import { createHash } from "node:crypto";

import type { SupportGuardConfig } from "../config/config.js";
import type { SupportCase } from "../domain/types.js";

export const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16);

/** Content fingerprint. Excludes updatedAt on purpose: Support Guard's own actions bump it. */
export function computeFingerprint(supportCase: SupportCase): string {
  return hash([
    supportCase.summary,
    supportCase.description,
    supportCase.status,
    supportCase.priority,
    supportCase.application,
    supportCase.environment,
    supportCase.reporter,
    supportCase.attachments.map((item) => item.id),
    supportCase.fields,
  ]);
}

/** Changes whenever the validation or sufficiency rules change, forcing re-evaluation. */
export function computeValidationVersion(config: SupportGuardConfig): string {
  return hash([config.validation, config.sufficiency]);
}

/** AI cache key: case content + prompt version + rules version + provider/model. */
export function computeAIFingerprint(contentFingerprint: string, parts: { promptVersion: string; rulesVersion: string; provider: string; model: string }): string {
  return hash([contentFingerprint, parts.promptVersion, parts.rulesVersion, parts.provider, parts.model]);
}
