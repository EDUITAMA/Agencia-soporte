import type { RequiredFieldRule } from "../config/config.js";
import type { FieldValidationResult, SupportCase } from "../domain/types.js";

export interface CaseValidationRules {
  requiredFields: RequiredFieldRule[];
  placeholderValues: string[];
}

/** Resolves a canonical field name against the normalized case (top-level fields first, then extra fields). */
export function resolveCaseField(supportCase: SupportCase, key: string): string {
  if (key === "attachments") return supportCase.attachments.length > 0 ? "yes" : "";
  const direct = (supportCase as unknown as Record<string, unknown>)[key];
  if (typeof direct === "string") return direct;
  return supportCase.fields[key] ?? "";
}

function isBlank(value: string, placeholders: Set<string>): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized === "" || placeholders.has(normalized);
}

export function validateRequiredFields(supportCase: SupportCase, rules: CaseValidationRules): FieldValidationResult {
  const placeholders = new Set(rules.placeholderValues.map((value) => value.toLowerCase()));
  const missing = rules.requiredFields.filter((rule) => isBlank(resolveCaseField(supportCase, rule.key), placeholders));
  return {
    caseId: supportCase.id,
    valid: missing.length === 0,
    missingFields: missing.map((rule) => rule.key),
    missingLabels: missing.map((rule) => rule.label),
  };
}
