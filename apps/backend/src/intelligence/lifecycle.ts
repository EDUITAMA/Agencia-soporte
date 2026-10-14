import { createHash } from "node:crypto";

import { ANALYSIS_VERSION, ANALYST_PIPELINE_VERSION, CLUSTERING_VERSION, EVIDENCE_VERSION, modelConfigOf, NORMALIZATION_VERSION, PROMPT_VERSION, type IntelligenceConfig } from "./config.js";
import type { Trend } from "./report.js";

export const ANALYSIS_MODES = ["SUMMARY", "RECURRENCE", "TOP_RCA", "SELECTED_RCA", "FULL_RCA"] as const;
export type AnalysisMode = (typeof ANALYSIS_MODES)[number];
export type AiDepth = "NONE" | "LABEL" | "DEEP";
export type ReuseState = "REUSABLE" | "STALE_DATA" | "STALE_ANALYSIS" | "NOT_FOUND";
export type Workload = "NONE" | "LOW" | "MEDIUM" | "HIGH";

export const TOP_DEFAULT = 3;
export const DEPTH_OF: Record<AnalysisMode, AiDepth> = { SUMMARY: "NONE", RECURRENCE: "LABEL", TOP_RCA: "DEEP", SELECTED_RCA: "DEEP", FULL_RCA: "DEEP" };

export class SelectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SelectionError";
  }
}

export const sha = (value: unknown) => createHash("sha1").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex");

/** Identifies the deterministic scope of an analysis: same project, dates and deterministic configuration. */
export function scopeFingerprint(input: { project?: string; from: string; to: string; config: IntelligenceConfig }): string {
  const { config } = input;
  return sha({
    project: input.project ?? "",
    from: input.from,
    to: input.to,
    versions: [ANALYSIS_VERSION, NORMALIZATION_VERSION, CLUSTERING_VERSION],
    rules: { periodField: config.periodField, baseJql: config.baseJql ?? "", fieldIds: config.fieldIds, excluded: config.excludedIssueTypes, services: config.expectedServices, noise: config.noisePatterns, clustering: config.clustering },
  });
}

/** Identifies one AI execution over a set of clusters. */
export function aiFingerprint(input: { runId: string; mode: AnalysisMode; clusterIds: string[]; config: IntelligenceConfig }): string {
  return sha({ run: input.runId, mode: input.mode, clusters: [...input.clusterIds].sort(), pipeline: ANALYST_PIPELINE_VERSION, prompts: PROMPT_VERSION, models: modelConfigOf(input.config) });
}

/** Cache key for the AI result of one cluster snapshot. */
export function clusterAiKey(input: { clusterId: string; snapshot: string; depth: AiDepth; config: IntelligenceConfig }): string {
  const { config } = input;
  return sha({ cluster: input.clusterId, snapshot: input.snapshot, depth: input.depth, pipeline: ANALYST_PIPELINE_VERSION, evidence: [EVIDENCE_VERSION, config.evidence], prompts: PROMPT_VERSION, models: modelConfigOf(config), validation: config.ai.validationEnabled });
}

export interface PriorityInput {
  cases: number;
  maxCases: number;
  trend: Trend;
  previousCount: number | null;
  open: number;
  reopened: number;
  totalHours: number;
  maxHours: number;
  highPriority: number;
  confidence: number;
}

export interface PriorityResult {
  score: number;
  factors: { key: string; label: string; weight: number; value: number; points: number }[];
  reasons: string[];
}

const TREND_GROWTH: Record<Trend, number> = { GROWING: 1, NEW: 0.8, PERSISTENT: 0.5, NO_BASELINE: 0.3, DECLINING: 0.1 };
export const HIGH_PRIORITY = /highest|high|critical|blocker|major|urgent|alta|alto|cr[ií]tic|bloqueante/i;

/** Deterministic priority from observable signals only; it never estimates business impact. */
export function priorityScore(input: PriorityInput): PriorityResult {
  const share = (part: number, whole: number) => (whole > 0 ? Math.min(1, part / whole) : 0);
  const factors = [
    { key: "volume", label: "Volumen", weight: 30, value: share(input.cases, input.maxCases) },
    { key: "growth", label: "Crecimiento", weight: 20, value: TREND_GROWTH[input.trend] },
    { key: "persistence", label: "Persistencia", weight: 10, value: (input.previousCount ?? 0) > 0 ? 1 : 0 },
    { key: "open", label: "Casos abiertos", weight: 15, value: share(input.open, input.cases) },
    { key: "reopened", label: "Reabiertos", weight: 10, value: Math.min(1, share(input.reopened, input.cases) * 4) },
    { key: "hours", label: "Horas", weight: 5, value: share(input.totalHours, input.maxHours) },
    { key: "priority", label: "Prioridad Jira", weight: 5, value: share(input.highPriority, input.cases) },
    { key: "confidence", label: "Confianza del grupo", weight: 5, value: Math.max(0, Math.min(1, input.confidence)) },
  ].map((factor) => ({ ...factor, points: Math.round(factor.weight * factor.value * 10) / 10 }));
  const score = Math.round(factors.reduce((sum, factor) => sum + factor.points, 0) * 10) / 10;

  const reasons: string[] = [`${input.cases} caso(s)`];
  if (input.trend === "GROWING") reasons.push(`en crecimiento (antes ${input.previousCount ?? 0})`);
  else if (input.trend === "NEW") reasons.push("aparece por primera vez frente al periodo anterior");
  else if ((input.previousCount ?? 0) > 0 && input.trend === "PERSISTENT") reasons.push("persiste desde el periodo anterior");
  if (input.open > 0) reasons.push(`${input.open} abierto(s)`);
  if (input.reopened > 0) reasons.push(`${input.reopened} reabierto(s)`);
  if (input.highPriority > 0) reasons.push(`${input.highPriority} con prioridad alta en Jira`);
  if (input.totalHours > 0) reasons.push(`${Math.round(input.totalHours)} h registradas`);
  return { score, factors, reasons };
}

