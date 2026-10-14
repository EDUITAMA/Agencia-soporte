import { HttpClient, HttpErrorResponse } from "@angular/common/http";
import { computed, inject, Injectable, signal } from "@angular/core";
import { firstValueFrom } from "rxjs";

import type { AuditEntry, CaseRecord, Overview, RunSummary } from "./models";

const BASE = "/api/support-guard";
const POLL_MS = 3000;

/** Front-end facade over the Support Guard API. The UI never talks to Jira directly. */
@Injectable({ providedIn: "root" })
export class SupportGuardService {
  private readonly http = inject(HttpClient);

  readonly overview = signal<Overview | null>(null);
  readonly cases = signal<CaseRecord[]>([]);
  readonly loading = signal(true);
  readonly running = signal(false);
  readonly error = signal<string | null>(null);
  readonly lastRunMessage = signal<string | null>(null);
  readonly selectedAudit = signal<AuditEntry[]>([]);
  readonly copiedCase = signal<string | null>(null);
  readonly returningCase = signal<string | null>(null);
  readonly returnFeedback = signal<{ caseId: string; ok: boolean; text: string } | null>(null);
  readonly bulkReturning = signal(false);
  readonly bulkFeedback = signal<{ ok: boolean; text: string } | null>(null);

  /** Human-triggered return from the case detail. The backend uses its stored message and honours DRY_RUN/LIVE. */
  async returnCase(caseId: string): Promise<void> {
    if (this.returningCase()) return;
    this.returningCase.set(caseId);
    this.returnFeedback.set(null);
    try {
      const result = await firstValueFrom(this.http.post<{ case: CaseRecord; mode: string }>(`${BASE}/cases/${encodeURIComponent(caseId)}/return`, {}));
      this.cases.update((list) => list.map((record) => (record.caseId === caseId ? result.case : record)));
      this.returnFeedback.set({
        caseId,
        ok: true,
        text: result.mode === "DRY_RUN" ? "Simulación registrada (DRY_RUN): Jira no fue modificado." : "Caso devuelto en Jira con el mensaje al solicitante.",
      });
      await this.loadAudit(caseId);
    } catch (error) {
      const message = error instanceof HttpErrorResponse ? (error.error as { error?: { message?: string } } | null)?.error?.message : undefined;
      this.returnFeedback.set({ caseId, ok: false, text: message ?? "No fue posible devolver el caso. Intente nuevamente." });
    } finally {
      this.returningCase.set(null);
    }
  }

  /** Returns the selected cases one by one; a failure on one case does not stop the rest. */
  async returnMany(caseIds: string[]): Promise<void> {
    if (this.bulkReturning() || caseIds.length === 0) return;
    this.bulkReturning.set(true);
    this.bulkFeedback.set(null);
    let done = 0;
    let failed = 0;
    for (const caseId of caseIds) {
      try {
        const result = await firstValueFrom(this.http.post<{ case: CaseRecord; mode: string }>(`${BASE}/cases/${encodeURIComponent(caseId)}/return`, {}));
        this.cases.update((list) => list.map((record) => (record.caseId === caseId ? result.case : record)));
        done++;
      } catch {
        failed++;
      }
    }
    const dry = this.overview()?.actionsMode !== "LIVE";
    this.bulkFeedback.set({
      ok: failed === 0,
      text: `${dry ? "Simulación registrada (DRY_RUN, Jira no fue modificado)" : "Devueltos en Jira"}: ${done} de ${caseIds.length}${failed ? ` · ${failed} con error o no elegibles` : ""}.`,
    });
    this.bulkReturning.set(false);
  }

  async copyMessage(caseId: string, message: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(message);
      this.copiedCase.set(caseId);
      setTimeout(() => this.copiedCase.set(null), 2000);
    } catch {
      this.copiedCase.set(null);
    }
  }
  /** True while the first sync on entry is running (cached state is already shown). */
  readonly syncing = signal(false);
  readonly jiraUnavailable = signal(false);

  private initialized = false;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;

  readonly applications = computed(() =>
    [...new Set(this.cases().map((record) => record.supportCase.application).filter(Boolean))].sort(),
  );

  /**
   * Runs once per application lifecycle: show cached state immediately, then trigger the single startup sync.
   * Later calls are no-ops, so render/change detection can never fan out into several syncs.
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
    await this.refresh();
    this.syncing.set(true);
    try {
      const result = await firstValueFrom(this.http.post<{ performed: boolean; summary: RunSummary | null }>(`${BASE}/sync/startup`, {}));
      this.jiraUnavailable.set(!!result.summary?.sourceError);
      await this.refresh(true);
    } catch {
      this.jiraUnavailable.set(true);
    } finally {
      this.syncing.set(false);
    }
  }

  async refresh(silent = false): Promise<void> {
    if (!silent) this.loading.set(true);
    try {
      const [overview, cases] = await Promise.all([
        firstValueFrom(this.http.get<Overview>(`${BASE}/overview`)),
        firstValueFrom(this.http.get<{ cases: CaseRecord[] }>(`${BASE}/cases`)),
      ]);
      this.overview.set(overview);
      this.cases.set(cases.cases);
      this.error.set(null);
      this.schedulePoll(overview, cases.cases);
    } catch (error) {
      this.error.set(describeError(error));
    } finally {
      this.loading.set(false);
    }
  }

  /** AI analysis finishes after the table is usable; poll gently only while jobs are pending. */
  private schedulePoll(overview: Overview, cases: CaseRecord[]): void {
    if (this.pollTimer) clearTimeout(this.pollTimer);
    this.pollTimer = null;
    const pending = (overview.ai?.pending ?? 0) > 0 || cases.some((record) => record.ai?.status === "QUEUED" || record.ai?.status === "ANALYZING");
    if (pending) this.pollTimer = setTimeout(() => void this.refresh(true), POLL_MS);
  }

  async runValidation(): Promise<void> {
    if (this.running()) return;
    this.running.set(true);
    this.lastRunMessage.set(null);
    try {
      const { summary } = await firstValueFrom(this.http.post<{ summary: RunSummary }>(`${BASE}/validation/run`, {}));
      this.jiraUnavailable.set(!!summary.sourceError);
      this.lastRunMessage.set(
        summary.sourceError
          ? summary.sourceError
          : `${summary.found} casos revisados · ${summary.processed} evaluados · ${summary.skippedUnchanged} sin cambios`,
      );
      await this.refresh();
    } catch (error) {
      this.error.set(describeError(error));
    } finally {
      this.running.set(false);
    }
  }

  async loadAudit(caseId: string): Promise<void> {
    this.selectedAudit.set([]);
    try {
      const detail = await firstValueFrom(this.http.get<{ audit: AuditEntry[] }>(`${BASE}/cases/${encodeURIComponent(caseId)}`));
      this.selectedAudit.set(detail.audit);
    } catch {
      this.selectedAudit.set([]);
    }
  }
}

function describeError(error: unknown): string {
  if (error instanceof HttpErrorResponse && error.status === 0) return "No fue posible comunicarse con el servicio de Support Guard.";
  return "Support Guard no pudo completar la operación. Intente nuevamente.";
}
