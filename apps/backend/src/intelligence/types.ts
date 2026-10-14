export type PeriodType = "MONTHLY" | "BIWEEKLY" | "WEEKLY" | "DAILY" | "CUSTOM";

export interface ResolvedPeriod {
  type: PeriodType;
  /** Inclusive first day, YYYY-MM-DD. */
  from: string;
  /** Inclusive last day, YYYY-MM-DD. */
  to: string;
  label: string;
  days: number;
  warnings: string[];
}

export type AnalysisStatus =
  | "QUEUED"
  | "SYNCING_JIRA"
  | "NORMALIZING"
  | "CLUSTERING"
  | "ANALYZING"
  | "VALIDATING"
  | "GENERATING_REPORT"
  | "PREPARED"
  | "COMPLETED"
  | "FAILED"
  | "INTERRUPTED"
  | "PARTIAL";

export type Eligibility = "ELIGIBLE_FOR_RCA" | "INSUFFICIENT_CONTEXT" | "FOREIGN_SERVICE" | "NOISE" | "DUPLICATE" | "CHILD_ONLY" | "OTHER";

export interface CaseComment {
  id: string;
  author: string;
  createdAt: string;
  body: string;
  noise: boolean;
}

export interface CaseLink {
  key: string;
  type: string;
  direction: "inward" | "outward";
}

/** Analytical model, independent from the raw Jira JSON (which is stored alongside for traceability). */
export interface AnalyticalCase {
  jiraKey: string;
  jiraId: string;
  issueType: string;
  parentKey?: string;
  summary: string;
  description: string;
  status: string;
  closed: boolean;
  priority: string;
  service: string;
  team: string;
  serviceLine: string;
  commercialGroup: string;
  classification: string;
  equipmentId: string;
  prioritized: string;
  reopened: boolean;
  totalHours?: number;
  errorMessage: string;
  closeMessage: string;
  aiUsage: string;
  sla: string;
  reporter: string;
  creator: string;
  assignee: string;
  labels: string[];
  createdAt: string;
  updatedAt: string;
  resolution: string;
  resolvedAt?: string;
  url?: string;
  comments: CaseComment[];
  links: CaseLink[];
  attachmentCount: number;
  /** Changes whenever Jira data relevant to the analysis changes. */
  version: string;
}

/** One analysis unit: a parent Support case with the context of its Sub-Support children (or a standalone case). */
export interface CanonicalUnit {
  canonicalKey: string;
  /** Case that carries the unit (the parent when available). */
  root: AnalyticalCase;
  children: AnalyticalCase[];
  /** Date used to place the unit on the timeline. */
  periodDate: string;
  inheritedFields: string[];
  orphanChild: boolean;
  analysisText: string;
  eligibility: Eligibility;
  eligibilityReason: string;
  /** Normalized service/team/classification after inheritance. */
  service: string;
  team: string;
  classification: string;
  errorMessage: string;
  closeMessage: string;
  errorUseful: boolean;
  closed: boolean;
  reopened: boolean;
  totalHours: number;
  resolvedAt?: string;
}

export interface ClusterMemberInfo {
  canonicalKey: string;
  similarity: number;
  representative: boolean;
}

export interface FailureGroup {
  id: string;
  signature: string;
  label: string;
  members: string[];
  percentage: number;
  signals: string[];
  representative: string[];
}

export interface ClusterResult {
  id: string;
  title: string;
  members: ClusterMemberInfo[];
  topTerms: string[];
  service: string;
  team: string;
  dominantClassification: string;
  firstSeen: string;
  lastSeen: string;
  openCases: number;
  closedCases: number;
  reopenedCases: number;
  totalHours: number;
  cohesion: number;
  outliers: string[];
  mixedFailureModes: boolean;
  evidenceCoverage: number;
  confidence: number;
  lowConfidence: boolean;
  failureGroups: FailureGroup[];
  timeline: { bucket: string; count: number }[];
  centroid: Record<string, number>;
}

export interface EvidenceItem {
  id: string;
  jiraKey: string;
  field: "summary" | "description" | "errorMessage" | "closeMessage" | "comment" | "classification";
  snippet: string;
  failureGroupId?: string;
  reason: string;
  fingerprint?: string;
}

export type CauseLevel = "OBSERVED_PATTERN" | "LIKELY_CAUSE" | "HYPOTHESIS" | "SUPPORTED_CAUSE" | "CONFIRMED_CAUSE";

export interface EvidenceRef {
  evidenceId?: string;
  jiraKey: string;
  field: EvidenceItem["field"];
  excerpt: string;
}

export interface Claim {
  id: string;
  claim: string;
  failureGroupId?: string;
  level: CauseLevel;
  confidence: number;
  evidence: EvidenceRef[];
  limitations: string[];
}

export interface Recommendation {
  action: string;
  rationale: string;
  relatedClaimIds: string[];
  owner?: string;
  priority?: "HIGH" | "MEDIUM" | "LOW";
  findingIds?: string[];
  roles?: string[];
}

export type CandidateStatus = "CANDIDATE" | "INSUFFICIENT_EVIDENCE_FOR_RCA" | "CONFLICTING_EVIDENCE";

export interface RootCauseCandidate {
  id: string;
  clusterId: string;
  failureGroupId?: string;
  title: string;
  description: string;
  level: CauseLevel;
  confidence: number;
  evidence: EvidenceRef[];
  affectedCases: string[];
  businessImpact: string;
  technicalSignals: string[];
  limitations: string[];
  recommendedNextSteps: Recommendation[];
  status?: CandidateStatus;
}
