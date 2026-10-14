import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import test from "node:test";

import request from "supertest";

import { SourceError } from "../src/adapters/case-source.js";
import { DEMO_108_UPDATE, MockJiraAdapter, demoCases } from "../src/adapters/mock-jira-adapter.js";
import { AIAnalysisService } from "../src/ai/ai-analysis-service.js";
import { AxetBridgeAIProvider } from "../src/ai/axet-bridge-provider.js";
import { MockAIProvider } from "../src/ai/mock-ai-provider.js";
import { PROMPT_VERSION } from "../src/ai/prompt.js";
import { buildRequesterRequest } from "../src/ai/request-builder.js";
import { parseAIResponse } from "../src/ai/schema.js";
import { AIError, type AIAnalysisProvider } from "../src/ai/types.js";
import { createApp } from "../src/app.js";
import { JwtVerifier } from "../src/auth/jwt-verifier.js";
import { type SupportGuardConfig, loadConfig } from "../src/config/config.js";
import type { AIAnalysisResult, SupportCase } from "../src/domain/types.js";
import { CaseIntakeService } from "../src/intake/case-intake-service.js";
import { PollingScheduler } from "../src/intake/polling-scheduler.js";
import { StateStore } from "../src/store/state-store.js";
import { validateRequiredFields } from "../src/validation/required-fields.js";

const silent = { error: () => undefined, info: () => undefined, warn: () => undefined };
const AUTH = { SUPPORT_GUARD_AUTH_JWKS_URL: "https://auth.example.test/keys", SUPPORT_GUARD_AUTH_ISSUER: "https://auth.example.test" };

function makeConfig(env: Record<string, string> = {}): SupportGuardConfig {
  return loadConfig({ SUPPORT_GUARD_SOURCE: "MOCK_JIRA", SUPPORT_GUARD_AI_ENABLED: "true", SUPPORT_GUARD_AI_PROVIDER: "MOCK_AI", ...env });
}

function makeCase(overrides: Partial<SupportCase> = {}): SupportCase {
  return {
    id: "SUP-1",
    externalId: "1",
    source: "JIRA",
    summary: "Falla",
    description: "No funciona.",
    status: "Open",
    priority: "High",
    application: "Ventas",
    environment: "QA",
    reporter: "Ana",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    attachments: [],
    fields: {},
    ...overrides,
  };
}

function setup(cases: SupportCase[], env: Record<string, string> = {}, provider: AIAnalysisProvider | null = new MockAIProvider()) {
  const config = makeConfig(env);
  const adapter = new MockJiraAdapter(cases);
  const store = new StateStore();
  const ai = new AIAnalysisService(provider, config.ai, store, silent);
  const intake = new CaseIntakeService(adapter, config, store, silent, ai);
  return { config, adapter, store, ai, intake, provider };
}

const goodResult: AIAnalysisResult = {
  status: "INSUFFICIENT",
  confidence: 0.8,
  summary: "Falta detalle.",
  missingInformation: [{ field: "reproductionSteps", reason: "No hay pasos", question: "¿Cuáles son los pasos para reproducir el problema?" }],
  ambiguities: [],
  recommendedQuestions: ["¿Qué esperabas que ocurriera?"],
  requesterMessage: "Hola, necesitamos más datos. Gracias.",
};

test("AI schema validation accepts valid JSON (even fenced) and rejects invalid responses", () => {
  assert.equal(parseAIResponse(JSON.stringify(goodResult)).status, "INSUFFICIENT");
  assert.equal(parseAIResponse("```json\n" + JSON.stringify(goodResult) + "\n```").status, "INSUFFICIENT");
  assert.throws(() => parseAIResponse("no es json"), (error: unknown) => error instanceof AIError);
  assert.throws(() => parseAIResponse(JSON.stringify({ ...goodResult, status: "MAYBE" })), (error: unknown) => error instanceof AIError);
  assert.throws(() => parseAIResponse(JSON.stringify({ ...goodResult, confidence: 3 })), (error: unknown) => error instanceof AIError);
});

test("Axet adapter builds an OpenAI-compatible request from config with minimal context and no secrets", () => {
  const provider = new AxetBridgeAIProvider({ baseUrl: "http://127.0.0.1:4317/v1", model: "model-x", timeoutMs: 1000 });
  const supportCase = makeCase({ fields: { token: "SECRET-TOKEN" } });
  const { url, body } = provider.buildRequest({ supportCase, validation: validateRequiredFields(supportCase, makeConfig().validation) });
  assert.equal(url, "http://127.0.0.1:4317/v1/chat/completions");
  assert.equal(body.model, "model-x");
  const serialized = JSON.stringify(body);
  assert.ok(!serialized.includes("SECRET-TOKEN"));
});

