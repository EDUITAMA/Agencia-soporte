import type { AIConfig } from "../config/config.js";
import type { AIAnalysisRecord, AuditAction, CaseRecord } from "../domain/types.js";
import { computeAIFingerprint } from "../intake/fingerprint.js";
import type { StateStore } from "../store/state-store.js";
import { PROMPT_VERSION } from "./prompt.js";
import { buildRequesterRequest } from "./request-builder.js";
import { type AIAnalysisProvider, AIError, type AIHealth } from "./types.js";

const HEALTH_TTL_MS = 30_000;

type Logger = Pick<Console, "error" | "info">;

/**
 * Runs AI analyses in the background with bounded concurrency. It only reads cases and writes analysis results to the
 * local store: it has no reference to the source adapter, so the AI can never act on Jira.
 */
export class AIAnalysisService {
  private readonly queue: string[] = [];
  private readonly queued = new Set<string>();
  private active = 0;
  private waiters: (() => void)[] = [];
  private health: AIHealth | null = null;

  constructor(
    private readonly provider: AIAnalysisProvider | null,
    private readonly config: AIConfig,
    private readonly store: StateStore,
    private readonly logger: Logger = console,
  ) {}

  get enabled(): boolean {
    return this.provider !== null;
  }

  get pending(): number {
    return this.queue.length + this.active;
  }

  async getHealth(force = false): Promise<AIHealth> {
    if (!this.provider) {
      return { state: "DISABLED", provider: this.config.provider, model: this.config.model, checkedAt: new Date().toISOString(), message: "Análisis con IA deshabilitado" };
    }
    if (!force && this.health && Date.now() - Date.parse(this.health.checkedAt) < HEALTH_TTL_MS) return this.health;
    this.health = await this.provider.healthCheck();
    return this.health;
  }

  stats() {
    const records = this.store.allCases();
    const count = (status: AIAnalysisRecord["status"]) => records.filter((record) => record.ai?.status === status).length;
    return {
      analyzed: count("COMPLETED"),
      queued: count("QUEUED"),
      analyzing: count("ANALYZING"),
      failed: count("FAILED"),
      skipped: count("SKIPPED"),
    };
  }

  private fingerprintFor(record: CaseRecord): string {
    return computeAIFingerprint(record.fingerprint, {
      promptVersion: PROMPT_VERSION,
      rulesVersion: record.validationVersion,
      provider: this.provider?.name ?? this.config.provider,
      model: this.provider?.model ?? this.config.model,
    });
  }

  private audit(caseId: string, action: AuditAction, result: string): void {
    this.store.appendAudit({
      timestamp: new Date().toISOString(),
      caseId,
      action,
      result,
      model: this.provider?.model ?? this.config.model,
      promptVersion: PROMPT_VERSION,
    });
  }

  private save(record: CaseRecord, ai: AIAnalysisRecord): void {
    this.store.upsertCase({ ...record, ai, request: buildRequesterRequest(record.supportCase, record.validation, ai.status === "COMPLETED" ? ai.result : undefined) });
  }

  /** Schedules analysis for a case unless an up-to-date result already exists. Returns immediately. */
  enqueue(caseId: string): void {
    const record = this.store.getCase(caseId);
    if (!record) return;
    const fingerprint = this.fingerprintFor(record);
    const base = { fingerprint, promptVersion: PROMPT_VERSION, provider: this.provider?.name ?? this.config.provider, model: this.provider?.model ?? this.config.model };

    if (!this.provider) {
      if (record.ai?.status !== "SKIPPED" || record.ai.fingerprint !== fingerprint) {
        this.save(record, { ...base, status: "SKIPPED", queuedAt: new Date().toISOString() });
      }
      return;
    }

    const current = record.ai;
    if (current && current.fingerprint === fingerprint) {
      if (current.status === "COMPLETED") {
        this.save(record, current);
        this.audit(caseId, "AI_ANALYSIS_REUSED", current.result?.status ?? "COMPLETED");
        return;
      }
      if ((current.status === "QUEUED" || current.status === "ANALYZING") && this.queued.has(caseId)) return;
      if (current.status === "FAILED") {
        const age = Date.now() - Date.parse(current.analyzedAt ?? current.queuedAt);
        if (age < this.config.retryFailedAfterSeconds * 1000) return;
      }
    }
    if (this.queued.has(caseId)) return;

    this.save(record, { ...base, status: "QUEUED", queuedAt: new Date().toISOString() });
    this.queued.add(caseId);
    this.queue.push(caseId);
    this.pump();
  }

  private pump(): void {
    while (this.active < this.config.maxConcurrency && this.queue.length > 0) {
      const caseId = this.queue.shift()!;
      this.active++;
      void this.run(caseId).finally(() => {
        this.queued.delete(caseId);
        this.active--;
        this.pump();
        if (this.pending === 0) this.waiters.splice(0).forEach((resolve) => resolve());
      });
    }
  }

  /** Resolves when the queue is empty and nothing is running (used by tests and graceful shutdown). */
  idle(): Promise<void> {
    return this.pending === 0 ? Promise.resolve() : new Promise((resolve) => this.waiters.push(resolve));
  }

  private async run(caseId: string): Promise<void> {
    const record = this.store.getCase(caseId);
    if (!record || !this.provider) return;
    const fingerprint = this.fingerprintFor(record);
    if (record.ai?.fingerprint !== fingerprint) return;

    const startedMs = Date.now();
    const aiStartedAt = new Date(startedMs).toISOString();
    this.save(record, { ...record.ai, status: "ANALYZING", aiStartedAt });
    this.audit(caseId, "AI_ANALYSIS_STARTED", "ANALYZING");
    const timing = () => {
      const now = Date.now();
      return { aiStartedAt, aiCompletedAt: new Date(now).toISOString(), analyzedAt: new Date(now).toISOString(), durationMs: now - startedMs };
    };

    try {
      const result = await this.provider.analyze({ supportCase: record.supportCase, validation: record.validation });
      const latest = this.store.getCase(caseId);
      // The case changed while the model was working: this result is stale; the next sync re-queues it.
      if (!latest || this.fingerprintFor(latest) !== fingerprint || !latest.ai) return;
      this.save(latest, { ...latest.ai, ...timing(), status: "COMPLETED", result, errorKind: undefined, errorMessage: undefined });
      this.audit(caseId, "AI_ANALYSIS_COMPLETED", result.status);
    } catch (error) {
      const aiError = error instanceof AIError ? error : new AIError("AI_ANALYSIS_ERROR", String((error as Error)?.message ?? error));
      this.logger.error(`[ai] analysis failed for ${caseId}: ${aiError.kind} ${aiError.technicalDetail}`);
      const latest = this.store.getCase(caseId);
      if (latest?.ai && this.fingerprintFor(latest) === fingerprint) {
        this.save(latest, { ...latest.ai, ...timing(), status: "FAILED", errorKind: aiError.kind, errorMessage: aiError.userMessage });
      }
      this.audit(caseId, "AI_ANALYSIS_FAILED", aiError.kind);
    }
  }
}
