import { type CaseSourceAdapter, SourceError } from "../adapters/case-source.js";
import { CaseActionService } from "../actions/case-actions.js";
import { buildRequesterRequest } from "../ai/request-builder.js";
import type { SupportGuardConfig } from "../config/config.js";
import type {
  ActionRecord,
  AuditAction,
  CaseRecord,
  RunSummary,
  SupportCase,
  ValidationStatus,
} from "../domain/types.js";
import { evaluateSufficiency } from "../sufficiency/sufficiency-engine.js";
import type { StateStore } from "../store/state-store.js";
import { validateRequiredFields } from "../validation/required-fields.js";
import { computeFingerprint, computeValidationVersion } from "./fingerprint.js";

/** Grace period so our own comment/transition does not look like a user edit. */
const REOPEN_GRACE_MS = 120_000;

export { computeFingerprint, computeValidationVersion };

/** Minimal hook the intake needs from the AI layer. It cannot reach Jira through it. */
export interface AIEnqueuer {
  enqueue(caseId: string): void;
}

export class CaseIntakeService {
  private running: Promise<RunSummary> | null = null;
  private readonly actions: CaseActionService;

  constructor(
    private readonly adapter: CaseSourceAdapter,
    private readonly config: SupportGuardConfig,
    private readonly store: StateStore,
    private readonly logger: Pick<Console, "error" | "info"> = console,
    private readonly ai?: AIEnqueuer,
  ) {
    this.actions = new CaseActionService(adapter, config);
  }

  get isRunning(): boolean {
    return this.running !== null;
  }

  /**
   * Sync triggered when a user opens the app. Joins an in-flight run, and skips the Jira call entirely when the data
   * is fresher than startupSync.maxAgeSeconds, so reloads and several tabs never cause a burst of syncs.
   */
  async startupSync(): Promise<{ performed: boolean; summary: RunSummary | null }> {
    if (this.running) return { performed: false, summary: await this.running };
    const { enabled, maxAgeSeconds } = this.config.startupSync;
    const lastSync = this.store.lastSyncAt;
    const fresh = lastSync !== null && Date.now() - Date.parse(lastSync) < maxAgeSeconds * 1000;
    if (!enabled || fresh) return { performed: false, summary: this.store.lastRun };
    return { performed: true, summary: await this.run("STARTUP") };
  }

  /** Runs one intake cycle. Concurrent calls share the in-flight run instead of starting another. */
  run(trigger: RunSummary["trigger"]): Promise<RunSummary> {
    if (!this.running) {
      this.running = this.execute(trigger).finally(() => {
        this.running = null;
      });
    }
    return this.running;
  }

  private audit(caseId: string, action: AuditAction, result: string): void {
    this.store.appendAudit({ timestamp: new Date().toISOString(), caseId, action, result });
  }

  /** Manual return requested by a user from the case detail. The message always comes from the stored request, never from the client. */
  async returnWithRequest(caseId: string): Promise<{ ok: true; record: CaseRecord } | { ok: false; code: "NOT_FOUND" | "NO_REQUEST" | "AI_PENDING" | "ALREADY_RETURNED" | "JIRA_ERROR"; message: string }> {
    const record = this.store.getCase(caseId);
    if (!record) return { ok: false, code: "NOT_FOUND", message: "El caso no ha sido procesado" };
    if (!record.request) return { ok: false, code: "NO_REQUEST", message: "Este caso no requiere solicitar información" };
    if (record.ai?.status === "QUEUED" || record.ai?.status === "ANALYZING") {
      return { ok: false, code: "AI_PENDING", message: "El análisis con IA aún está en curso; espere para revisar el mensaje final" };
    }
    if (record.validationStatus === "RETURNED") return { ok: false, code: "ALREADY_RETURNED", message: "El caso ya fue devuelto" };

    let postedCommentKey = record.postedCommentKey;
    try {
      const action = await this.actions.returnWithMessage(record.supportCase, record.request.message, {
        postedCommentKey,
        onCommentPosted: (key) => {
          postedCommentKey = key;
        },
      });
      const status: ValidationStatus = action.type === "DRY_RUN" ? "DRY_RUN" : "RETURNED";
      this.audit(caseId, status === "DRY_RUN" ? "CASE_RETURN_DRY_RUN" : "CASE_RETURNED", "MANUAL");
      const updated = { ...record, validationStatus: status, lastAction: action, errorMessage: undefined, postedCommentKey };
      this.store.upsertCase(updated);
      return { ok: true, record: updated };
    } catch (error) {
      const sourceError = error instanceof SourceError ? error : new SourceError("UNKNOWN", String(error));
      this.logger.error(`[intake] manual return failed for ${caseId}: ${sourceError.kind}`);
      this.audit(caseId, "JIRA_ERROR", sourceError.kind);
      // Keep the posted-comment key so a retry does not duplicate the comment when only the transition failed.
      this.store.upsertCase({ ...record, postedCommentKey });
      return { ok: false, code: "JIRA_ERROR", message: sourceError.userMessage };
    }
  }

