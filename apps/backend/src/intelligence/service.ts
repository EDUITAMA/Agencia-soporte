import { randomUUID } from "node:crypto";

import { SourceError } from "../adapters/case-source.js";
import type { JiraIssue } from "../adapters/jira-normalizer.js";
import { ClusterAnalyzer, type ClusterAnalysis } from "./ai/analysis.js";
import { RolePipeline, type DeepDetail } from "./deep/pipeline.js";
import type { LlmClient } from "./ai/llm.js";
import { AnalyticalStore, type Row } from "./analytical-store.js";
import { buildUnits, profileErrorMessages, type ErrorProfile } from "./canonical.js";
import { clusterUnits, matchToClusters } from "./clustering.js";
import { ANALYSIS_VERSION, ANALYST_PIPELINE_VERSION, CLUSTERING_VERSION, modelConfigOf, NORMALIZATION_VERSION, PROMPT_VERSION, type IntelligenceConfig } from "./config.js";
import { segmentFailures } from "./failures.js";
import { aiFingerprint, clusterAiKey, DEPTH_OF, estimateWorkload, HIGH_PRIORITY, priorityScore, resolveSelection, scopeFingerprint, sha, type AiDepth, type AnalysisMode, type ReuseState, type SelectableCluster, type SelectionResult, type WorkloadEstimate } from "./lifecycle.js";
import { historicalJiraFields, sanitizeCase, toAnalyticalCase } from "./normalize.js";
import { addDays, exclusiveEnd, periodFromRange, previousPeriod, resolvePeriod, type PeriodRequest } from "./periods.js";
import { buildReports, REPORT_KINDS, trendOf, type ReportKind, type Trend } from "./report.js";
import type { HistoricalIssueSource } from "./source.js";
import type { AnalysisStatus, AnalyticalCase, CanonicalUnit, ClusterResult, PeriodType, ResolvedPeriod } from "./types.js";

export interface AnalysisRequest extends PeriodRequest {
  /** Explicit "Recalcular": ignore a reusable run, re-read Jira fully and create a new run. */
  refresh?: boolean;
  trigger?: "MANUAL" | "SCHEDULED";
  /** When set, the AI stage runs right after preparation (used by the scheduler). */
  mode?: AnalysisMode;
}

export interface ExecuteRequest {
  mode: AnalysisMode;
  clusterIds?: string[];
  includeLowConfidence?: boolean;
}

interface AnalysisPlan {
  selection: SelectionResult;
  estimate: WorkloadEstimate;
  period: ResolvedPeriod;
  previousStatus: string;
  request: ExecuteRequest;
}

export interface LookupResult {
  state: ReuseState;
  period: ResolvedPeriod;
  scopeFingerprint: string;
  run: ReturnType<IntelligenceService["runView"]> | null;
  lastSyncAt: string | null;
  lastCheckedAt: string | null;
  activeRunId: string | null;
}

export class ActiveRunError extends Error {
  constructor(readonly runId: string) {
    super("Ya hay un análisis en ejecución");
  }
}

export class RunStateError extends Error {}

export class StaleRunError extends Error {
  constructor() {
    super("Los datos de Jira cambiaron desde que se prepararon estos resultados. Actualice el periodo antes de analizar con IA.");
  }
}

export interface ProgressInfo {
  phase: AnalysisStatus;
  percent: number;
  message: string;
  clustersDone?: number;
  clustersTotal?: number;
  reusedFrom?: string;
}

type FullCluster = ClusterResult & { previousCount?: number; trend: Trend };

export interface OpsUnitRow {
  unit: CanonicalUnit;
  eligible: boolean;
}

const PHASE_PERCENT: Record<string, number> = { QUEUED: 2, SYNCING_JIRA: 15, NORMALIZING: 40, CLUSTERING: 50, ANALYZING: 60, VALIDATING: 85, GENERATING_REPORT: 92, PREPARED: 100, COMPLETED: 100, PARTIAL: 100, FAILED: 100 };
const json = (value: unknown) => JSON.stringify(value);
const parse = <T>(value: unknown, fallback: T): T => {
  if (typeof value !== "string" || !value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
};
const s = (value: unknown) => (value === null || value === undefined ? "" : String(value));
const chunk = <T>(items: T[], size: number): T[][] => Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, (index + 1) * size));
const jqlDateTime = (date: Date) => date.toISOString().slice(0, 16).replace("T", " ");

export interface IntelligenceDeps {
  config: IntelligenceConfig;
  store: AnalyticalStore;
  source: HistoricalIssueSource;
  llm: LlmClient;
  projectKey?: string;
  now?: () => Date;
}

/** Orchestrates the read-only analytical pipeline. It never calls a Jira write operation. */
export class IntelligenceService {
  private activeRunId?: string;
  private checking = false;
  private readonly analyzer: ClusterAnalyzer;
  private readonly pipeline: RolePipeline;
  private readonly now: () => Date;

  close(): void {
    this.deps.store.close();
  }

  constructor(private readonly deps: IntelligenceDeps) {
    this.analyzer = new ClusterAnalyzer(deps.llm, deps.config);
    this.pipeline = new RolePipeline(deps.llm, deps.config, this.analyzer, {
      get: async (key) => (await this.cacheGet([key]))?.value,
      put: (key, value) => this.cachePut(key, "", "ROLE", value),
    });
    this.now = deps.now ?? (() => new Date());
  }

  get config() {
    return this.deps.config;
  }

  get activeRun(): string | undefined {
    return this.activeRunId;
  }

  previewPeriod(request: PeriodRequest): ResolvedPeriod {
    return resolvePeriod(request, this.deps.config, this.now());
  }

