import type { OpsConfig } from "../config.js";
import { round } from "../text.js";

/** One top-level Jira case, reduced to what the operational layer needs. Built from the local analytical store. */
export interface CaseRow {
  key: string;
  canonicalKey: string;
  createdAt: string;
  resolvedAt?: string | null;
  closed: boolean;
  reopened: boolean;
  totalHours: number;
  priority: string;
  hasDescription: boolean;
  hasErrorMessage: boolean;
  hasCloseMessage: boolean;
  service: string;
  team: string;
  classification: string;
  issueType: string;
  aiUsage: string;
}

export interface ResolutionStats {
  samples: number;
  medianHours: number;
  p75Hours: number;
  p95Hours: number;
}

export interface PeriodMetrics {
  total: number;
  open: number;
  closed: number;
  reopened: number;
  totalHours: number;
  resolution: ResolutionStats | null;
  coverage: { description: number; errorMessage: number; closeMessage: number | null };
}

export function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const rank = (sorted.length - 1) * p;
  const low = Math.floor(rank);
  const high = Math.ceil(rank);
  return sorted[low] + (sorted[high] - sorted[low]) * (rank - low);
}

const pct = (part: number, whole: number) => (whole ? round((part / whole) * 100, 1) : 0);

export function resolutionStats(rows: CaseRow[]): ResolutionStats | null {
  const hours = rows
    .filter((row) => row.closed && row.resolvedAt)
    .map((row) => (Date.parse(row.resolvedAt!) - Date.parse(row.createdAt)) / 3_600_000)
    .filter((value) => Number.isFinite(value) && value >= 0)
    .sort((a, b) => a - b);
  if (!hours.length) return null;
  return { samples: hours.length, medianHours: round(percentile(hours, 0.5), 1), p75Hours: round(percentile(hours, 0.75), 1), p95Hours: round(percentile(hours, 0.95), 1) };
}

export function computeMetrics(rows: CaseRow[]): PeriodMetrics {
  const closed = rows.filter((row) => row.closed);
  return {
    total: rows.length,
    open: rows.length - closed.length,
    closed: closed.length,
    reopened: rows.filter((row) => row.reopened).length,
    totalHours: round(rows.reduce((sum, row) => sum + row.totalHours, 0), 1),
    resolution: resolutionStats(rows),
    coverage: { description: pct(rows.filter((row) => row.hasDescription).length, rows.length), errorMessage: pct(rows.filter((row) => row.hasErrorMessage).length, rows.length), closeMessage: closed.length ? pct(closed.filter((row) => row.hasCloseMessage).length, closed.length) : null },
  };
}

export type Tone = "GOOD" | "BAD" | "NEUTRAL";
export type Direction = "UP" | "DOWN" | "FLAT";

export interface KpiValue {
  key: string;
  label: string;
  unit: "cases" | "percent" | "hours" | "count";
  value: number;
  previous: number | null;
  /** Absolute and relative change. Null when there is no previous period: no delta is ever invented. */
  change: number | null;
  changePct: number | null;
  direction: Direction | null;
  tone: Tone | null;
  note?: string;
}

/** `goodWhen` encodes the semantics of each KPI: more closed cases is good, more reopened cases is bad. */
export function kpi(key: string, label: string, unit: KpiValue["unit"], value: number, previous: number | null | undefined, goodWhen: "UP" | "DOWN" | "NEUTRAL", flatBand = 0.02, note?: string): KpiValue {
  if (previous === null || previous === undefined) return { key, label, unit, value, previous: null, change: null, changePct: null, direction: null, tone: null, note };
  const change = round(value - previous, 1);
  const changePct = previous === 0 ? null : round((value - previous) / previous, 3);
  const flat = previous === 0 ? value === 0 : Math.abs(value - previous) / Math.abs(previous) <= flatBand;
  const direction: Direction = flat ? "FLAT" : value > previous ? "UP" : "DOWN";
  const tone: Tone = direction === "FLAT" || goodWhen === "NEUTRAL" ? "NEUTRAL" : direction === goodWhen ? "GOOD" : "BAD";
  return { key, label, unit, value, previous, change, changePct, direction, tone, note };
}

export interface AgingBucket {
  label: string;
  fromHours: number;
  toHours: number | null;
  cases: number;
}

/** Age of OPEN cases only, measured at `now`. */
export function agingOf(rows: CaseRow[], now: Date, buckets: OpsConfig["agingBucketsHours"]): { buckets: AgingBucket[]; open: number; oldestHours: number | null; medianHours: number | null } {
  const ages = rows.filter((row) => !row.closed).map((row) => (now.getTime() - Date.parse(row.createdAt)) / 3_600_000).filter((age) => Number.isFinite(age) && age >= 0);
  const bounds = [0, ...buckets];
  const fmt = (hours: number) => (hours % 24 === 0 ? `${hours / 24}d` : `${hours}h`);
  const label = (from: number, to: number | null) => (to === null ? `>${fmt(from)}` : from === 0 ? `<${fmt(to)}` : `${fmt(from)}–${fmt(to)}`);
  const result = bounds.map((from, index) => {
    const to = bounds[index + 1] ?? null;
    return { label: label(from, to), fromHours: from, toHours: to, cases: ages.filter((age) => age >= from && (to === null || age < to)).length };
  });
  const sorted = [...ages].sort((a, b) => a - b);
  return { buckets: result, open: ages.length, oldestHours: sorted.length ? round(sorted.at(-1)!, 1) : null, medianHours: sorted.length ? round(percentile(sorted, 0.5), 1) : null };
}