  private async execute(trigger: RunSummary["trigger"]): Promise<RunSummary> {
    const summary: RunSummary = {
      trigger,
      startedAt: new Date().toISOString(),
      finishedAt: "",
      found: 0,
      processed: 0,
      skippedUnchanged: 0,
      complete: 0,
      incomplete: 0,
      returned: 0,
      dryRun: 0,
      errors: 0,
    };

    let cases: SupportCase[];
    try {
      cases = await this.adapter.fetchNewCases();
    } catch (error) {
      const sourceError = error instanceof SourceError ? error : new SourceError("UNKNOWN", String(error));
      this.logger.error(`[intake] fetch failed: ${sourceError.kind} ${sourceError.technicalDetail}`);
      this.audit("-", "JIRA_ERROR", sourceError.kind);
      summary.sourceError = sourceError.userMessage;
      summary.errors = 1;
      summary.finishedAt = new Date().toISOString();
      this.store.recordRun(summary, false);
      return summary;
    }

    summary.found = cases.length;
    for (const supportCase of cases) {
      await this.processCase(supportCase, summary);
    }
    summary.finishedAt = new Date().toISOString();
    this.store.recordRun(summary, true);
    return summary;
  }

  private needsReprocessing(existing: CaseRecord, supportCase: SupportCase, fingerprint: string, version: string): boolean {
    if (existing.fingerprint !== fingerprint || existing.validationVersion !== version) return true;
    const action = existing.lastAction;
    if (existing.validationStatus === "ERROR") return true;
    // A simulated action must be executed for real once the mode is switched to LIVE.
    if (action?.type === "DRY_RUN" && this.actions.mode === "LIVE") return true;
    // Returned earlier and showing up as "new" again after a later edit: the requester answered.
    if (action?.type === "RETURNED" && Date.parse(supportCase.updatedAt) > Date.parse(action.at) + REOPEN_GRACE_MS) return true;
    return false;
  }

  private async processCase(supportCase: SupportCase, summary: RunSummary): Promise<void> {
    const now = new Date().toISOString();
    const fingerprint = computeFingerprint(supportCase);
    const version = computeValidationVersion(this.config);
    const existing = this.store.getCase(supportCase.id);

    if (existing && !this.needsReprocessing(existing, supportCase, fingerprint, version)) {
      this.store.upsertCase({ ...existing, lastSeenAt: now });
      summary.skippedUnchanged++;
      this.tally(summary, existing.validationStatus);
      // Unchanged cases only need AI when they never got a (successful) analysis, e.g. AI was off or down earlier.
      if (existing.ai?.status !== "COMPLETED") this.ai?.enqueue(supportCase.id);
      return;
    }

    if (!existing) this.audit(supportCase.id, "CASE_DISCOVERED", `status=${supportCase.status}`);

    try {
      const validation = validateRequiredFields(supportCase, this.config.validation);
      const sufficiency = evaluateSufficiency(supportCase, this.config.sufficiency);
      this.audit(supportCase.id, "CASE_VALIDATED", validation.valid ? "COMPLETE" : "INCOMPLETE");
      this.audit(supportCase.id, "SUFFICIENCY_EVALUATED", `${sufficiency.status} (${sufficiency.score})`);

      let action: ActionRecord | null = null;
      let status: ValidationStatus = "COMPLETE";
      let errorMessage: string | undefined;
      let postedCommentKey = existing?.postedCommentKey;

      if (!validation.valid) {
        this.audit(supportCase.id, "CASE_MISSING_FIELDS", validation.missingFields.join(","));
        try {
          action = await this.actions.returnCase(supportCase, validation, {
            postedCommentKey,
            onCommentPosted: (key) => {
              postedCommentKey = key;
            },
          });
          if (action.type === "DRY_RUN") {
            status = "DRY_RUN";
            this.audit(supportCase.id, "CASE_RETURN_DRY_RUN", "Would return case");
          } else {
            status = "RETURNED";
            this.audit(supportCase.id, "CASE_RETURNED", action.type);
          }
        } catch (error) {
          const sourceError = error instanceof SourceError ? error : new SourceError("UNKNOWN", String(error));
          this.logger.error(`[intake] return failed for ${supportCase.id}: ${sourceError.kind} ${sourceError.technicalDetail}`);
          this.audit(supportCase.id, "JIRA_ERROR", sourceError.kind);
          action = { type: "ERROR", mode: this.actions.mode, at: new Date().toISOString(), detail: sourceError.userMessage };
          status = "ERROR";
          errorMessage = sourceError.userMessage;
        }
      }

      this.store.upsertCase({
        caseId: supportCase.id,
        supportCase,
        fingerprint,
        validationVersion: version,
        validationStatus: status,
        validation,
        sufficiency,
        lastAction: action,
        firstSeenAt: existing?.firstSeenAt ?? now,
        lastSeenAt: now,
        lastCheckedAt: now,
        lastProcessedAt: now,
        errorMessage,
        postedCommentKey,
        ai: existing?.ai,
        request: buildRequesterRequest(supportCase, validation, undefined),
      });
      summary.processed++;
      this.tally(summary, status);
      this.ai?.enqueue(supportCase.id);
    } catch (error) {
      this.logger.error(`[intake] unexpected failure for ${supportCase.id}: ${(error as Error).message}`);
      this.audit(supportCase.id, "JIRA_ERROR", "PROCESSING_FAILED");
      summary.errors++;
    }
  }

  private tally(summary: RunSummary, status: ValidationStatus): void {
    if (status === "COMPLETE") summary.complete++;
    else if (status === "ERROR") summary.errors++;
    else {
      summary.incomplete++;
      if (status === "RETURNED") summary.returned++;
      if (status === "DRY_RUN") summary.dryRun++;
    }
  }
}
