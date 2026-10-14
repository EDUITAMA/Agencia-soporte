import type { OpsConfig } from "../config.js";
import { round } from "../text.js";

export type OpsTrend = "NEW" | "GROWING" | "STABLE" | "DECLINING" | "NOT_SEEN" | "PERSISTENT" | "RECURRING" | "INSUFFICIENT_HISTORY";

export interface SeriesPoint {
  from: string;
  to: string;
  count: number;
}

export interface TrendResult {
  trend: OpsTrend;
  /** Consecutive periods, ending at the current one, where the group was present. */
  consecutivePeriods: number;
  presentIn: number;
  /** Previous periods that actually have data; a short history is stated instead of guessed. */
  historyAvailable: number;
  limitedHistory: boolean;
  change: number | null;
  changePct: number | null;
}

/**
 * Deterministic temporal classification. `series` is chronological and ends with the current period; only periods
 * with real data are included. A group that is absent from the current period is NOT_SEEN, never "resolved".
 */
export function classifyTrend(series: SeriesPoint[], thresholds: Pick<OpsConfig["thresholds"], "change" | "persistentPeriods">): TrendResult {
  const current = series.at(-1)?.count ?? 0;
  const earlier = series.slice(0, -1);
  const historyAvailable = earlier.length;
  const previous = earlier.at(-1)?.count;
  let consecutive = 0;
  for (let index = series.length - 1; index >= 0 && series[index].count > 0; index--) consecutive++;
  const presentIn = series.filter((point) => point.count > 0).length;
  const base = { consecutivePeriods: consecutive, presentIn, historyAvailable, limitedHistory: historyAvailable < 3, change: previous === undefined ? null : current - previous, changePct: previous === undefined || previous === 0 ? null : round((current - previous) / previous, 3) };
  if (historyAvailable === 0) return { ...base, trend: "INSUFFICIENT_HISTORY" };
  if (current === 0) return { ...base, trend: "NOT_SEEN" };
  if (!previous) return { ...base, trend: earlier.some((point) => point.count > 0) ? "RECURRING" : "NEW" };
  const ratio = current / previous;
  if (ratio >= 1 + thresholds.change && current - previous >= 2) return { ...base, trend: "GROWING" };
  if (ratio <= 1 - thresholds.change && previous - current >= 2) return { ...base, trend: "DECLINING" };
  return { ...base, trend: consecutive >= thresholds.persistentPeriods && historyAvailable >= thresholds.persistentPeriods ? "PERSISTENT" : "STABLE" };
}
