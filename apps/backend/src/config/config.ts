import { readFileSync } from "node:fs";

import type { ActionsMode, SourceMode } from "../domain/types.js";

export interface RequiredFieldRule {
  /** Canonical field name resolved against SupportCase (summary, application, ...) or SupportCase.fields. */
  key: string;
  label: string;
}

export type SufficiencyCheckSpec =
  | { kind: "minWords"; minWords: number }
  | { kind: "field"; field: string }
  | { kind: "pattern"; patterns: string[] }
  | { kind: "fieldOrPattern"; field: string; patterns: string[] }
  | { kind: "attachmentsOrPattern"; patterns: string[] };

export interface SufficiencyRule {
  id: string;
  label: string;
  weight: number;
  critical?: boolean;
  /** When set, the rule only counts if the summary/description matches one of these patterns. */
  appliesWhenPatterns?: string[];
  check: SufficiencyCheckSpec;
  missingMessage: string;
  recommendation: string;
}

export interface SufficiencyConfig {
  rules: SufficiencyRule[];
  sufficientThreshold: number;
  partialThreshold: number;
  /** Scores are rounded to this step to avoid false precision. */
  scoreStep: number;
}

export interface JiraTransitionTarget {
  id?: string;
  name?: string;
}

export interface SupportGuardConfig {
  sourceMode: SourceMode;
  jira: {
    baseUrl: string;
    authMode: "basic" | "bearer";
    email: string;
    apiToken: string;
    projectKey: string;
    jql?: string;
    timeoutMs: number;
    maxRetries: number;
    maxResults: number;
    /** canonical name -> candidate Jira field ids (first non-empty wins). */
    fieldMap: Record<string, string[]>;
    newCaseStatuses: string[];
    returnTransition: JiraTransitionTarget;
    pendingLabel: string;
    actionsMode: ActionsMode;
  };
  validation: {
    requiredFields: RequiredFieldRule[];
    placeholderValues: string[];
  };
  sufficiency: SufficiencyConfig;
  polling: { enabled: boolean; intervalSeconds: number };
  /** Sync performed when a user opens the app; skipped when data is fresher than maxAgeSeconds. */
  startupSync: { enabled: boolean; maxAgeSeconds: number };
  ai: AIConfig;
  auth: AuthConfig;
  /** Why LIVE was requested but not applied (fail closed). Undefined when nothing was blocked. */
  liveBlockedReason?: string;
  comments: { returnIntro: string; returnOutro: string };
  storeFile: string;
}

export type AIProviderName = "AXET_BRIDGE_LOCAL" | "MOCK_AI";

export interface AIConfig {
  enabled: boolean;
  provider: AIProviderName;
  baseUrl: string;
  model: string;
  timeoutMs: number;
  maxConcurrency: number;
  /** FAILED analyses are retried after this delay on a later sync (unless the case changed). */
  retryFailedAfterSeconds: number;
}

/** Okta/aXet JWT validation. Without it the API stays open for local use and LIVE actions stay blocked. */
export interface AuthConfig {
  jwksUrl: string;
  issuer: string;
  audience: string;
}

export const isAuthConfigured = (auth: AuthConfig) => Boolean(auth.jwksUrl && auth.issuer);

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

function safeHostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

const DEFAULT_FIELD_LABELS: Record<string, string> = {
  summary: "Resumen",
  description: "Descripción",
  priority: "Prioridad",
  application: "Aplicación afectada",
  environment: "Ambiente",
  reporter: "Solicitante",
};

const PROBLEM = ["error", "falla", "fallo", "no funciona", "no permite", "no puede", "bug", "incidente", "fail", "broken", "caído", "caida"];

