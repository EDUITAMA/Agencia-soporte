import type { AIConfig } from "../config/config.js";
import type { AIAnalysisResult } from "../domain/types.js";
import { buildMessages } from "./prompt.js";
import { parseAIResponse } from "./schema.js";
import { type AIAnalysisInput, AIError, type AIAnalysisProvider, type AIHealth } from "./types.js";

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/**
 * Consumes the local AXET Bridge as a plain OpenAI-compatible endpoint (POST {baseUrl}/chat/completions).
 * It depends only on that public contract, never on the bridge internals.
 */
export class AxetBridgeAIProvider implements AIAnalysisProvider {
  readonly name = "AXET_BRIDGE_LOCAL";
  private readonly fetchImpl: FetchLike;

  constructor(
    private readonly config: Pick<AIConfig, "baseUrl" | "model" | "timeoutMs">,
    fetchImpl?: FetchLike,
  ) {
    this.fetchImpl = fetchImpl ?? ((url, init) => fetch(url, init));
  }

  get model(): string {
    return this.config.model;
  }

  /** Exposed for tests: the exact request sent to the bridge. */
  buildRequest(input: AIAnalysisInput) {
    return {
      url: `${this.config.baseUrl}/chat/completions`,
      body: {
        model: this.config.model,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: buildMessages(input.supportCase, input.validation),
      },
    };
  }

  private async call(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await this.fetchImpl(url, { ...init, signal: controller.signal });
    } catch (error) {
      if (controller.signal.aborted) throw new AIError("TIMEOUT", `no response within ${timeoutMs}ms`);
      throw new AIError("UNAVAILABLE", `request failed: ${(error as Error).message}`);
    } finally {
      clearTimeout(timer);
    }
  }

  async healthCheck(): Promise<AIHealth> {
    const base = { provider: this.name, model: this.model, checkedAt: new Date().toISOString() };
    try {
      const response = await this.call(`${this.config.baseUrl}/models`, { method: "GET" }, Math.min(this.config.timeoutMs, 3000));
      if (!response.ok) return { ...base, state: "DISCONNECTED", message: `AXET Bridge respondió HTTP ${response.status}` };
      // An open port is not enough: the bridge must return a model list that includes the configured model.
      const payload = (await response.json().catch(() => null)) as { data?: { id?: string }[] } | null;
      if (!payload || !Array.isArray(payload.data)) return { ...base, state: "DISCONNECTED", message: "AXET Bridge respondió con un formato inesperado" };
      const wanted = this.model.toLowerCase();
      const available = payload.data.some((item) => {
        const id = String(item.id ?? "").toLowerCase();
        return id === wanted || id.endsWith(`/${wanted}`);
      });
      if (!available) return { ...base, state: "DISCONNECTED", message: "El modelo configurado no está disponible en AXET Bridge" };
      return { ...base, state: "CONNECTED", message: "AXET Bridge local disponible" };
    } catch (error) {
      return { ...base, state: "DISCONNECTED", message: (error as AIError).userMessage ?? "AXET Bridge no disponible" };
    }
  }

  async analyze(input: AIAnalysisInput): Promise<AIAnalysisResult> {
    const { url, body } = this.buildRequest(input);
    const response = await this.call(
      url,
      { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) },
      this.config.timeoutMs,
    );
    if (!response.ok) throw new AIError("HTTP_ERROR", `bridge answered HTTP ${response.status}`);
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new AIError("INVALID_RESPONSE", "bridge response is not JSON");
    }
    const content = (payload as { choices?: { message?: { content?: unknown } }[] })?.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) throw new AIError("INVALID_RESPONSE", "bridge response has no message content");
    return parseAIResponse(content);
  }
}
