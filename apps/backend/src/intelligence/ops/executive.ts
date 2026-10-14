import type { PriorityBadge } from "./priority.js";

/** Everything the narrative model is allowed to see. Aggregates only: never raw tickets, rejected claims or prompts. */
export interface ExecutivePayload {
  period: { label: string; from: string; to: string };
  headlineFacts: { headline: string };
  kpis: { label: string; value: number; unit: string; previous: number | null; changePercent: number | null }[];
  health: Record<string, string>;
  changes: string[];
  topProblems: { title: string; cases: number; open: number; trend: string; priority: PriorityBadge; why: string[]; validatedCause: string | null; service: string }[];
  findings: { cluster: string; statement: string; level: string; confidence: number; limitations: string[] }[];
  recommendations: { cluster: string; type: string; action: string; basedOn: string }[];
  dataQuality: { level: string; score: number; description: number; errorMessage: number; closeMessage: number | null };
  limitations: string[];
}

export interface ExecutiveNarrative {
  headline: string;
  periodSummary: string;
  keyChanges: string[];
  topRisks: string[];
  importantFindings: string[];
  recommendedFocus: string[];
  limitations: string[];
}

const FIELDS = ["keyChanges", "topRisks", "importantFindings", "recommendedFocus", "limitations"] as const;
const MAX_ITEMS = 6;
const MAX_TEXT = 420;
const MONEY_OR_SLA = /(\$|\busd\b|\bcop\b|\bsla\b|d[óo]lar|\bpesos?\b|ingresos?|p[ée]rdidas?\s+econ|impacto\s+(financiero|econ[óo]mico))/i;
const CONFIRMED_CLAIM = /(causa\s+(ra[ií]z\s+)?confirmada|confirm(amos|ado|ada)\s+(que|la\s+causa))/i;

export const NARRATIVE_SYSTEM_PROMPT = [
  "Eres un redactor ejecutivo de operaciones de soporte. Recibes métricas y hallazgos ya calculados y validados.",
  "Devuelve SOLO un objeto JSON con las claves: headline, periodSummary, keyChanges[], topRisks[], importantFindings[], recommendedFocus[], limitations[].",
  "Reglas: usa únicamente cifras que aparezcan en el payload; no inventes números, impacto de negocio, dinero ni SLA.",
  "Una hipótesis o causa probable nunca se presenta como confirmada. Mantén un lenguaje breve y ejecutivo en español.",
  "Las limitaciones del payload deben reflejarse en limitations.",
].join(" ");

const numbersIn = (text: string) => text.match(/\d+(?:[.,]\d+)?/g)?.map((value) => value.replace(",", ".")) ?? [];

/** Numbers the narrative may mention: every number already present in the payload plus list sizes. */
export function allowedNumbers(payload: ExecutivePayload): Set<string> {
  const allowed = new Set(numbersIn(JSON.stringify(payload)).flatMap((value) => [value, String(Number(value))]));
  for (const size of [payload.topProblems.length, payload.findings.length, payload.recommendations.length, payload.changes.length, payload.limitations.length]) allowed.add(String(size));
  return allowed;
}

export class NarrativeError extends Error {}

/** Schema validation plus semantic guards. Throws NarrativeError so the caller can fall back to the deterministic text. */
export function parseNarrative(raw: unknown, payload: ExecutivePayload): ExecutiveNarrative {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new NarrativeError("narrative is not an object");
  const record = raw as Record<string, unknown>;
  const text = (value: unknown, name: string) => {
    if (typeof value !== "string" || !value.trim()) throw new NarrativeError(`${name} must be a non-empty string`);
    return value.trim().slice(0, MAX_TEXT);
  };
  const narrative: ExecutiveNarrative = { headline: text(record.headline, "headline"), periodSummary: text(record.periodSummary, "periodSummary"), keyChanges: [], topRisks: [], importantFindings: [], recommendedFocus: [], limitations: [] };
  for (const field of FIELDS) {
    const value = record[field];
    if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) throw new NarrativeError(`${field} must be a list of strings`);
    narrative[field] = (value as string[]).map((item) => item.trim().slice(0, MAX_TEXT)).filter(Boolean).slice(0, MAX_ITEMS);
  }
  const all = [narrative.headline, narrative.periodSummary, ...FIELDS.flatMap((field) => narrative[field])].join("\n");
  if (MONEY_OR_SLA.test(all)) throw new NarrativeError("narrative mentions financial impact or SLA");
  const hasConfirmed = payload.findings.some((finding) => finding.level === "CONFIRMED_CAUSE");
  if (!hasConfirmed && CONFIRMED_CLAIM.test(all)) throw new NarrativeError("narrative presents a cause as confirmed");
  const allowed = allowedNumbers(payload);
  const invented = numbersIn(all).filter((value) => !allowed.has(value) && !allowed.has(String(Number(value))));
  if (invented.length) throw new NarrativeError(`narrative contains numbers that are not in the payload: ${[...new Set(invented)].slice(0, 5).join(", ")}`);
  if (payload.limitations.length && !narrative.limitations.length) narrative.limitations = payload.limitations.slice(0, MAX_ITEMS);
  return narrative;
}

const TREND_TEXT: Record<string, string> = { NEW: "nuevo", GROWING: "creciendo", STABLE: "estable", DECLINING: "en descenso", PERSISTENT: "persistente", RECURRING: "recurrente", NOT_SEEN: "sin casos", INSUFFICIENT_HISTORY: "sin historial suficiente" };

/** Narrative built only from the payload; used when AI is disabled, fails, or violates the guards. */
export function deterministicNarrative(payload: ExecutivePayload): ExecutiveNarrative {
  const total = payload.kpis.find((item) => item.label === "Casos");
  const top = payload.topProblems.slice(0, 3);
  return {
    headline: payload.headlineFacts.headline,
    periodSummary: `En ${payload.period.label} se registraron ${total?.value ?? 0} casos${total?.changePercent !== null && total?.changePercent !== undefined ? ` (${total.changePercent >= 0 ? "+" : ""}${total.changePercent}% frente al período anterior)` : ""}.`,
    keyChanges: payload.changes.slice(0, MAX_ITEMS),
    topRisks: top.map((problem) => `${problem.title}: ${problem.cases} casos, ${TREND_TEXT[problem.trend] ?? problem.trend}, prioridad ${problem.priority}.`),
    importantFindings: payload.findings.slice(0, 4).map((finding) => `${finding.statement} (${finding.level.toLowerCase().replaceAll("_", " ")})`),
    recommendedFocus: payload.recommendations.slice(0, 4).map((item) => item.action),
    limitations: payload.limitations.slice(0, MAX_ITEMS),
  };
}