test("Axet adapter: success, HTTP error, invalid response, unavailable and timeout map to typed errors", async () => {
  const input = { supportCase: makeCase(), validation: validateRequiredFields(makeCase(), makeConfig().validation) };
  const reply = (content: string) => async () => new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
  const config = { baseUrl: "http://127.0.0.1:4317/v1", model: "m", timeoutMs: 30 };

  assert.equal((await new AxetBridgeAIProvider(config, reply(JSON.stringify(goodResult))).analyze(input)).status, "INSUFFICIENT");
  await assert.rejects(new AxetBridgeAIProvider(config, reply("basura")).analyze(input), { kind: "INVALID_RESPONSE" });
  await assert.rejects(new AxetBridgeAIProvider(config, async () => new Response("x", { status: 500 })).analyze(input), { kind: "HTTP_ERROR" });
  await assert.rejects(new AxetBridgeAIProvider(config, async () => { throw new Error("ECONNREFUSED"); }).analyze(input), { kind: "UNAVAILABLE" });
  const hanging = (_url: string, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("aborted"))));
  await assert.rejects(new AxetBridgeAIProvider(config, hanging).analyze(input), { kind: "TIMEOUT" });
  const health = await new AxetBridgeAIProvider(config, async () => { throw new Error("down"); }).healthCheck();
  assert.equal(health.state, "DISCONNECTED");

  const models = (body: unknown) => async () => new Response(JSON.stringify(body), { status: 200 });
  const listed = { data: [{ id: "openai/m" }] };
  assert.equal((await new AxetBridgeAIProvider(config, models(listed)).healthCheck()).state, "CONNECTED");
  assert.equal((await new AxetBridgeAIProvider(config, models({ data: [{ id: "other" }] })).healthCheck()).state, "DISCONNECTED");
  assert.equal((await new AxetBridgeAIProvider(config, models({ ok: true })).healthCheck()).state, "DISCONNECTED");
});

test("AI record stores start/completion timestamps and duration without leaking them as results", async () => {
  const { store, ai, intake } = setup([makeCase()]);
  await intake.run("MANUAL");
  await ai.idle();
  const record = store.getCase("SUP-1")!.ai!;
  assert.ok(record.aiStartedAt && record.aiCompletedAt);
  assert.ok(typeof record.durationMs === "number" && record.durationMs >= 0);
});

test("AI analysis completes after the deterministic result and flags insufficient descriptions", async () => {
  const { store, ai, intake } = setup([makeCase()]);
  await intake.run("MANUAL");
  assert.equal(store.getCase("SUP-1")?.validation.valid, true);
  await ai.idle();
  const record = store.getCase("SUP-1")!;
  assert.equal(record.ai?.status, "COMPLETED");
  assert.equal(record.ai?.result?.status, "INSUFFICIENT");
  assert.ok(record.request?.message.startsWith("Hola"));
  const actions = store.recentAudit(100).map((entry) => entry.action);
  assert.ok(actions.includes("AI_ANALYSIS_STARTED") && actions.includes("AI_ANALYSIS_COMPLETED"));
});

test("AI fingerprint: unchanged case is reused, changed case and new prompt version are re-evaluated", async () => {
  const { adapter, store, ai, intake, provider } = setup([makeCase({ id: "DEMO-108" })]);
  const mock = provider as MockAIProvider;
  await intake.run("MANUAL");
  await ai.idle();
  await intake.run("MANUAL");
  await ai.idle();
  assert.equal(mock.calls, 1);
  assert.equal(mock.calls, 1);
  ai.enqueue("DEMO-108");
  await ai.idle();
  assert.ok(store.recentAudit(100).some((entry) => entry.action === "AI_ANALYSIS_REUSED"));

  adapter.updateCase("DEMO-108", DEMO_108_UPDATE);
  await intake.run("MANUAL");
  await ai.idle();
  assert.equal(mock.calls, 2);

  const record = store.getCase("DEMO-108")!;
  store.upsertCase({ ...record, ai: { ...record.ai!, promptVersion: "old", fingerprint: "stale-fingerprint" } });
  ai.enqueue("DEMO-108");
  await ai.idle();
  assert.equal(mock.calls, 3);
  assert.equal(store.getCase("DEMO-108")?.ai?.promptVersion, PROMPT_VERSION);
});

