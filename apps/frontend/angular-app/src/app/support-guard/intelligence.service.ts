import { HttpClient, HttpErrorResponse } from "@angular/common/http";
import { inject, Injectable, signal } from "@angular/core";
import { firstValueFrom } from "rxjs";

import type { AnalysisEstimate, AnalysisMode, AnalysisRun, CasePage, ClusterDetail, ClusterSummary, ComparisonReport, DataQualityReport, ExecutiveReport, PeriodLookup, PeriodType, PreAnalysis, ResolvedPeriod } from "./intelligence.models";

const BASE = "/api/support-guard/intelligence";
const POLL_MS = 2500;
const ACTIVE = new Set(["QUEUED", "SYNCING_JIRA", "NORMALIZING", "CLUSTERING", "ANALYZING", "VALIDATING", "GENERATING_REPORT"]);

export interface ObjectiveRequest {
  mode: AnalysisMode;
  clusterIds?: string[];
  includeLowConfidence?: boolean;
}

export interface PeriodSelection {
  type: PeriodType;
  month?: string;
  from?: string;
  to?: string;
}

/** Front-end facade for Support Intelligence. Read-only: it never writes to Jira. */
@Injectable({ providedIn: "root" })
export class IntelligenceService {
  private readonly http = inject(HttpClient);
  private timer?: ReturnType<typeof setTimeout>;

  readonly periods = signal<ResolvedPeriod[]>([]);
  readonly preview = signal<ResolvedPeriod | null>(null);
  readonly runs = signal<AnalysisRun[]>([]);
  readonly run = signal<AnalysisRun | null>(null);
  readonly clusters = signal<ClusterSummary[]>([]);
  readonly executive = signal<ExecutiveReport | null>(null);
  readonly quality = signal<DataQualityReport | null>(null);
  readonly comparison = signal<ComparisonReport | null>(null);
  readonly detail = signal<ClusterDetail | null>(null);
  readonly casePage = signal<CasePage | null>(null);
  readonly error = signal<string | null>(null);
  readonly starting = signal(false);
  readonly checking = signal(false);
  readonly executing = signal(false);
  readonly staleBlocked = signal(false);
  readonly checkNote = signal<string | null>(null);
  readonly lookup = signal<PeriodLookup | null>(null);
  readonly pre = signal<PreAnalysis | null>(null);
  readonly estimate = signal<AnalysisEstimate | null>(null);
  readonly loadingDetail = signal(false);

  get running(): boolean {
    const status = this.run()?.status;
    return Boolean(status && ACTIVE.has(status));
  }

  private message(error: unknown, fallback: string): string {
    return (error instanceof HttpErrorResponse && (error.error as { error?: { message?: string } } | null)?.error?.message) || fallback;
  }

  async initialize(): Promise<void> {
    try {
      const { periods } = await firstValueFrom(this.http.get<{ periods: ResolvedPeriod[] }>(`${BASE}/periods`));
      this.periods.set(periods);
      await this.loadRuns();
    } catch (error) {
      this.error.set(this.message(error, "No fue posible cargar Support Intelligence."));
    }
  }

  private params(selection: PeriodSelection, type = "type"): URLSearchParams {
    const params = new URLSearchParams({ [type]: selection.type });
    for (const key of ["month", "from", "to"] as const) if (selection[key]) params.set(key, selection[key]!);
    return params;
  }

  /** Resolves the period and looks up an equivalent stored analysis. Local only: it never calls Jira or AI. */
  async previewPeriod(selection: PeriodSelection): Promise<void> {
    try {
      const { periods } = await firstValueFrom(this.http.get<{ periods: ResolvedPeriod[] }>(`${BASE}/periods?${this.params(selection)}`));
      this.preview.set(periods[0] ?? null);
      this.checkNote.set(null);
      this.error.set(null);
      this.lookup.set(await firstValueFrom(this.http.get<PeriodLookup>(`${BASE}/analysis/lookup?${this.params(selection, "periodType")}`)));
    } catch (error) {
      this.preview.set(null);
      this.lookup.set(null);
      this.error.set(this.message(error, "Periodo inválido."));
    }
  }

  async loadRuns(): Promise<void> {
    const { runs } = await firstValueFrom(this.http.get<{ runs: AnalysisRun[] }>(`${BASE}/analysis`));
    this.runs.set(runs);
  }

  /** "Verificar cambios": incremental Jira check only (no full download, no AI). */
  async check(selection: PeriodSelection): Promise<void> {
    if (this.checking() || this.running) return;
    this.checking.set(true);
    this.error.set(null);
    try {
      const result = await firstValueFrom(this.http.post<PeriodLookup>(`${BASE}/analysis/check`, { periodType: selection.type, month: selection.month, from: selection.from, to: selection.to }));
      this.lookup.set(result);
      this.checkNote.set(result.checked ? (result.changedCases ? `${result.changedCases} caso(s) cambiaron en Jira desde el último análisis.` : "Sin cambios en Jira desde el último análisis.") : "Aún no hay datos sincronizados para este periodo.");
    } catch (error) {
      this.error.set(this.message(error, "No fue posible verificar cambios."));
    } finally {
      this.checking.set(false);
    }
  }

