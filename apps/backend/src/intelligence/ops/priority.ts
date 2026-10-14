import { round } from "../text.js";
import type { TrendResult } from "./trends.js";

export type PriorityBadge = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";

export interface PriorityInput {
  cases: number;
  maxCases: number;
  open: number;
  reopened: number;
  highPriorityCases: number;
  totalHours: number;
  maxHours: number;
  confidence: number;
  lowConfidence: boolean;
  trend: TrendResult;
  /** Best validated level among the findings of the group, if any. */
  rcaLevel?: string | null;
  previousCount?: number | null;
}

export interface PriorityComponent {
  key: string;
  label: string;
  weight: number;
  /** Normalised signal in [0, 1]. */
  value: number;
  points: number;
}

export interface OperationalPriority {
  score: number;
  badge: PriorityBadge;
  components: PriorityComponent[];
  reasons: string[];
  /** Present only when the CRITICAL rule fired; it is the justification shown to the user. */
  criticalRule?: string;
}

const WEIGHTS = { volume: 25, growth: 15, persistence: 10, open: 15, reopened: 8, jiraPriority: 7, hours: 5, confidence: 5, cause: 10 } as const;
const CAUSE_VALUE: Record<string, number> = { CONFIRMED_CAUSE: 1, SUPPORTED_CAUSE: 1, LIKELY_CAUSE: 0.6, HYPOTHESIS: 0.3 };
export const CRITICAL_RULE = "score ≥ 70, ≥ 50 % de casos abiertos, tendencia creciente/nueva o presencia ≥ 3 períodos consecutivos, y grupo de confianza suficiente";

const clamp = (value: number) => Math.max(0, Math.min(1, value));

/**
 * Explainable, deterministic score. No business impact or money is inferred: only volume, change, persistence,
 * backlog, reopenings, Jira priority, recorded hours, cluster confidence and the validated cause level.
 */
export function operationalPriority(input: PriorityInput): OperationalPriority {
  const { trend } = input;
  const openShare = input.cases ? input.open / input.cases : 0;
  const growth = trend.trend === "GROWING" ? clamp(trend.changePct ?? 0.5) : trend.trend === "NEW" ? (trend.limitedHistory ? 0.5 : 0.8) : 0;
  const values = {
    volume: clamp(input.cases / Math.max(1, input.maxCases)),
    growth,
    persistence: clamp((trend.consecutivePeriods - 1) / 3),
    open: clamp(openShare),
    reopened: clamp((input.cases ? input.reopened / input.cases : 0) * 4),
    jiraPriority: clamp(input.cases ? input.highPriorityCases / input.cases : 0),
    hours: clamp(input.maxHours ? input.totalHours / input.maxHours : 0),
    confidence: clamp(input.confidence),
    cause: CAUSE_VALUE[input.rcaLevel ?? ""] ?? 0,
  };
  const labels: Record<keyof typeof WEIGHTS, string> = { volume: "Volumen", growth: "Crecimiento", persistence: "Persistencia", open: "Casos abiertos", reopened: "Reabiertos", jiraPriority: "Prioridad Jira", hours: "Horas registradas", confidence: "Confianza del grupo", cause: "Causa validada" };
  const components = (Object.keys(WEIGHTS) as (keyof typeof WEIGHTS)[]).map((key) => ({ key, label: labels[key], weight: WEIGHTS[key], value: round(values[key], 2), points: round(values[key] * WEIGHTS[key], 1) }));
  const score = round(components.reduce((sum, component) => sum + component.points, 0), 1);

  const reasons = [`${input.cases} casos`];
  if (trend.changePct !== null && trend.trend !== "INSUFFICIENT_HISTORY") reasons.push(`${trend.changePct >= 0 ? "+" : ""}${Math.round(trend.changePct * 100)}% vs período anterior`);
  else if (trend.trend === "NEW") reasons.push("no aparecía en el período anterior");
  if (input.open) reasons.push(`${input.open} abiertos`);
  if (input.reopened) reasons.push(`${input.reopened} reabiertos`);
  if (trend.consecutivePeriods >= 2) reasons.push(`presente en ${trend.consecutivePeriods} períodos consecutivos`);
  if (trend.limitedHistory) reasons.push(`historial disponible: ${trend.historyAvailable} período(s) previo(s)`);

  const growing = trend.trend === "GROWING" || (trend.trend === "NEW" && !trend.limitedHistory);
  const critical = score >= 70 && openShare >= 0.5 && (growing || trend.consecutivePeriods >= 3) && !input.lowConfidence;
  const badge: PriorityBadge = critical ? "CRITICAL" : score >= 60 ? "HIGH" : score >= 35 ? "MEDIUM" : "LOW";
  return { score, badge, components, reasons, ...(critical ? { criticalRule: CRITICAL_RULE } : {}) };
}
