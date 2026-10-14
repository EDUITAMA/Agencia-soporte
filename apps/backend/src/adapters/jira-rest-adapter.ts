import type { SupportGuardConfig } from "../config/config.js";
import type { ConnectionStatus, SupportCase } from "../domain/types.js";
import { type CaseSourceAdapter, type ReturnEvidence, type ReturnOptions, SourceError } from "./case-source.js";
import { SearchLimitError } from "../intelligence/source.js";
import { type JiraIssue, normalizeJiraIssue, requestedJiraFields } from "./jira-normalizer.js";

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface JiraLogger {
  warn(message: string): void;
  error(message: string): void;
}

export interface JiraRestAdapterOptions {
  config: SupportGuardConfig;
  fetchImpl?: FetchLike;
  logger?: JiraLogger;
  sleep?: (ms: number) => Promise<void>;
}

const RETRYABLE = new Set([429, 502, 503, 504]);
const DEGRADED_LATENCY_MS = 3000;

function quote(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** Builds the JQL that selects "new" cases. A configured JIRA_JQL wins; otherwise it is derived from configuration. */
export function buildNewCasesJql(jira: SupportGuardConfig["jira"]): string {
  if (jira.jql) return jira.jql.replaceAll("{JIRA_PROJECT_KEY}", jira.projectKey);
  const clauses: string[] = [];
  if (jira.projectKey) clauses.push(`project = ${quote(jira.projectKey)}`);
  clauses.push(`status in (${jira.newCaseStatuses.map(quote).join(", ")})`);
  return `${clauses.join(" AND ")} ORDER BY created ASC`;
}

export class JiraRestAdapter implements CaseSourceAdapter {
  readonly sourceName = "Jira";
  readonly mode = "REAL_JIRA" as const;
  private readonly config: SupportGuardConfig;
  private readonly fetchImpl: FetchLike;
  private readonly logger: JiraLogger;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(options: JiraRestAdapterOptions) {
    this.config = options.config;
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
    this.logger = options.logger ?? console;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  private get jira() {
    return this.config.jira;
  }

  private assertConfigured(): void {
    const { baseUrl, apiToken, email, authMode } = this.jira;
    if (!baseUrl || !apiToken || (authMode === "basic" && !email)) {
      throw new SourceError("CONFIGURATION", "JIRA_URL / JIRA_API_TOKEN (and JIRA_EMAIL for basic auth) are required");
    }
  }

  private authHeader(): string {
    if (this.jira.authMode === "bearer") return `Bearer ${this.jira.apiToken}`;
    return `Basic ${Buffer.from(`${this.jira.email}:${this.jira.apiToken}`).toString("base64")}`;
  }

  private async request(method: string, path: string, body?: unknown): Promise<unknown> {
    this.assertConfigured();
    const url = `${this.jira.baseUrl}${path}`;
    for (let attempt = 0; ; attempt++) {
      let response: Response;
      try {
        response = await this.fetchImpl(url, {
          method,
          headers: { Authorization: this.authHeader(), Accept: "application/json", "Content-Type": "application/json" },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: AbortSignal.timeout(this.jira.timeoutMs),
        });
      } catch (error) {
        const name = (error as { name?: string })?.name;
        if (name === "TimeoutError" || name === "AbortError") throw new SourceError("TIMEOUT", `${method} ${path} timed out`);
        throw new SourceError("NETWORK", `${method} ${path} failed: ${(error as Error)?.message ?? "unknown"}`);
      }

      if (RETRYABLE.has(response.status) && attempt < this.jira.maxRetries) {
        const retryAfter = Number(response.headers.get("Retry-After"));
        const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, 30000) : 500 * 2 ** attempt;
        this.logger.warn(`[jira] ${method} ${path} -> ${response.status}; retry ${attempt + 1}/${this.jira.maxRetries} in ${wait}ms`);
        await this.sleep(wait);
        continue;
      }
      return this.parse(response, method, path);
    }
  }

  private async parse(response: Response, method: string, path: string): Promise<unknown> {
    if (response.ok) {
      if (response.status === 204) return null;
      try {
        return await response.json();
      } catch {
        throw new SourceError("INVALID_RESPONSE", `${method} ${path} returned a non-JSON body`, response.status);
      }
    }
    const detail = `${method} ${path} -> HTTP ${response.status}`;
    if (response.status === 401) throw new SourceError("AUTHENTICATION", detail, 401);
    if (response.status === 403) throw new SourceError("PERMISSION", detail, 403);
    if (response.status === 404) throw new SourceError("NOT_FOUND", detail, 404);
    if (response.status === 429) throw new SourceError("RATE_LIMIT", detail, 429);
    if (response.status >= 500) throw new SourceError("NETWORK", detail, response.status);
    throw new SourceError("UNKNOWN", detail, response.status);
  }

  private normalize(issue: unknown): SupportCase {
    try {
      return normalizeJiraIssue(issue as JiraIssue, { baseUrl: this.jira.baseUrl, fieldMap: this.jira.fieldMap });
    } catch (error) {
      throw new SourceError("INVALID_RESPONSE", (error as Error).message);
    }
  }

  async healthCheck(): Promise<ConnectionStatus> {
    const base = { source: this.sourceName, mode: this.mode, checkedAt: new Date().toISOString() };
    try {
      this.assertConfigured();
      const started = Date.now();
      await this.request("GET", "/rest/api/2/myself");
      const latencyMs = Date.now() - started;
      return latencyMs > DEGRADED_LATENCY_MS
        ? { ...base, state: "DEGRADED", latencyMs, message: "Jira responde con lentitud" }
        : { ...base, state: "CONNECTED", latencyMs, message: "Conectado" };
    } catch (error) {
      const sourceError = error instanceof SourceError ? error : new SourceError("UNKNOWN", String(error));
      this.logger.error(`[jira] health check failed: ${sourceError.kind} ${sourceError.technicalDetail}`);
      const degraded = sourceError.kind === "RATE_LIMIT" || sourceError.kind === "TIMEOUT";
      return { ...base, state: degraded ? "DEGRADED" : "DISCONNECTED", message: sourceError.userMessage };
    }
  }

  async fetchNewCases(): Promise<SupportCase[]> {
    const cases: SupportCase[] = [];
    const jql = buildNewCasesJql(this.jira);
    let startAt = 0;
    for (;;) {
      const page = (await this.request("POST", "/rest/api/2/search", {
        jql,
        startAt,
        maxResults: this.jira.maxResults,
        fields: requestedJiraFields(this.jira.fieldMap),
      })) as { issues?: unknown[]; total?: number } | null;
      if (!page || !Array.isArray(page.issues)) throw new SourceError("INVALID_RESPONSE", "search response has no issues array");
      cases.push(...page.issues.map((issue) => this.normalize(issue)));
      startAt += page.issues.length;
      if (page.issues.length === 0 || startAt >= (page.total ?? startAt)) break;
    }
    return cases;
  }

  get baseUrl(): string {
    return this.jira.baseUrl;
  }

  /** Read-only historical search (pagination via startAt). Fails instead of truncating when over `maxCases`. */
  async searchIssues(jql: string, options: { fields: string[]; pageSize: number; maxCases: number; onPage?: (fetched: number, total: number) => void }): Promise<JiraIssue[]> {
    const issues: JiraIssue[] = [];
    let startAt = 0;
    for (;;) {
      const page = (await this.request("POST", "/rest/api/2/search", { jql, startAt, maxResults: options.pageSize, fields: options.fields })) as { issues?: JiraIssue[]; total?: number } | null;
      if (!page || !Array.isArray(page.issues)) throw new SourceError("INVALID_RESPONSE", "search response has no issues array");
      const total = page.total ?? startAt + page.issues.length;
      if (total > options.maxCases) throw new SearchLimitError(total, options.maxCases);
      issues.push(...page.issues);
      startAt += page.issues.length;
      options.onPage?.(issues.length, total);
      if (page.issues.length === 0 || startAt >= total) break;
    }
    return issues;
  }

  async getCase(id: string): Promise<SupportCase> {
    const fields = requestedJiraFields(this.jira.fieldMap).join(",");
    return this.normalize(await this.request("GET", `/rest/api/2/issue/${encodeURIComponent(id)}?fields=${encodeURIComponent(fields)}`));
  }

  async addComment(id: string, body: string): Promise<void> {
    await this.request("POST", `/rest/api/2/issue/${encodeURIComponent(id)}/comment`, { body });
  }

  async returnForInformation(id: string, comment: string, options: ReturnOptions = {}): Promise<ReturnEvidence> {
    const target = this.jira.returnTransition;
    const issuePath = `/rest/api/2/issue/${encodeURIComponent(id)}`;
    const postComment = async () => {
      if (options.skipComment) return;
      await this.addComment(id, comment);
      options.onCommentPosted?.();
    };

    if (!target.id && !target.name) {
      await postComment();
      await this.request("PUT", issuePath, { update: { labels: [{ add: this.jira.pendingLabel }] } });
      return {
        type: "MARKED_PENDING",
        detail: "Comment added and pending-information label applied (no return transition configured)",
        evidence: { label: this.jira.pendingLabel },
      };
    }

    const available = (await this.request("GET", `${issuePath}/transitions`)) as { transitions?: { id: string; name: string }[] } | null;
    const transitions = available?.transitions ?? [];
    const match = transitions.find((item) =>
      target.id ? item.id === target.id : item.name.toLowerCase() === target.name!.toLowerCase(),
    );
    if (!match) {
      throw new SourceError(
        "CONFIGURATION",
        `Configured return transition is not available for ${id}; available: ${transitions.map((t) => `${t.id}:${t.name}`).join(", ")}`,
      );
    }
    await postComment();
    await this.request("POST", `${issuePath}/transitions`, { transition: { id: match.id } });
    return {
      type: "RETURNED",
      detail: `Transitioned with "${match.name}"`,
      evidence: { transitionId: match.id, transitionName: match.name },
    };
  }
}
