export type PeriodType = "MONTHLY" | "BIWEEKLY" | "WEEKLY" | "DAILY" | "CUSTOM";
export type AnalysisMode = "SUMMARY" | "RECURRENCE" | "TOP_RCA" | "SELECTED_RCA" | "FULL_RCA";
export type ReuseState = "REUSABLE" | "STALE_DATA" | "STALE_ANALYSIS" | "NOT_FOUND";

export interface ResolvedPeriod {
  type: PeriodType;
  from: string;
  to: string;
  label: string;
  days: number;
  warnings: string[];
}

export interface RunProgress {
  phase: string;
  percent: number;
  message: string;
  clustersDone?: number;
  clustersTotal?: number;
  reusedFrom?: string;
}

export interface AnalysisRun {
  id: string;
  periodType: PeriodType;
  from: string;
  to: string;
  status: string;
  progress: RunProgress | null;
  trigger: string;
  startedAt: string;
  completedAt: string | null;
  casesFetched: number;
  eligible: number;
  excluded: number;
  clusters: number;
  failureGroups: number;
  error: string | null;
  warnings: string[];
  models: Record<string, string>;
  reusedFrom?: string;
  preparedAt: string | null;
  lastCheckedAt: string | null;
  analysis: RunAnalysis | null;
}

export interface RunAnalysis {
  mode: AnalysisMode;
  requestedClusters: string[];
  selection: { id: string; reason: string }[];
  processedClusters: number;
  reusedClusters: number;
  analyzedClusters: number;
  aiCalls: number;
  aiSkippedByReuse: number;
  pipelineVersion: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface ClusterSummary {
  id: string;
  title: string;
  description: string;
  cases: number;
  percentage: number;
  service: string;
  team: string;
  classification: string;
  firstSeen: string;
  lastSeen: string;
  open: number;
  closed: number;
  reopened: number;
  totalHours: number;
  confidence: number;
  lowConfidence: boolean;
  mixedFailureModes: boolean;
  previousCount: number | null;
  trend: string;
  analysisStatus: string;
  failureGroups: number;
  topTerms: string[];
  priorityScore: number;
  priorityReasons: string[];
  aiDepth: string;
  aiReused: boolean;
}

export interface EvidenceRef {
  jiraKey: string;
  field: string;
  excerpt: string;
}

export interface Candidate {
  id: string;
  failureGroupId: string | null;
  title: string;
  description: string;
  level: string;
  confidence: number;
  evidence: EvidenceRef[];
  affectedCases: string[];
  businessImpact: string;
  technicalSignals: string[];
  limitations: string[];
  recommendedNextSteps: { action: string; rationale: string }[];
  status?: string;
}

export interface DeepFinding {
  id: string;
  failureGroupId?: string;
  statement: string;
  level: string;
  confidence: number;
  roles: string[];
  evidence: EvidenceRef[];
  limitations: string[];
  status: string;
}

export interface DeepRoleRun {
  role: string;
  model: string;
  status: string;
  reason?: string;
  attempts: number;
  durationMs: number;
  promptVersion: string;
  rawClaims: number;
  verifiedClaims: number;
  missingInformation: string[];
}

export interface DeepDetail {
  pipelineVersion: string;
  segmentation: { groups: { id: string; kind: string; signature: string; label?: string; members: string[] }[]; outliers: string[]; reclassifications: { jiraKey?: string; status: string; reason?: string }[]; mixed: boolean };
  evidence: { items: number; totalCases: number; casesRepresented: number; sampled: boolean };
  roles: { selected: { role: string; reason: string }[]; skipped: { role: string; reason: string }[] };
  roleRuns: DeepRoleRun[];
  validation: { status: string; model: string };
  counts: { raw: number; verified: number; validated: number; rejected: number; contradicted: number; reusedRoles: number; ranRoles: number };
  findings: DeepFinding[];
  recommendations: { action: string; rationale: string; owner?: string; priority?: string; findingIds?: string[]; roles?: string[] }[];
  dataQuality: { code: string; message: string; cases: number }[];
  limitations: string[];
  partial: boolean;
}

export interface ClusterDetail {
  deep?: DeepDetail | null;
  outliers?: string[];
  cluster: ClusterSummary;
  timeline: { bucket: string; count: number }[];
  cases: { key: string; summary: string; status: string; createdAt: string; service: string; similarity: number; representative: boolean; failureGroupId: string | null }[];
  failureGroups: { id: string; signature: string; label: string; cases: number; percentage: number; signals: string[] }[];
  evidence: { id: string; jiraKey: string; field: string; snippet: string }[];
  candidates: Candidate[];
  aiTasks: { task: string; model: string; status: string; durationMs: number; error: string | null }[];
}

export interface CasePage {
  total: number;
  page: number;
  pageSize: number;
  items: { key: string; summary: string; status: string; issueType: string; service: string; closed: boolean; date: string; eligibility: string; eligibilityReason: string; clusterId: string | null; url: string | null }[];
}

export interface ExecutiveReport {
  period: ResolvedPeriod;
  totals: { units: number; eligible: number; closed: number; reopened: number; totalHours: number; avgResolutionHours: number | null; clusters: number; clusteredCases: number; clusteredPercentage: number; excluded: number; byEligibility: Record<string, number> };
  topClusters: { id: string; title: string; cases: number; percentage: number; trend: string; lowConfidence: boolean; topLevel: string | null }[];
  narrative: string;
  narrativeSource: "AI" | "DETERMINISTIC";
  highlights: string[];
  limitations: string[];
}

export interface DataQualityReport {
  units: number;
  completeness: Record<string, number>;
  orphanSubSupport: number;
  inheritedFieldUnits: number;
  eligibility: Record<string, number>;
}

export interface ComparisonReport {
  current: { from: string; to: string; units: number; eligible: number; reopened: number };
  previous: { from: string; to: string; units: number; eligible: number; reopened: number } | null;
  newClusters: number;
  growingClusters: number;
  decliningClusters: number;
  resolvedClusters: number | null;
}

export interface PeriodLookup {
  state: ReuseState;
  period: ResolvedPeriod;
  scopeFingerprint: string;
  run: AnalysisRun | null;
  lastSyncAt: string | null;
  lastCheckedAt: string | null;
  activeRunId: string | null;
  checked?: boolean;
  changedCases?: number;
}

export interface PreAnalysis {
  run: AnalysisRun;
  period: ResolvedPeriod;
  totals: ExecutiveReport["totals"];
  groups: ClusterSummary[];
  topGroups: { id: string; title: string; cases: number; priorityScore: number; reason: string }[];
  lowConfidenceGroups: string[];
  dataQuality: DataQualityReport | null;
  comparison: ComparisonReport | null;
  recommended: { mode: AnalysisMode; clusterIds: string[] };
  ai: { enabled: boolean };
}

export interface AnalysisEstimate {
  mode: AnalysisMode;
  depth: "NONE" | "LABEL" | "DEEP";
  selected: { id: string; title: string; cases: number; lowConfidence: boolean; priorityScore: number; reason: string; willReuse: boolean }[];
  skippedLowConfidence: string[];
  capped: boolean;
  estimate: { groupsSelected: number; casesRepresented: number; casesTotal: number; depth: string; workload: "NONE" | "LOW" | "MEDIUM" | "HIGH"; aiCalls: number; reusableGroups: number; aiCallsSkippedByReuse: number };
  warnings: string[];
}