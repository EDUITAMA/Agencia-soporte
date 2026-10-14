import type {
  AIAnalysisResult,
  FieldValidationResult,
  RequestItem,
  RequesterRequest,
  SupportCase,
} from "../domain/types.js";

const normalize = (value: string) => value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");

const ALIASES: Record<string, string[]> = {
  environment: ["environment", "env", "ambiente", "entorno"],
  application: ["application", "app", "aplicacion", "aplicativo", "sistema", "servicio", "module", "modulo"],
  description: ["description", "descripcion", "detalle", "problemdescription"],
  summary: ["summary", "resumen", "titulo", "title"],
  priority: ["priority", "prioridad", "urgency", "urgencia"],
  reporter: ["reporter", "solicitante", "requester"],
  expectedBehavior: ["expectedbehavior", "expected", "comportamientoesperado", "esperado"],
  observedBehavior: ["observedbehavior", "observed", "comportamientoobservado", "actualbehavior"],
  errorMessage: ["errormessage", "error", "mensajeerror", "mensajedeerror", "errorcode", "exacterror"],
  reproductionSteps: ["reproductionsteps", "steps", "stepstoreproduce", "pasos", "pasosparareproducir", "reproduccion"],
  evidence: ["evidence", "evidencia", "screenshot", "captura", "attachments", "adjuntos", "logs"],
  impact: ["impact", "impacto"],
  affectedUser: ["affecteduser", "usuarioafectado", "user", "usuario", "contexto", "affectedusers"],
};

const ALIAS_LOOKUP = new Map<string, string>(
  Object.entries(ALIASES).flatMap(([canonical, names]) => names.map((name) => [normalize(name), canonical] as const)),
);

/** Canonical key for a field name coming from required-field config or from the model. */
export function canonicalFieldKey(field: string): string {
  const normalized = normalize(field);
  return ALIAS_LOOKUP.get(normalized) ?? normalized;
}

const DEFAULT_QUESTIONS: Record<string, string> = {
  environment: "En qué ambiente se presenta el inconveniente (por ejemplo producción o QA).",
  application: "Qué aplicación o módulo se ve afectado.",
  description: "Una descripción más detallada de lo que ocurre.",
  summary: "Un resumen claro del requerimiento.",
  priority: "Qué prioridad o urgencia tiene la solicitud.",
  reporter: "Quién es el solicitante o contacto del caso.",
};

const PRESENT_ON_CASE: (keyof SupportCase)[] = ["application", "environment", "description", "summary", "priority", "reporter"];

function hasValue(supportCase: SupportCase, key: string): boolean {
  if (!PRESENT_ON_CASE.includes(key as keyof SupportCase)) return false;
  return String(supportCase[key as keyof SupportCase] ?? "").trim().length > 0;
}

function sentence(text: string): string {
  const trimmed = text.trim();
  return /[.?!]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

export function composeRequesterMessage(caseId: string, items: RequestItem[]): string {
  const bullets = items.map((item) => `• ${sentence(item.question)}`).join("\n");
  return `Hola,\n\nPara poder iniciar el análisis del caso ${caseId} necesitamos complementar algunos datos de la solicitud.\n\nPor favor indícanos:\n\n${bullets}\n\nCon esta información podremos iniciar el análisis con mayor precisión.\n\nGracias.`;
}

/**
 * Merges deterministic required-field evidence with semantic AI findings into one request, without duplicates
 * and without asking for data the case already contains.
 */
export function buildRequesterRequest(
  supportCase: SupportCase,
  validation: FieldValidationResult,
  ai: AIAnalysisResult | undefined,
): RequesterRequest | undefined {
  const items = new Map<string, RequestItem>();

  validation.missingFields.forEach((key, index) => {
    const canonical = canonicalFieldKey(key);
    if (items.has(canonical)) return;
    const label = validation.missingLabels[index] ?? key;
    items.set(canonical, {
      key: canonical,
      label,
      question: DEFAULT_QUESTIONS[canonical] ?? `Completar el dato "${label}".`,
      origin: "REQUIRED_FIELD",
    });
  });

  const deterministicCount = items.size;
  for (const missing of ai?.missingInformation ?? []) {
    const canonical = canonicalFieldKey(missing.field);
    if (items.has(canonical) || hasValue(supportCase, canonical)) continue;
    items.set(canonical, { key: canonical, label: missing.field, question: missing.question, origin: "AI" });
  }

  if (items.size === 0) return undefined;
  const aiOnly = deterministicCount === 0 && ai?.requesterMessage && items.size === ai.missingInformation.length;
  return {
    items: [...items.values()],
    message: aiOnly ? ai.requesterMessage : composeRequesterMessage(supportCase.id, [...items.values()]),
    source: ai ? "AI" : "DETERMINISTIC",
  };
}
