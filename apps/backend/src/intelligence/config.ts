import type { PeriodType } from "./types.js";

export type AITask = "LABEL" | "ANALYZE" | "VALIDATE" | "SUMMARY" | "ROLE_FAILURE" | "ROLE_FUNCTIONAL" | "ROLE_TECHNICAL" | "ROLE_INFRA" | "EXEC_NARRATIVE";

/** Bump when the operational layer (metrics, priority, insights, report shape) changes. Part of the report cache key. */
export const OPS_VERSION = "operational-intelligence/1";
export const NARRATIVE_PROMPT_VERSION = "exec-narrative/1";

export interface OpsConfig {
  /** Upper bounds, in hours, of the aging buckets of open cases (the last bucket is open-ended). */
  agingBucketsHours: number[];
  /** Previous periods read from the local store to build trends and series. */
  historyPeriods: number;
  thresholds: {
    /** Relative change that moves a signal away from STABLE. */
    change: number;
    recurrenceMedium: number;
    recurrenceHigh: number;
    reopenedElevated: number;
    dataQualityGood: number;
    dataQualityPoor: number;
    /** Minimum consecutive periods for a cluster to be called PERSISTENT. */
    persistentPeriods: number;
  };
}

/** Bump when the clustering/eligibility logic changes so identical periods are recomputed instead of reused. */
export const ANALYSIS_VERSION = "intelligence/1";
export const CLUSTERING_VERSION = "tfidf-centroid/1";
export const PROMPT_VERSION = "intelligence-prompts/1";
export const NORMALIZATION_VERSION = "canonical-units/2";
export const EVIDENCE_VERSION = "evidence-sampling/1";
/** Bump when the per-cluster AI pipeline changes so cached AI results are not reused across pipelines. */
export const ANALYST_PIPELINE_VERSION = "cluster-analyst/2";
/** Per-role prompt versions: bumping one invalidates only that role's cached result. */
export const ROLE_PROMPT_VERSIONS = { ROLE_FAILURE: "failure-modes/1", ROLE_FUNCTIONAL: "functional/1", ROLE_TECHNICAL: "technical/1", ROLE_INFRA: "infrastructure/1", VALIDATE: "claim-validator/2" } as const;
export const SEGMENTATION_VERSION = "failure-segmentation/1";
export const LIFECYCLE_VERSION = "lifecycle/1";

/** Canonical analytical field -> Jira field id. Every id can be overridden with INTELLIGENCE_FIELD_<NAME>. */
export interface IntelligenceFieldIds {
  team: string;
  service: string;
  serviceLine: string;
  commercialGroup: string;
  parentIssueType: string;
  classification: string;
  equipmentId: string;
  prioritized: string;
  reopened: string;
  totalHours: string;
  errorMessage: string;
  closeMessage: string;
  aiUsage: string;
  sla: string;
}

export interface IntelligenceConfig {
  enabled: boolean;
  dbPath: string;
  /** Optional JQL prefix; the period clause is always appended by the service. {JIRA_PROJECT_KEY} is replaced. */
  baseJql?: string;
  periodField: "created" | "updated";
  pageSize: number;
  /** Hard ceiling of cases pulled by one analysis. Exceeding it fails the sync instead of truncating silently. */
  maxCases: number;
  maxCustomDays: number;
  warnCustomDays: number;
  fieldIds: IntelligenceFieldIds;
  excludedIssueTypes: string[];
  /** When set, units whose service is not in this list are FOREIGN_SERVICE. Empty disables the check. */
  expectedServices: string[];
  noisePatterns: string[];
  clustering: { similarityThreshold: number; minClusterSize: number; lowConfidenceCohesion: number };
  evidence: { fullCaseLimit: number; sampleSize: number; maxDescriptionChars: number };
  ai: {
    enabled: boolean;
    provider: "AXET_BRIDGE_LOCAL" | "MOCK_AI";
    baseUrl: string;
    models: Record<AITask, string>;
    timeoutMs: number;
    maxConcurrency: number;
    validationEnabled: boolean;
    /** Extra attempts for a role call that timed out or returned invalid output. */
    roleRetries: number;
    /** Only the largest N clusters are sent to the model, to bound cost and latency. */
    maxClusters: number;
  };
  /** Scheduled analyses never run RCA: mode is SUMMARY or RECURRENCE and deep candidates are only prepared. */
  auto: { enabled: boolean; period: PeriodType; checkIntervalMinutes: number; mode: "SUMMARY" | "RECURRENCE" };
  ops: OpsConfig;
}

