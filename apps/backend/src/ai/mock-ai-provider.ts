import type { AIAnalysisResult, AIMissingItem, AISufficiencyStatus } from "../domain/types.js";
import { composeRequesterMessage } from "./request-builder.js";
import { type AIAnalysisInput, type AIAnalysisProvider, type AIHealth, AIError } from "./types.js";

const has = (text: string, patterns: RegExp[]) => patterns.some((pattern) => pattern.test(text));

const PROBLEM = [/error|falla|fallo|no funciona|no sirve|no permite|no puede|bug|ca[ií]d|lent|intermitenc|broken|fail/i];
const OBSERVED = [/ocurre|sucede|muestra|aparece|presenta|se queda|tarda|no carga|desde (ayer|hoy|la ma[ñn]ana)|actualmente|devuelve|responde/i];
const EXPECTED = [/esperaba|esperado|deber[ií]a|expected|should/i];
const ERROR_TEXT = [/mensaje|exception|stack|c[oó]digo|[\"“'][^\"”']{6,}[\"”']|\b(ORA|SQL|HTTP|ERR)[-_ ]?\d+/i, /\b[45]\d\d\b/];
const STEPS = [/pasos|reproducir|steps|al intentar|al ingresar|al hacer|al dar|(^|\n)\s*1[.)]/i];
const EVIDENCE = [/captura|screenshot|adjunto|evidencia|\blog\b|attached/i];
const IMPACT = [/impacto|afecta|bloquea|urgente|impact|no podemos|no pueden|productiv|usuarios/i];

const QUESTIONS: Record<string, [string, string]> = {
  observedBehavior: ["No se describe qué ocurre realmente.", "Qué comportamiento observas actualmente."],
  expectedBehavior: ["No se indica el resultado esperado.", "Qué comportamiento esperabas."],
  errorMessage: ["No se incluye el mensaje o código de error.", "Si aparece algún mensaje de error, compártenos el texto o una evidencia."],
  reproductionSteps: ["No hay pasos que permitan reproducir el problema.", "Si es posible, indícanos los pasos para reproducir el problema."],
  evidence: ["No hay evidencia adjunta.", "Adjunta una captura de pantalla o log del momento en que ocurre."],
  impact: ["No se indica el impacto en la operación.", "A cuántos usuarios o procesos afecta y con qué urgencia."],
  description: ["La descripción es demasiado genérica para iniciar el análisis.", "Descríbenos con más detalle qué intentabas hacer y qué ocurrió."],
};

/**
 * Development/test provider (SUPPORT_GUARD_AI_PROVIDER=MOCK_AI). It is a generic text heuristic, not tied to any
 * fixture, and clearly reports itself as a mock. It never touches the network.
 */
export class MockAIProvider implements AIAnalysisProvider {
  readonly name = "MOCK_AI";
  readonly model = "mock-ai";
  /** Test hook: when set, analyze() and healthCheck() fail with this error. */
  failWith: AIError | null = null;
  calls = 0;

  async healthCheck(): Promise<AIHealth> {
    const base = { provider: this.name, model: this.model, checkedAt: new Date().toISOString() };
    if (this.failWith) return { ...base, state: "DISCONNECTED", message: this.failWith.userMessage };
    return { ...base, state: "CONNECTED", message: "Proveedor simulado (MOCK_AI)" };
  }

  async analyze({ supportCase }: AIAnalysisInput): Promise<AIAnalysisResult> {
    this.calls++;
    if (this.failWith) throw this.failWith;
    const text = `${supportCase.summary}\n${supportCase.description}`;
    const words = supportCase.description.trim().split(/\s+/).filter(Boolean).length;
    const isProblem = has(text, PROBLEM);
    const missingKeys: string[] = [];

    if (words < 8) missingKeys.push("description");
    if (isProblem) {
      if (!has(supportCase.description, OBSERVED) && words < 25) missingKeys.push("observedBehavior");
      if (!has(supportCase.description, EXPECTED)) missingKeys.push("expectedBehavior");
      if (!has(supportCase.description, ERROR_TEXT)) missingKeys.push("errorMessage");
      if (!has(supportCase.description, STEPS)) missingKeys.push("reproductionSteps");
      if (supportCase.attachments.length === 0 && !has(supportCase.description, EVIDENCE)) missingKeys.push("evidence");
      if (!has(supportCase.description, IMPACT)) missingKeys.push("impact");
    }

    const missingInformation: AIMissingItem[] = missingKeys.map((field) => ({
      field,
      reason: QUESTIONS[field][0],
      question: QUESTIONS[field][1],
    }));
    const status: AISufficiencyStatus = words < 8 || missingKeys.length >= 3 ? "INSUFFICIENT" : missingKeys.length > 0 ? "PARTIALLY_SUFFICIENT" : "SUFFICIENT";
    const ambiguities = words < 8 ? [`La descripción "${supportCase.description.trim().slice(0, 60)}" no permite identificar el problema.`] : [];

    return {
      status,
      confidence: 0.7,
      summary:
        status === "SUFFICIENT"
          ? "El caso contiene información suficiente para que un analista inicie el diagnóstico."
          : status === "PARTIALLY_SUFFICIENT"
            ? "El caso permite un primer análisis, pero faltan algunos datos que acelerarían el diagnóstico."
            : "La información actual no permite iniciar el diagnóstico sin contactar al solicitante.",
      missingInformation,
      ambiguities,
      recommendedQuestions: missingInformation.map((item) => item.question),
      requesterMessage:
        missingInformation.length === 0
          ? ""
          : composeRequesterMessage(
              supportCase.id,
              missingInformation.map((item) => ({ key: item.field, label: item.field, question: item.question, origin: "AI" as const })),
            ),
    };
  }
}
