export type ValidationStatus = "COMPLETE" | "MISSING_INFORMATION" | "RETURNED" | "DRY_RUN" | "ERROR";
export type SufficiencyStatus = "SUFFICIENT" | "PARTIALLY_SUFFICIENT" | "INSUFFICIENT" | "NOT_EVALUATED" | "ERROR";
export type ConnectionState = "CONNECTED" | "DEGRADED" | "DISCONNECTED";

export interface CaseAttachment {
  id: string;
  filename: string;
  mimeType?: string;
  size?: number;
}

export interface SupportCase {
  id: string;
  source: string;
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
  fields: Record<string, string>;
}

export interface SufficiencyCheck {
  ruleId: string;
  label: string;
  passed: boolean;
  critical: boolean;
  detail: string;
}

export interface CaseRecord {
  caseId: string;
  supportCase: SupportCase;
  validationStatus: ValidationStatus;
  validation: { valid: boolean; missingFields: string[]; missingLabels: string[] };
  sufficiency: {
    status: SufficiencyStatus;
    score: number | null;
    missingInformation: string[];
    checks: SufficiencyCheck[];
    explanation: string;
    recommendation: string;
  };
  lastAction: { type: string; mode: string; at: string; detail: string; evidence?: Record<string, string> } | null;
  lastCheckedAt: string;
  errorMessage?: string;
  ai?: AIAnalysisRecord;
  request?: RequesterRequest;
}

export interface AuditEntry {
  timestamp: string;
  caseId: string;
  action: string;
  result: string;
  model?: string;
  promptVersion?: string;
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

export interface Overview {
  connection: { state: ConnectionState; source: string; mode: "REAL_JIRA" | "MOCK_JIRA"; checkedAt: string; latencyMs?: number; message: string };
  sourceMode: "REAL_JIRA" | "MOCK_JIRA";
  lastSyncAt: string | null;
  syncing?: boolean;
  actionsMode: "DRY_RUN" | "LIVE";
  liveBlockedReason?: string | null;
  ai?: {
    health: { state: AIState; provider: string; model: string; message: string };
    stats: { analyzed: number; queued: number; analyzing: number; failed: number; skipped: number };
    pending: number;
  };
  kpis: {
    newCases: number;
    completeCases: number;
    missingInformation: number;
    sufficientCases: number;
    insufficientCases: number;
    returnedCases: number;
    dryRunCases: number;
    errorCases: number;
  };
  lastRun: RunSummary | null;
  autoValidation: { enabled: boolean; intervalSeconds: number; running: boolean; lastRunAt: string | null; nextRunAt: string | null };
  recentActivity: AuditEntry[];
}

export type ViewName = "home" | "validation" | "sufficiency" | "analyst" | "intelligence";

export type AIJobStatus = "QUEUED" | "ANALYZING" | "COMPLETED" | "FAILED" | "SKIPPED";
export type AIState = "CONNECTED" | "DISCONNECTED" | "DISABLED";

export interface AIMissingItem {
  field: string;
  reason: string;
  question: string;
}

export interface AIAnalysisResult {
  status: "SUFFICIENT" | "PARTIALLY_SUFFICIENT" | "INSUFFICIENT";
  confidence: number;
  summary: string;
  missingInformation: AIMissingItem[];
  ambiguities: string[];
  recommendedQuestions: string[];
  requesterMessage: string;
}

export interface AIAnalysisRecord {
  status: AIJobStatus;
  provider: string;
  model: string;
  promptVersion: string;
  analyzedAt?: string;
  result?: AIAnalysisResult;
  errorKind?: string;
  errorMessage?: string;
}

export interface RequesterRequest {
  items: { key: string; label: string; question: string; origin: "REQUIRED_FIELD" | "AI" }[];
  message: string;
  source: "DETERMINISTIC" | "AI";
}

export type WorkflowState = "READY" | "NEEDS_INFO" | "AI_REVIEWING" | "RETURNED" | "ERROR";