export const DEFAULT_SUFFICIENCY: SufficiencyConfig = {
  sufficientThreshold: 75,
  partialThreshold: 50,
  scoreStep: 5,
  rules: [
    {
      id: "useful-description",
      label: "Descripción útil",
      weight: 20,
      critical: true,
      check: { kind: "minWords", minWords: 12 },
      missingMessage: "La descripción es demasiado breve o genérica para entender el caso",
      recommendation: "Ampliar la descripción con contexto, qué se intentaba hacer y qué ocurrió",
    },
    {
      id: "application",
      label: "Aplicación identificada",
      weight: 15,
      critical: true,
      check: { kind: "field", field: "application" },
      missingMessage: "No se identifica la aplicación afectada",
      recommendation: "Indicar la aplicación o módulo afectado",
    },
    {
      id: "environment",
      label: "Ambiente",
      weight: 10,
      check: {
        kind: "fieldOrPattern",
        field: "environment",
        patterns: ["\\b(producci[oó]n|production|prod|qa|uat|staging|desarrollo|development|pruebas|test)\\b"],
      },
      missingMessage: "No se especifica el ambiente (producción, QA, etc.)",
      recommendation: "Indicar en qué ambiente ocurre",
    },
    {
      id: "expected-behavior",
      label: "Comportamiento esperado",
      weight: 8,
      check: { kind: "pattern", patterns: ["esperaba", "esperado", "deber[ií]a", "expected", "should"] },
      missingMessage: "No se describe el comportamiento esperado",
      recommendation: "Describir qué debería ocurrir",
    },
    {
      id: "observed-behavior",
      label: "Comportamiento observado",
      weight: 12,
      check: {
        kind: "pattern",
        patterns: ["ocurre", "sucede", "muestra", "aparece", "presenta", "no permite", "no puede", "actualmente", "instead", "observ", "no carga", "se queda"],
      },
      missingMessage: "No se describe el comportamiento observado",
      recommendation: "Describir qué ocurre realmente",
    },
    {
      id: "steps-to-reproduce",
      label: "Pasos para reproducir",
      weight: 12,
      appliesWhenPatterns: PROBLEM,
      check: { kind: "pattern", patterns: ["pasos", "paso 1", "reproducir", "steps", "al intentar", "al ingresar", "al hacer", "al dar", "(^|\\n)\\s*1[.)]"] },
      missingMessage: "No se especifican pasos para reproducir",
      recommendation: "Listar los pasos para reproducir el problema",
    },
    {
      id: "error-message",
      label: "Mensaje o código de error",
      weight: 10,
      appliesWhenPatterns: PROBLEM,
      check: {
        kind: "pattern",
        patterns: ["mensaje", "message", "exception", "stack", "c[oó]digo de error", "error code", "[\"“'][^\"”']{6,}[\"”']", "\\b(ORA|SQL|HTTP|ERR)[-_ ]?\\d+", "\\b[45]\\d\\d\\b"],
      },
      missingMessage: "No se incluye mensaje de error",
      recommendation: "Copiar el mensaje o código de error exacto",
    },
    {
      id: "evidence",
      label: "Evidencia",
      weight: 5,
      check: { kind: "attachmentsOrPattern", patterns: ["captura", "screenshot", "adjunto", "evidencia", "\\blog\\b", "attached"] },
      missingMessage: "No se adjunta evidencia (captura, log)",
      recommendation: "Adjuntar captura de pantalla o log",
    },
    {
      id: "impact",
      label: "Impacto",
      weight: 5,
      check: { kind: "pattern", patterns: ["impacto", "afecta", "bloquea", "urgente", "impact", "critic", "no podemos", "no pueden", "productiv"] },
      missingMessage: "No se indica el impacto",
      recommendation: "Indicar el impacto en la operación",
    },
    {
      id: "affected-user",
      label: "Usuario o contexto afectado",
      weight: 3,
      check: { kind: "pattern", patterns: ["usuario", "user", "cliente", "sucursal", "estaci[oó]n", "todos", "equipo", "@"] },
      missingMessage: "No se identifica el usuario o contexto afectado",
      recommendation: "Indicar quién o qué contexto está afectado",
    },
  ],
};

function csv(value: string | undefined, fallback: string[]): string[] {
  if (value === undefined || value.trim() === "") return fallback;
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function bool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim() === "") return fallback;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function int(value: string | undefined, fallback: number, min: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? Math.max(min, parsed) : fallback;
}

function parseJson<T>(value: string | undefined, name: string): T | undefined {
  if (!value || value.trim() === "") return undefined;
  try {
    return JSON.parse(value) as T;
  } catch {
    throw new Error(`${name} must contain valid JSON`);
  }
}

interface RulesFile {
  requiredFields?: RequiredFieldRule[];
  placeholderValues?: string[];
  sufficiency?: Partial<SufficiencyConfig>;
  comments?: Partial<SupportGuardConfig["comments"]>;
  fieldMap?: Record<string, string[]>;
}

