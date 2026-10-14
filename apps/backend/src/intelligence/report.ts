import { round } from "./text.js";
import type { ErrorProfile } from "./canonical.js";
import type { ClusterAnalysis } from "./ai/analysis.js";
import type { CanonicalUnit, CauseLevel, ClusterResult, Eligibility, ResolvedPeriod, RootCauseCandidate } from "./types.js";

export type Trend = "NEW" | "GROWING" | "DECLINING" | "PERSISTENT" | "NO_BASELINE";
export type ReportKind = "executive" | "cluster" | "rootcause" | "data_quality" | "period_comparison";
export const REPORT_KINDS: ReportKind[] = ["executive", "cluster", "rootcause", "data_quality", "period_comparison"];

export interface PeriodTotals {
  units: number;
  eligible: number;
  closed: number;
  reopened: number;
  totalHours: number;
  avgResolutionHours: number | null;
}

export function totalsOf(units: CanonicalUnit[]): PeriodTotals {
  const resolution = units
    .filter((unit) => unit.closed && unit.resolvedAt && unit.root.createdAt)
    .map((unit) => (Date.parse(unit.resolvedAt!) - Date.parse(unit.root.createdAt)) / 3_600_000)
    .filter((hours) => Number.isFinite(hours) && hours >= 0);
  return {
    units: units.length,
    eligible: units.filter((unit) => unit.eligibility === "ELIGIBLE_FOR_RCA").length,
    closed: units.filter((unit) => unit.closed).length,
    reopened: units.filter((unit) => unit.reopened).length,
    totalHours: round(units.reduce((sum, unit) => sum + unit.totalHours, 0), 1),
    avgResolutionHours: resolution.length ? round(resolution.reduce((sum, hours) => sum + hours, 0) / resolution.length, 1) : null,
  };
}

export function trendOf(current: number, previous: number | undefined): Trend {
  if (previous === undefined) return "NO_BASELINE";
  if (previous === 0) return "NEW";
  const ratio = current / previous;
  if (ratio >= 1.25) return "GROWING";
  if (ratio <= 0.75) return "DECLINING";
  return "PERSISTENT";
}

export interface ReportInput {
  period: ResolvedPeriod;
  previous?: { from: string; to: string; units: CanonicalUnit[]; resolvedClusters: number };
  units: CanonicalUnit[];
  clusters: (ClusterResult & { previousCount?: number; trend: Trend; title: string })[];
  analyses: Map<string, ClusterAnalysis>;
  candidates: RootCauseCandidate[];
  errorProfile: ErrorProfile;
  narrative?: { narrative: string; highlights: string[]; model?: string };
  aiEnabled: boolean;
  warnings: string[];
}

const LEVEL_ORDER: CauseLevel[] = ["CONFIRMED_CAUSE", "SUPPORTED_CAUSE", "LIKELY_CAUSE", "HYPOTHESIS", "OBSERVED_PATTERN"];
const pct = (part: number, whole: number) => (whole ? round((part / whole) * 100, 1) : 0);

