import type { CaseSourceAdapter } from "../adapters/case-source.js";
import type { SupportGuardConfig } from "../config/config.js";
import type { ActionRecord, FieldValidationResult, SupportCase } from "../domain/types.js";
import { hash } from "../intake/fingerprint.js";

export function buildReturnComment(
  supportCase: SupportCase,
  validation: FieldValidationResult,
  comments: SupportGuardConfig["comments"],
): string {
  const items = validation.missingLabels.map((label) => `- ${label}`).join("\n");
  return `${comments.returnIntro}\n\nCaso: ${supportCase.id}\nInformación pendiente:\n${items}\n\n${comments.returnOutro}`;
}

/** Same case + same missing fields + same comment text => same key => the comment is posted once. */
export function commentKey(caseId: string, validation: FieldValidationResult, comment: string): string {
  return hash([caseId, validation.missingFields, comment]);
}

export interface ReturnContext {
  /** Key of the comment already posted for this case, if any. */
  postedCommentKey?: string;
  /** Called as soon as the comment is accepted, so the key is persisted even if the transition then fails. */
  onCommentPosted: (key: string) => void;
}

/** Executes (or simulates) external actions. DRY_RUN never touches the source system. AI has no access to this class. */
export class CaseActionService {
  constructor(
    private readonly adapter: CaseSourceAdapter,
    private readonly config: SupportGuardConfig,
  ) {}

  get mode() {
    return this.config.jira.actionsMode;
  }

  async returnCase(supportCase: SupportCase, validation: FieldValidationResult, context?: ReturnContext): Promise<ActionRecord> {
    const at = new Date().toISOString();
    const mode = this.mode;
    if (mode === "DRY_RUN") {
      return { type: "DRY_RUN", mode, at, detail: `Would return case ${supportCase.id}: missing ${validation.missingLabels.join(", ")}` };
    }
    const comment = buildReturnComment(supportCase, validation, this.config.comments);
    const key = commentKey(supportCase.id, validation, comment);
    const result = await this.adapter.returnForInformation(supportCase.id, comment, {
      skipComment: context?.postedCommentKey === key,
      onCommentPosted: () => context?.onCommentPosted(key),
    });
    return { type: result.type, mode, at: new Date().toISOString(), detail: result.detail, evidence: result.evidence };
  }

  /** Human-triggered return using the reviewed requester message. Same DRY_RUN guard and comment idempotency as automatic returns. */
  async returnWithMessage(supportCase: SupportCase, message: string, context?: ReturnContext): Promise<ActionRecord> {
    const at = new Date().toISOString();
    const mode = this.mode;
    if (mode === "DRY_RUN") {
      return { type: "DRY_RUN", mode, at, detail: `Would return case ${supportCase.id} with the reviewed requester message` };
    }
    const key = hash([supportCase.id, "requester-message", message]);
    const result = await this.adapter.returnForInformation(supportCase.id, message, {
      skipComment: context?.postedCommentKey === key,
      onCommentPosted: () => context?.onCommentPosted(key),
    });
    return { type: result.type, mode, at: new Date().toISOString(), detail: result.detail, evidence: result.evidence };
  }
}