export interface SelectableCluster {
  id: string;
  title: string;
  cases: number;
  lowConfidence: boolean;
  priorityScore: number;
  priorityReasons: string[];
  evidenceCases: number;
}

export interface SelectionRequest {
  mode: AnalysisMode;
  clusterIds?: string[];
  includeLowConfidence?: boolean;
}

export interface SelectionResult {
  mode: AnalysisMode;
  depth: AiDepth;
  selected: (SelectableCluster & { reason: string })[];
  skippedLowConfidence: string[];
  capped: boolean;
}

const byPriority = (a: SelectableCluster, b: SelectableCluster) => b.priorityScore - a.priorityScore || b.cases - a.cases || a.id.localeCompare(b.id);

/** Resolves which clusters a mode sends to AI. SUMMARY selects none; the cap bounds cost for large periods. */
export function resolveSelection(clusters: SelectableCluster[], request: SelectionRequest, cap: number): SelectionResult {
  const { mode } = request;
  if (!ANALYSIS_MODES.includes(mode)) throw new SelectionError(`Modo de análisis inválido: ${String(mode)}`);
  const depth = DEPTH_OF[mode];
  const ranked = [...clusters].sort(byPriority);
  const explain = (cluster: SelectableCluster, prefix: string) => ({ ...cluster, reason: `${prefix}: ${cluster.priorityReasons.join(", ")}` });
  let pool: SelectableCluster[] = [];
  let prefix = "Prioridad";
  const skippedLowConfidence: string[] = [];

  if (mode === "RECURRENCE") {
    pool = ranked;
    prefix = "Recurrencia";
  } else if (mode === "TOP_RCA") {
    pool = ranked.filter((cluster) => !cluster.lowConfidence).slice(0, TOP_DEFAULT);
    ranked.filter((cluster) => cluster.lowConfidence).forEach((cluster) => skippedLowConfidence.push(cluster.id));
    prefix = "Top por prioridad";
  } else if (mode === "SELECTED_RCA") {
    const wanted = [...new Set(request.clusterIds ?? [])];
    if (!wanted.length) throw new SelectionError("Seleccione al menos un grupo");
    const known = new Map(clusters.map((cluster) => [cluster.id, cluster]));
    const unknown = wanted.filter((id) => !known.has(id));
    if (unknown.length) throw new SelectionError(`Grupos inexistentes en este análisis: ${unknown.join(", ")}`);
    pool = wanted.map((id) => known.get(id)!).sort(byPriority);
    prefix = "Selección manual";
  } else if (mode === "FULL_RCA") {
    pool = ranked.filter((cluster) => request.includeLowConfidence || !cluster.lowConfidence);
    ranked.filter((cluster) => cluster.lowConfidence && !request.includeLowConfidence).forEach((cluster) => skippedLowConfidence.push(cluster.id));
    prefix = "Análisis completo";
  }
  const capped = pool.length > cap;
  return { mode, depth, selected: pool.slice(0, cap).map((cluster) => explain(cluster, prefix)), skippedLowConfidence, capped };
}

export interface WorkloadEstimate {
  groupsSelected: number;
  casesRepresented: number;
  casesTotal: number;
  depth: AiDepth;
  workload: Workload;
  aiCalls: number;
  reusableGroups: number;
  aiCallsSkippedByReuse: number;
  summaryCall: boolean;
}

/** Simple workload class from groups, evidence volume and pipeline steps. It never estimates money. */
export function estimateWorkload(input: { selection: SelectionResult; casesTotal: number; reusable: Set<string>; config: IntelligenceConfig }): WorkloadEstimate {
  const { selection, config } = input;
  const perCluster = selection.depth === "DEEP" ? 2 + (config.ai.validationEnabled ? 1 : 0) : selection.depth === "LABEL" ? 1 : 0;
  const fresh = selection.selected.filter((cluster) => !input.reusable.has(cluster.id));
  const aiCalls = fresh.length * perCluster;
  const evidenceCases = selection.depth === "DEEP" ? fresh.reduce((sum, cluster) => sum + cluster.evidenceCases, 0) : 0;
  const summaryCall = config.ai.enabled;
  const load = aiCalls + Math.ceil(evidenceCases / 40);
  const workload: Workload = !config.ai.enabled || (aiCalls === 0 && !summaryCall) ? "NONE" : load <= 6 ? "LOW" : load <= 15 ? "MEDIUM" : "HIGH";
  return {
    groupsSelected: selection.selected.length,
    casesRepresented: selection.selected.reduce((sum, cluster) => sum + cluster.cases, 0),
    casesTotal: input.casesTotal,
    depth: config.ai.enabled ? selection.depth : "NONE",
    workload,
    aiCalls: config.ai.enabled ? aiCalls + (summaryCall ? 1 : 0) : 0,
    reusableGroups: selection.selected.length - fresh.length,
    aiCallsSkippedByReuse: (selection.selected.length - fresh.length) * perCluster,
    summaryCall,
  };
}