export function buildReports(input: ReportInput): Record<ReportKind, unknown> {
  const { units, clusters, candidates } = input;
  const totals = totalsOf(units);
  const byEligibility = units.reduce<Record<string, number>>((acc, unit) => ({ ...acc, [unit.eligibility]: (acc[unit.eligibility] ?? 0) + 1 }), {});
  const clustered = clusters.reduce((sum, cluster) => sum + cluster.members.length, 0);
  const topClusters = clusters.slice(0, 5).map((cluster) => ({
    id: cluster.id,
    title: cluster.title,
    cases: cluster.members.length,
    percentage: pct(cluster.members.length, totals.eligible),
    trend: cluster.trend,
    previousCount: cluster.previousCount,
    lowConfidence: cluster.lowConfidence,
    topLevel: LEVEL_ORDER.find((level) => candidates.some((candidate) => candidate.clusterId === cluster.id && candidate.level === level)) ?? null,
  }));
  const limitations = [
    ...input.warnings,
    ...(input.aiEnabled ? [] : ["El análisis con IA está deshabilitado: solo se muestran agrupaciones deterministas."]),
    ...clusters.filter((cluster) => cluster.lowConfidence).slice(0, 3).map((cluster) => `El grupo "${cluster.title}" tiene baja confianza; se reporta como patrón observado.`),
    "Ninguna causa se presenta como confirmada: la confirmación requiere validación humana.",
  ];

  const executive = {
    period: input.period,
    totals: { ...totals, clusters: clusters.length, clusteredCases: clustered, clusteredPercentage: pct(clustered, totals.eligible), excluded: units.length - totals.eligible, byEligibility },
    topClusters,
    narrative: input.narrative?.narrative ?? fallbackNarrative(input.period, totals, clusters.length, topClusters[0]?.title),
    narrativeSource: input.narrative ? "AI" : "DETERMINISTIC",
    highlights: input.narrative?.highlights ?? [],
    limitations,
  };

  const cluster = clusters.map((item) => {
    const analysis = input.analyses.get(item.id);
    return {
      id: item.id,
      title: item.title,
      cases: item.members.length,
      service: item.service,
      team: item.team,
      trend: item.trend,
      previousCount: item.previousCount,
      confidence: item.confidence,
      lowConfidence: item.lowConfidence,
      mixedFailureModes: item.mixedFailureModes,
      failureGroups: item.failureGroups.map((group) => ({ id: group.id, label: group.label, cases: group.members.length, percentage: group.percentage })),
      summary: analysis?.summary ?? "",
      analysisStatus: analysis?.status ?? "SKIPPED",
      deep: analysis?.deep
        ? {
            outliers: analysis.deep.segmentation.outliers.length,
            reclassifications: analysis.deep.segmentation.reclassifications.length,
            rolesSelected: analysis.deep.roles.selected.map((entry) => entry.role),
            rolesSkipped: analysis.deep.roles.skipped.map((entry) => ({ role: entry.role, reason: entry.reason })),
            findings: analysis.deep.findings.length,
            recommendations: analysis.deep.recommendations.length,
            limitations: analysis.deep.limitations,
          }
        : null,
    };
  });

  const rootcause = {
    levels: LEVEL_ORDER,
    candidates: [...candidates].sort((a, b) => LEVEL_ORDER.indexOf(a.level) - LEVEL_ORDER.indexOf(b.level) || b.confidence - a.confidence),
    note: "Los candidatos son hipótesis respaldadas por citas verificadas; no son causas confirmadas.",
  };

  const filled = (pick: (unit: CanonicalUnit) => string) => pct(units.filter((unit) => pick(unit).trim() !== "").length, units.length);
  const data_quality = {
    units: units.length,
    completeness: {
      description: filled((unit) => unit.root.description),
      service: filled((unit) => unit.service),
      team: filled((unit) => unit.team),
      classification: filled((unit) => unit.classification),
      errorMessage: filled((unit) => unit.root.errorMessage),
      errorMessageUseful: pct(units.filter((unit) => unit.errorUseful).length, units.length),
      closeMessage: filled((unit) => unit.closeMessage),
    },
    errorMessageProfile: { withValue: input.errorProfile.withValue, useful: input.errorProfile.usefulCount, boilerplateValues: input.errorProfile.boilerplate.size },
    orphanSubSupport: units.filter((unit) => unit.orphanChild).length,
    inheritedFieldUnits: units.filter((unit) => unit.inheritedFields.length).length,
    eligibility: byEligibility,
    warnings: input.warnings,
  };

  const previousTotals = input.previous ? totalsOf(input.previous.units) : undefined;
  const period_comparison = {
    current: { from: input.period.from, to: input.period.to, ...totals },
    previous: input.previous && previousTotals ? { from: input.previous.from, to: input.previous.to, ...previousTotals } : null,
    delta: previousTotals ? { units: totals.units - previousTotals.units, eligible: totals.eligible - previousTotals.eligible, reopened: totals.reopened - previousTotals.reopened } : null,
    clusters: clusters.map((item) => ({ id: item.id, title: item.title, current: item.members.length, previous: item.previousCount ?? null, trend: item.trend })),
    newClusters: clusters.filter((item) => item.trend === "NEW").length,
    growingClusters: clusters.filter((item) => item.trend === "GROWING").length,
    decliningClusters: clusters.filter((item) => item.trend === "DECLINING").length,
    resolvedClusters: input.previous?.resolvedClusters ?? null,
  };

  return { executive, cluster, rootcause, data_quality, period_comparison };
}

function fallbackNarrative(period: ResolvedPeriod, totals: PeriodTotals, clusters: number, top?: string): string {
  const base = `En ${period.label} se analizaron ${totals.units} casos, ${totals.eligible} elegibles para análisis, agrupados en ${clusters} grupo(s).`;
  return top ? `${base} El grupo con más casos es "${top}".` : base;
}

export const eligibilityLabels: Record<Eligibility, string> = {
  ELIGIBLE_FOR_RCA: "Elegible",
  INSUFFICIENT_CONTEXT: "Contexto insuficiente",
  FOREIGN_SERVICE: "Servicio ajeno",
  NOISE: "Ruido",
  DUPLICATE: "Duplicado",
  CHILD_ONLY: "Sub-Support",
  OTHER: "Otro",
};