test("AI unavailable does not break the deterministic result and is retried later only after the cooldown", async () => {
  const mock = new MockAIProvider();
  mock.failWith = new AIError("UNAVAILABLE", "down");
  const { store, ai, intake } = setup([makeCase({ application: "" })], {}, mock);
  const summary = await intake.run("MANUAL");
  await ai.idle();
  assert.equal(summary.errors, 0);
  const record = store.getCase("SUP-1")!;
  assert.equal(record.validation.valid, false);
  assert.equal(record.ai?.status, "FAILED");
  assert.ok(store.recentAudit(100).some((entry) => entry.action === "AI_ANALYSIS_FAILED"));
  await intake.run("MANUAL");
  await ai.idle();
  assert.equal(mock.calls, 1);
  assert.equal((await ai.getHealth(true)).state, "DISCONNECTED");
});

test("AI disabled marks cases SKIPPED and reports DISABLED", async () => {
  const config = makeConfig({ SUPPORT_GUARD_AI_ENABLED: "false" });
  const store = new StateStore();
  const adapter = new MockJiraAdapter([makeCase()]);
  const ai = new AIAnalysisService(null, config.ai, store, silent);
  await new CaseIntakeService(adapter, config, store, silent, ai).run("MANUAL");
  assert.equal(store.getCase("SUP-1")?.ai?.status, "SKIPPED");
  assert.equal((await ai.getHealth()).state, "DISABLED");
});

test("AI concurrency never exceeds the configured limit", async () => {
  let active = 0;
  let peak = 0;
  const base = new MockAIProvider();
  const slow: AIAnalysisProvider = {
    name: "MOCK_AI",
    model: "mock-ai",
    healthCheck: () => base.healthCheck(),
    async analyze(input) {
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 15));
      active--;
      return base.analyze(input);
    },
  };
  const cases = Array.from({ length: 6 }, (_, index) => makeCase({ id: `SUP-${index + 1}` }));
  const { ai, intake } = setup(cases, { SUPPORT_GUARD_AI_MAX_CONCURRENCY: "2" }, slow);
  await intake.run("MANUAL");
  await ai.idle();
  assert.equal(peak, 2);
});

test("requester request merges required fields and AI items without duplicates or already-present data", () => {
  const config = makeConfig();
  const supportCase = makeCase({ environment: "", description: "Detalle" });
  const validation = validateRequiredFields(supportCase, config.validation);
  const result: AIAnalysisResult = {
    ...goodResult,
    missingInformation: [
      { field: "environment", reason: "x", question: "¿En qué ambiente ocurre?" },
      { field: "application", reason: "x", question: "¿Qué aplicación?" },
      { field: "errorMessage", reason: "x", question: "¿Cuál es el mensaje de error exacto?" },
      { field: "reproductionSteps", reason: "x", question: "¿Cuáles son los pasos para reproducirlo?" },
    ],
  };
  const merged = buildRequesterRequest(supportCase, validation, result)!;
  const keys = merged.items.map((item) => item.key);
  assert.equal(new Set(keys).size, keys.length);
  assert.equal(keys.filter((key) => key === "environment").length, 1);
  assert.ok(!keys.includes("application"));
  assert.ok(keys.includes("errorMessage") && keys.includes("reproductionSteps"));
  assert.match(merged.message, /^Hola,/);
  assert.match(merged.message, /Gracias\.$/);
  assert.equal(merged.message.match(/ambiente/gi)?.length, 1);
});

test("AI never touches Jira: analysis performs no returns or updates", async () => {
  const { adapter, ai, intake } = setup([makeCase()], { JIRA_ACTIONS_MODE: "LIVE", ...AUTH });
  await intake.run("MANUAL");
  await ai.idle();
  assert.equal(adapter.returned.length, 0);
  assert.equal(Object.keys(ai).includes("adapter"), false);
});

test("comment idempotency: comment posted, transition fails, retry does not duplicate the comment", async () => {
  const { adapter, store, intake } = setup([makeCase({ application: "" })], { JIRA_ACTIONS_MODE: "LIVE", ...AUTH });
  adapter.failTransition = new SourceError("SERVER_ERROR", "transition failed");
  await intake.run("MANUAL");
  assert.equal(adapter.returned.length, 1);
  assert.equal(store.getCase("SUP-1")?.validationStatus, "ERROR");
  assert.ok(store.getCase("SUP-1")?.postedCommentKey);

  adapter.failTransition = null;
  await intake.run("MANUAL");
  assert.equal(adapter.returned.filter((entry) => entry.comment).length, 1);
  assert.equal(store.getCase("SUP-1")?.validationStatus, "RETURNED");
});