/**
 * Builds the central configuration from environment variables. Jira variable names (JIRA_URL, JIRA_EMAIL,
 * JIRA_API_TOKEN, JIRA_AUTH_MODE, JIRA_PROJECT_KEY, JIRA_JQL) are the ones already used by the reference Jira project.
 * An optional JSON file (SUPPORT_GUARD_RULES_FILE) can override validation/sufficiency rules and comment texts.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): SupportGuardConfig {
  const rules = env.SUPPORT_GUARD_RULES_FILE
    ? (JSON.parse(readFileSync(env.SUPPORT_GUARD_RULES_FILE, "utf8")) as RulesFile)
    : ({} as RulesFile);

  const requiredKeys = csv(env.SUPPORT_GUARD_REQUIRED_FIELDS, ["summary", "description", "priority", "application", "environment", "reporter"]);
  const requiredFields =
    rules.requiredFields ?? requiredKeys.map((key) => ({ key, label: DEFAULT_FIELD_LABELS[key] ?? key }));

  const fieldMap = {
    application: ["components"],
    environment: ["environment"],
    ...(parseJson<Record<string, string[]>>(env.JIRA_FIELD_MAP, "JIRA_FIELD_MAP") ?? {}),
    ...(rules.fieldMap ?? {}),
  };

  const sourceMode = (env.SUPPORT_GUARD_SOURCE ?? "MOCK_JIRA").toUpperCase();
  if (sourceMode !== "REAL_JIRA" && sourceMode !== "MOCK_JIRA") {
    throw new Error("SUPPORT_GUARD_SOURCE must be REAL_JIRA or MOCK_JIRA");
  }
  const requestedMode = (env.JIRA_ACTIONS_MODE ?? "DRY_RUN").toUpperCase();
  if (requestedMode !== "DRY_RUN" && requestedMode !== "LIVE") {
    throw new Error("JIRA_ACTIONS_MODE must be DRY_RUN or LIVE");
  }
  const auth: AuthConfig = {
    jwksUrl: env.SUPPORT_GUARD_AUTH_JWKS_URL?.trim() ?? "",
    issuer: env.SUPPORT_GUARD_AUTH_ISSUER?.trim() ?? "",
    audience: env.SUPPORT_GUARD_AUTH_AUDIENCE?.trim() ?? "",
  };
  if (Boolean(auth.jwksUrl) !== Boolean(auth.issuer)) {
    throw new Error("SUPPORT_GUARD_AUTH_JWKS_URL and SUPPORT_GUARD_AUTH_ISSUER must be configured together");
  }
  if (auth.jwksUrl && !/^https:\/\//i.test(auth.jwksUrl) && !LOOPBACK_HOSTS.has(safeHostname(auth.jwksUrl))) {
    throw new Error("SUPPORT_GUARD_AUTH_JWKS_URL must use https");
  }
  const authRequired = (env.SUPPORT_GUARD_REQUIRE_AUTH ?? (env.NODE_ENV === "production" ? "true" : "false")).toLowerCase() === "true";
  if (authRequired && !isAuthConfigured(auth)) {
    throw new Error("Authentication is required (SUPPORT_GUARD_REQUIRE_AUTH / NODE_ENV=production): configure SUPPORT_GUARD_AUTH_JWKS_URL and SUPPORT_GUARD_AUTH_ISSUER");
  }
  // Fail closed: real Jira modifications need a verifiable caller identity.
  const actionsMode: ActionsMode = requestedMode === "LIVE" && isAuthConfigured(auth) ? "LIVE" : "DRY_RUN";
  const liveBlockedReason =
    requestedMode === "LIVE" && actionsMode === "DRY_RUN"
      ? "LIVE blocked: configure SUPPORT_GUARD_AUTH_JWKS_URL and SUPPORT_GUARD_AUTH_ISSUER so the backend can validate the aXet/Okta JWT."
      : undefined;

  const aiProvider = (env.SUPPORT_GUARD_AI_PROVIDER ?? "AXET_BRIDGE_LOCAL").toUpperCase();
  if (aiProvider !== "AXET_BRIDGE_LOCAL" && aiProvider !== "MOCK_AI") {
    throw new Error("SUPPORT_GUARD_AI_PROVIDER must be AXET_BRIDGE_LOCAL or MOCK_AI");
  }
  const aiBaseUrl = (env.SUPPORT_GUARD_AI_BASE_URL?.trim() || "http://127.0.0.1:4317/v1").replace(/\/+$/, "");
  if (aiProvider === "AXET_BRIDGE_LOCAL" && !LOOPBACK_HOSTS.has(new URL(aiBaseUrl).hostname)) {
    throw new Error("SUPPORT_GUARD_AI_BASE_URL must point to a local (loopback) AXET Bridge in this version");
  }

  return {
    sourceMode,
    jira: {
      baseUrl: (env.JIRA_URL ?? "").replace(/\/+$/, ""),
      authMode: (env.JIRA_AUTH_MODE ?? "basic").toLowerCase() === "bearer" ? "bearer" : "basic",
      email: env.JIRA_EMAIL ?? "",
      apiToken: env.JIRA_API_TOKEN ?? "",
      projectKey: env.JIRA_PROJECT_KEY ?? "",
      jql: env.JIRA_JQL?.trim() || undefined,
      timeoutMs: int(env.JIRA_TIMEOUT_MS, 15000, 1000),
      maxRetries: int(env.JIRA_MAX_RETRIES, 3, 0),
      maxResults: int(env.JIRA_MAX_RESULTS, 50, 1),
      fieldMap,
      newCaseStatuses: csv(env.JIRA_NEW_CASE_STATUSES, ["Open"]),
      returnTransition: {
        id: env.JIRA_RETURN_TRANSITION_ID?.trim() || undefined,
        name: env.JIRA_RETURN_TRANSITION_NAME?.trim() || undefined,
      },
      pendingLabel: env.JIRA_PENDING_LABEL?.trim() || "support-guard-pending-info",
      actionsMode,
    },
    validation: {
      requiredFields,
      placeholderValues: rules.placeholderValues ?? ["n/a", "na", "none", "null", "tbd", "-", "sin información", "pendiente"],
    },
    sufficiency: { ...DEFAULT_SUFFICIENCY, ...(rules.sufficiency ?? {}) },
    polling: {
      enabled: bool(env.SUPPORT_GUARD_AUTO_ENABLED, false),
      intervalSeconds: int(env.SUPPORT_GUARD_POLL_INTERVAL_SECONDS, 300, 30),
    },
    startupSync: {
      enabled: bool(env.SUPPORT_GUARD_STARTUP_SYNC, true),
      maxAgeSeconds: int(env.SUPPORT_GUARD_STARTUP_SYNC_MAX_AGE_SECONDS, 60, 0),
    },
    ai: {
      enabled: bool(env.SUPPORT_GUARD_AI_ENABLED, false),
      provider: aiProvider,
      baseUrl: aiBaseUrl,
      model: env.SUPPORT_GUARD_AI_MODEL?.trim() || "gpt-5.6-terra",
      timeoutMs: int(env.SUPPORT_GUARD_AI_TIMEOUT_MS, 60000, 1000),
      maxConcurrency: int(env.SUPPORT_GUARD_AI_MAX_CONCURRENCY, 2, 1),
      retryFailedAfterSeconds: int(env.SUPPORT_GUARD_AI_RETRY_SECONDS, 120, 0),
    },
    auth,
    liveBlockedReason,
    comments: {
      returnIntro:
        rules.comments?.returnIntro ??
        "Support Guard revisó este caso y requiere información adicional antes de continuar con el proceso de soporte.",
      returnOutro: rules.comments?.returnOutro ?? "Por favor complete estos datos para que el caso pueda continuar.",
    },
    storeFile: env.SUPPORT_GUARD_STATE_FILE ?? "./data/support-guard-state.json",
  };
}

/** Configuration safe to expose to the UI: never includes credentials. */
export function toPublicConfig(config: SupportGuardConfig) {
  return {
    sourceMode: config.sourceMode,
    jira: {
      configured: Boolean(config.jira.baseUrl && config.jira.apiToken),
      projectKey: config.jira.projectKey,
      newCaseStatuses: config.jira.newCaseStatuses,
      actionsMode: config.jira.actionsMode,
      returnTransitionConfigured: Boolean(config.jira.returnTransition.id || config.jira.returnTransition.name),
    },
    requiredFields: config.validation.requiredFields,
    polling: config.polling,
    ai: { enabled: config.ai.enabled, provider: config.ai.provider, model: config.ai.model, maxConcurrency: config.ai.maxConcurrency },
    authConfigured: isAuthConfigured(config.auth),
    liveBlockedReason: config.liveBlockedReason,
  };
}