  /**
   * Prepares data for a period. If an equivalent, unchanged run exists it is returned as-is (no Jira, no AI);
   * otherwise a NEW run is created (history is never overwritten). `refresh` forces a full re-read.
   */
  async start(request: AnalysisRequest, options: { wait?: boolean } = {}): Promise<{ runId: string; period: ResolvedPeriod; reused: boolean; state: ReuseState }> {
    const period = this.previewPeriod(request);
    if (this.activeRunId || this.checking) throw new ActiveRunError(this.activeRunId ?? "check");
    const lookup = await this.lookupPeriod(period);
    if (!request.refresh && lookup.state === "REUSABLE" && lookup.run) return { runId: lookup.run.id, period, reused: true, state: "REUSABLE" };

    const runId = `run_${randomUUID().slice(0, 12)}`;
    this.activeRunId = runId;
    const prev = previousPeriod(period);
    const progress: ProgressInfo = { phase: "QUEUED", percent: PHASE_PERCENT.QUEUED, message: "En cola" };
    try {
      await this.deps.store.run(
        `INSERT INTO analysis_runs (id, period_type, period_from, period_to, previous_from, previous_to, status, progress_json, fingerprint, analysis_version, clustering_version, prompt_version, model_config, trigger, started_at, warnings_json, normalization_version, pipeline_version)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [runId, period.type, period.from, period.to, prev.from, prev.to, "QUEUED", json(progress), lookup.scopeFingerprint, ANALYSIS_VERSION, CLUSTERING_VERSION, PROMPT_VERSION, json(modelConfigOf(this.deps.config)), request.trigger ?? "MANUAL", this.now().toISOString(), json(period.warnings), NORMALIZATION_VERSION, ANALYST_PIPELINE_VERSION],
      );
    } catch (error) {
      this.activeRunId = undefined;
      throw error;
    }
    const job = (async () => {
      if (!(await this.prepare(runId, period, Boolean(request.refresh)))) return;
      if (request.mode) await this.executeAnalysis(runId, await this.beginAnalysis(runId, { mode: request.mode }));
    })().finally(() => {
      this.activeRunId = undefined;
    });
    if (options.wait) await job;
    else job.catch(() => undefined);
    return { runId, period, reused: false, state: lookup.state };
  }

  // ------------------------------------------------------------ reuse lookup

  async lookup(request: PeriodRequest): Promise<LookupResult> {
    return this.lookupPeriod(this.previewPeriod(request));
  }

  /** Local-only: decides whether an existing run can be shown without touching Jira or AI. */
  private async lookupPeriod(period: ResolvedPeriod): Promise<LookupResult> {
    const { store, config } = this.deps;
    const scope = scopeFingerprint({ project: this.deps.projectKey, from: period.from, to: period.to, config });
    const rows = await store.query(`SELECT * FROM analysis_runs WHERE period_from = ? AND period_to = ? AND status IN ('PREPARED','COMPLETED','PARTIAL') ORDER BY started_at DESC`, [period.from, period.to]);
    const sync = await store.queryOne(`SELECT started_at FROM jira_sync_runs WHERE status = 'COMPLETED' AND period_from = ? AND period_to = ? ORDER BY started_at DESC LIMIT 1`, [period.from, period.to]);
    const base = { period, scopeFingerprint: scope, lastSyncAt: sync ? s(sync.started_at) : null, activeRunId: this.activeRunId ?? null };
    const match = rows.find((row) => s(row.fingerprint) === scope && row.data_fingerprint);
    if (match) {
      const current = await this.dataFingerprint(period);
      const state: ReuseState = current === s(match.data_fingerprint) ? "REUSABLE" : "STALE_DATA";
      return { ...base, state, run: this.runView(match), lastCheckedAt: match.last_checked_at ? s(match.last_checked_at) : null };
    }
    if (rows.length) return { ...base, state: "STALE_ANALYSIS", run: this.runView(rows[0]), lastCheckedAt: null };
    return { ...base, state: "NOT_FOUND", run: null, lastCheckedAt: null };
  }

  /** Fingerprint of the cached Jira data that feeds a period (period cases, their roots and children) and its previous period. */
  private async dataFingerprint(period: ResolvedPeriod): Promise<string> {
    const column = this.deps.config.periodField === "updated" ? "updated_at" : "created_at";
    const part = async (range: { from: string; to: string }) => {
      const rows = await this.deps.store.query(
        `WITH p AS (SELECT jira_key, parent_key FROM jira_cases WHERE substr(${column}, 1, 10) >= ? AND substr(${column}, 1, 10) <= ?),
              roots AS (SELECT jira_key FROM p WHERE parent_key IS NULL UNION SELECT parent_key AS jira_key FROM p WHERE parent_key IS NOT NULL)
         SELECT jira_key, version FROM jira_cases WHERE jira_key IN (SELECT jira_key FROM p) OR jira_key IN (SELECT jira_key FROM roots) OR parent_key IN (SELECT jira_key FROM roots)`,
        [range.from, range.to],
      );
      return rows.map((row) => `${s(row.jira_key)}:${s(row.version)}`).sort();
    };
    const prev = previousPeriod(period);
    return sha([await part(period), await part(prev)]);
  }

  /** "Verificar cambios": asks Jira only for cases updated since the last sync of this period, never a full download. */
  async checkChanges(request: PeriodRequest): Promise<LookupResult & { checked: boolean; changedCases: number }> {
    const period = this.previewPeriod(request);
    if (this.activeRunId || this.checking) throw new ActiveRunError(this.activeRunId ?? "check");
    const before = await this.lookupPeriod(period);
    if (!before.lastSyncAt || before.state === "NOT_FOUND") return { ...before, checked: false, changedCases: 0 };
    this.checking = true;
    try {
      let changed = (await this.syncPeriod(undefined, period, false)).changed;
      const prev = previousPeriod(period);
      const prevSynced = await this.deps.store.queryOne(`SELECT id FROM jira_sync_runs WHERE status = 'COMPLETED' AND period_from = ? AND period_to = ? LIMIT 1`, [prev.from, prev.to]);
      if (prevSynced) changed += (await this.syncPeriod(undefined, { ...period, from: prev.from, to: prev.to }, false)).changed;
      const now = this.now().toISOString();
      await this.deps.store.run(`UPDATE analysis_runs SET last_checked_at = ? WHERE period_from = ? AND period_to = ? AND fingerprint = ?`, [now, period.from, period.to, before.scopeFingerprint]);
      return { ...(await this.lookupPeriod(period)), checked: true, changedCases: changed };
    } finally {
      this.checking = false;
    }
  }

  // ------------------------------------------------------- AI deep analysis

  private async periodOfRun(runId: string): Promise<{ row: Row; period: ResolvedPeriod }> {
    const row = await this.deps.store.queryOne(`SELECT * FROM analysis_runs WHERE id = ?`, [runId]);
    if (!row) throw new RunStateError("Análisis no encontrado");
    return { row, period: periodFromRange(s(row.period_type) as PeriodType, s(row.period_from), s(row.period_to)) };
  }

  private async selectable(runId: string): Promise<SelectableCluster[]> {
    const { config, store } = this.deps;
    const rows = await store.query(`SELECT c.id, c.title, c.case_count, c.low_confidence, p.priority_score, p.priority_json FROM clusters c LEFT JOIN cluster_ai_state p ON p.run_id = c.run_id AND p.cluster_id = c.id WHERE c.run_id = ?`, [runId]);
    return rows.map((row) => {
      const cases = Number(row.case_count);
      return {
        id: s(row.id), title: s(row.title), cases, lowConfidence: Boolean(row.low_confidence), priorityScore: Number(row.priority_score ?? 0),
        priorityReasons: parse<{ reasons?: string[] }>(row.priority_json, {}).reasons ?? [], evidenceCases: cases <= config.evidence.fullCaseLimit ? cases : config.evidence.sampleSize,
      };
    });
  }

  private async snapshotOf(runId: string, clusterId: string): Promise<string> {
    const rows = await this.deps.store.query(`SELECT jira_key, case_version FROM analysis_run_cases WHERE run_id = ? AND cluster_id = ? ORDER BY jira_key`, [runId, clusterId]);
    return sha([clusterId, rows.map((row) => `${s(row.jira_key)}:${s(row.case_version)}`)]);
  }

  private aiKeys(clusterId: string, snapshot: string, depth: AiDepth): string[] {
    const { config } = this.deps;
    const deep = clusterAiKey({ clusterId, snapshot, depth: "DEEP", config });
    return depth === "DEEP" ? [deep] : [deep, clusterAiKey({ clusterId, snapshot, depth: "LABEL", config })];
  }

  private async cacheGet<T>(keys: string[]): Promise<{ value: T; key: string } | undefined> {
    for (const key of keys) {
      const row = await this.deps.store.queryOne(`SELECT analysis_json FROM ai_result_cache WHERE fingerprint = ?`, [key]);
      if (row) return { value: JSON.parse(s(row.analysis_json)) as T, key };
    }
    return undefined;
  }

  private async cachePut(key: string, clusterId: string, depth: string, value: unknown) {
    await this.deps.store.run(`INSERT OR REPLACE INTO ai_result_cache (fingerprint, cluster_id, depth, created_at, analysis_json) VALUES (?,?,?,?,?)`, [key, clusterId, depth, this.now().toISOString(), json(value)]);
  }

  /** Resolves the selection and workload for an objective WITHOUT calling AI. */
  async estimate(runId: string, request: ExecuteRequest) {
    const { config } = this.deps;
    await this.periodOfRun(runId);
    const clusters = await this.selectable(runId);
    const selection = resolveSelection(clusters, request, config.ai.maxClusters);
    const reusable = new Set<string>();
    if (config.ai.enabled && selection.depth !== "NONE") {
      for (const cluster of selection.selected) {
        if (await this.cacheGet(this.aiKeys(cluster.id, await this.snapshotOf(runId, cluster.id), selection.depth))) reusable.add(cluster.id);
      }
    }
    const casesTotal = clusters.reduce((sum, cluster) => sum + cluster.cases, 0);
    const estimate = estimateWorkload({ selection, casesTotal, reusable, config });
    const warnings: string[] = [];
    const deepPlan = estimate.depth === "DEEP" ? { failureGroups: "Se determinan al segmentar cada grupo; el costo real depende de ellos.", rolesPerGroup: "2 a 4 roles dinámicos + 1 validación por grupo seleccionado" } : null;
    if (request.mode === "FULL_RCA") warnings.push("El análisis completo utiliza más tiempo y procesamiento de IA.");
    if (selection.capped) warnings.push(`Se limitó a ${config.ai.maxClusters} grupos (INTELLIGENCE_AI_MAX_CLUSTERS) para acotar el costo.`);
    if (!config.ai.enabled) warnings.push("La IA está deshabilitada: solo se generarán métricas deterministas.");
    return { mode: selection.mode, depth: estimate.depth, selected: selection.selected.map((cluster) => ({ id: cluster.id, title: cluster.title, cases: cluster.cases, lowConfidence: cluster.lowConfidence, priorityScore: cluster.priorityScore, reason: cluster.reason, willReuse: reusable.has(cluster.id) })), skippedLowConfidence: selection.skippedLowConfidence, capped: selection.capped, estimate, deepPlan, warnings };
  }

  /** Starts the confirmed AI stage on a prepared run. Rejects if Jira data changed since preparation. */
  async analyze(runId: string, request: ExecuteRequest, options: { wait?: boolean } = {}) {
    if (this.activeRunId || this.checking) throw new ActiveRunError(this.activeRunId ?? "check");
    this.activeRunId = runId;
    let plan: AnalysisPlan;
    try {
      plan = await this.beginAnalysis(runId, request);
    } catch (error) {
      this.activeRunId = undefined;
      throw error;
    }
    const job = this.executeAnalysis(runId, plan).finally(() => {
      this.activeRunId = undefined;
    });
    if (options.wait) await job;
    else job.catch(() => undefined);
    return { runId, selection: plan.selection, estimate: plan.estimate };
  }

  private async beginAnalysis(runId: string, request: ExecuteRequest): Promise<AnalysisPlan> {
    const { config, store } = this.deps;
    const { row, period } = await this.periodOfRun(runId);
    const previousStatus = s(row.status);
    if (!["PREPARED", "COMPLETED", "PARTIAL"].includes(previousStatus)) throw new RunStateError("Los datos de este análisis aún no están preparados");
    if (row.data_fingerprint && (await this.dataFingerprint(period)) !== s(row.data_fingerprint)) throw new StaleRunError();
    const clusters = await this.selectable(runId);
    const selection = resolveSelection(clusters, request, config.ai.maxClusters);
    const estimate = (await this.estimate(runId, request)).estimate;
    const fingerprint = aiFingerprint({ runId, mode: request.mode, clusterIds: selection.selected.map((cluster) => cluster.id), config });
    await store.run(`UPDATE analysis_runs SET status = 'ANALYZING', error = NULL, analysis_mode = ?, requested_clusters = ?, selection_json = ?,     ai_fingerprint = ?, ai_started_at = ?, ai_completed_at = NULL, pipeline_version = ?, progress_json = ? WHERE id = ?`, [
          request.mode, json(selection.selected.map((cluster) => cluster.id)), json(selection.selected.map((cluster) => ({ id: cluster.id, reason: cluster.reason }))), fingerprint, this.now().toISOString(), ANALYST_PIPELINE_VERSION,
      json({ phase: "ANALYZING", percent: PHASE_PERCENT.ANALYZING, message: "Iniciando análisis con IA" } satisfies ProgressInfo), runId,
    ]);
    return { selection, estimate, period, previousStatus, request };
  }

  private async executeAnalysis(runId: string, plan: AnalysisPlan): Promise<void> {
    const { config, store } = this.deps;
    const { period, selection } = plan;
    try {
      const derived = await this.derive(period);
      const { clusters, unitMap } = derived;
      const stored = await store.query(`SELECT id, title FROM clusters WHERE run_id = ?`, [runId]);
      const titles = new Map(stored.map((row) => [s(row.id), s(row.title)]));
      for (const cluster of clusters) cluster.title = titles.get(cluster.id) ?? cluster.title;
      const analyses = await this.loadStoredAnalyses(runId);
      const depth: AiDepth = config.ai.enabled ? selection.depth : "NONE";
      const targets = selection.selected.map((item) => clusters.find((cluster) => cluster.id === item.id)).filter((cluster): cluster is FullCluster => Boolean(cluster));
      const stats = { calls: 0, skipped: 0, reused: 0, analyzed: 0, failed: 0, done: 0 };

      if (depth !== "NONE" && targets.length) {
        await this.setPhase(runId, "ANALYZING", `Analizando ${targets.length} grupo(s) con IA`, { clustersDone: 0, clustersTotal: targets.length, percent: PHASE_PERCENT.ANALYZING });
        const queue = [...targets];
        const worker = async () => {
          for (let cluster = queue.shift(); cluster; cluster = queue.shift()) {
            const existing = analyses.get(cluster.id);
            if (depth === "LABEL" && existing?.status === "COMPLETED") {
              stats.reused++;
              stats.skipped += existing.calls.length;
              stats.done++;
              await this.event(runId, "INFO", "AI_ANALYSIS_REUSED", `${cluster.id}: ya tiene un análisis en esta ejecución`);
              continue;
            }
            const snapshot = await this.snapshotOf(runId, cluster.id);
            const keys = this.aiKeys(cluster.id, snapshot, depth);
            const cached = await this.cacheGet<ClusterAnalysis>(keys);
            let analysis: ClusterAnalysis;
            let key = keys[keys.length - 1];
            if (cached) {
              analysis = cached.value;
              key = cached.key;
              stats.reused++;
              stats.skipped += analysis.calls.length;
              await this.event(runId, "INFO", "AI_ANALYSIS_REUSED", `${cluster.id}: resultado existente reutilizado`);
            } else {
              await this.event(runId, "INFO", "AI_ANALYSIS_STARTED", `${cluster.id} (${cluster.members.length} casos, ${depth})`);
              analysis = depth === "DEEP" ? await this.pipeline.analyze(cluster, unitMap, { event: (level, phase, message) => this.event(runId, level, phase, message) }) : await this.analyzer.labelOnly(cluster, unitMap);
              stats.calls += analysis.calls.length;
              stats.skipped += analysis.deep?.counts.reusedRoles ?? 0;
              stats.analyzed++;
              if (analysis.status === "COMPLETED") await this.cachePut(key, cluster.id, depth, analysis);
              else stats.failed++;
              const phase = analysis.status === "COMPLETED" ? "AI_ANALYSIS_COMPLETED" : analysis.status === "PARTIAL" ? "AI_ANALYSIS_PARTIAL" : "AI_ANALYSIS_FAILED";
              await this.event(runId, analysis.status === "COMPLETED" ? "INFO" : "WARN", phase, `${cluster.id}${analysis.error ? `: ${analysis.error}` : ""}`);
            }
            analyses.set(cluster.id, analysis);
            if (analysis.label) cluster.title = analysis.label.title;
            await this.persistClusterAnalysis(runId, cluster, analysis, { depth: cached ? (cached.key === keys[0] ? "DEEP" : "LABEL") : depth, reused: Boolean(cached), key, record: !cached });
            stats.done++;
            const percent = PHASE_PERCENT.ANALYZING + Math.round((stats.done / targets.length) * 25);
            await store.run(`UPDATE analysis_runs SET progress_json = ? WHERE id = ?`, [json({ phase: "ANALYZING", percent, message: `Grupo ${stats.done} de ${targets.length}`, clustersDone: stats.done, clustersTotal: targets.length } satisfies ProgressInfo), runId]);
          }
        };
        await Promise.all(Array.from({ length: Math.min(config.ai.maxConcurrency, targets.length) }, worker));
      }
      if (!config.ai.enabled) await store.run(`UPDATE clusters SET rootcause_status = 'AI_DISABLED' WHERE run_id = ?`, [runId]);

      await this.setPhase(runId, "GENERATING_REPORT", "Generando reportes");
      const candidates = [...analyses.values()].flatMap((analysis) => analysis.candidates);
      const metrics = { period: period.label, cases: derived.units.length, eligible: derived.eligible.length, clusters: clusters.length, top: clusters.slice(0, 5).map((cluster) => ({ title: cluster.title, cases: cluster.members.length, trend: cluster.trend })) };
      let narrative: Awaited<ReturnType<ClusterAnalyzer["summarize"]>>;
      if (config.ai.enabled && clusters.length) {
        const summaryKey = sha({ kind: "SUMMARY", metrics, model: config.ai.models.SUMMARY, prompts: PROMPT_VERSION, pipeline: ANALYST_PIPELINE_VERSION });
        const cachedSummary = await this.cacheGet<NonNullable<typeof narrative>>([summaryKey]);
        if (cachedSummary) {
          narrative = cachedSummary.value;
          stats.skipped++;
        } else {
          narrative = await this.analyzer.summarize(metrics);
          stats.calls++;
          if (narrative) await this.cachePut(summaryKey, "", "SUMMARY", narrative);
        }
      }
      const row = await store.queryOne(`SELECT warnings_json FROM analysis_runs WHERE id = ?`, [runId]);
      const warnings = parse<string[]>(row?.warnings_json, []).filter((warning) => !/no pudieron analizarse con IA/.test(warning));
      if (stats.failed) warnings.push(`${stats.failed} grupo(s) no pudieron analizarse con IA; se conserva la agrupación determinista.`);
      await this.storeReports(runId, buildReports({ period, previous: derived.previousInfo, units: derived.units, clusters, analyses, candidates, errorProfile: derived.errorProfile, narrative, aiEnabled: config.ai.enabled, warnings }));

      const status: AnalysisStatus = stats.failed > 0 ? "PARTIAL" : "COMPLETED";
      const message = !config.ai.enabled ? "Análisis completado sin IA (deshabilitada)" : status === "COMPLETED" ? "Análisis completado" : "Análisis parcial";
      await store.run(`UPDATE analysis_runs SET status = ?, completed_at = ?, ai_completed_at = ?, ai_runs = ?, processed_clusters = ?, reused_clusters = ?, ai_skipped = ?, warnings_json = ?, progress_json = ? WHERE id = ?`, [
        status, this.now().toISOString(), this.now().toISOString(), stats.calls, targets.length, stats.reused, stats.skipped, json(warnings),
        json({ phase: status, percent: 100, message } satisfies ProgressInfo), runId,
      ]);
      await this.event(runId, "INFO", status, `mode=${plan.request.mode} groups=${targets.length} reused=${stats.reused} calls=${stats.calls}`);
    } catch (error) {
      const message = this.errorText(error);
      console.error(`[intelligence] analysis ${runId} failed: ${message}`);
      await store.run(`UPDATE analysis_runs SET status = ?, error = ?, progress_json = ? WHERE id = ?`, [plan.previousStatus, message, json({ phase: plan.previousStatus as AnalysisStatus, percent: 100, message } satisfies ProgressInfo), runId]).catch(() => undefined);
      await this.event(runId, "ERROR", "FAILED", message).catch(() => undefined);
    }
  }

  private async loadStoredAnalyses(runId: string): Promise<Map<string, ClusterAnalysis>> {
    const rows = await this.deps.store.query(`SELECT cluster_id, analysis_json FROM cluster_ai_state WHERE run_id = ? AND analysis_json IS NOT NULL`, [runId]);
    return new Map(rows.map((row) => [s(row.cluster_id), JSON.parse(s(row.analysis_json)) as ClusterAnalysis]));
  }

  private async persistClusterAnalysis(runId: string, cluster: FullCluster, analysis: ClusterAnalysis, meta: { depth: AiDepth; reused: boolean; key: string; record: boolean }) {
    const status = analysis.status === "COMPLETED" ? "COMPLETED" : analysis.status === "PARTIAL" ? "PARTIAL_ANALYSIS" : "FAILED";
    const ts = this.now().toISOString();
    await this.deps.store.transaction(async (tx) => {
      const deep = analysis.deep;
      if (deep) {
        for (const table of ["analysis_failure_groups", "analysis_evidence_items", "role_runs", "role_claims", "claim_validations", "consolidated_findings", "cluster_recommendations"]) await tx.run(`DELETE FROM ${table} WHERE run_id = ? AND cluster_id = ?`, [runId, cluster.id]);
        for (const group of deep.segmentation.groups) await tx.run(`INSERT INTO analysis_failure_groups VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`, [runId, cluster.id, group.id, group.signature, group.label, group.kind, group.members.length, group.percentage, group.confidence, json(group.signals), json(group.members), deep.segmentationVersion]);
        for (const item of analysis.evidence) await tx.run(`INSERT INTO analysis_evidence_items VALUES (?,?,?,?,?,?,?,?,?,?)`, [runId, cluster.id, item.id, item.fingerprint ?? null, item.failureGroupId ?? null, item.jiraKey, item.field, item.snippet, item.reason, deep.evidenceVersion]);
        for (const run of deep.roleRuns) await tx.run(`INSERT INTO role_runs VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [randomUUID(), runId, cluster.id, run.role, run.task, run.model, meta.reused && run.status === "COMPLETED" ? "REUSED" : run.status, run.reason ?? null, run.attempts, Math.round(run.durationMs), run.promptVersion, run.promptHash ?? null, run.evidenceHash ?? null, deep.pipelineVersion, run.rawClaims, run.verifiedClaims, run.error ?? null, run.summary ?? null, json(run.missingInformation), run.response ?? null]);
        await tx.run(`INSERT INTO role_runs VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [randomUUID(), runId, cluster.id, "VALIDATOR", "VALIDATE", deep.validation.model, meta.reused && deep.validation.status === "COMPLETED" ? "REUSED" : deep.validation.status, null, deep.validation.status === "SKIPPED" ? 0 : 1, Math.round(deep.validation.durationMs), "claim-validator/2", null, deep.evidence.hash, deep.pipelineVersion, deep.counts.verified, deep.counts.validated, deep.validation.error ?? null, null, json([]), null]);
        for (const claim of analysis.claims) await tx.run(`INSERT INTO role_claims VALUES (?,?,?,?,?,?,?,?,?,?)`, [runId, cluster.id, claim.id, (claim as { role?: string }).role ?? null, claim.failureGroupId ?? null, claim.claim, claim.level, claim.confidence, json(claim.evidence), json(claim.limitations)]);
        for (const check of deep.validation.checks) await tx.run(`INSERT INTO claim_validations VALUES (?,?,?,?,?,?)`, [runId, cluster.id, check.claimId, check.verdict, check.action, check.reason]);
        for (const finding of deep.findings) await tx.run(`INSERT INTO consolidated_findings VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`, [runId, cluster.id, finding.id, finding.failureGroupId ?? null, finding.statement, finding.level, finding.confidence, finding.status, json(finding.roles), json(finding.claimIds), json(finding.evidence), json(finding.limitations)]);
        for (const [position, rec] of deep.recommendations.entries()) await tx.run(`INSERT INTO cluster_recommendations VALUES (?,?,?,?,?,?,?,?,?)`, [runId, cluster.id, `r${position + 1}`, rec.action, rec.rationale, rec.owner ?? null, rec.priority ?? null, json(rec.findingIds ?? []), json(rec.roles ?? [])]);
      }
      await tx.run(`UPDATE clusters SET title = ?, description = ?, rootcause_status = ? WHERE run_id = ? AND id = ?`, [cluster.title, analysis.label?.description || analysis.summary || "", status, runId, cluster.id]);
      await tx.run(`DELETE FROM cluster_evidence WHERE run_id = ? AND cluster_id = ?`, [runId, cluster.id]);
      await tx.run(`DELETE FROM rootcause_candidates WHERE run_id = ? AND cluster_id = ?`, [runId, cluster.id]);
      for (const item of analysis.evidence) await tx.run(`INSERT OR REPLACE INTO cluster_evidence VALUES (?,?,?,?,?,?,?,?)`, [item.id, runId, cluster.id, item.failureGroupId, item.jiraKey, item.field, item.snippet, item.reason]);
      if (meta.record) {
        for (const call of analysis.calls) {
          await tx.run(`INSERT INTO ai_task_runs VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [randomUUID(), runId, cluster.id, null, call.task === "VALIDATE" ? "REVIEWER" : "ANALYST", call.task, call.model, call.ok ? "COMPLETED" : "FAILED", 0, call.error ?? null, ts, ts, call.durationMs, call.task === "ANALYZE" ? json({ dropped: analysis.dropped, invalidReferences: analysis.invalidReferences, evidence: analysis.evidenceMeta }) : null]);
        }
      }
      for (const candidate of analysis.candidates) {
        await tx.run(`INSERT OR REPLACE INTO rootcause_candidates (id, run_id, cluster_id, failure_group_id, title, description, level, confidence, evidence_json, affected_cases_json, business_impact, technical_signals_json, limitations_json, next_steps_json, status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [candidate.id, runId, candidate.clusterId, candidate.failureGroupId, candidate.title, candidate.description, candidate.level, candidate.confidence, json(candidate.evidence), json(candidate.affectedCases), candidate.businessImpact, json(candidate.technicalSignals), json(candidate.limitations), json(candidate.recommendedNextSteps), candidate.status ?? "CANDIDATE"]);
      }
      await tx.run(`UPDATE cluster_ai_state SET depth = ?, reused = ?, fingerprint = ?, analysis_json = ?, updated_at = ? WHERE run_id = ? AND cluster_id = ?`, [meta.depth, meta.reused, meta.key, json(analysis), ts, runId, cluster.id]);
    });
  }

  /** PRE-ANALYSIS: everything the user needs to choose an objective, computed without AI. */
  async preAnalysis(runId: string) {
    const id = await this.effectiveId(runId);
    if (!id) return undefined;
    const run = await this.getRun(runId);
    const [clusters, executive, quality, comparison] = await Promise.all([this.clusters(runId), this.report(runId, "executive"), this.report(runId, "data_quality"), this.report(runId, "period_comparison")]);
    if (!run || !clusters || !executive) return undefined;
    const content = executive.content as unknown as { period: ResolvedPeriod; totals: Record<string, unknown> };
    const selectable = await this.selectable(id);
    const top = resolveSelection(selectable, { mode: "TOP_RCA" }, this.deps.config.ai.maxClusters);
    return {
      run,
      period: content.period,
      totals: content.totals,
      groups: clusters,
      topGroups: top.selected.map((cluster) => ({ id: cluster.id, title: cluster.title, cases: cluster.cases, priorityScore: cluster.priorityScore, reason: cluster.reason })),
      lowConfidenceGroups: clusters.filter((cluster) => cluster.lowConfidence).map((cluster) => cluster.id),
      dataQuality: quality?.content ?? null,
      comparison: comparison?.content ?? null,
      recommended: { mode: "TOP_RCA" as AnalysisMode, clusterIds: top.selected.map((cluster) => cluster.id) },
      ai: { enabled: this.deps.config.ai.enabled, models: this.deps.config.ai.models },
    };
  }


  // ---------------------------------------------------------------- pipeline

  private async setPhase(runId: string, phase: AnalysisStatus, message: string, extra: Partial<ProgressInfo> = {}) {
    const progress: ProgressInfo = { phase, percent: extra.percent ?? PHASE_PERCENT[phase] ?? 0, message, ...extra };
    await this.deps.store.run(`UPDATE analysis_runs SET status = ?, progress_json = ? WHERE id = ?`, [phase, json(progress), runId]);
    await this.event(runId, "INFO", phase, message);
  }

  private async event(runId: string | undefined, level: "INFO" | "WARN" | "ERROR", phase: string, message: string) {
    if (!runId) return;
    await this.deps.store.run(`INSERT INTO analysis_events (id, run_id, ts, level, phase, message) VALUES (?,?,?,?,?,?)`, [randomUUID(), runId, this.now().toISOString(), level, phase, message.slice(0, 500)]);
  }

  /** DATA PREPARATION: Jira sync (incremental when possible) -> units -> clusters -> priorities -> deterministic reports. No AI. */
  private async prepare(runId: string, period: ResolvedPeriod, refresh: boolean): Promise<boolean> {
    const { config, store } = this.deps;
    const warnings = [...period.warnings];
    try {
      await this.setPhase(runId, "SYNCING_JIRA", `Leyendo casos de ${period.label} (solo lectura)`);
      const prev = previousPeriod(period);
      await this.syncPeriod(runId, period, refresh);
      try {
        await this.syncPeriod(runId, { ...period, from: prev.from, to: prev.to }, refresh);
      } catch (error) {
        warnings.push(`No fue posible leer el periodo anterior; se omite la comparación (${this.errorText(error)}).`);
      }

      await this.setPhase(runId, "NORMALIZING", "Construyendo unidades y agrupando casos");
      const derived = await this.derive(period);
      const { units, childRows, clusters, eligible } = derived;
      await store.run(`UPDATE analysis_runs SET cases_fetched = ? WHERE id = ?`, [derived.inPeriodCount, runId]);
      await this.persistSnapshot(runId, units, childRows, clusters, derived.inPeriodCount);
      await this.persistPriorities(runId, clusters, derived.unitMap);

      await this.setPhase(runId, "GENERATING_REPORT", "Generando pre-análisis determinista");
      const reports = buildReports({ period, previous: derived.previousInfo, units, clusters, analyses: new Map(), candidates: [], errorProfile: derived.errorProfile, aiEnabled: config.ai.enabled, warnings });
      await this.storeReports(runId, reports);
      const now = this.now().toISOString();
      await store.run(`UPDATE analysis_runs SET status = 'PREPARED', completed_at = ?, prepared_at = ?, last_checked_at = ?, data_fingerprint = ?, warnings_json = ?, progress_json = ? WHERE id = ?`, [
        now, now, now, await this.dataFingerprint(period), json(warnings),
        json({ phase: "PREPARED", percent: 100, message: "Datos preparados" } satisfies ProgressInfo), runId,
      ]);
      await this.event(runId, "INFO", "PREPARED", `clusters=${clusters.length} units=${units.length} eligible=${eligible.length}`);
      return true;
    } catch (error) {
      await this.failRun(runId, error);
      return false;
    }
  }

  /**
   * Startup recovery: a run still in an active phase belongs to a process that died. Runs that never finished preparing become
   * INTERRUPTED (never reusable); runs whose data was already prepared become PARTIAL so analysis can be retried
   * (cached AI results are reused). A run is never left looking COMPLETED or in progress.
   */
  async recoverInterrupted(): Promise<{ interrupted: number; partial: number }> {
    const { store } = this.deps;
    const active = ["QUEUED", "SYNCING_JIRA", "NORMALIZING", "CLUSTERING", "ANALYZING", "VALIDATING", "GENERATING_REPORT"];
    const rows = await store.query(`SELECT id, status, prepared_at FROM analysis_runs WHERE status IN (${active.map(() => "?").join(",")})`, active);
    let interrupted = 0;
    let partial = 0;
    for (const row of rows) {
      const id = s(row.id);
      const phase = s(row.status);
      const prepared = Boolean(row.prepared_at);
      const status: AnalysisStatus = prepared ? "PARTIAL" : "INTERRUPTED";
      const message = prepared ? `El proceso se interrumpió durante ${phase}. Los datos preparados siguen disponibles; reintente el análisis (los resultados ya guardados se reutilizan).` : `El proceso se interrumpió durante ${phase}. Vuelva a preparar el período.`;
      await store.run(`UPDATE analysis_runs SET status = ?, completed_at = ?, error = ?, progress_json = ? WHERE id = ?`, [status, this.now().toISOString(), message, json({ phase: status, percent: 100, message } satisfies ProgressInfo), id]);
      await this.event(id, "WARN", status, message);
      if (prepared) partial++;
      else interrupted++;
    }
    return { interrupted, partial };
  }

  /** Cheap liveness probe of the analytical store plus run counters for the health endpoint. Never touches Jira or AI. */
  async healthSnapshot(): Promise<{ schemaVersion: string | null; activeRun: string | null; runsByStatus: Record<string, number>; lastFailure: { runId: string; at: string | null } | null }> {
    const { store } = this.deps;
    const version = await store.queryOne(`SELECT value FROM schema_meta WHERE key = 'schema_version'`);
    const counts = await store.query(`SELECT status, COUNT(*) AS total FROM analysis_runs GROUP BY status`);
    const failed = await store.queryOne(`SELECT id, completed_at FROM analysis_runs WHERE status = 'FAILED' ORDER BY completed_at DESC LIMIT 1`);
    return {
      schemaVersion: version ? s(version.value) : null,
      activeRun: this.activeRunId ?? null,
      runsByStatus: Object.fromEntries(counts.map((row) => [s(row.status), Number(row.total)])),
      lastFailure: failed ? { runId: s(failed.id), at: failed.completed_at ? s(failed.completed_at) : null } : null,
    };
  }

  private async storeReports(runId: string, reports: Record<ReportKind, unknown>) {
    const generatedAt = this.now().toISOString();
    for (const kind of REPORT_KINDS) await this.deps.store.run(`INSERT OR REPLACE INTO analysis_reports (run_id, kind, generated_at, content_json) VALUES (?,?,?,?)`, [runId, kind, generatedAt, json(reports[kind])]);
  }

  private async failRun(runId: string, error: unknown) {
    const message = this.errorText(error);
    console.error(`[intelligence] run ${runId} failed: ${error instanceof SourceError ? error.technicalDetail : message}`);
    await this.deps.store.run(`UPDATE analysis_runs SET status = 'FAILED', completed_at = ?, error = ?, progress_json = ? WHERE id = ?`, [this.now().toISOString(), message, json({ phase: "FAILED", percent: 100, message } satisfies ProgressInfo), runId]).catch(() => undefined);
    await this.event(runId, "ERROR", "FAILED", message).catch(() => undefined);
  }

  /** Deterministic derivation from the local store only (no Jira). Used by preparation and by later AI execution. */
  private async derive(period: ResolvedPeriod) {
    const { config, store } = this.deps;
    const prev = previousPeriod(period);
    const hasPrevious = Boolean(await store.queryOne(`SELECT id FROM jira_sync_runs WHERE status = 'COMPLETED' AND period_from = ? AND period_to = ? LIMIT 1`, [prev.from, prev.to]));
    const inPeriod = await this.loadPeriodCases(period);
    const universe = await this.loadContext(inPeriod);
    const errorProfile = profileErrorMessages(inPeriod);
    const { units, childRows } = buildUnits({ inPeriod, universe, from: period.from, to: period.to }, config, errorProfile);
    const previousUnits = hasPrevious ? await this.buildPreviousUnits({ from: prev.from, to: prev.to }, errorProfile) : [];
    const eligible = units.filter((unit) => unit.eligibility === "ELIGIBLE_FOR_RCA");
    const output = clusterUnits(eligible, config, period, segmentFailures);
    const clusters: FullCluster[] = output.clusters.map((cluster) => ({ ...cluster, trend: "NO_BASELINE" as Trend }));
    let previousInfo: { from: string; to: string; units: CanonicalUnit[]; resolvedClusters: number } | undefined;
    if (hasPrevious) {
      const matched = matchToClusters(previousUnits.filter((unit) => unit.eligibility === "ELIGIBLE_FOR_RCA"), output.model, output.clusters, config.clustering.similarityThreshold);
      for (const cluster of clusters) {
        cluster.previousCount = matched.counts.get(cluster.id) ?? 0;
        cluster.trend = trendOf(cluster.members.length, cluster.previousCount);
      }
      const leftover = clusterUnits(matched.unmatched, config, { from: prev.from, to: prev.to }, segmentFailures);
      previousInfo = { from: prev.from, to: prev.to, units: previousUnits, resolvedClusters: leftover.clusters.length };
    }
    return { units, childRows, clusters, eligible, errorProfile, previousInfo, model: output.model, inPeriodCount: inPeriod.length, unitMap: new Map(units.map((unit) => [unit.canonicalKey, unit])) };
  }

  /** Whether a completed sync covers the whole period; periods without coverage never appear in a trend. */
  private async covered(period: { from: string; to: string }): Promise<boolean> {
    return Boolean(await this.deps.store.queryOne(`SELECT id FROM jira_sync_runs WHERE status = 'COMPLETED' AND period_from <= ? AND period_to >= ? LIMIT 1`, [period.from, period.to]));
  }

  get internals() {
    const { store, llm, config } = this.deps;
    return { store, llm, config, now: this.now };
  }

  resolveRunId(runId: string): Promise<string | undefined> {
    return this.effectiveId(runId);
  }

  /**
   * Local-only (no Jira, no AI): unit rows of the run period and of its previous periods, plus the per-cluster case series
   * obtained by matching earlier periods against the run's clusters. The series is persisted so screens never recompute it.
   */
  async operationalData(runId: string, historyPeriods: number): Promise<{
    period: ResolvedPeriod;
    current: OpsUnitRow[];
    previous: { from: string; to: string; rows: OpsUnitRow[] } | null;
    history: { from: string; to: string; rows: OpsUnitRow[] }[];
    series: Map<string, { from: string; to: string; count: number }[]>;
    coveredPeriods: number;
  }> {
    const { store, config } = this.deps;
    const id = (await this.effectiveId(runId)) ?? runId;
    const { period } = await this.periodOfRun(id);
    const profile = profileErrorMessages(await this.loadPeriodCases(period));
    const toRows = (units: CanonicalUnit[]): OpsUnitRow[] => units.map((unit) => ({ unit, eligible: unit.eligibility === "ELIGIBLE_FOR_RCA" }));
    const current = await this.buildPreviousUnits(period, profile);

    // Previous periods that really have data, nearest first. A gap in coverage ends the history: no interpolation.
    const history: { from: string; to: string; units: CanonicalUnit[] }[] = [];
    let cursor: { from: string; to: string } = period;
    for (let index = 0; index < historyPeriods; index++) {
      cursor = previousPeriod(periodFromRange(period.type, cursor.from, cursor.to));
      if (!(await this.covered(cursor))) break;
      history.push({ ...cursor, units: await this.buildPreviousUnits(cursor, profile) });
    }

    let stored = await store.query(`SELECT cluster_id, period_from, period_to, case_count FROM cluster_period_series WHERE run_id = ? ORDER BY period_from`, [id]);
    // Stored series are valid only for the history coverage they were built with; newly prepared periods must refresh them.
    const storedPeriods = new Set(stored.map((row) => s(row.period_from)));
    const expectedPeriods = new Set([period.from, ...history.map((item) => item.from)]);
    const outdated = storedPeriods.size !== expectedPeriods.size || [...expectedPeriods].some((from) => !storedPeriods.has(from));
    if (!stored.length || outdated) {
      const derived = await this.derive(period);
      const storedIds = new Set((await store.query(`SELECT id FROM clusters WHERE run_id = ?`, [id])).map((row) => s(row.id)));
      const clusters = derived.clusters.filter((cluster) => storedIds.has(cluster.id));
      const points = new Map<string, { from: string; to: string; count: number }[]>(clusters.map((cluster) => [cluster.id, [{ from: period.from, to: period.to, count: cluster.members.length }]]));
      for (const item of history) {
        const matched = matchToClusters(item.units.filter((unit) => unit.eligibility === "ELIGIBLE_FOR_RCA"), derived.model, clusters, config.clustering.similarityThreshold);
        for (const cluster of clusters) points.get(cluster.id)!.unshift({ from: item.from, to: item.to, count: matched.counts.get(cluster.id) ?? 0 });
      }
      for (const [clusterId, list] of points) {
        for (const point of list) await store.run(`INSERT OR REPLACE INTO cluster_period_series (run_id, cluster_id, period_from, period_to, case_count) VALUES (?,?,?,?,?)`, [id, clusterId, point.from, point.to, point.count]);
      }
      stored = await store.query(`SELECT cluster_id, period_from, period_to, case_count FROM cluster_period_series WHERE run_id = ? ORDER BY period_from`, [id]);
    }
    const series = new Map<string, { from: string; to: string; count: number }[]>();
    for (const row of stored) series.set(s(row.cluster_id), [...(series.get(s(row.cluster_id)) ?? []), { from: s(row.period_from), to: s(row.period_to), count: Number(row.case_count) }]);
    const rows = history.map((item) => ({ from: item.from, to: item.to, rows: toRows(item.units) }));
    return { period, current: toRows(current), previous: rows[0] ?? null, history: rows, series, coveredPeriods: history.length };
  }

  async logEvent(runId: string, level: "INFO" | "WARN" | "ERROR", phase: string, message: string) {
    await this.event(runId, level, phase, message);
  }

  async waitForIdle(timeoutMs = 30 * 60_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (this.activeRunId && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 500));
  }

  private async persistPriorities(runId: string, clusters: FullCluster[], unitMap: Map<string, CanonicalUnit>) {
    const maxCases = Math.max(1, ...clusters.map((cluster) => cluster.members.length));
    const maxHours = Math.max(0, ...clusters.map((cluster) => cluster.totalHours));
    for (const cluster of clusters) {
      const highPriority = cluster.members.filter((member) => HIGH_PRIORITY.test(unitMap.get(member.canonicalKey)?.root.priority ?? "")).length;
      const result = priorityScore({ cases: cluster.members.length, maxCases, trend: cluster.trend, previousCount: cluster.previousCount ?? null, open: cluster.openCases, reopened: cluster.reopenedCases, totalHours: cluster.totalHours, maxHours, highPriority, confidence: cluster.confidence });
      await this.deps.store.run(`INSERT OR REPLACE INTO cluster_ai_state (run_id, cluster_id, priority_score, priority_json, depth, reused, updated_at) VALUES (?,?,?,?,?,?,?)`, [runId, cluster.id, result.score, json({ factors: result.factors, reasons: result.reasons }), "NONE", false, this.now().toISOString()]);
    }
  }


  private errorText(error: unknown): string {
    if (error instanceof SourceError) return error.userMessage;
    return (error as Error)?.message ?? "Error inesperado";
  }

  // --------------------------------------------------------------- Jira sync

  private baseClauses(): string {
    const { baseJql } = this.deps.config;
    const raw = baseJql ? baseJql.replaceAll("{JIRA_PROJECT_KEY}", this.deps.projectKey ?? "") : this.deps.projectKey ? `project = "${this.deps.projectKey}"` : "";
    return raw.replace(/\s+order\s+by\s+.*$/i, "").trim();
  }

  private async syncPeriod(runId: string | undefined, period: { from: string; to: string }, refresh: boolean): Promise<{ fetched: number; changed: number }> {
    const { config, store, source } = this.deps;
    const field = config.periodField;
    const clauses = [this.baseClauses(), `${field} >= "${period.from}"`, `${field} < "${exclusiveEnd(period)}"`].filter(Boolean);
    const last = refresh ? undefined : await store.queryOne(`SELECT started_at FROM jira_sync_runs WHERE status = 'COMPLETED' AND period_from = ? AND period_to = ? ORDER BY started_at DESC LIMIT 1`, [period.from, period.to]);
    const incremental = Boolean(last);
    if (last) clauses.push(`updated >= "${jqlDateTime(new Date(Date.parse(s(last.started_at)) - 15 * 60_000))}"`);
    const jql = `${clauses.join(" AND ")} ORDER BY created ASC`;
    const syncId = `sync_${randomUUID().slice(0, 12)}`;
    const startedAt = this.now().toISOString();
    await store.run(`INSERT INTO jira_sync_runs (id, started_at, status, jql, period_from, period_to, incremental) VALUES (?,?,?,?,?,?,?)`, [syncId, startedAt, "RUNNING", jql, period.from, period.to, incremental]);
    try {
      const issues = await source.searchIssues(jql, {
        fields: historicalJiraFields(config.fieldIds),
        pageSize: config.pageSize,
        maxCases: config.maxCases,
        onPage: (fetched, total) => void this.event(runId, "INFO", "SYNCING_JIRA", `Leídos ${fetched} de ${total}`).catch(() => undefined),
      });
      let changed = await this.upsertIssues(issues);
      for (let guard = 0; guard < 5; guard++) {
        const missing = (await store.query(`SELECT DISTINCT parent_key FROM jira_cases WHERE parent_key IS NOT NULL AND parent_key NOT IN (SELECT jira_key FROM jira_cases)`)).map((row) => s(row.parent_key));
        if (!missing.length) break;
        const before = changed;
        for (const part of chunk(missing, 50)) {
          const parents = await source.searchIssues(`key in (${part.map((key) => `"${key}"`).join(",")})`, { fields: historicalJiraFields(config.fieldIds), pageSize: 50, maxCases: 50 });
          changed += await this.upsertIssues(parents);
        }
        if (changed === before) break;
      }
      await store.run(`UPDATE jira_sync_runs SET status = 'COMPLETED', finished_at = ?, fetched = ?, changed = ? WHERE id = ?`, [this.now().toISOString(), issues.length, changed, syncId]);
      return { fetched: issues.length, changed };
    } catch (error) {
      await store.run(`UPDATE jira_sync_runs SET status = 'FAILED', finished_at = ?, error = ? WHERE id = ?`, [this.now().toISOString(), this.errorText(error), syncId]);
      throw error;
    }
  }

  private async upsertIssues(issues: JiraIssue[]): Promise<number> {
    const { config, store, source } = this.deps;
    const cases: { item: AnalyticalCase; raw: JiraIssue }[] = [];
    for (const raw of issues) {
      try {
        cases.push({ item: toAnalyticalCase(raw, config.fieldIds, source.baseUrl), raw });
      } catch {
        /* malformed payloads are skipped; they are counted as not fetched */
      }
    }
    if (!cases.length) return 0;
    const existing = new Map<string, string>();
    for (const part of chunk(cases, 400)) {
      const rows = await store.query(`SELECT jira_key, version FROM jira_cases WHERE jira_key IN (${part.map(() => "?").join(",")})`, part.map(({ item }) => item.jiraKey));
      rows.forEach((row) => existing.set(s(row.jira_key), s(row.version)));
    }
    const changed = cases.filter(({ item }) => existing.get(item.jiraKey) !== item.version);
    const now = this.now().toISOString();
    for (const part of chunk(changed, 100)) {
      await store.transaction(async (tx) => {
        for (const { item, raw } of part) {
          await tx.run(`DELETE FROM jira_cases WHERE jira_key = ?`, [item.jiraKey]);
          await tx.run(`DELETE FROM jira_case_comments WHERE jira_key = ?`, [item.jiraKey]);
          await tx.run(`DELETE FROM jira_case_relationships WHERE jira_key = ?`, [item.jiraKey]);
          await tx.run(
            `INSERT INTO jira_cases VALUES (${Array.from({ length: 37 }, () => "?").join(",")})`,
            [item.jiraKey, item.jiraId, item.issueType, item.parentKey, item.summary, item.description, item.status, item.closed, item.priority, item.service, item.team, item.serviceLine, item.commercialGroup, item.classification, item.equipmentId, item.prioritized, item.reopened, item.totalHours ?? null, item.errorMessage, item.closeMessage, item.aiUsage, item.sla, item.reporter, item.creator, item.assignee, json(item.labels), item.createdAt, item.updatedAt, item.resolution, item.resolvedAt, item.url, item.attachmentCount, item.version, json(item), json(raw.fields), now, now],
          );
          for (const comment of item.comments) await tx.run(`INSERT OR REPLACE INTO jira_case_comments VALUES (?,?,?,?,?,?)`, [`${item.jiraKey}:${comment.id}`, item.jiraKey, comment.author, comment.createdAt, comment.body, comment.noise]);
          for (const link of item.links) await tx.run(`INSERT OR REPLACE INTO jira_case_relationships VALUES (?,?,?,?)`, [item.jiraKey, link.key, link.direction, link.type]);
        }
      });
    }
    return changed.length;
  }

  // --------------------------------------------------------------- local data

  private async loadByKeys(column: "jira_key" | "parent_key", keys: string[]): Promise<AnalyticalCase[]> {
    const result: AnalyticalCase[] = [];
    for (const part of chunk([...new Set(keys)], 400)) {
      const rows = await this.deps.store.query(`SELECT case_json FROM jira_cases WHERE ${column} IN (${part.map(() => "?").join(",")})`, part);
      rows.forEach((row) => result.push(sanitizeCase(JSON.parse(s(row.case_json)) as AnalyticalCase)));
    }
    return result;
  }

  private async loadPeriodCases(period: { from: string; to: string }): Promise<AnalyticalCase[]> {
    const column = this.deps.config.periodField === "updated" ? "updated_at" : "created_at";
    const rows = await this.deps.store.query(`SELECT case_json FROM jira_cases WHERE substr(${column}, 1, 10) >= ? AND substr(${column}, 1, 10) <= ? ORDER BY created_at`, [period.from, period.to]);
    return rows.map((row) => sanitizeCase(JSON.parse(s(row.case_json)) as AnalyticalCase));
  }

  private async loadContext(inPeriod: AnalyticalCase[]): Promise<AnalyticalCase[]> {
    const parents = await this.loadByKeys("jira_key", inPeriod.map((item) => item.parentKey).filter((key): key is string => Boolean(key)));
    const roots = new Set([...inPeriod.filter((item) => !item.parentKey).map((item) => item.jiraKey), ...parents.map((item) => item.jiraKey)]);
    const children = await this.loadByKeys("parent_key", [...roots]);
    return [...new Map([...inPeriod, ...parents, ...children].map((item) => [item.jiraKey, item])).values()];
  }

  private async buildPreviousUnits(period: { from: string; to: string }, profile: ErrorProfile): Promise<CanonicalUnit[]> {
    const inPeriod = await this.loadPeriodCases(period);
    const universe = await this.loadContext(inPeriod);
    return buildUnits({ inPeriod, universe, from: period.from, to: period.to }, this.deps.config, profile).units;
  }

  // -------------------------------------------------------------- persistence

  private async persistSnapshot(runId: string, units: CanonicalUnit[], childRows: { child: AnalyticalCase; unit: CanonicalUnit; inherited: string[] }[], clusters: FullCluster[], fetched: number) {
    const { store } = this.deps;
    const clusterOf = new Map<string, string>();
    const groupOf = new Map<string, string>();
    for (const cluster of clusters) {
      cluster.members.forEach((member) => clusterOf.set(member.canonicalKey, cluster.id));
      cluster.failureGroups.forEach((group) => group.members.forEach((key) => groupOf.set(key, group.id)));
    }
    const eligible = units.filter((unit) => unit.eligibility === "ELIGIBLE_FOR_RCA").length;
    const total = Math.max(eligible, 1);
    for (const part of chunk(units, 100)) {
      await store.transaction(async (tx) => {
        for (const unit of part) {
          await tx.run(`INSERT INTO analysis_run_cases VALUES (${Array.from({ length: 19 }, () => "?").join(",")})`, [
            runId, unit.canonicalKey, unit.root.jiraKey, "UNIT", unit.root.version, unit.root.updatedAt, unit.eligibility, unit.eligibilityReason, unit.analysisText, json(unit.inheritedFields), unit.periodDate,
            unit.service, unit.team, unit.classification, unit.closed, unit.reopened, unit.totalHours, clusterOf.get(unit.canonicalKey) ?? null, groupOf.get(unit.canonicalKey) ?? null,
          ]);
        }
      });
    }
    for (const part of chunk(childRows, 100)) {
      await store.transaction(async (tx) => {
        for (const { child, unit, inherited } of part) {
          await tx.run(`INSERT OR REPLACE INTO analysis_run_cases VALUES (${Array.from({ length: 19 }, () => "?").join(",")})`, [
            runId, unit.canonicalKey, child.jiraKey, "CHILD", child.version, child.updatedAt, "CHILD_ONLY", `Sub-Support de ${unit.root.jiraKey}`, "", json(inherited), child.createdAt.slice(0, 10),
            child.service || unit.service, child.team || unit.team, child.classification || unit.classification, child.closed, child.reopened, child.totalHours ?? 0, clusterOf.get(unit.canonicalKey) ?? null, groupOf.get(unit.canonicalKey) ?? null,
          ]);
        }
      });
    }
    for (const cluster of clusters) {
      await store.transaction(async (tx) => {
        await tx.run(`INSERT INTO clusters VALUES (${Array.from({ length: 27 }, () => "?").join(",")})`, [
          cluster.id, runId, cluster.title, "", cluster.members.length, Math.round((cluster.members.length / total) * 1000) / 10, cluster.service, cluster.team, cluster.dominantClassification, cluster.firstSeen, cluster.lastSeen,
          cluster.openCases, cluster.closedCases, cluster.reopenedCases, cluster.totalHours, cluster.cohesion, cluster.confidence, cluster.lowConfidence, cluster.mixedFailureModes, cluster.evidenceCoverage,
          json(cluster.outliers), json(cluster.topTerms), json(cluster.timeline), json(cluster.centroid), cluster.previousCount ?? null, cluster.trend, "PENDING",
        ]);
        for (const member of cluster.members) await tx.run(`INSERT INTO cluster_members VALUES (?,?,?,?,?)`, [runId, cluster.id, member.canonicalKey, member.similarity, member.representative]);
        for (const group of cluster.failureGroups) await tx.run(`INSERT INTO failure_groups VALUES (?,?,?,?,?,?,?,?,?)`, [group.id, runId, cluster.id, group.signature, group.label, group.members.length, group.percentage, json(group.signals), json(group.representative)]);
      });
    }
    await store.run(`UPDATE analysis_runs SET cases_eligible = ?, cases_excluded = ?, clusters = ?, failure_groups = ? WHERE id = ?`, [eligible, units.length - eligible, clusters.length, clusters.reduce((sum, cluster) => sum + cluster.failureGroups.length, 0), runId]);
    void fetched;
  }

  // ------------------------------------------------------------------- reads

  private async effectiveId(runId: string): Promise<string | undefined> {
    const row = await this.deps.store.queryOne(`SELECT progress_json FROM analysis_runs WHERE id = ?`, [runId]);
    if (!row) return undefined;
    return parse<ProgressInfo | undefined>(row.progress_json, undefined)?.reusedFrom ?? runId;
  }

  runView(row: Row) {
    return {
      id: s(row.id), periodType: s(row.period_type), from: s(row.period_from), to: s(row.period_to), status: s(row.status),
      progress: parse<ProgressInfo | null>(row.progress_json, null), trigger: s(row.trigger), startedAt: s(row.started_at), completedAt: row.completed_at ? s(row.completed_at) : null,
      casesFetched: Number(row.cases_fetched ?? 0), eligible: Number(row.cases_eligible ?? 0), excluded: Number(row.cases_excluded ?? 0), clusters: Number(row.clusters ?? 0), failureGroups: Number(row.failure_groups ?? 0),
      error: row.error ? s(row.error) : null, warnings: parse<string[]>(row.warnings_json, []), models: parse<Record<string, string>>(row.model_config, {}),
      versions: { analysis: s(row.analysis_version), clustering: s(row.clustering_version), prompt: s(row.prompt_version), normalization: s(row.normalization_version), pipeline: s(row.pipeline_version) },
      preparedAt: row.prepared_at ? s(row.prepared_at) : null,
      lastCheckedAt: row.last_checked_at ? s(row.last_checked_at) : null,
      analysis: row.analysis_mode
        ? {
            mode: s(row.analysis_mode), requestedClusters: parse<string[]>(row.requested_clusters, []), selection: parse<{ id: string; reason: string }[]>(row.selection_json, []),
            processedClusters: Number(row.processed_clusters ?? 0), reusedClusters: Number(row.reused_clusters ?? 0), analyzedClusters: Math.max(0, Number(row.processed_clusters ?? 0) - Number(row.reused_clusters ?? 0)),
            aiCalls: Number(row.ai_runs ?? 0), aiSkippedByReuse: Number(row.ai_skipped ?? 0), pipelineVersion: s(row.pipeline_version), startedAt: row.ai_started_at ? s(row.ai_started_at) : null, completedAt: row.ai_completed_at ? s(row.ai_completed_at) : null,
          }
        : null,
    };
  }

  async listRuns(limit = 30) {
    return (await this.deps.store.query(`SELECT * FROM analysis_runs ORDER BY started_at DESC LIMIT ?`, [Math.min(limit, 100)])).map((row) => this.runView(row));
  }

  async getRun(runId: string) {
    const row = await this.deps.store.queryOne(`SELECT * FROM analysis_runs WHERE id = ?`, [runId]);
    if (!row) return undefined;
    const view = this.runView(row);
    const effective = view.progress?.reusedFrom ? await this.deps.store.queryOne(`SELECT * FROM analysis_runs WHERE id = ?`, [view.progress.reusedFrom]) : undefined;
    return effective ? { ...this.runView(effective), id: view.id, reusedFrom: view.progress?.reusedFrom, startedAt: view.startedAt, completedAt: view.completedAt, status: view.status, progress: view.progress } : view;
  }

  async events(runId: string, limit = 100) {
    return (await this.deps.store.query(`SELECT ts, level, phase, message FROM analysis_events WHERE run_id = ? ORDER BY ts DESC LIMIT ?`, [runId, limit])).reverse();
  }

  async clusters(runId: string) {
    const id = await this.effectiveId(runId);
    if (!id) return undefined;
    const rows = await this.deps.store.query(`SELECT c.*, p.priority_score, p.priority_json, p.depth AS ai_depth, p.reused AS ai_reused FROM clusters c LEFT JOIN cluster_ai_state p ON p.run_id = c.run_id AND p.cluster_id = c.id WHERE c.run_id = ? ORDER BY c.case_count DESC, c.id`, [id]);
    const groups = await this.deps.store.query(`SELECT cluster_id, COUNT(*) AS n FROM failure_groups WHERE run_id = ? GROUP BY cluster_id`, [id]);
    const counts = new Map(groups.map((row) => [s(row.cluster_id), Number(row.n)]));
    return rows.map((row) => ({
      id: s(row.id), title: s(row.title), description: s(row.description), cases: Number(row.case_count), percentage: Number(row.percentage), service: s(row.service), team: s(row.team),
      classification: s(row.dominant_classification), firstSeen: s(row.first_seen), lastSeen: s(row.last_seen), open: Number(row.open_cases), closed: Number(row.closed_cases), reopened: Number(row.reopened_cases),
      totalHours: Number(row.total_hours), cohesion: Number(row.cohesion), confidence: Number(row.confidence), lowConfidence: Boolean(row.low_confidence), mixedFailureModes: Boolean(row.mixed_failure_modes),
      previousCount: row.previous_count === null ? null : Number(row.previous_count), trend: s(row.trend), analysisStatus: s(row.rootcause_status), failureGroups: counts.get(s(row.id)) ?? 0, topTerms: parse<string[]>(row.top_terms_json, []),
      priorityScore: Number(row.priority_score ?? 0), priorityReasons: parse<{ reasons?: string[] }>(row.priority_json, {}).reasons ?? [], aiDepth: s(row.ai_depth || "NONE"), aiReused: Boolean(row.ai_reused),
    }));
  }

  async clusterDetail(runId: string, clusterId: string) {
    const id = await this.effectiveId(runId);
    if (!id) return undefined;
    const { store } = this.deps;
    const row = await store.queryOne(`SELECT * FROM clusters WHERE run_id = ? AND id = ?`, [id, clusterId]);
    if (!row) return undefined;
    const [members, groups, evidence, candidates, tasks] = await Promise.all([
      store.query(`SELECT m.canonical_key, m.similarity, m.representative, c.summary, c.status, c.created_at, c.service, r.eligibility, r.failure_group_id FROM cluster_members m JOIN jira_cases c ON c.jira_key = m.canonical_key LEFT JOIN analysis_run_cases r ON r.run_id = m.run_id AND r.jira_key = m.canonical_key WHERE m.run_id = ? AND m.cluster_id = ? ORDER BY m.similarity DESC`, [id, clusterId]),
      store.query(`SELECT * FROM failure_groups WHERE run_id = ? AND cluster_id = ? ORDER BY case_count DESC`, [id, clusterId]),
      store.query(`SELECT * FROM cluster_evidence WHERE run_id = ? AND cluster_id = ? ORDER BY id`, [id, clusterId]),
      store.query(`SELECT * FROM rootcause_candidates WHERE run_id = ? AND cluster_id = ?`, [id, clusterId]),
      store.query(`SELECT task, model, status, duration_ms, error_class, output_json FROM ai_task_runs WHERE run_id = ? AND cluster_id = ?`, [id, clusterId]),
    ]);
    const summary = (await this.clusters(runId))?.find((item) => item.id === clusterId);
    const state = await store.queryOne(`SELECT analysis_json FROM cluster_ai_state WHERE run_id = ? AND cluster_id = ?`, [id, clusterId]);
    const stored = parse<{ deep?: DeepDetail } | null>(state?.analysis_json, null);
    const deep = stored?.deep ? { ...stored.deep, roleRuns: stored.deep.roleRuns.map(({ response: _response, ...rest }) => rest) } : null;
    return {
      deep,
      cluster: summary,
      timeline: parse(row.timeline_json, []),
      outliers: parse<string[]>(row.outliers_json, []),
      cases: members.map((m) => ({ key: s(m.canonical_key), summary: s(m.summary), status: s(m.status), createdAt: s(m.created_at), service: s(m.service), similarity: Number(m.similarity), representative: Boolean(m.representative), failureGroupId: m.failure_group_id ? s(m.failure_group_id) : null })),
      failureGroups: groups.map((g) => ({ id: s(g.id), signature: s(g.signature), label: s(g.label), cases: Number(g.case_count), percentage: Number(g.percentage), signals: parse<string[]>(g.signals_json, []) })),
      evidence: evidence.map((e) => ({ id: s(e.id), jiraKey: s(e.jira_key), field: s(e.field), snippet: s(e.snippet), failureGroupId: e.failure_group_id ? s(e.failure_group_id) : null, reason: s(e.reason) })),
      candidates: candidates.map((c) => ({ id: s(c.id), failureGroupId: c.failure_group_id ? s(c.failure_group_id) : null, title: s(c.title), description: s(c.description), level: s(c.level), confidence: Number(c.confidence), evidence: parse(c.evidence_json, []), affectedCases: parse<string[]>(c.affected_cases_json, []), businessImpact: s(c.business_impact), technicalSignals: parse<string[]>(c.technical_signals_json, []), limitations: parse<string[]>(c.limitations_json, []), recommendedNextSteps: parse(c.next_steps_json, []), status: c.status ? s(c.status) : "CANDIDATE" })),
      aiTasks: tasks.map((t) => ({ task: s(t.task), model: s(t.model), status: s(t.status), durationMs: Number(t.duration_ms ?? 0), error: t.error_class ? s(t.error_class) : null, audit: parse(t.output_json, null) })),
    };
  }

  async cases(runId: string, query: { page?: number; pageSize?: number; eligibility?: string; clusterId?: string; service?: string; status?: string; search?: string }) {
    const id = await this.effectiveId(runId);
    if (!id) return undefined;
    const where = ["r.run_id = ?", "r.role = 'UNIT'"];
    const params: (string | number)[] = [id];
    if (query.eligibility) (where.push("r.eligibility = ?"), params.push(query.eligibility));
    if (query.clusterId) (where.push("r.cluster_id = ?"), params.push(query.clusterId));
    if (query.service) (where.push("lower(r.service) = lower(?)"), params.push(query.service));
    if (query.status) (where.push(query.status === "closed" ? "r.closed = true" : "r.closed = false"));
    if (query.search) (where.push("(lower(c.summary) LIKE ? OR lower(r.jira_key) LIKE ?)"), params.push(`%${query.search.toLowerCase()}%`, `%${query.search.toLowerCase()}%`));
    const pageSize = Math.min(Math.max(query.pageSize ?? 25, 1), 100);
    const page = Math.max(query.page ?? 1, 1);
    const base = `FROM analysis_run_cases r JOIN jira_cases c ON c.jira_key = r.jira_key WHERE ${where.join(" AND ")}`;
    const total = Number((await this.deps.store.queryOne(`SELECT COUNT(*) AS n ${base}`, params))?.n ?? 0);
    const rows = await this.deps.store.query(`SELECT r.jira_key, r.eligibility, r.eligibility_reason, r.cluster_id, r.service, r.team, r.classification, r.closed, r.reopened, r.period_date, r.inherited_fields, c.summary, c.status, c.issue_type, c.priority, c.url ${base} ORDER BY r.period_date DESC, r.jira_key LIMIT ? OFFSET ?`, [...params, pageSize, (page - 1) * pageSize]);
    return {
      total, page, pageSize,
      items: rows.map((row) => ({ key: s(row.jira_key), summary: s(row.summary), status: s(row.status), issueType: s(row.issue_type), priority: s(row.priority), service: s(row.service), team: s(row.team), classification: s(row.classification), closed: Boolean(row.closed), reopened: Boolean(row.reopened), date: s(row.period_date), eligibility: s(row.eligibility), eligibilityReason: s(row.eligibility_reason), clusterId: row.cluster_id ? s(row.cluster_id) : null, inheritedFields: parse<string[]>(row.inherited_fields, []), url: row.url ? s(row.url) : null })),
    };
  }

  async report(runId: string, kind: ReportKind) {
    const id = await this.effectiveId(runId);
    if (!id) return undefined;
    const row = await this.deps.store.queryOne(`SELECT generated_at, content_json FROM analysis_reports WHERE run_id = ? AND kind = ?`, [id, kind]);
    return row ? { kind, generatedAt: s(row.generated_at), content: parse(row.content_json, null) } : undefined;
  }

  async overview() {
    const latest = await this.deps.store.queryOne(`SELECT id FROM analysis_runs WHERE status IN ('PREPARED','COMPLETED','PARTIAL') ORDER BY started_at DESC LIMIT 1`);
    return { enabled: this.deps.config.enabled, source: this.deps.source.mode, ai: { enabled: this.deps.config.ai.enabled, provider: this.deps.config.ai.provider, models: this.deps.config.ai.models }, activeRunId: this.activeRunId ?? null, latestRunId: latest ? s(latest.id) : null, readOnly: true };
  }

  /** Whether a completed run already covers this period (used by the scheduler). */
  async hasRunFor(period: { from: string; to: string }): Promise<boolean> {
    return Boolean(await this.deps.store.queryOne(`SELECT id FROM analysis_runs WHERE period_from = ? AND period_to = ? AND status IN ('PREPARED','COMPLETED','PARTIAL','QUEUED','SYNCING_JIRA','NORMALIZING','CLUSTERING','ANALYZING','VALIDATING','GENERATING_REPORT') LIMIT 1`, [period.from, period.to]));
  }
}

export { addDays };