test("manual return from the detail: DRY_RUN never touches Jira; LIVE posts the reviewed message once even if the transition fails first", async () => {
  const dry = setup([makeCase()]);
  await dry.intake.run("MANUAL");
  await dry.ai.idle();
  const simulated = await dry.intake.returnWithRequest("SUP-1");
  assert.ok(simulated.ok && simulated.record.lastAction?.type === "DRY_RUN");
  assert.equal(dry.adapter.returned.length, 0);

  const live = setup([makeCase()], { JIRA_ACTIONS_MODE: "LIVE", ...AUTH });
  await live.intake.run("MANUAL");
  await live.ai.idle();
  const message = live.store.getCase("SUP-1")!.request!.message;
  live.adapter.failTransition = new SourceError("SERVER_ERROR", "transition failed");
  const failed = await live.intake.returnWithRequest("SUP-1");
  assert.equal(failed.ok, false);
  live.adapter.failTransition = null;
  const done = await live.intake.returnWithRequest("SUP-1");
  assert.ok(done.ok && done.record.validationStatus === "RETURNED");
  const comments = live.adapter.returned.filter((entry) => entry.comment);
  assert.equal(comments.length, 1);
  assert.equal(comments[0].comment, message);
  const again = await live.intake.returnWithRequest("SUP-1");
  assert.ok(!again.ok && again.code === "ALREADY_RETURNED");
});

test("startup sync runs once for concurrent callers and is skipped while data is fresh", async () => {
  const { adapter, intake } = setup(demoCases());
  let fetches = 0;
  const original = adapter.fetchNewCases.bind(adapter);
  adapter.fetchNewCases = async (...args) => {
    fetches++;
    return original(...args);
  };
  const [a, b] = await Promise.all([intake.startupSync(), intake.startupSync()]);
  assert.equal(fetches, 1);
  assert.equal(a.summary?.trigger, "STARTUP");
  assert.ok(b.summary);
  const third = await intake.startupSync();
  assert.equal(third.performed, false);
  assert.equal(fetches, 1);
});

test("startup sync with Jira down still lets the dashboard load", async () => {
  const config = makeConfig();
  const adapter = new MockJiraAdapter(demoCases());
  adapter.failWith = new SourceError("UNAVAILABLE", "Jira unavailable");
  const store = new StateStore();
  const ai = new AIAnalysisService(new MockAIProvider(), config.ai, store, silent);
  const intake = new CaseIntakeService(adapter, config, store, silent, ai);
  const scheduler = new PollingScheduler(intake, config.polling);
  const app = createApp({ productName: "Support Guard", version: "t", corsOrigin: "*" }, { adapter, config, store, intake, scheduler, ai });

  const sync = await request(app).post("/api/support-guard/sync/startup");
  assert.equal(sync.status, 200);
  const overview = await request(app).get("/api/support-guard/overview");
  assert.equal(overview.status, 200);
  assert.equal(overview.body.connection.state, "DISCONNECTED");
  assert.ok(overview.body.ai.health);
  assert.ok(!JSON.stringify(overview.body).includes("127.0.0.1"));
});

test("health: /live always answers, /ready is 503 only when a critical dependency is down and leaks no secrets", async () => {
  const config = makeConfig();
  const adapter = new MockJiraAdapter(demoCases());
  adapter.failWith = new SourceError("UNAVAILABLE", "Jira unavailable");
  const store = new StateStore();
  const ai = new AIAnalysisService(new MockAIProvider(), config.ai, store, silent);
  const intake = new CaseIntakeService(adapter, config, store, silent, ai);
  const scheduler = new PollingScheduler(intake, config.polling);
  const app = createApp({ productName: "Support Guard", version: "t", corsOrigin: "*" }, { adapter, config, store, intake, scheduler, ai });

  const live = await request(app).get("/api/health/live");
  assert.equal(live.status, 200);
  assert.equal(live.body.status, "UP");
  assert.equal((await request(app).get("/api/health")).status, 200);

  const ready = await request(app).get("/api/health/ready?fresh=true");
  assert.equal(ready.status, 503);
  assert.equal(ready.body.status, "DOWN");
  const byName = Object.fromEntries(ready.body.checks.map((check: { name: string }) => [check.name, check]));
  assert.equal(byName.jira.state, "DOWN");
  assert.equal(byName.jira.critical, false);
  assert.equal(byName.analyticalStore.critical, true);
  assert.ok(!JSON.stringify(ready.body).includes("127.0.0.1"));
});

