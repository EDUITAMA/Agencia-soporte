import type { SufficiencyConfig, SufficiencyRule } from "../config/config.js";
import type { SufficiencyCheck, SufficiencyResult, SufficiencyStatus, SupportCase } from "../domain/types.js";
import { resolveCaseField } from "../validation/required-fields.js";

function matchesAny(text: string, patterns: string[]): boolean {
  return patterns.some((pattern) => new RegExp(pattern, "i").test(text));
}

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function runRule(rule: SufficiencyRule, supportCase: SupportCase, text: string): { passed: boolean; detail: string } {
  const check = rule.check;
  switch (check.kind) {
    case "minWords": {
      const words = wordCount(supportCase.description);
      return { passed: words >= check.minWords, detail: `${words} palabras en la descripción (mínimo ${check.minWords})` };
    }
    case "field": {
      const present = resolveCaseField(supportCase, check.field).trim() !== "";
      return { passed: present, detail: present ? `Campo "${check.field}" informado` : `Campo "${check.field}" vacío` };
    }
    case "pattern": {
      const passed = matchesAny(text, check.patterns);
      return { passed, detail: passed ? "Se encontraron indicios en el texto" : "No se encontraron indicios en el texto" };
    }
    case "fieldOrPattern": {
      const present = resolveCaseField(supportCase, check.field).trim() !== "";
      const passed = present || matchesAny(text, check.patterns);
      return { passed, detail: present ? `Campo "${check.field}" informado` : passed ? "Mencionado en el texto" : "No informado" };
    }
    case "attachmentsOrPattern": {
      const hasAttachments = supportCase.attachments.length > 0;
      const passed = hasAttachments || matchesAny(text, check.patterns);
      return { passed, detail: hasAttachments ? `${supportCase.attachments.length} adjunto(s)` : passed ? "Evidencia mencionada" : "Sin adjuntos ni referencias" };
    }
  }
}

export function classifyScore(score: number, config: Pick<SufficiencyConfig, "sufficientThreshold" | "partialThreshold">): SufficiencyStatus {
  if (score >= config.sufficientThreshold) return "SUFFICIENT";
  if (score >= config.partialThreshold) return "PARTIALLY_SUFFICIENT";
  return "INSUFFICIENT";
}

/** Deterministic, explainable sufficiency evaluation driven entirely by configurable rules. */
export function evaluateSufficiency(supportCase: SupportCase, config: SufficiencyConfig): SufficiencyResult {
  const text = `${supportCase.summary}\n${supportCase.description}`;
  const checks: SufficiencyCheck[] = [];

  for (const rule of config.rules) {
    if (rule.appliesWhenPatterns && !matchesAny(text, rule.appliesWhenPatterns)) continue;
    const outcome = runRule(rule, supportCase, text);
    checks.push({ ruleId: rule.id, label: rule.label, passed: outcome.passed, critical: Boolean(rule.critical), weight: rule.weight, detail: outcome.detail });
  }

  const totalWeight = checks.reduce((sum, item) => sum + item.weight, 0);
  const earned = checks.filter((item) => item.passed).reduce((sum, item) => sum + item.weight, 0);
  const rawScore = totalWeight === 0 ? 0 : (earned / totalWeight) * 100;
  const score = Math.min(100, Math.round(rawScore / config.scoreStep) * config.scoreStep);

  const failed = checks.filter((item) => !item.passed);
  const criticalFailed = failed.filter((item) => item.critical);
  let status = classifyScore(score, config);
  // A missing critical element can never yield a fully sufficient case.
  if (status === "SUFFICIENT" && criticalFailed.length > 0) status = "PARTIALLY_SUFFICIENT";

  const rulesById = new Map(config.rules.map((rule) => [rule.id, rule]));
  const missingInformation = failed.map((item) => rulesById.get(item.ruleId)!.missingMessage);
  const recommendations = failed.map((item) => rulesById.get(item.ruleId)!.recommendation);

  const explanation =
    failed.length === 0
      ? "El caso contiene la información necesaria para que un analista pueda iniciar el trabajo."
      : `Se cumplen ${checks.length - failed.length} de ${checks.length} criterios aplicables.` +
        (criticalFailed.length ? ` Faltan elementos críticos: ${criticalFailed.map((item) => item.label.toLowerCase()).join(", ")}.` : "");

  return {
    caseId: supportCase.id,
    status,
    score,
    missingInformation,
    checks,
    explanation,
    recommendation:
      failed.length === 0 ? "Puede asignarse a un analista sin información adicional." : `Solicitar al reportante: ${recommendations.join("; ")}.`,
  };
}
