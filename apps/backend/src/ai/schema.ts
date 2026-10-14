import type { AIAnalysisResult, AIMissingItem, AISufficiencyStatus } from "../domain/types.js";
import { AIError } from "./types.js";

const STATUSES: AISufficiencyStatus[] = ["SUFFICIENT", "PARTIALLY_SUFFICIENT", "INSUFFICIENT"];

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown, max = 2000) => (typeof value === "string" ? value.trim().slice(0, max) : "");

/** Models sometimes wrap JSON in prose or code fences; extract the outermost object. */
export function extractJson(raw: string): unknown {
  const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end <= start) throw new AIError("INVALID_RESPONSE", "response does not contain a JSON object");
  try {
    return JSON.parse(trimmed.slice(start, end + 1));
  } catch {
    throw new AIError("INVALID_RESPONSE", "response JSON could not be parsed");
  }
}

/** Strict contract check. Anything that does not match raises INVALID_RESPONSE; it is never "repaired" silently. */
export function validateAIResult(raw: unknown): AIAnalysisResult {
  if (!isRecord(raw)) throw new AIError("INVALID_RESPONSE", "result is not an object");
  const status = text(raw.status).toUpperCase() as AISufficiencyStatus;
  if (!STATUSES.includes(status)) throw new AIError("INVALID_RESPONSE", `unknown status "${text(raw.status, 40)}"`);

  const confidence = typeof raw.confidence === "number" ? raw.confidence : Number.NaN;
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) throw new AIError("INVALID_RESPONSE", "confidence must be a number between 0 and 1");

  const summary = text(raw.summary);
  const requesterMessage = text(raw.requesterMessage, 6000);
  if (!summary) throw new AIError("INVALID_RESPONSE", "summary is required");
  if (!Array.isArray(raw.missingInformation)) throw new AIError("INVALID_RESPONSE", "missingInformation must be an array");

  const missingInformation: AIMissingItem[] = raw.missingInformation.map((item) => {
    if (!isRecord(item)) throw new AIError("INVALID_RESPONSE", "missingInformation item is not an object");
    const field = text(item.field, 80);
    const question = text(item.question);
    if (!field || !question) throw new AIError("INVALID_RESPONSE", "missingInformation items need field and question");
    return { field, reason: text(item.reason), question };
  });

  const strings = (value: unknown): string[] => {
    if (value === undefined) return [];
    if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) throw new AIError("INVALID_RESPONSE", "expected an array of strings");
    return (value as string[]).map((entry) => entry.trim()).filter(Boolean);
  };

  if (status !== "SUFFICIENT" && missingInformation.length === 0 && !requesterMessage) {
    throw new AIError("INVALID_RESPONSE", "insufficient result without missing information");
  }
  return {
    status,
    confidence,
    summary,
    missingInformation,
    ambiguities: strings(raw.ambiguities),
    recommendedQuestions: strings(raw.recommendedQuestions),
    requesterMessage,
  };
}

export function parseAIResponse(content: string): AIAnalysisResult {
  return validateAIResult(extractJson(content));
}