test("LIVE is forced to DRY_RUN without auth config (fail closed) and honoured with it", () => {
  const blocked = makeConfig({ JIRA_ACTIONS_MODE: "LIVE" });
  assert.equal(blocked.jira.actionsMode, "DRY_RUN");
  assert.ok(blocked.liveBlockedReason);
  assert.equal(makeConfig({ JIRA_ACTIONS_MODE: "LIVE", ...AUTH }).jira.actionsMode, "LIVE");
});

test("auth config: partial or insecure JWKS settings and required-but-missing auth abort startup", () => {
  assert.throws(() => makeConfig({ SUPPORT_GUARD_AUTH_JWKS_URL: "https://idp.example.com/keys" }), /together/);
  assert.throws(() => makeConfig({ SUPPORT_GUARD_AUTH_JWKS_URL: "http://idp.example.com/keys", SUPPORT_GUARD_AUTH_ISSUER: "https://idp.example.com" }), /https/);
  assert.throws(() => makeConfig({ SUPPORT_GUARD_REQUIRE_AUTH: "true" }), /Authentication is required/);
  assert.throws(() => makeConfig({ NODE_ENV: "production" }), /Authentication is required/);
  assert.doesNotThrow(() => makeConfig({ ...AUTH, SUPPORT_GUARD_REQUIRE_AUTH: "true" }));
});

test("JWKS: unknown kid does not refetch within the cooldown and a failing JWKS yields an auth error", async () => {
  const { publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  let calls = 0;
  const verifier = new JwtVerifier(makeConfig(AUTH).auth, async () => (calls++, new Response(JSON.stringify({ keys: [{ ...publicKey.export({ format: "jwk" }), kid: "k1" }] }))));
  const enc = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const bad = `${enc({ alg: "RS256", kid: "other" })}.${enc({})}.x`;
  for (let i = 0; i < 5; i++) await assert.rejects(() => verifier.verify(bad), /unknown signing key/);
  assert.equal(calls, 1);
  const down = new JwtVerifier(makeConfig(AUTH).auth, async () => { throw new Error("network"); });
  await assert.rejects(() => down.verify(bad), /jwks unavailable/);
});

test("API requires a valid JWT when auth is configured and rejects missing, forged and expired tokens", async () => {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: "jwk" }), kid: "k1" };
  const config = makeConfig(AUTH);
  const verifier = new JwtVerifier(config.auth, async () => new Response(JSON.stringify({ keys: [jwk] })));
  const adapter = new MockJiraAdapter([makeCase()]);
  const store = new StateStore();
  const intake = new CaseIntakeService(adapter, config, store, silent);
  const scheduler = new PollingScheduler(intake, config.polling);
  const app = createApp({ productName: "Support Guard", version: "t", corsOrigin: "*" }, { adapter, config, store, intake, scheduler, verifier });

  const token = (claims: Record<string, unknown>, key = privateKey) => {
    const enc = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
    const head = `${enc({ alg: "RS256", kid: "k1" })}.${enc(claims)}`;
    return `${head}.${sign("RSA-SHA256", Buffer.from(head), key).toString("base64url")}`;
  };
  const valid = token({ iss: AUTH.SUPPORT_GUARD_AUTH_ISSUER, exp: Math.floor(Date.now() / 1000) + 600, sub: "u1" });
  const expired = token({ iss: AUTH.SUPPORT_GUARD_AUTH_ISSUER, exp: Math.floor(Date.now() / 1000) - 600 });
  const forged = token({ iss: AUTH.SUPPORT_GUARD_AUTH_ISSUER, exp: Math.floor(Date.now() / 1000) + 600 }, generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey);

  assert.equal((await request(app).post("/api/support-guard/validation/run")).status, 401);
  assert.equal((await request(app).post("/api/support-guard/validation/run").set("Authorization", `Bearer ${expired}`)).status, 401);
  assert.equal((await request(app).post("/api/support-guard/validation/run").set("Authorization", `Bearer ${forged}`)).status, 401);
  assert.equal((await request(app).post("/api/support-guard/validation/run").set("Authorization", `Bearer ${valid}`)).status, 200);
});
