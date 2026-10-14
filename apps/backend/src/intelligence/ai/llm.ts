import type { AITask, IntelligenceConfig } from "../config.js";

export type ChatMessage = { role: "system" | "user"; content: string };

export class LlmError extends Error {
  constructor(
    readonly kind: "TIMEOUT" | "UNAVAILABLE" | "HTTP_ERROR" | "INVALID_RESPONSE" | "DISABLED",
    message: string,
  ) {
    super(message);
  }
}

export interface LlmCall {
  json: unknown;
  model: string;
  durationMs: number;
}

/** Plain inference: JSON in, JSON out. No tools, no streaming. */
export interface LlmClient {
  readonly provider: string;
  complete(task: AITask, messages: ChatMessage[]): Promise<LlmCall>;
}

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export function parseJsonContent(raw: string): unknown {
  const text = raw.trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const candidate = fenced ? fenced[1].trim() : text;
  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(candidate.slice(start, end + 1));
      } catch {
        /* fall through */
      }
    }
    throw new LlmError("INVALID_RESPONSE", "model output is not valid JSON");
  }
}

/** OpenAI-compatible consumer of the local bridge. A model per task is chosen from configuration. */
export class BridgeLlmClient implements LlmClient {
  readonly provider = "AXET_BRIDGE_LOCAL";
  private readonly fetchImpl: FetchLike;

  constructor(
    private readonly config: Pick<IntelligenceConfig["ai"], "baseUrl" | "models" | "timeoutMs">,
    fetchImpl?: FetchLike,
  ) {
    this.fetchImpl = fetchImpl ?? ((url, init) => fetch(url, init));
  }

  async complete(task: AITask, messages: ChatMessage[]): Promise<LlmCall> {
    const model = this.config.models[task];
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
    const started = Date.now();
    try {
      const response = await this.fetchImpl(`${this.config.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model, temperature: 0, response_format: { type: "json_object" }, messages }),
        signal: controller.signal,
      });
      if (!response.ok) throw new LlmError("HTTP_ERROR", `bridge answered HTTP ${response.status}`);
      const payload = (await response.json().catch(() => null)) as { choices?: { message?: { content?: unknown } }[] } | null;
      const content = payload?.choices?.[0]?.message?.content;
      if (typeof content !== "string" || !content.trim()) throw new LlmError("INVALID_RESPONSE", "bridge response has no message content");
      return { json: parseJsonContent(content), model, durationMs: Date.now() - started };
    } catch (error) {
      if (error instanceof LlmError) throw error;
      if (controller.signal.aborted) throw new LlmError("TIMEOUT", `no response within ${this.config.timeoutMs}ms`);
      throw new LlmError("UNAVAILABLE", `request failed: ${(error as Error).message}`);
    } finally {
      clearTimeout(timer);
    }
  }
}

export class DisabledLlmClient implements LlmClient {
  readonly provider = "DISABLED";
  async complete(): Promise<LlmCall> {
    throw new LlmError("DISABLED", "AI analysis is disabled");
  }
}

interface MockPayload {
  cluster?: { title?: string; topTerms?: string[] };
  failureGroups?: { id: string; signature: string; label: string }[];
  evidence?: { id: string; jiraKey: string; field: string; snippet: string; failureGroupId?: string }[];
  claims?: { id: string }[];
  metrics?: Record<string, unknown>;
}

function mockNarrative(payload: { headlineFacts?: { headline?: string } }) {
  return { headline: payload.headlineFacts?.headline ?? "Resumen operativo del periodo", periodSummary: "Resumen redactado a partir de las métricas del payload.", keyChanges: [], topRisks: [], importantFindings: [], recommendedFocus: [], limitations: [] };
}

/** Deterministic stand-in for tests and demos. It only cites text that exists in the payload it receives. */
export class MockLlmClient implements LlmClient {
  readonly provider = "MOCK_AI";
  constructor(private readonly models: IntelligenceConfig["ai"]["models"] = { LABEL: "mock", ANALYZE: "mock", VALIDATE: "mock", SUMMARY: "mock", ROLE_FAILURE: "mock", ROLE_FUNCTIONAL: "mock", ROLE_TECHNICAL: "mock", ROLE_INFRA: "mock", EXEC_NARRATIVE: "mock" }) {}

  async complete(task: AITask, messages: ChatMessage[]): Promise<LlmCall> {
    const payload = JSON.parse(messages.at(-1)?.content ?? "{}") as MockPayload;
    return { json: this.respond(task, payload), model: this.models[task], durationMs: 1 };
  }

  private respond(task: AITask, payload: MockPayload): unknown {
    if (task === "LABEL") {
      const terms = payload.cluster?.topTerms ?? [];
      return { title: terms.slice(0, 3).join(" ") || "Grupo de casos", description: `Casos relacionados con ${terms.slice(0, 4).join(", ")}.` };
    }
    if (task === "VALIDATE") return { verdicts: (payload.claims ?? []).map((claim) => ({ claimId: claim.id, verdict: "SUPPORTED", action: "ACCEPT", reason: "Las citas respaldan la afirmación." })) };
    if (task === "EXEC_NARRATIVE") return mockNarrative(payload as { headlineFacts?: { headline?: string } });
    if (task === "SUMMARY") return { narrative: "Resumen generado con datos agregados del periodo.", highlights: [] };
    const claims = (payload.failureGroups ?? [])
      .map((group, index) => {
        const evidence = (payload.evidence ?? []).filter((item) => item.failureGroupId === group.id && item.field !== "summary").slice(0, 3);
        const refs = evidence.length ? evidence : (payload.evidence ?? []).filter((item) => item.failureGroupId === group.id).slice(0, 3);
        return {
          id: `c${index + 1}`,
          claim: `Los casos del grupo "${group.label}" comparten la misma señal técnica.`,
          failureGroupId: group.id,
          level: "LIKELY_CAUSE",
          confidence: 0.6,
          evidence: refs.map((item) => ({ evidenceId: item.id, jiraKey: item.jiraKey, field: item.field, excerpt: item.snippet.slice(0, 80) })),
          limitations: ["Análisis determinista de demostración."],
        };
      })
      .filter((claim) => claim.evidence.length > 0);
    return { clusterSummary: "Patrón recurrente identificado a partir de los casos del grupo.", claims, recommendations: claims.slice(0, 1).map((claim) => ({ action: "Revisar el componente asociado a la señal repetida.", rationale: "La señal aparece en varios casos.", relatedClaimIds: [claim.id] })) };
  }
}