  /** Loads the stored analysis for the looked-up period. Never creates a run. */
  async openExisting(): Promise<void> {
    const run = this.lookup()?.run;
    if (run) await this.select(run.id);
  }

  /** Prepares data (no AI). Reuses a REUSABLE run unless `refresh` ("Recalcular") is explicit. */
  async start(selection: PeriodSelection, refresh = false): Promise<void> {
    if (this.starting() || this.running) return;
    this.starting.set(true);
    this.error.set(null);
    try {
      const body = { periodType: selection.type, month: selection.month, from: selection.from, to: selection.to, refresh };
      const { runId } = await firstValueFrom(this.http.post<{ runId: string }>(`${BASE}/analysis`, body));
      this.clearResults();
      await this.select(runId);
    } catch (error) {
      this.error.set(this.message(error, "No fue posible iniciar el análisis."));
    } finally {
      this.starting.set(false);
    }
  }

  private clearResults(): void {
    this.clusters.set([]);
    this.executive.set(null);
    this.quality.set(null);
    this.comparison.set(null);
    this.casePage.set(null);
    this.detail.set(null);
    this.pre.set(null);
    this.estimate.set(null);
  }

  async select(runId: string): Promise<void> {
    clearTimeout(this.timer);
    try {
      const { run } = await firstValueFrom(this.http.get<{ run: AnalysisRun }>(`${BASE}/analysis/${runId}`));
      if (this.run()?.id !== run.id) this.clearResults();
      this.run.set(run);
      if (ACTIVE.has(run.status)) {
        this.timer = setTimeout(() => void this.select(runId), POLL_MS);
        return;
      }
      await this.loadRuns();
      if (run.status !== "FAILED") await this.loadResults(runId);
      else this.clearResults();
    } catch (error) {
      this.error.set(this.message(error, "No fue posible consultar el análisis."));
    }
  }

  async estimateObjective(request: ObjectiveRequest): Promise<void> {
    const run = this.run();
    if (!run) return;
    try {
      this.estimate.set(await firstValueFrom(this.http.post<AnalysisEstimate>(`${BASE}/analysis/${run.id}/estimate`, request)));
      this.error.set(null);
    } catch (error) {
      this.estimate.set(null);
      this.error.set(this.message(error, "No fue posible estimar el análisis."));
    }
  }

  /** Runs the AI stage. Only called after an explicit user confirmation. */
  async execute(request: ObjectiveRequest): Promise<void> {
    const run = this.run();
    if (!run || this.running || this.executing()) return;
    this.executing.set(true);
    this.error.set(null);
    try {
      await firstValueFrom(this.http.post(`${BASE}/analysis/${run.id}/execute`, { ...request, confirm: true }));
      await this.select(run.id);
    } catch (error) {
      const stale = error instanceof HttpErrorResponse && (error.error as { error?: { code?: string } } | null)?.error?.code === "STALE_DATA";
      this.error.set(this.message(error, "No fue posible ejecutar el análisis."));
      if (stale) this.staleBlocked.set(true);
    } finally {
      this.executing.set(false);
    }
  }

  private async loadResults(runId: string): Promise<void> {
    const get = <T>(path: string) => firstValueFrom(this.http.get<T>(`${BASE}/analysis/${runId}/${path}`));
    const [clusters, executive, quality, comparison, pre] = await Promise.all([
      get<{ clusters: ClusterSummary[] }>("clusters"),
      get<{ content: ExecutiveReport }>("report?kind=executive"),
      get<{ content: DataQualityReport }>("report?kind=data_quality"),
      get<{ content: ComparisonReport }>("report?kind=period_comparison"),
      get<PreAnalysis>("pre-analysis"),
    ]);
    this.clusters.set(clusters.clusters);
    this.executive.set(executive.content);
    this.quality.set(quality.content);
    this.comparison.set(comparison.content);
    this.pre.set(pre);
    this.staleBlocked.set(false);
    await this.loadCases({ page: 1 });
  }

  async openCluster(clusterId: string): Promise<void> {
    const run = this.run();
    if (!run) return;
    this.loadingDetail.set(true);
    try {
      this.detail.set(await firstValueFrom(this.http.get<ClusterDetail>(`${BASE}/analysis/${run.id}/clusters/${clusterId}`)));
    } catch (error) {
      this.error.set(this.message(error, "No fue posible cargar el grupo."));
    } finally {
      this.loadingDetail.set(false);
    }
  }

  closeCluster(): void {
    this.detail.set(null);
  }

  async loadCases(filters: { page: number; eligibility?: string; clusterId?: string; search?: string; status?: string }): Promise<void> {
    const run = this.run();
    if (!run) return;
    const params = new URLSearchParams({ page: String(filters.page), pageSize: "10" });
    for (const key of ["eligibility", "clusterId", "search", "status"] as const) if (filters[key]) params.set(key, filters[key]!);
    try {
      this.casePage.set(await firstValueFrom(this.http.get<CasePage>(`${BASE}/analysis/${run.id}/cases?${params}`)));
    } catch (error) {
      this.error.set(this.message(error, "No fue posible cargar los casos."));
    }
  }
}
