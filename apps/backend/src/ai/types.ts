import type { AIAnalysisResult, AIErrorKind, SupportCase, FieldValidationResult } from "../domain/types.js";

export class AIError extends Error {
  constructor(
    readonly kind: AIErrorKind,
    readonly technicalDetail: string,
  ) {
    super(technicalDetail);
    this.name = "AIError";
  }

  get userMessage(): string {
    switch (this.kind) {
      case "UNAVAILABLE":
        return "El análisis con IA no está disponible en este momento.";
      case "TIMEOUT":
        return "El análisis con IA tardó demasiado y fue cancelado.";
      case "INVALID_RESPONSE":
      case "AI_ANALYSIS_ERROR":
        return "La IA devolvió una respuesta que no pudo validarse.";
      default:
        return "El servicio de IA respondió con un error.";
    }
  }
}

export interface AIHealth {
  state: "CONNECTED" | "DISCONNECTED" | "DISABLED";
  provider: string;
  model: string;
  checkedAt: string;
  message: string;
}

export interface AIAnalysisInput {
  supportCase: SupportCase;
  validation: FieldValidationResult;
}

/** Port for any AI backend (local AXET Bridge today; Azure OpenAI, OpenAI or a corporate provider later). */
export interface AIAnalysisProvider {
  readonly name: string;
  readonly model: string;
  healthCheck(): Promise<AIHealth>;
  analyze(input: AIAnalysisInput): Promise<AIAnalysisResult>;
}
