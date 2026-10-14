import type { ConnectionStatus, SupportCase } from "../domain/types.js";

export type SourceErrorKind =
  | "AUTHENTICATION"
  | "PERMISSION"
  | "NETWORK"
  | "TIMEOUT"
  | "RATE_LIMIT"
  | "INVALID_RESPONSE"
  | "NOT_FOUND"
  | "CONFIGURATION"
  | "UNKNOWN";

const USER_MESSAGES: Record<SourceErrorKind, string> = {
  AUTHENTICATION: "Jira rechazó las credenciales. Verifique el usuario/token configurado.",
  PERMISSION: "La cuenta de servicio no tiene permisos suficientes en Jira para esta operación.",
  NETWORK: "No fue posible conectar con Jira. Revise la red o la URL configurada.",
  TIMEOUT: "Jira no respondió a tiempo. Intente nuevamente en unos minutos.",
  RATE_LIMIT: "Jira limitó temporalmente las solicitudes. Support Guard reintentará más tarde.",
  INVALID_RESPONSE: "Jira devolvió una respuesta inesperada.",
  NOT_FOUND: "El recurso solicitado no existe en Jira.",
  CONFIGURATION: "La integración con Jira no está completamente configurada.",
  UNKNOWN: "Ocurrió un error inesperado al consultar Jira.",
};

/** Error raised by a case source. `technicalDetail` is for logs only and must never reach the UI. */
export class SourceError extends Error {
  constructor(
    readonly kind: SourceErrorKind,
    readonly technicalDetail: string,
    readonly status?: number,
  ) {
    super(USER_MESSAGES[kind]);
    this.name = "SourceError";
  }

  get userMessage(): string {
    return USER_MESSAGES[this.kind];
  }
}

export interface ReturnEvidence {
  type: "RETURNED" | "MARKED_PENDING";
  detail: string;
  evidence: Record<string, string>;
}

export interface ReturnOptions {
  /** The identical comment was already posted: only perform the remaining steps (transition/label). */
  skipComment?: boolean;
  /** Invoked right after the comment is accepted, before the transition, so callers can persist that fact. */
  onCommentPosted?: () => void;
}

/** Port implemented by every support-case source (Jira today; ServiceNow, Salesforce, ... later). */
export interface CaseSourceAdapter {
  readonly sourceName: string;
  readonly mode: "REAL_JIRA" | "MOCK_JIRA";
  healthCheck(): Promise<ConnectionStatus>;
  fetchNewCases(): Promise<SupportCase[]>;
  getCase(id: string): Promise<SupportCase>;
  addComment(id: string, body: string): Promise<void>;
  /** Comments and moves the case back for information. Resolves only with evidence that the source accepted it. */
  returnForInformation(id: string, comment: string, options?: ReturnOptions): Promise<ReturnEvidence>;
}