export type VolumeSignal = "STABLE" | "INCREASING" | "DECREASING" | "NO_BASELINE";
export type LevelSignal = "LOW" | "MEDIUM" | "HIGH";
export type ResolutionSignal = "IMPROVING" | "STABLE" | "WORSENING" | "NO_DATA";
export type DataQualitySignal = "GOOD" | "DEGRADED" | "POOR";
export type RcaConfidence = "HIGH" | "MEDIUM" | "LOW" | "NOT_ANALYZED";

export interface HealthSignals {
  volume: VolumeSignal;
  recurrence: LevelSignal;
  resolution: ResolutionSignal;
  reopened: "LOW" | "ELEVATED";
  dataQuality: DataQualitySignal;
  rcaConfidence: RcaConfidence;
}

/** Explicit signals instead of a single arbitrary score. Every threshold comes from configuration. */
export function healthSignals(input: {
  current: PeriodMetrics;
  previous: PeriodMetrics | null;
  groupedPercentage: number;
  dataQualityScore: number;
  rcaLevels: string[];
  analyzedClusters: number;
  thresholds: OpsConfig["thresholds"];
}): HealthSignals {
  const { current, previous, thresholds } = input;
  const relative = (now: number, before: number) => (before === 0 ? (now === 0 ? 0 : 1) : (now - before) / before);
  const volume: VolumeSignal = !previous ? "NO_BASELINE" : relative(current.total, previous.total) >= thresholds.change ? "INCREASING" : relative(current.total, previous.total) <= -thresholds.change ? "DECREASING" : "STABLE";
  const grouped = input.groupedPercentage / 100;
  const recurrence: LevelSignal = grouped >= thresholds.recurrenceHigh ? "HIGH" : grouped >= thresholds.recurrenceMedium ? "MEDIUM" : "LOW";
  let resolution: ResolutionSignal = "NO_DATA";
  if (current.resolution && previous?.resolution) {
    const change = relative(current.resolution.medianHours, previous.resolution.medianHours);
    resolution = change <= -thresholds.change ? "IMPROVING" : change >= thresholds.change ? "WORSENING" : "STABLE";
  }
  const reopened = current.total && current.reopened / current.total >= thresholds.reopenedElevated ? "ELEVATED" : "LOW";
  const dataQuality: DataQualitySignal = input.dataQualityScore >= thresholds.dataQualityGood ? "GOOD" : input.dataQualityScore >= thresholds.dataQualityPoor ? "DEGRADED" : "POOR";
  const rcaConfidence: RcaConfidence = !input.analyzedClusters ? "NOT_ANALYZED" : input.rcaLevels.some((level) => level === "SUPPORTED_CAUSE" || level === "CONFIRMED_CAUSE") ? "HIGH" : input.rcaLevels.includes("LIKELY_CAUSE") ? "MEDIUM" : "LOW";
  return { volume, recurrence, resolution, reopened, dataQuality, rcaConfidence };
}

export interface Breakdown {
  dimension: string;
  coverage: number;
  rows: { value: string; cases: number; open: number; closed: number; reopened: number; medianResolutionHours: number | null; share: number }[];
}

/** A dimension is reported only when enough cases carry a value; otherwise the numbers would be misleading. */
export function breakdownOf(rows: CaseRow[], dimension: string, pick: (row: CaseRow) => string, minCoverage = 0.6, limit = 10): Breakdown | null {
  const filled = rows.filter((row) => pick(row).trim() !== "");
  if (!rows.length || filled.length / rows.length < minCoverage) return null;
  const groups = new Map<string, CaseRow[]>();
  for (const row of filled) groups.set(pick(row).trim(), [...(groups.get(pick(row).trim()) ?? []), row]);
  const result = [...groups.entries()]
    .map(([value, items]) => ({ value, cases: items.length, open: items.filter((item) => !item.closed).length, closed: items.filter((item) => item.closed).length, reopened: items.filter((item) => item.reopened).length, medianResolutionHours: resolutionStats(items)?.medianHours ?? null, share: pct(items.length, rows.length) }))
    .sort((a, b) => b.cases - a.cases || a.value.localeCompare(b.value))
    .slice(0, limit);
  return { dimension, coverage: pct(filled.length, rows.length), rows: result };
}

/** Equal-weight composite of the coverage metrics that exist; used to compare data quality across periods. */
export function dataQualityScore(coverage: PeriodMetrics["coverage"], usefulErrorPercentage?: number): number {
  const parts = [coverage.description, usefulErrorPercentage ?? coverage.errorMessage, ...(coverage.closeMessage === null ? [] : [coverage.closeMessage])];
  return round(parts.reduce((sum, value) => sum + value, 0) / parts.length, 1);
}
