import { randomUUID } from "node:crypto";

import { NARRATIVE_PROMPT_VERSION, OPS_VERSION } from "../config.js";
import { HIGH_PRIORITY, sha } from "../lifecycle.js";
import type { IntelligenceService, OpsUnitRow } from "../service.js";
import { round } from "../text.js";
import type { CanonicalUnit } from "../types.js";
import { deterministicNarrative, NARRATIVE_SYSTEM_PROMPT, parseNarrative, type ExecutiveNarrative, type ExecutivePayload } from "./executive.js";
import { buildInsights, type OperationalInsight, type ProblemRow } from "./insights.js";
import { agingOf, breakdownOf, computeMetrics, dataQualityScore, healthSignals, kpi, type CaseRow, type KpiValue, type PeriodMetrics } from "./metrics.js";
import { operationalPriority, type OperationalPriority } from "./priority.js";
import { classifyTrend, type SeriesPoint, type TrendResult } from "./trends.js";

type Row = Record<string, unknown>;
const s = (value: unknown) => (value === null || value === undefined ? "" : String(value));
const parse = <T>(value: unknown, fallback: T): T => {
  if (typeof value !== "string" || !value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
};
const pct = (part: number, whole: number) => (whole ? round((part / whole) * 100, 1) : 0);

export const REPORT_TYPES = ["EXECUTIVE", "OPERATIONAL", "RCA", "DATA_QUALITY", "PERIOD_COMPARISON"] as const;
export type OpsReportKind = (typeof REPORT_TYPES)[number];
export const RECOMMENDATION_STATES = ["PROPOSED", "REVIEWED", "ACCEPTED", "DISMISSED", "DONE"] as const;
export type RecommendationState = (typeof RECOMMENDATION_STATES)[number];
export type RecommendationType = "INVESTIGATE" | "FIX" | "MONITOR" | "PROCESS_CHANGE" | "DATA_QUALITY" | "RECLASSIFY";
export type OperationalStatus = "PREPARED" | "COMPLETED" | "COMPLETED_WITH_LIMITATIONS" | "PARTIAL" | "FAILED" | "INTERRUPTED";

const LEVEL_RANK: Record<string, number> = { CONFIRMED_CAUSE: 4, SUPPORTED_CAUSE: 3, LIKELY_CAUSE: 2, HYPOTHESIS: 1, OBSERVED_PATTERN: 0 };
const CAUSAL = new Set(["CONFIRMED_CAUSE", "SUPPORTED_CAUSE", "LIKELY_CAUSE"]);
const TYPE_ORDER: RecommendationType[] = ["FIX", "PROCESS_CHANGE", "INVESTIGATE", "DATA_QUALITY", "RECLASSIFY", "MONITOR"];
const OK_ROLE_STATUS = new Set(["COMPLETED", "REUSED", "SKIPPED"]);

export function recommendationType(action: string, owner: string, basis: string | null): RecommendationType {
  const text = `${action} ${owner}`.toLowerCase();
  let type: RecommendationType = "INVESTIGATE";
  if (/(monitor|vigil|seguimiento|observar)/.test(text)) type = "MONITOR";
  else if (/(reclasific|clasificaci)/.test(text)) type = "RECLASSIFY";
  else if (/(calidad de datos|completar|campo|mensaje de error|documentar|registrar)/.test(text)) type = "DATA_QUALITY";
  else if (/(proceso|procedimiento|runbook|flujo|gu[ií]a)/.test(text)) type = "PROCESS_CHANGE";
  else if (/(corregir|arreglar|\bfix\b|implementar|ajustar|desplegar|parche|actualizar|reiniciar)/.test(text)) type = "FIX";
  // A weak basis never yields a definitive action.
  if (type === "FIX" && (!basis || !CAUSAL.has(basis))) type = "INVESTIGATE";
  return type;
}

export function toCaseRow(unit: CanonicalUnit): CaseRow {
  return {
    key: unit.root.jiraKey,
    canonicalKey: unit.canonicalKey,
    createdAt: unit.root.createdAt,
    resolvedAt: unit.resolvedAt ?? null,
    closed: unit.closed,
    reopened: unit.reopened,
    totalHours: unit.totalHours,
    priority: unit.root.priority,
    hasDescription: unit.root.description.trim().length > 0,
    hasErrorMessage: unit.errorUseful,
    hasCloseMessage: unit.closeMessage.trim() !== "",
    service: unit.service,
    team: unit.team,
    classification: unit.classification,
    issueType: unit.root.issueType,
    aiUsage: unit.root.aiUsage,
  };
}

export interface ProblemView extends ProblemRow {
  rank: number;
  percentage: number;
  evidenceCoverage: number;
  firstSeen: string;
  lastSeen: string;
  series: SeriesPoint[];
  backlog: { open: number; oldestHours: number | null };
  confidence: number;
  analysisStatus: string;
}

export interface FindingView {
  id: string;
  clusterId: string;
  cluster: string;
  statement: string;
  level: string;
  confidence: number;
  limitations: string[];
  affectedCases: number;
  trend: string;
  evidenceCoverage: number;
  relatedCandidateId: string | null;
  evidence: { jiraKey: string; field: string; excerpt: string }[];
}

export interface RecommendationView {
  id: string;
  clusterId: string;
  cluster: string;
  type: RecommendationType;
  action: string;
  rationale: string;
  owner: string;
  basis: string | null;
  findingIds: string[];
  state: RecommendationState;
  priority: string;
  affectedCases: number;
}

export interface Dashboard {
  run: { id: string; effectiveId: string; period: { type: string; from: string; to: string; label: string; days: number }; status: string; operationalStatus: OperationalStatus; mode: string | null; dataFingerprint: string; pipelineVersion: string; computedAt: string };
  kpis: KpiValue[];
  health: ReturnType<typeof healthSignals>;
  changes: OperationalInsight[];
  insights: OperationalInsight[];
  problems: ProblemView[];
  rootCause: { counts: { supported: number; likely: number; hypotheses: number; insufficient: number; conflicting: number }; analyzedGroups: number; findings: FindingView[]; coverage: { recurringCases: number; coveredCases: number; percentage: number } };
  recommendations: RecommendationView[];
  dataQuality: { level: string; score: number; previousScore: number | null; current: PeriodMetrics["coverage"]; previous: PeriodMetrics["coverage"] | null; insufficientForRca: number };
  breakdowns: { dimension: string; coverage: number; rows: Record<string, unknown>[] }[];
  aging: ReturnType<typeof agingOf>;
  trend: { historyAvailable: number; periods: { from: string; to: string; current: boolean; total: number; open: number; closed: number; reopened: number; hours: number; medianResolutionHours: number | null; dataQuality: number }[] };
  comparison: { previous: { from: string; to: string } | null; metrics: PeriodMetrics; previousMetrics: PeriodMetrics | null };
  limitations: string[];
  ai: { calls: number; skippedByReuse: number; mode: string | null };
}

export interface ReportRecord {
  id: string;
  runId: string;
  kind: OpsReportKind;
  version: number;
  status: "COMPLETED" | "REUSED" | "FAILED";
  reportVersion: string;
  dataFingerprint: string;
  analysisPipelineVersion: string;
  promptVersion: string | null;
  model: string | null;
  aiCalls: number;
  generatedAt: string;
  content: unknown;
}

/** Operational Intelligence: reads what the earlier phases already stored and never re-analyses cases with AI. */
export class OpsService {
  constructor(private readonly svc: IntelligenceService) {}

  // ---------------------------------------------------------------- dashboard

  async dashboard(runId: string): Promise<Dashboard | undefined> {
    const { store, config, now } = this.svc.internals;
    const id = await this.svc.resolveRunId(runId);
    if (!id) return undefined;
    const run = await this.svc.getRun(id);
    const runRow = await store.queryOne(`SELECT data_fingerprint, pipeline_version, status, analysis_mode, ai_runs, ai_skipped FROM analysis_runs WHERE id = ?`, [id]);
    if (!run || !runRow) return undefined;
    const data = await this.svc.operationalData(id, config.ops.historyPeriods);
    const clusters = (await this.svc.clusters(id)) ?? [];

    const currentRows = data.current.map((item) => toCaseRow(item.unit));
    const previousRows = data.previous?.rows.map((item) => toCaseRow(item.unit)) ?? null;
    const metrics = computeMetrics(currentRows);
    const previousMetrics = previousRows ? computeMetrics(previousRows) : null;
    const eligible = data.current.filter((item) => item.eligible);
    const previousEligible = data.previous?.rows.filter((item) => item.eligible).length ?? 0;
    const groupedCases = clusters.reduce((sum, cluster) => sum + cluster.cases, 0);
    const groupedPct = pct(groupedCases, eligible.length);
    const previousGrouped = data.previous ? clusters.reduce((sum, cluster) => sum + (cluster.previousCount ?? 0), 0) : null;

    const members = new Map((await store.query(`SELECT canonical_key, cluster_id FROM analysis_run_cases WHERE run_id = ? AND role = 'UNIT' AND cluster_id IS NOT NULL`, [id])).map((row) => [s(row.canonical_key), s(row.cluster_id)]));
    const unitsByCluster = new Map<string, OpsUnitRow[]>();
    for (const item of data.current) {
      const clusterId = members.get(item.unit.canonicalKey);
      if (clusterId) unitsByCluster.set(clusterId, [...(unitsByCluster.get(clusterId) ?? []), item]);
    }

    const { findings, conflicting, candidates, evidenceByCluster, roleStats, recs, recStates } = await this.loadAnalysis(id);
    const evidenceCoverage = (clusterId: string, cases: number) => pct(evidenceByCluster.get(clusterId) ?? 0, cases);

    // ---- problems
    const maxCases = Math.max(1, ...clusters.map((cluster) => cluster.cases));
    const maxHours = Math.max(0, ...clusters.map((cluster) => cluster.totalHours));
    const levelOf = (clusterId: string) => findings.filter((finding) => finding.clusterId === clusterId).sort((a, b) => (LEVEL_RANK[b.level] ?? 0) - (LEVEL_RANK[a.level] ?? 0))[0]?.level ?? null;
    const problems: ProblemView[] = clusters.map((cluster) => {
      const own = unitsByCluster.get(cluster.id) ?? [];
      const series = data.series.get(cluster.id) ?? [{ from: data.period.from, to: data.period.to, count: cluster.cases }];
      const trend: TrendResult = classifyTrend(series, config.ops.thresholds);
      const rcaLevel = levelOf(cluster.id);
      const rcaForPriority = rcaLevel && LEVEL_RANK[rcaLevel] > 0 ? rcaLevel : null;
      const priority: OperationalPriority = operationalPriority({
        cases: cluster.cases,
        maxCases,
        open: cluster.open,
        reopened: cluster.reopened,
        highPriorityCases: own.filter((item) => HIGH_PRIORITY.test(item.unit.root.priority)).length,
        totalHours: cluster.totalHours,
        maxHours,
        confidence: cluster.confidence,
        lowConfidence: cluster.lowConfidence,
        trend,
        rcaLevel: rcaForPriority,
        previousCount: cluster.previousCount,
      });
      const backlog = agingOf(own.map((item) => toCaseRow(item.unit)), now(), config.ops.agingBucketsHours);
      return {
        rank: 0,
        clusterId: cluster.id,
        title: cluster.title,
        cases: cluster.cases,
        previousCount: cluster.previousCount,
        open: cluster.open,
        reopened: cluster.reopened,
        service: cluster.service,
        team: cluster.team,
        lowConfidence: cluster.lowConfidence,
        trend,
        priority,
        rcaLevel: rcaForPriority,
        analyzed: cluster.aiDepth === "DEEP",
        percentage: cluster.percentage,
        evidenceCoverage: evidenceCoverage(cluster.id, cluster.cases),
        firstSeen: cluster.firstSeen,
        lastSeen: cluster.lastSeen,
        series,
        backlog: { open: backlog.open, oldestHours: backlog.oldestHours },
        confidence: cluster.confidence,
        analysisStatus: cluster.analysisStatus,
      };
    });
    problems.sort((a, b) => b.priority.score - a.priority.score || b.cases - a.cases || a.clusterId.localeCompare(b.clusterId));
    problems.forEach((problem, index) => (problem.rank = index + 1));
    const problemOf = new Map(problems.map((problem) => [problem.clusterId, problem]));

    // ---- root cause section
    const candidateTarget = candidates.filter((candidate) => candidate.status === "CANDIDATE");
    const counts = {
      supported: candidateTarget.filter((candidate) => candidate.level === "SUPPORTED_CAUSE" || candidate.level === "CONFIRMED_CAUSE").length,
      likely: candidateTarget.filter((candidate) => candidate.level === "LIKELY_CAUSE").length,
      hypotheses: candidateTarget.filter((candidate) => candidate.level === "HYPOTHESIS").length,
      insufficient: candidates.filter((candidate) => candidate.status === "INSUFFICIENT_EVIDENCE_FOR_RCA").length,
      conflicting: candidates.filter((candidate) => candidate.status === "CONFLICTING_EVIDENCE").length,
    };
    const covered = new Set(candidateTarget.filter((candidate) => CAUSAL.has(candidate.level)).flatMap((candidate) => candidate.affectedCases));
    const rootFindings: FindingView[] = findings
      .map((finding) => {
        const problem = problemOf.get(finding.clusterId);
        const candidate = candidates.find((item) => item.clusterId === finding.clusterId && item.failureGroupId === finding.failureGroupId);
        return {
          id: finding.id,
          clusterId: finding.clusterId,
          cluster: problem?.title ?? finding.clusterId,
          statement: finding.statement,
          level: finding.level,
          confidence: finding.confidence,
          limitations: finding.limitations,
          affectedCases: finding.groupCases ?? problem?.cases ?? 0,
          trend: problem?.trend.trend ?? "INSUFFICIENT_HISTORY",
          evidenceCoverage: problem?.evidenceCoverage ?? 0,
          relatedCandidateId: candidate?.id ?? null,
          evidence: finding.evidence.slice(0, 4).map((item) => ({ jiraKey: item.jiraKey, field: item.field, excerpt: item.excerpt })),
        };
      })
      .sort((a, b) => (LEVEL_RANK[b.level] ?? 0) - (LEVEL_RANK[a.level] ?? 0) || b.confidence - a.confidence);

    // ---- recommendations
    const recommendations: RecommendationView[] = recs
      .map((rec): RecommendationView | undefined => {
        const linked = findings.filter((finding) => finding.clusterId === rec.clusterId && rec.findingIds.includes(finding.id));
        if (rec.findingIds.length && !linked.length) return undefined;
        const basis = linked.sort((a, b) => (LEVEL_RANK[b.level] ?? 0) - (LEVEL_RANK[a.level] ?? 0))[0]?.level ?? null;
        const problem = problemOf.get(rec.clusterId);
        return { id: rec.id, clusterId: rec.clusterId, cluster: problem?.title ?? rec.clusterId, type: recommendationType(rec.action, rec.owner, basis), action: rec.action, rationale: rec.rationale, owner: rec.owner, basis, findingIds: rec.findingIds, state: recStates.get(`${rec.clusterId}:${rec.id}`) ?? "PROPOSED", priority: problem?.priority.badge ?? "LOW", affectedCases: problem?.cases ?? 0 };
      })
      .filter((rec): rec is RecommendationView => Boolean(rec))
      .sort((a, b) => {
        const pa = problemOf.get(a.clusterId);
        const pb = problemOf.get(b.clusterId);
        return (pb?.priority.score ?? 0) - (pa?.priority.score ?? 0) || b.affectedCases - a.affectedCases || (pb?.trend.changePct ?? 0) - (pa?.trend.changePct ?? 0) || (pb?.trend.consecutivePeriods ?? 0) - (pa?.trend.consecutivePeriods ?? 0) || (LEVEL_RANK[b.basis ?? ""] ?? -1) - (LEVEL_RANK[a.basis ?? ""] ?? -1) || TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type);
      });

    // ---- data quality
    const score = dataQualityScore(metrics.coverage);
    const previousScore = previousMetrics ? dataQualityScore(previousMetrics.coverage) : null;
    const insufficient = data.current.filter((item) => item.unit.eligibility === "INSUFFICIENT_CONTEXT").length;

    // ---- breakdowns
    const candidateByCase = new Map<string, Set<string>>();
    for (const candidate of candidateTarget) for (const key of candidate.affectedCases) candidateByCase.set(key, new Set([...(candidateByCase.get(key) ?? []), candidate.id]));
    const titles = new Map(clusters.map((cluster) => [cluster.id, cluster.title]));
    const enriched = (dimension: string, pick: (row: CaseRow) => string) => {
      const base = breakdownOf(currentRows, dimension, pick, dimension === "Servicio" || dimension === "Equipo" ? 0 : 0.6);
      if (!base) return null;
      return {
        dimension,
        coverage: base.coverage,
        rows: base.rows.map((row) => {
          const group = currentRows.filter((item) => pick(item).trim() === row.value);
          const inClusters = group.filter((item) => members.has(item.canonicalKey));
          const byCluster = new Map<string, number>();
          for (const item of inClusters) byCluster.set(members.get(item.canonicalKey)!, (byCluster.get(members.get(item.canonicalKey)!) ?? 0) + 1);
          const top = [...byCluster.entries()].sort((a, b) => b[1] - a[1])[0];
          const causes = new Set(group.flatMap((item) => [...(candidateByCase.get(item.canonicalKey) ?? [])]));
          return { ...row, recurringPercentage: pct(inClusters.length, group.length), topCluster: top ? titles.get(top[0]) ?? top[0] : null, rcaCandidates: causes.size };
        }),
      };
    };
    const breakdowns = [
      enriched("Servicio", (row) => row.service),
      enriched("Equipo", (row) => row.team),
      enriched("Tipo de caso", (row) => row.issueType),
      enriched("Prioridad Jira", (row) => row.priority),
      enriched("Uso de IA (descriptivo)", (row) => row.aiUsage),
    ].filter((item): item is NonNullable<typeof item> => Boolean(item));

    // ---- signals, KPIs, insights
    const health = healthSignals({ current: metrics, previous: previousMetrics, groupedPercentage: groupedPct, dataQualityScore: score, rcaLevels: candidateTarget.map((candidate) => candidate.level), analyzedClusters: problems.filter((problem) => problem.analyzed).length, thresholds: config.ops.thresholds });
    const highPriorityFindings = rootFindings.filter((finding) => ["CRITICAL", "HIGH"].includes(problemOf.get(finding.clusterId)?.priority.badge ?? "")).length;
    const resolution = metrics.resolution && metrics.resolution.samples >= 5 ? metrics.resolution : null;
    const kpis: KpiValue[] = [
      kpi("cases", "Casos", "cases", metrics.total, previousMetrics?.total, "NEUTRAL"),
      kpi("recurring", "Casos recurrentes", "cases", groupedCases, previousGrouped, "DOWN"),
      kpi("grouped", "% agrupado", "percent", groupedPct, data.previous && previousEligible ? pct(previousGrouped ?? 0, previousEligible) : null, "DOWN"),
      kpi("open", "Abiertos", "cases", metrics.open, previousMetrics?.open, "DOWN"),
      kpi("closed", "Cerrados", "cases", metrics.closed, previousMetrics?.closed, "UP"),
      kpi("reopened", "Reabiertos", "cases", metrics.reopened, previousMetrics?.reopened, "DOWN"),
      ...(resolution ? [kpi("resolution", "Resolución (mediana, h)", "hours", resolution.medianHours, previousMetrics?.resolution && previousMetrics.resolution.samples >= 5 ? previousMetrics.resolution.medianHours : null, "DOWN", 0.02, `P75 ${resolution.p75Hours} h · P95 ${resolution.p95Hours} h · ${resolution.samples} casos resueltos`)] : []),
      kpi("hours", "Horas registradas", "hours", metrics.totalHours, previousMetrics?.totalHours, "NEUTRAL"),
      kpi("groups", "Grupos recurrentes", "count", clusters.length, null, "NEUTRAL"),
      kpi("rcaCandidates", "Candidatos de causa", "count", candidateTarget.length, null, "NEUTRAL"),
      kpi("highPriorityFindings", "Hallazgos de prioridad alta", "count", highPriorityFindings, null, "NEUTRAL"),
    ];
    const insights = buildInsights({ current: metrics, previous: previousMetrics, signals: health, problems, dataQuality: { current: score, previous: previousScore }, services: breakdownOf(currentRows, "Servicio", (row) => row.service, 0), thresholds: config.ops.thresholds });

    // ---- limitations and status
    const failedRoles = roleStats.failed;
    const limitations: string[] = [];
    if (!data.previous) limitations.push("No hay período anterior con datos locales: no se muestran cambios frente al período previo.");
    else if (data.coveredPeriods < 3) limitations.push(`Historial limitado: ${data.coveredPeriods} período(s) previo(s) con datos; las tendencias de persistencia son parciales.`);
    const lowConfidence = problems.filter((problem) => problem.lowConfidence).length;
    if (lowConfidence) limitations.push(`${lowConfidence} grupo(s) tienen baja confianza y se tratan como patrones observados.`);
    const notAnalyzed = problems.filter((problem) => !problem.analyzed && problem.priority.badge !== "LOW").length;
    if (notAnalyzed) limitations.push(`${notAnalyzed} problema(s) prioritario(s) no tienen análisis profundo; no hay causa validada para ellos.`);
    if (counts.insufficient) limitations.push(`${counts.insufficient} grupo(s) analizados no tienen evidencia suficiente para proponer una causa.`);
    if (counts.conflicting) limitations.push(`${counts.conflicting} grupo(s) presentan evidencia contradictoria y no se reportan como causa.`);
    if (health.dataQuality !== "GOOD") limitations.push(`Calidad de datos ${health.dataQuality === "POOR" ? "baja" : "degradada"} (${score} puntos); reduce la fiabilidad del análisis.`);
    if (failedRoles) limitations.push(`${failedRoles} ejecución(es) de roles de análisis fallaron; los resultados de esos grupos pueden estar incompletos.`);
    if (!resolution) limitations.push("La resolución no se reporta: hay menos de 5 casos resueltos en el período.");
    if (run.status === "PARTIAL") limitations.push("El análisis con IA terminó de forma parcial.");
    limitations.push(...run.warnings.filter((warning) => !limitations.includes(warning)).slice(0, 3));

    const status = s(runRow.status);
    const operationalStatus: OperationalStatus = status === "FAILED" ? "FAILED" : status === "PARTIAL" ? "PARTIAL" : status === "PREPARED" ? "PREPARED" : failedRoles ? "COMPLETED_WITH_LIMITATIONS" : "COMPLETED";

    const periods = [
      ...data.history.slice().reverse().map((item) => ({ item, current: false })),
      { item: { from: data.period.from, to: data.period.to, rows: data.current }, current: true },
    ].map(({ item, current }) => {
      const rows = item.rows.map((entry) => toCaseRow(entry.unit));
      const periodMetrics = computeMetrics(rows);
      return { from: item.from, to: item.to, current, total: periodMetrics.total, open: periodMetrics.open, closed: periodMetrics.closed, reopened: periodMetrics.reopened, hours: periodMetrics.totalHours, medianResolutionHours: periodMetrics.resolution && periodMetrics.resolution.samples >= 5 ? periodMetrics.resolution.medianHours : null, dataQuality: dataQualityScore(periodMetrics.coverage) };
    });

    return {
      run: { id: runId, effectiveId: id, period: { type: data.period.type, from: data.period.from, to: data.period.to, label: data.period.label, days: data.period.days }, status, operationalStatus, mode: runRow.analysis_mode ? s(runRow.analysis_mode) : null, dataFingerprint: s(runRow.data_fingerprint), pipelineVersion: s(runRow.pipeline_version), computedAt: now().toISOString() },
      kpis,
      health,
      changes: insights.filter((insight) => insight.severity !== "INFO").slice(0, 6),
      insights,
      problems,
      rootCause: { counts, analyzedGroups: candidates.length, findings: rootFindings, coverage: { recurringCases: groupedCases, coveredCases: covered.size, percentage: pct(covered.size, groupedCases) } },
      recommendations,
      dataQuality: { level: health.dataQuality, score, previousScore, current: metrics.coverage, previous: previousMetrics?.coverage ?? null, insufficientForRca: insufficient },
      breakdowns,
      aging: agingOf(currentRows, now(), config.ops.agingBucketsHours),
      trend: { historyAvailable: data.coveredPeriods, periods },
      comparison: { previous: data.previous ? { from: data.previous.from, to: data.previous.to } : null, metrics, previousMetrics },
      limitations,
      ai: { calls: Number(runRow.ai_runs ?? 0), skippedByReuse: Number(runRow.ai_skipped ?? 0), mode: runRow.analysis_mode ? s(runRow.analysis_mode) : null },
    };
  }

  /** Persisted Phase 2 results. Findings tied to a rejected claim or to conflicting evidence are never exposed as findings. */
  private async loadAnalysis(id: string) {
    const { store } = this.svc.internals;
    const rejected = new Set((await store.query(`SELECT cluster_id, claim_id FROM claim_validations WHERE run_id = ? AND (action = 'REJECT' OR verdict IN ('UNSUPPORTED','CONTRADICTED'))`, [id])).map((row) => `${s(row.cluster_id)}:${s(row.claim_id)}`));
    const groupCases = new Map((await store.query(`SELECT cluster_id, id, case_count FROM analysis_failure_groups WHERE run_id = ?`, [id])).map((row) => [`${s(row.cluster_id)}:${s(row.id)}`, Number(row.case_count)]));
    const rawFindings = await store.query(`SELECT cluster_id, id, failure_group_id, statement, level, confidence, status, claim_ids_json, evidence_json, limitations_json FROM consolidated_findings WHERE run_id = ?`, [id]);
    const findings: { id: string; clusterId: string; failureGroupId: string | null; statement: string; level: string; confidence: number; limitations: string[]; evidence: { jiraKey: string; field: string; excerpt: string }[]; groupCases?: number }[] = [];
    let conflicting = 0;
    for (const row of rawFindings) {
      const clusterId = s(row.cluster_id);
      const claimIds = parse<string[]>(row.claim_ids_json, []);
      if (s(row.status) !== "ACCEPTED") {
        conflicting++;
        continue;
      }
      if (claimIds.some((claimId) => rejected.has(`${clusterId}:${claimId}`))) continue;
      const evidence = parse<{ jiraKey?: string; field?: string; excerpt?: string }[]>(row.evidence_json, []).map((item) => ({ jiraKey: s(item.jiraKey), field: s(item.field), excerpt: s(item.excerpt).slice(0, 240) }));
      findings.push({ id: s(row.id), clusterId, failureGroupId: row.failure_group_id ? s(row.failure_group_id) : null, statement: s(row.statement), level: s(row.level), confidence: Number(row.confidence), limitations: parse<string[]>(row.limitations_json, []), evidence, groupCases: groupCases.get(`${clusterId}:${s(row.failure_group_id)}`) });
    }
    const candidates = (await store.query(`SELECT id, cluster_id, failure_group_id, title, level, confidence, status, affected_cases_json FROM rootcause_candidates WHERE run_id = ?`, [id])).map((row) => ({ id: s(row.id), clusterId: s(row.cluster_id), failureGroupId: row.failure_group_id ? s(row.failure_group_id) : null, title: s(row.title), level: s(row.level), confidence: Number(row.confidence), status: s(row.status || "CANDIDATE"), affectedCases: parse<string[]>(row.affected_cases_json, []) }));
    const evidenceByCluster = new Map((await store.query(`SELECT cluster_id, COUNT(DISTINCT jira_key) AS n FROM analysis_evidence_items WHERE run_id = ? GROUP BY cluster_id`, [id])).map((row) => [s(row.cluster_id), Number(row.n)]));
    const roleRows = await store.query(`SELECT status, COUNT(*) AS n FROM role_runs WHERE run_id = ? GROUP BY status`, [id]);
    const roleStats = { total: roleRows.reduce((sum, row) => sum + Number(row.n), 0), failed: roleRows.filter((row) => !OK_ROLE_STATUS.has(s(row.status))).reduce((sum, row) => sum + Number(row.n), 0) };
    const recs = (await store.query(`SELECT cluster_id, id, action, rationale, owner, priority, finding_ids_json FROM cluster_recommendations WHERE run_id = ?`, [id])).map((row) => ({ clusterId: s(row.cluster_id), id: s(row.id), action: s(row.action), rationale: s(row.rationale), owner: s(row.owner), findingIds: parse<string[]>(row.finding_ids_json, []) }));
    const recStates = new Map((await store.query(`SELECT cluster_id, recommendation_id, state FROM recommendation_state WHERE run_id = ?`, [id])).map((row) => [`${s(row.cluster_id)}:${s(row.recommendation_id)}`, s(row.state) as RecommendationState]));
    return { findings, conflicting, candidates, evidenceByCluster, roleStats, recs, recStates };
  }

  async insights(runId: string) {
    const dashboard = await this.dashboard(runId);
    return dashboard ? { runId, insights: dashboard.insights } : undefined;
  }

  async recommendations(runId: string) {
    const dashboard = await this.dashboard(runId);
    return dashboard ? { runId, recommendations: dashboard.recommendations } : undefined;
  }

  async setRecommendationState(runId: string, clusterId: string, recommendationId: string, state: string): Promise<{ state: RecommendationState }> {
    const { store, now } = this.svc.internals;
    if (!RECOMMENDATION_STATES.includes(state as RecommendationState)) throw new Error(`Estado inválido: ${RECOMMENDATION_STATES.join(", ")}`);
    const id = await this.svc.resolveRunId(runId);
    const exists = id ? await store.queryOne(`SELECT id FROM cluster_recommendations WHERE run_id = ? AND cluster_id = ? AND id = ?`, [id, clusterId, recommendationId]) : undefined;
    if (!id || !exists) throw new Error("Recomendación no encontrada");
    await store.run(`INSERT OR REPLACE INTO recommendation_state (run_id, cluster_id, recommendation_id, state, updated_at) VALUES (?,?,?,?,?)`, [id, clusterId, recommendationId, state, now().toISOString()]);
    return { state: state as RecommendationState };
  }

  // ------------------------------------------------------------------ reports

  executivePayload(dashboard: Dashboard): ExecutivePayload {
    const total = dashboard.kpis.find((item) => item.key === "cases");
    const top = dashboard.problems.slice(0, 5);
    return {
      period: { label: dashboard.run.period.label, from: dashboard.run.period.from, to: dashboard.run.period.to },
      headlineFacts: { headline: `${dashboard.run.period.label}: ${total?.value ?? 0} casos, ${dashboard.problems.length} grupos recurrentes` },
      kpis: dashboard.kpis.map((item) => ({ label: item.label, value: item.value, unit: item.unit, previous: item.previous, changePercent: item.changePct === null ? null : Math.round(item.changePct * 100) })),
      health: { ...dashboard.health },
      changes: dashboard.changes.map((insight) => insight.statement),
      topProblems: top.map((problem) => ({ title: problem.title, cases: problem.cases, open: problem.open, trend: problem.trend.trend, priority: problem.priority.badge, why: problem.priority.reasons, validatedCause: problem.rcaLevel && CAUSAL.has(problem.rcaLevel) ? problem.rcaLevel : null, service: problem.service })),
      findings: dashboard.rootCause.findings.slice(0, 6).map((finding) => ({ cluster: finding.cluster, statement: finding.statement, level: finding.level, confidence: round(finding.confidence, 2), limitations: finding.limitations.slice(0, 2) })),
      recommendations: dashboard.recommendations.filter((rec) => rec.state !== "DISMISSED").slice(0, 6).map((rec) => ({ cluster: rec.cluster, type: rec.type, action: rec.action, basedOn: rec.basis ?? "OBSERVED_PATTERN" })),
      dataQuality: { level: dashboard.dataQuality.level, score: dashboard.dataQuality.score, description: dashboard.dataQuality.current.description, errorMessage: dashboard.dataQuality.current.errorMessage, closeMessage: dashboard.dataQuality.current.closeMessage },
      limitations: dashboard.limitations.slice(0, 8),
    };
  }

  private async narrative(payload: ExecutivePayload): Promise<{ narrative: ExecutiveNarrative; source: "AI" | "DETERMINISTIC"; model: string | null; calls: number; note?: string }> {
    const { config, llm } = this.svc.internals;
    if (!config.ai.enabled) return { narrative: deterministicNarrative(payload), source: "DETERMINISTIC", model: null, calls: 0, note: "IA deshabilitada" };
    try {
      const call = await llm.complete("EXEC_NARRATIVE", [{ role: "system", content: NARRATIVE_SYSTEM_PROMPT }, { role: "user", content: JSON.stringify(payload) }]);
      return { narrative: parseNarrative(call.json, payload), source: "AI", model: call.model, calls: 1 };
    } catch (error) {
      return { narrative: deterministicNarrative(payload), source: "DETERMINISTIC", model: null, calls: 1, note: `La narrativa de IA no se utilizó: ${(error as Error).message}`.slice(0, 240) };
    }
  }

  private content(kind: OpsReportKind, dashboard: Dashboard, narrative?: Awaited<ReturnType<OpsService["narrative"]>>): unknown {
    const base = { period: dashboard.run.period, operationalStatus: dashboard.run.operationalStatus, limitations: dashboard.limitations };
    switch (kind) {
      case "EXECUTIVE":
        return {
          ...base,
          headline: narrative?.narrative.headline,
          narrative: narrative?.narrative,
          narrativeSource: narrative?.source,
          narrativeNote: narrative?.note ?? null,
          kpis: dashboard.kpis,
          health: dashboard.health,
          changes: dashboard.changes,
          topProblems: dashboard.problems.slice(0, 5).map((problem) => ({ clusterId: problem.clusterId, title: problem.title, cases: problem.cases, open: problem.open, trend: problem.trend.trend, consecutivePeriods: problem.trend.consecutivePeriods, priority: problem.priority.badge, score: problem.priority.score, why: problem.priority.reasons, rcaLevel: problem.rcaLevel })),
          rootCause: { counts: dashboard.rootCause.counts, coverage: dashboard.rootCause.coverage, findings: dashboard.rootCause.findings.slice(0, 6) },
          recommendations: dashboard.recommendations.slice(0, 6),
          dataQuality: dashboard.dataQuality,
          priorityIssues: dashboard.problems.filter((problem) => problem.priority.badge === "CRITICAL" || problem.priority.badge === "HIGH").length,
        };
      case "OPERATIONAL":
        return { ...base, kpis: dashboard.kpis, aging: dashboard.aging, breakdowns: dashboard.breakdowns, problems: dashboard.problems, trend: dashboard.trend, health: dashboard.health, recommendations: dashboard.recommendations };
      case "RCA":
        return { ...base, counts: dashboard.rootCause.counts, coverage: dashboard.rootCause.coverage, findings: dashboard.rootCause.findings, recommendations: dashboard.recommendations, note: "Solo hallazgos validados con evidencia; las hipótesis se identifican por su nivel." };
      case "DATA_QUALITY":
        return { ...base, dataQuality: dashboard.dataQuality, series: dashboard.trend.periods.map((period) => ({ from: period.from, to: period.to, score: period.dataQuality })), insights: dashboard.insights.filter((insight) => insight.type === "DATA_QUALITY_DEGRADATION") };
      case "PERIOD_COMPARISON":
        return { ...base, previous: dashboard.comparison.previous, kpis: dashboard.kpis.filter((item) => item.previous !== null), groups: dashboard.problems.map((problem) => ({ clusterId: problem.clusterId, title: problem.title, current: problem.cases, previous: problem.previousCount, trend: problem.trend.trend, series: problem.series })), trendSummary: ["NEW", "GROWING", "DECLINING", "STABLE", "PERSISTENT", "RECURRING", "INSUFFICIENT_HISTORY"].map((trend) => ({ trend, groups: dashboard.problems.filter((problem) => problem.trend.trend === trend).length })), series: dashboard.trend.periods, health: dashboard.health };
    }
  }

  /** Versioned, cached generation. Same data + findings + versions => REUSED, with no new AI call. */
  async generateReports(runId: string, options: { kinds?: OpsReportKind[]; force?: boolean } = {}): Promise<ReportRecord[] | undefined> {
    const { store, now, config } = this.svc.internals;
    const dashboard = await this.dashboard(runId);
    if (!dashboard) return undefined;
    const id = dashboard.run.effectiveId;
    await this.svc.logEvent(id, "INFO", "REPORT_GENERATION_STARTED", `kinds=${(options.kinds ?? REPORT_TYPES).join(",")}`);
    const payload = this.executivePayload(dashboard);
    const findingSignature = sha([dashboard.rootCause.findings.map((finding) => [finding.id, finding.level, finding.confidence]), dashboard.recommendations.map((rec) => [rec.id, rec.type])]);
    const results: ReportRecord[] = [];
    for (const kind of options.kinds ?? REPORT_TYPES) {
      const model = kind === "EXECUTIVE" && config.ai.enabled ? config.ai.models.EXEC_NARRATIVE : null;
      const cacheKey = sha({ kind, data: dashboard.run.dataFingerprint, findings: findingSignature, pipeline: dashboard.run.pipelineVersion, ops: OPS_VERSION, payload: kind === "EXECUTIVE" ? payload : kpiSignature(dashboard), model, prompt: kind === "EXECUTIVE" ? NARRATIVE_PROMPT_VERSION : null });
      const hit = options.force ? undefined : await store.queryOne(`SELECT * FROM ops_reports WHERE cache_key = ? ORDER BY generated_at DESC LIMIT 1`, [cacheKey]);
      if (hit && s(hit.run_id) === id) {
        results.push(this.record(hit, "REUSED"));
        await this.svc.logEvent(id, "INFO", "REPORT_REUSED", `${kind} v${Number(hit.version)}`);
        continue;
      }
      const version = Number((await store.queryOne(`SELECT COALESCE(MAX(version), 0) AS v FROM ops_reports WHERE run_id = ? AND kind = ?`, [id, kind]))?.v ?? 0) + 1;
      let content: unknown;
      let aiCalls = 0;
      let status: ReportRecord["status"] = "COMPLETED";
      if (hit) {
        content = parse(hit.content_json, null);
        status = "REUSED";
      } else {
        const narrative = kind === "EXECUTIVE" ? await this.narrative(payload) : undefined;
        aiCalls = narrative?.calls ?? 0;
        content = this.content(kind, dashboard, narrative);
      }
      const record: ReportRecord = { id: `rep_${randomUUID().slice(0, 12)}`, runId: id, kind, version, status, reportVersion: OPS_VERSION, dataFingerprint: dashboard.run.dataFingerprint, analysisPipelineVersion: dashboard.run.pipelineVersion, promptVersion: kind === "EXECUTIVE" ? NARRATIVE_PROMPT_VERSION : null, model, aiCalls, generatedAt: now().toISOString(), content };
      await store.run(`INSERT INTO ops_reports (id, run_id, kind, version, status, cache_key, report_version, data_fingerprint, pipeline_version, prompt_version, model, ai_calls, generated_at, content_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [record.id, id, kind, version, status, cacheKey, record.reportVersion, record.dataFingerprint, record.analysisPipelineVersion, record.promptVersion, record.model, aiCalls, record.generatedAt, JSON.stringify(content)]);
      results.push(record);
      await this.svc.logEvent(id, "INFO", status === "REUSED" ? "REPORT_REUSED" : "REPORT_GENERATED", `${kind} v${version} aiCalls=${aiCalls}`);
      if (kind === "EXECUTIVE") await this.svc.logEvent(id, "INFO", "INSIGHT_GENERATED", `${dashboard.insights.length} insight(s)`);
    }
    return results;
  }

  private record(row: Row, status: ReportRecord["status"]): ReportRecord {
    return { id: s(row.id), runId: s(row.run_id), kind: s(row.kind) as OpsReportKind, version: Number(row.version), status, reportVersion: s(row.report_version), dataFingerprint: s(row.data_fingerprint), analysisPipelineVersion: s(row.pipeline_version), promptVersion: row.prompt_version ? s(row.prompt_version) : null, model: row.model ? s(row.model) : null, aiCalls: Number(row.ai_calls ?? 0), generatedAt: s(row.generated_at), content: parse(row.content_json, null) };
  }

  async listReports(runId: string) {
    const { store } = this.svc.internals;
    const id = await this.svc.resolveRunId(runId);
    if (!id) return undefined;
    const rows = await store.query(`SELECT id, run_id, kind, version, status, report_version, data_fingerprint, pipeline_version, prompt_version, model, ai_calls, generated_at FROM ops_reports WHERE run_id = ? ORDER BY generated_at DESC, version DESC`, [id]);
    return rows.map((row) => ({ ...this.record({ ...row, content_json: null }, s(row.status) as ReportRecord["status"]), content: undefined }));
  }

  async getReport(runId: string, kind: OpsReportKind, version?: number): Promise<ReportRecord | undefined> {
    const { store } = this.svc.internals;
    const id = await this.svc.resolveRunId(runId);
    if (!id) return undefined;
    const row = await store.queryOne(`SELECT * FROM ops_reports WHERE run_id = ? AND kind = ? ${version ? "AND version = ?" : ""} ORDER BY version DESC LIMIT 1`, version ? [id, kind, version] : [id, kind]);
    return row ? this.record(row, s(row.status) as ReportRecord["status"]) : undefined;
  }

  // ------------------------------------------------------------------ history

  async history(limit = 50) {
    const { store } = this.svc.internals;
    const runs = await this.svc.listRuns(limit);
    const out = [];
    for (const run of runs) {
      const id = (await this.svc.resolveRunId(run.id)) ?? run.id;
      const candidates = await store.queryOne(`SELECT COUNT(*) AS n FROM rootcause_candidates WHERE run_id = ? AND (status = 'CANDIDATE' OR status IS NULL)`, [id]);
      const failed = await store.queryOne(`SELECT COUNT(*) AS n FROM role_runs WHERE run_id = ? AND status NOT IN ('COMPLETED','REUSED','SKIPPED')`, [id]);
      const report = await store.queryOne(`SELECT version, generated_at, content_json FROM ops_reports WHERE run_id = ? AND kind = 'EXECUTIVE' ORDER BY version DESC LIMIT 1`, [id]);
      const priorityIssues = report ? parse<{ priorityIssues?: number }>(report.content_json, {}).priorityIssues ?? null : null;
      const status: OperationalStatus = run.status === "FAILED" ? "FAILED" : run.status === "PARTIAL" ? "PARTIAL" : run.status === "PREPARED" ? "PREPARED" : run.status === "COMPLETED" && Number(failed?.n ?? 0) > 0 ? "COMPLETED_WITH_LIMITATIONS" : run.status === "COMPLETED" ? "COMPLETED" : (run.status as OperationalStatus);
      out.push({ runId: run.id, period: { type: run.periodType, from: run.from, to: run.to }, mode: run.analysis?.mode ?? null, cases: run.casesFetched, eligible: run.eligible, groups: run.clusters, rcaCandidates: Number(candidates?.n ?? 0), priorityIssues, status, rawStatus: run.status, generatedAt: run.completedAt ?? run.startedAt, reportVersion: report ? Number(report.version) : null, pipelineVersion: run.versions.pipeline });
    }
    return out;
  }

  /** Side-by-side of two runs (not necessarily consecutive). Groups are listed per run: ids are not stable across runs. */
  async compare(runA: string, runB: string) {
    const { config } = this.svc.internals;
    const load = async (runId: string) => {
      const id = await this.svc.resolveRunId(runId);
      if (!id) return undefined;
      const data = await this.svc.operationalData(id, 1);
      const rows = data.current.map((item) => toCaseRow(item.unit));
      const clusters = (await this.svc.clusters(id)) ?? [];
      const metrics = computeMetrics(rows);
      return { id: runId, period: { type: data.period.type, from: data.period.from, to: data.period.to, label: data.period.label, days: data.period.days }, metrics, groups: clusters.length, grouped: clusters.reduce((sum, cluster) => sum + cluster.cases, 0), eligible: data.current.filter((item) => item.eligible).length, topGroups: clusters.slice(0, 5).map((cluster) => ({ id: cluster.id, title: cluster.title, cases: cluster.cases, open: cluster.open })), dataQuality: dataQualityScore(metrics.coverage) };
    };
    const [a, b] = await Promise.all([load(runA), load(runB)]);
    if (!a || !b) return undefined;
    const days = (period: { days: number }) => period.days;
    const comparable = days(a.period) === days(b.period);
    const rateOf = (value: number, period: { days: number }) => round(value / Math.max(1, period.days), 2);
    const kpis = [
      kpi("cases", "Casos", "cases", b.metrics.total, a.metrics.total, "NEUTRAL"),
      kpi("casesPerDay", "Casos por día", "count", rateOf(b.metrics.total, b.period), rateOf(a.metrics.total, a.period), "NEUTRAL"),
      kpi("open", "Abiertos", "cases", b.metrics.open, a.metrics.open, "DOWN"),
      kpi("closed", "Cerrados", "cases", b.metrics.closed, a.metrics.closed, "UP"),
      kpi("reopened", "Reabiertos", "cases", b.metrics.reopened, a.metrics.reopened, "DOWN"),
      kpi("groups", "Grupos", "count", b.groups, a.groups, "NEUTRAL"),
      kpi("grouped", "% agrupado", "percent", pct(b.grouped, b.eligible), pct(a.grouped, a.eligible), "DOWN"),
      kpi("dataQuality", "Calidad de datos", "count", b.dataQuality, a.dataQuality, "UP"),
    ];
    void config;
    return { a, b, kpis, notes: [comparable ? "Los períodos tienen la misma duración." : "Los períodos tienen duración distinta: compare los casos por día.", "Los grupos no se emparejan entre ejecuciones no consecutivas; se listan por separado."] };
  }
}

const kpiSignature = (dashboard: Dashboard) => [dashboard.kpis.map((item) => [item.key, item.value, item.previous]), dashboard.problems.map((problem) => [problem.clusterId, problem.priority.score, problem.trend.trend])];
