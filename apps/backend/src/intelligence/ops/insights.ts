import type { OpsConfig } from "../config.js";
import { round } from "../text.js";
import type { Breakdown, HealthSignals, PeriodMetrics } from "./metrics.js";
import type { OperationalPriority } from "./priority.js";
import type { TrendResult } from "./trends.js";

export type InsightType =
  | "VOLUME_SPIKE"
  | "PERSISTENT_PROBLEM"
  | "NEW_RECURRENT_PROBLEM"
  | "RESOLUTION_DEGRADATION"
  | "HIGH_REOPEN_RATE"
  | "DATA_QUALITY_DEGRADATION"
  | "SERVICE_CONCENTRATION"
  | "RCA_AVAILABLE"
  | "INSUFFICIENT_EVIDENCE";

export interface OperationalInsight {
  id: string;
  type: InsightType;
  statement: string;
  metric: string;
  currentValue: number;
  previousValue: number | null;
  change: number | null;
  clusterId?: string;
  service?: string;
  team?: string;
  severity: "HIGH" | "MEDIUM" | "LOW" | "INFO";
  evidence: string[];
}

export interface ProblemRow {
  clusterId: string;
  title: string;
  cases: number;
  previousCount: number | null;
  open: number;
  reopened: number;
  service: string;
  team: string;
  lowConfidence: boolean;
  trend: TrendResult;
  priority: OperationalPriority;
  /** Best validated level, or null when the group has no analysis or no causal finding. */
  rcaLevel: string | null;
  analyzed: boolean;
}

const CAUSAL = new Set(["CONFIRMED_CAUSE", "SUPPORTED_CAUSE", "LIKELY_CAUSE"]);
const LEVEL_TEXT: Record<string, string> = { CONFIRMED_CAUSE: "causa confirmada", SUPPORTED_CAUSE: "causa respaldada", LIKELY_CAUSE: "causa probable" };

export interface InsightInput {
  current: PeriodMetrics;
  previous: PeriodMetrics | null;
  signals: HealthSignals;
  problems: ProblemRow[];
  dataQuality: { current: number; previous: number | null };
  services: Breakdown | null;
  thresholds: OpsConfig["thresholds"];
}

