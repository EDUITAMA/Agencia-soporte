export type CaseSource = "JIRA" | (string & {});

export interface CaseAttachment {
  id: string;
  filename: string;
  mimeType?: string;
  size?: number;
}

/** Source-agnostic representation of a support case. */
export interface SupportCase {
  id: string;
  externalId: string;
  source: CaseSource;
  summary: string;
  description: string;
  status: string;
  priority: string;
  application: string;
  environment: string;
  reporter: string;
  createdAt: string;
  updatedAt: string;
  issueType?: string;
  url?: string;
  attachments: CaseAttachment[];
  /** Extra flattened fields, keyed by canonical name (configurable via field map). */
  fields: Record<string, string>;
}

export interface FieldValidationResult {
  caseId: string;
  valid: boolean;
  missingFields: string[];
  missingLabels: string[];
}

export type SufficiencyStatus = "SUFFICIENT" | "PARTIALLY_SUFFICIENT" | "INSUFFICIENT" | "NOT_EVALUATED" | "ERROR";

export interface SufficiencyCheck {
  ruleId: string;
  label: string;
  passed: boolean;
  critical: boolean;
  weight: number;
  detail: string;
}

export interface SufficiencyResult {
  caseId: string;
  status: SufficiencyStatus;
  score: number | null;
  missingInformation: string[];
  checks: SufficiencyCheck[];
  explanation: string;
  recommendation: string;
}

export type ValidationStatus = "COMPLETE" | "MISSING_INFORMATION" | "RETURNED" | "DRY_RUN" | "ERROR";
export type ActionType = "NONE" | "RETURNED" | "MARKED_PENDING" | "DRY_RUN" | "ERROR";
export type ActionsMode = "DRY_RUN" | "LIVE";

export interface ActionRecord {
  type: ActionType;
  mode: ActionsMode;
  at: string;
  detail: string;
  /** Evidence returned by the source system (e.g. transition name). Never contains credentials. */
  evidence?: Record<string, string>;
}

/** Semantic (AI) sufficiency. Kept separate from deterministic required-field validation. */
export type AISufficiencyStatus = "SUFFICIENT" | "PARTIALLY_SUFFICIENT" | "INSUFFICIENT";
export type AIJobStatus = "QUEUED" | "ANALYZING" | "COMPLETED" | "FAILED" | "SKIPPED";
export type AIErrorKind = "UNAVAILABLE" | "TIMEOUT" | "INVALID_RESPONSE" | "HTTP_ERROR" | "AI_ANALYSIS_ERROR";

export interface AIMissingItem {
  field: string;
  reason: string;
  question: string;
}

export interface AIAnalysisResult {
  status: AISufficiencyStatus;
  confidence: number;
  summary: string;
  missingInformation: AIMissingItem[];
  ambiguities: string[];
  recommendedQuestions: string[];
  requesterMessage: string;
}

export interface AIAnalysisRecord {
  status: AIJobStatus;
  /** Cache key: case content + prompt version + rules version + provider/model. */
  fingerprint: string;
  promptVersion: string;
  provider: string;
  model: string;
  queuedAt: string;
  analyzedAt?: string;
  aiStartedAt?: string;
  aiCompletedAt?: string;
  durationMs?: number;
  result?: AIAnalysisResult;
  errorKind?: AIErrorKind;
  errorMessage?: string;
}

export interface RequestItem {
  key: string;
  label: string;
  question: string;
  origin: "REQUIRED_FIELD" | "AI";
}

/** Draft request to the requester: required-field evidence merged with AI findings, without duplicates. */
export interface RequesterRequest {
  items: RequestItem[];
  message: string;
  source: "AI" | "DETERMINISTIC";
}

export interface CaseRecord {
  caseId: string;
  supportCase: SupportCase;
  fingerprint: string;
  validationVersion: string;
  validationStatus: ValidationStatus;
  validation: FieldValidationResult;
  sufficiency: SufficiencyResult;
  lastAction: ActionRecord | null;
  firstSeenAt: string;
  lastSeenAt: string;
  lastCheckedAt: string;
  lastProcessedAt: string;
  errorMessage?: string;
  /** Key of the last comment successfully posted to the source; prevents duplicate comments after partial failures. */
  postedCommentKey?: string;
  ai?: AIAnalysisRecord;
  request?: RequesterRequest;
}

export type AuditAction =
  | "AI_ANALYSIS_STARTED"
  | "AI_ANALYSIS_COMPLETED"
  | "AI_ANALYSIS_FAILED"
  | "AI_ANALYSIS_REUSED"
  | "CASE_DISCOVERED"
  | "CASE_VALIDATED"
  | "CASE_MISSING_FIELDS"
  | "CASE_RETURNED"
  | "CASE_RETURN_DRY_RUN"
  | "SUFFICIENCY_EVALUATED"
  | "JIRA_ERROR";

export interface AuditEntry {
  timestamp: string;
  caseId: string;
  action: AuditAction;
  result: string;
  /** AI audit entries only: model and prompt version used. Never credentials. */
  model?: string;
  promptVersion?: string;
}

export type ConnectionState = "CONNECTED" | "DEGRADED" | "DISCONNECTED";
export type SourceMode = "REAL_JIRA" | "MOCK_JIRA";

export interface ConnectionStatus {
  state: ConnectionState;
  source: string;
  mode: SourceMode;
  checkedAt: string;
  latencyMs?: number;
  message: string;
}

export interface RunSummary {
  trigger: "MANUAL" | "AUTO" | "STARTUP";
  startedAt: string;
  finishedAt: string;
  found: number;
  processed: number;
  skippedUnchanged: number;
  complete: number;
  incomplete: number;
  returned: number;
  dryRun: number;
  errors: number;
  sourceError?: string;
}