const DEFAULT_FIELD_IDS: IntelligenceFieldIds = {
  team: "customfield_20800",
  service: "customfield_15303",
  serviceLine: "customfield_15304",
  commercialGroup: "customfield_15302",
  parentIssueType: "customfield_15305",
  classification: "customfield_10705",
  equipmentId: "customfield_13321",
  prioritized: "customfield_17900",
  reopened: "customfield_12071",
  totalHours: "customfield_15307",
  errorMessage: "customfield_26800",
  closeMessage: "customfield_27000",
  aiUsage: "customfield_36000",
  sla: "customfield_12202",
};

const bool = (value: string | undefined, fallback: boolean) => (value === undefined || value.trim() === "" ? fallback : ["1", "true", "yes", "on"].includes(value.trim().toLowerCase()));
const num = (value: string | undefined, fallback: number, min: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && value?.trim() ? Math.max(min, parsed) : fallback;
};
const list = (value: string | undefined, fallback: string[]) => (value === undefined ? fallback : value.split(",").map((item) => item.trim()).filter(Boolean));

const PERIODS: PeriodType[] = ["MONTHLY", "BIWEEKLY", "WEEKLY", "DAILY", "CUSTOM"];

export function loadIntelligenceConfig(env: NodeJS.ProcessEnv = process.env): IntelligenceConfig {
  const fieldIds = { ...DEFAULT_FIELD_IDS };
  for (const key of Object.keys(fieldIds) as (keyof IntelligenceFieldIds)[]) {
    const envName = `INTELLIGENCE_FIELD_${key.replace(/[A-Z]/g, (letter) => `_${letter}`).toUpperCase()}`;
    const override = env[envName]?.trim();
    if (override) fieldIds[key] = override;
  }

  const autoPeriod = (env.INTELLIGENCE_AUTO_ANALYSIS_PERIOD ?? "MONTHLY").toUpperCase() as PeriodType;
  if (!PERIODS.includes(autoPeriod) || autoPeriod === "CUSTOM") throw new Error("INTELLIGENCE_AUTO_ANALYSIS_PERIOD must be MONTHLY, BIWEEKLY, WEEKLY or DAILY");

  const provider = (env.INTELLIGENCE_AI_PROVIDER ?? env.SUPPORT_GUARD_AI_PROVIDER ?? "AXET_BRIDGE_LOCAL").toUpperCase();
  if (provider !== "AXET_BRIDGE_LOCAL" && provider !== "MOCK_AI") throw new Error("INTELLIGENCE_AI_PROVIDER must be AXET_BRIDGE_LOCAL or MOCK_AI");
  const reasoning = env.INTELLIGENCE_AI_MODEL_ANALYZE?.trim() || env.SUPPORT_GUARD_AI_MODEL?.trim() || "gpt-5.6-terra";
  const fast = env.INTELLIGENCE_AI_MODEL_LABEL?.trim() || "gpt-5.6-luna";

  return {
    enabled: bool(env.INTELLIGENCE_ENABLED, true),
    dbPath: env.INTELLIGENCE_DB_PATH?.trim() || "./data/support-guard.duckdb",
    baseJql: env.INTELLIGENCE_JQL?.trim() || undefined,
    periodField: env.INTELLIGENCE_PERIOD_FIELD?.trim().toLowerCase() === "updated" ? "updated" : "created",
    pageSize: num(env.INTELLIGENCE_PAGE_SIZE, 100, 10),
    maxCases: num(env.INTELLIGENCE_MAX_CASES, 8000, 100),
    maxCustomDays: num(env.INTELLIGENCE_MAX_CUSTOM_DAYS, 92, 1),
    warnCustomDays: num(env.INTELLIGENCE_WARN_CUSTOM_DAYS, 31, 1),
    fieldIds,
    excludedIssueTypes: list(env.INTELLIGENCE_EXCLUDED_ISSUE_TYPES, ["Epic"]),
    expectedServices: list(env.INTELLIGENCE_EXPECTED_SERVICES, []),
    noisePatterns: list(env.INTELLIGENCE_NOISE_PATTERNS, ["^test\\b", "\\bprueba\\b", "\\bignorar\\b", "\\bdo not use\\b"]),
    clustering: {
      similarityThreshold: num(env.INTELLIGENCE_SIMILARITY_THRESHOLD, 0.34, 0.05),
      minClusterSize: num(env.INTELLIGENCE_MIN_CLUSTER_SIZE, 2, 2),
      lowConfidenceCohesion: num(env.INTELLIGENCE_LOW_CONFIDENCE_COHESION, 0.45, 0.05),
    },
    evidence: {
      fullCaseLimit: num(env.INTELLIGENCE_EVIDENCE_FULL_LIMIT, 20, 1),
      sampleSize: num(env.INTELLIGENCE_EVIDENCE_SAMPLE_SIZE, 20, 5),
      maxDescriptionChars: num(env.INTELLIGENCE_EVIDENCE_DESCRIPTION_CHARS, 3000, 100),
    },
    ai: {
      enabled: bool(env.INTELLIGENCE_AI_ENABLED, bool(env.SUPPORT_GUARD_AI_ENABLED, false)),
      provider,
      baseUrl: (env.INTELLIGENCE_AI_BASE_URL?.trim() || env.SUPPORT_GUARD_AI_BASE_URL?.trim() || "http://127.0.0.1:4317/v1").replace(/\/+$/, ""),
      models: {
        LABEL: fast,
        ANALYZE: reasoning,
        VALIDATE: env.INTELLIGENCE_AI_MODEL_VALIDATE?.trim() || reasoning,
        SUMMARY: env.INTELLIGENCE_AI_MODEL_SUMMARY?.trim() || fast,
        ROLE_FAILURE: env.INTELLIGENCE_AI_MODEL_FAILURE?.trim() || reasoning,
        ROLE_FUNCTIONAL: env.INTELLIGENCE_AI_MODEL_FUNCTIONAL?.trim() || reasoning,
        ROLE_TECHNICAL: env.INTELLIGENCE_AI_MODEL_TECHNICAL?.trim() || reasoning,
        ROLE_INFRA: env.INTELLIGENCE_AI_MODEL_INFRA?.trim() || reasoning,
        EXEC_NARRATIVE: env.INTELLIGENCE_AI_MODEL_EXECUTIVE?.trim() || reasoning,
      },
      roleRetries: num(env.INTELLIGENCE_AI_ROLE_RETRIES, 1, 0),
      timeoutMs: num(env.INTELLIGENCE_AI_TIMEOUT_MS, 120000, 1000),
      maxConcurrency: num(env.INTELLIGENCE_AI_MAX_CONCURRENCY, 2, 1),
      validationEnabled: bool(env.INTELLIGENCE_AI_VALIDATION, true),
      maxClusters: num(env.INTELLIGENCE_AI_MAX_CLUSTERS, 15, 1),
    },
    auto: {
      enabled: bool(env.INTELLIGENCE_AUTO_ANALYSIS_ENABLED, false),
      period: autoPeriod,
      checkIntervalMinutes: num(env.INTELLIGENCE_AUTO_CHECK_MINUTES, 60, 1),
      mode: (env.INTELLIGENCE_AUTO_ANALYSIS_MODE ?? "RECURRENCE").toUpperCase() === "SUMMARY" ? "SUMMARY" : "RECURRENCE",
    },
    ops: {
      agingBucketsHours: list(env.INTELLIGENCE_AGING_BUCKETS_HOURS, ["24", "72", "168"]).map(Number).filter((hours) => Number.isFinite(hours) && hours > 0).sort((a, b) => a - b),
      historyPeriods: num(env.INTELLIGENCE_HISTORY_PERIODS, 4, 1),
      thresholds: {
        change: num(env.INTELLIGENCE_OPS_CHANGE_THRESHOLD, 0.15, 0.01),
        recurrenceMedium: num(env.INTELLIGENCE_OPS_RECURRENCE_MEDIUM, 0.25, 0.01),
        recurrenceHigh: num(env.INTELLIGENCE_OPS_RECURRENCE_HIGH, 0.5, 0.01),
        reopenedElevated: num(env.INTELLIGENCE_OPS_REOPENED_ELEVATED, 0.08, 0.001),
        dataQualityGood: num(env.INTELLIGENCE_OPS_DQ_GOOD, 70, 1),
        dataQualityPoor: num(env.INTELLIGENCE_OPS_DQ_POOR, 40, 1),
        persistentPeriods: num(env.INTELLIGENCE_OPS_PERSISTENT_PERIODS, 2, 2),
      },
    },
  };
}

/** Model routing that makes a run reproducible; part of the analysis fingerprint. */
export function modelConfigOf(config: IntelligenceConfig): Record<string, string> {
  return config.ai.enabled ? { provider: config.ai.provider, ...config.ai.models } : { provider: "DISABLED" };
}