/** Insights are computed from numbers first; the model may only rephrase them afterwards. */
export function buildInsights(input: InsightInput): OperationalInsight[] {
  const { current, previous, thresholds } = input;
  const out: OperationalInsight[] = [];
  const add = (insight: Omit<OperationalInsight, "id">) => out.push({ ...insight, id: `${insight.type}:${insight.clusterId ?? insight.service ?? insight.metric}` });

  if (previous && previous.total > 0) {
    const change = (current.total - previous.total) / previous.total;
    if (change >= thresholds.change && current.total - previous.total >= 5) {
      add({ type: "VOLUME_SPIKE", statement: `El volumen de casos aumentó ${Math.round(change * 100)}% frente al período anterior (${previous.total} → ${current.total}).`, metric: "cases", currentValue: current.total, previousValue: previous.total, change: current.total - previous.total, severity: change >= 0.5 ? "HIGH" : "MEDIUM", evidence: [`casos=${current.total}`, `previo=${previous.total}`] });
    }
  }
  if (input.signals.resolution === "WORSENING" && current.resolution && previous?.resolution) {
    add({ type: "RESOLUTION_DEGRADATION", statement: `La mediana de resolución subió de ${previous.resolution.medianHours} h a ${current.resolution.medianHours} h.`, metric: "medianResolutionHours", currentValue: current.resolution.medianHours, previousValue: previous.resolution.medianHours, change: round(current.resolution.medianHours - previous.resolution.medianHours, 1), severity: "MEDIUM", evidence: [`muestras=${current.resolution.samples}`] });
  }
  if (input.signals.reopened === "ELEVATED") {
    add({ type: "HIGH_REOPEN_RATE", statement: `${current.reopened} de ${current.total} casos fueron reabiertos (${round((current.reopened / Math.max(current.total, 1)) * 100, 1)}%).`, metric: "reopened", currentValue: current.reopened, previousValue: previous?.reopened ?? null, change: previous ? current.reopened - previous.reopened : null, severity: "MEDIUM", evidence: [`umbral=${Math.round(thresholds.reopenedElevated * 100)}%`] });
  }
  const dq = input.dataQuality;
  if ((dq.previous !== null && dq.previous - dq.current >= 5) || input.signals.dataQuality === "POOR") {
    add({ type: "DATA_QUALITY_DEGRADATION", statement: dq.previous !== null && dq.previous - dq.current >= 5 ? `La calidad de datos bajó de ${dq.previous} a ${dq.current} puntos.` : `La calidad de datos es baja (${dq.current} puntos); limita la fiabilidad del análisis.`, metric: "dataQualityScore", currentValue: dq.current, previousValue: dq.previous, change: dq.previous === null ? null : round(dq.current - dq.previous, 1), severity: input.signals.dataQuality === "POOR" ? "HIGH" : "MEDIUM", evidence: [] });
  }
  const top = input.services?.rows[0];
  if (top && top.share >= 40 && input.services!.rows.length > 1) {
    add({ type: "SERVICE_CONCENTRATION", statement: `El servicio "${top.value}" concentra ${top.share}% de los casos del período.`, metric: "serviceShare", currentValue: top.share, previousValue: null, change: null, service: top.value, severity: top.share >= 60 ? "MEDIUM" : "LOW", evidence: [`casos=${top.cases}`] });
  }
  for (const problem of input.problems) {
    const base = { clusterId: problem.clusterId, service: problem.service || undefined, team: problem.team || undefined };
    if (problem.trend.trend === "PERSISTENT") {
      add({ ...base, type: "PERSISTENT_PROBLEM", statement: `"${problem.title}" está presente en ${problem.trend.consecutivePeriods} períodos consecutivos (${problem.cases} casos).`, metric: "clusterCases", currentValue: problem.cases, previousValue: problem.previousCount, change: problem.trend.change, severity: problem.priority.badge === "LOW" ? "LOW" : "MEDIUM", evidence: [`historial=${problem.trend.historyAvailable}`] });
    }
    if (problem.trend.trend === "NEW" && problem.cases >= 3) {
      add({ ...base, type: "NEW_RECURRENT_PROBLEM", statement: `"${problem.title}" no se observaba en el período anterior y ahora suma ${problem.cases} casos${problem.trend.limitedHistory ? " (historial limitado)" : ""}.`, metric: "clusterCases", currentValue: problem.cases, previousValue: problem.previousCount ?? 0, change: problem.cases - (problem.previousCount ?? 0), severity: problem.cases >= 10 && !problem.trend.limitedHistory ? "HIGH" : "MEDIUM", evidence: [`historial=${problem.trend.historyAvailable}`] });
    }
    if (problem.rcaLevel && CAUSAL.has(problem.rcaLevel)) {
      add({ ...base, type: "RCA_AVAILABLE", statement: `Hay una ${LEVEL_TEXT[problem.rcaLevel]} validada para "${problem.title}".`, metric: "rcaLevel", currentValue: problem.cases, previousValue: null, change: null, severity: "INFO", evidence: [problem.rcaLevel] });
    } else if (problem.priority.badge !== "LOW") {
      add({ ...base, type: "INSUFFICIENT_EVIDENCE", statement: problem.analyzed ? `"${problem.title}" es un problema prioritario pero no tiene evidencia suficiente para proponer una causa.` : `"${problem.title}" es un problema prioritario que aún no fue analizado en profundidad.`, metric: "rcaLevel", currentValue: problem.cases, previousValue: null, change: null, severity: "LOW", evidence: [problem.analyzed ? "ANALYZED_NO_CAUSAL_FINDING" : "NOT_ANALYZED"] });
    }
  }
  const order = { HIGH: 0, MEDIUM: 1, LOW: 2, INFO: 3 };
  return out.sort((a, b) => order[a.severity] - order[b.severity]);
}
