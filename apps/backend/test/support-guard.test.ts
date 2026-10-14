import assert from "node:assert/strict";
import test from "node:test";

import request from "supertest";

import { SourceError } from "../src/adapters/case-source.js";
import { buildNewCasesJql, JiraRestAdapter } from "../src/adapters/jira-rest-adapter.js";
import { normalizeJiraIssue } from "../src/adapters/jira-normalizer.js";
import { MockJiraAdapter, demoCases } from "../src/adapters/mock-jira-adapter.js";
import { createApp } from "../src/app.js";
import { type SupportGuardConfig, loadConfig } from "../src/config/config.js";
import type { SupportCase } from "../src/domain/types.js";
import { CaseIntakeService } from "../src/intake/case-intake-service.js";
import { PollingScheduler } from "../src/intake/polling-scheduler.js";
import { classifyScore, evaluateSufficiency } from "../src/sufficiency/sufficiency-engine.js";
import { StateStore } from "../src/store/state-store.js";
import { validateRequiredFields } from "../src/validation/required-fields.js";

const silent = { error: () => undefined, info: () => undefined, warn: () => undefined };

function makeConfig(env: Record<string, string> = {}): SupportGuardConfig {
  const live =
    env.JIRA_ACTIONS_MODE === "LIVE"
      ? { SUPPORT_GUARD_AUTH_JWKS_URL: "https://auth.example.test/keys", SUPPORT_GUARD_AUTH_ISSUER: "https://auth.example.test" }
      : {};
  return loadConfig({ SUPPORT_GUARD_SOURCE: "MOCK_JIRA", ...live, ...env });
}

function makeCase(overrides: Partial<SupportCase> = {}): SupportCase {
  return {
    id: "SUP-1",
    externalId: "1",
    source: "JIRA",
    summary: "Error al guardar",
    description: "",
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

const COMPLETE_DESCRIPTION =
  'Al intentar guardar un pedido en producción aparece el mensaje "Error 500 al guardar". Pasos: 1. Abrir pedidos 2. Guardar. Se esperaba que se guardara. Afecta a todos los usuarios y bloquea la operación.';

function makeIntake(config: SupportGuardConfig, cases: SupportCase[]) {
  const adapter = new MockJiraAdapter(cases);
  const store = new StateStore();
  const intake = new CaseIntakeService(adapter, config, store, silent);
  return { adapter, store, intake };
}

test("Jira normalization maps standard and configured fields", () => {
  const normalized = normalizeJiraIssue(
    {
      id: "10001",
      key: "SUP-9",
      fields: {
        summary: "Falla",
        description: "Detalle",
        status: { name: "Open" },
        priority: { name: "High" },
        reporter: { displayName: "Ana Pérez" },
        created: "2026-01-01T10:00:00.000+0000",
        updated: "2026-01-02T10:00:00.000+0000",
        components: [{ name: "Facturación" }],
        customfield_1: { value: "Producción" },
        attachment: [{ id: "7", filename: "log.txt", size: 10 }],
      },
    },
    { baseUrl: "https://jira.example.test", fieldMap: { application: ["components"], environment: ["customfield_1"] } },
  );
  assert.equal(normalized.id, "SUP-9");
  assert.equal(normalized.source, "JIRA");
  assert.equal(normalized.status, "Open");
  assert.equal(normalized.application, "Facturación");
  assert.equal(normalized.environment, "Producción");
  assert.equal(normalized.reporter, "Ana Pérez");
  assert.equal(normalized.attachments[0].filename, "log.txt");
  assert.equal(normalized.url, "https://jira.example.test/browse/SUP-9");
  assert.throws(() => normalizeJiraIssue({ fields: {} }, { fieldMap: {} }));
});

test("required field validation: complete case and missing fields", () => {
  const config = makeConfig();
  const complete = validateRequiredFields(makeCase({ description: "algo" }), config.validation);
  assert.equal(complete.valid, true);
  assert.deepEqual(complete.missingFields, []);

  const incomplete = validateRequiredFields(makeCase({ application: "", environment: " ", reporter: "N/A" }), config.validation);
  assert.equal(incomplete.valid, false);
  assert.deepEqual(incomplete.missingFields, ["description", "application", "environment", "reporter"]);
  assert.equal(incomplete.caseId, "SUP-1");
});

test("required fields are configurable", () => {
  const config = makeConfig({ SUPPORT_GUARD_REQUIRED_FIELDS: "summary,priority" });
  assert.equal(validateRequiredFields(makeCase({ description: "" }), config.validation).valid, true);
});

test("sufficiency: well described case is sufficient, generic case is insufficient with explanations", () => {
  const config = makeConfig();
  const good = evaluateSufficiency(makeCase({ description: COMPLETE_DESCRIPTION, attachments: [{ id: "1", filename: "a.png" }] }), config.sufficiency);
  assert.equal(good.status, "SUFFICIENT");
  assert.ok(good.score! >= 75);

  const bad = evaluateSufficiency(makeCase({ summary: "El sistema no funciona", description: "El sistema no funciona.", application: "", environment: "" }), config.sufficiency);
  assert.equal(bad.status, "INSUFFICIENT");
  assert.ok(bad.missingInformation.includes("No se especifican pasos para reproducir"));
  assert.ok(bad.missingInformation.includes("No se incluye mensaje de error"));
  assert.ok(bad.explanation.length > 0);
});

test("sufficiency: score/status boundaries and critical rule cap", () => {
  const thresholds = { sufficientThreshold: 75, partialThreshold: 50 };
  assert.equal(classifyScore(75, thresholds), "SUFFICIENT");
  assert.equal(classifyScore(74, thresholds), "PARTIALLY_SUFFICIENT");
  assert.equal(classifyScore(50, thresholds), "PARTIALLY_SUFFICIENT");
  assert.equal(classifyScore(49, thresholds), "INSUFFICIENT");

  const config = makeConfig();
  const noApp = evaluateSufficiency(makeCase({ description: COMPLETE_DESCRIPTION, application: "", attachments: [{ id: "1", filename: "a.png" }] }), config.sufficiency);
  assert.ok(noApp.score! >= 75);
  assert.equal(noApp.status, "PARTIALLY_SUFFICIENT");
});

test("DRY_RUN does not modify Jira and reports would-return", async () => {
  const { adapter, store, intake } = makeIntake(makeConfig({ JIRA_ACTIONS_MODE: "DRY_RUN" }), [makeCase({ application: "" })]);
  const summary = await intake.run("MANUAL");
  assert.equal(adapter.returned.length, 0);
  assert.equal(summary.dryRun, 1);
  const record = store.getCase("SUP-1")!;
  assert.equal(record.validationStatus, "DRY_RUN");
  assert.match(record.lastAction!.detail, /Would return case/);
  assert.ok(store.recentAudit().some((entry) => entry.action === "CASE_RETURN_DRY_RUN"));
});

test("default actions mode is DRY_RUN", () => {
  assert.equal(makeConfig().jira.actionsMode, "DRY_RUN");
});

test("LIVE returns the case through the adapter with a comment listing missing fields", async () => {
  const { adapter, store, intake } = makeIntake(makeConfig({ JIRA_ACTIONS_MODE: "LIVE" }), [makeCase({ application: "" })]);
  const summary = await intake.run("MANUAL");
  assert.equal(summary.returned, 1);
  assert.equal(adapter.returned.length, 1);
  assert.match(adapter.returned[0].comment, /Aplicación afectada/);
  assert.equal(store.getCase("SUP-1")!.validationStatus, "RETURNED");
  assert.ok(store.recentAudit().some((entry) => entry.action === "CASE_RETURNED"));
});

test("complete cases trigger no external action", async () => {
  const { adapter, store, intake } = makeIntake(makeConfig({ JIRA_ACTIONS_MODE: "LIVE" }), [makeCase({ description: "Detalle" })]);
  await intake.run("MANUAL");
  assert.equal(adapter.returned.length, 0);
  assert.equal(store.getCase("SUP-1")!.validationStatus, "COMPLETE");
});

test("idempotency: repeated polling does not repeat actions; edits and mode change re-trigger", async () => {
  const config = makeConfig({ JIRA_ACTIONS_MODE: "DRY_RUN" });
  const adapter = new MockJiraAdapter([makeCase({ application: "" })]);
  const store = new StateStore();
  const intake = new CaseIntakeService(adapter, config, store, silent);
  const scheduler = new PollingScheduler(intake, { enabled: true, intervalSeconds: 60 }, silent);

  await scheduler.tick();
  await scheduler.tick();
  await scheduler.tick();
  const audits = store.recentAudit(100).filter((entry) => entry.action === "CASE_RETURN_DRY_RUN");
  assert.equal(audits.length, 1);
  assert.equal(store.lastRun!.skippedUnchanged, 1);

  adapter.updateCase("SUP-1", { description: "Nuevo detalle del usuario" });
  await intake.run("MANUAL");
  assert.equal(store.recentAudit(100).filter((entry) => entry.action === "CASE_RETURN_DRY_RUN").length, 1 + 1);

  // Switching to LIVE executes the pending simulated action exactly once.
  const liveConfig = makeConfig({ JIRA_ACTIONS_MODE: "LIVE" });
  const liveIntake = new CaseIntakeService(adapter, liveConfig, store, silent);
  await liveIntake.run("MANUAL");
  assert.equal(adapter.returned.length, 1);
  await liveIntake.run("MANUAL");
  assert.equal(adapter.returned.length, 1);
});

test("idempotency: LIVE case that is returned is not returned again on later runs", async () => {
  const { adapter, intake } = makeIntake(makeConfig({ JIRA_ACTIONS_MODE: "LIVE" }), [makeCase({ application: "" })]);
  await intake.run("MANUAL");
  await intake.run("MANUAL");
  await intake.run("MANUAL");
  assert.equal(adapter.returned.length, 1);
});

test("Jira errors are contained: run reports a source error without throwing", async () => {
  const { adapter, store, intake } = makeIntake(makeConfig(), [makeCase()]);
  adapter.failWith = new SourceError("AUTHENTICATION", "HTTP 401");
  const summary = await intake.run("MANUAL");
  assert.equal(summary.errors, 1);
  assert.match(summary.sourceError!, /credenciales/);
  assert.ok(store.recentAudit().some((entry) => entry.action === "JIRA_ERROR"));
  assert.equal(store.lastSyncAt, null);
});

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), { status, headers });
}

function jiraConfig(extra: Record<string, string> = {}) {
  return makeConfig({ SUPPORT_GUARD_SOURCE: "REAL_JIRA", JIRA_URL: "https://jira.example.test/", JIRA_API_TOKEN: "secret-token", JIRA_AUTH_MODE: "bearer", JIRA_PROJECT_KEY: "SUP", ...extra });
}

test("Jira adapter maps HTTP failures to typed errors and never leaks the token", async () => {
  const cases: [number, string][] = [
    [401, "AUTHENTICATION"],
    [403, "PERMISSION"],
    [404, "NOT_FOUND"],
    [429, "RATE_LIMIT"],
  ];
  for (const [status, kind] of cases) {
    const adapter = new JiraRestAdapter({ config: jiraConfig({ JIRA_MAX_RETRIES: "0" }), fetchImpl: async () => jsonResponse(status, {}), logger: silent });
    await assert.rejects(adapter.getCase("SUP-1"), (error: SourceError) => error.kind === kind && !JSON.stringify(error).includes("secret-token"));
  }
  const timeout = new JiraRestAdapter({
    config: jiraConfig(),
    fetchImpl: async () => {
      throw Object.assign(new Error("timeout"), { name: "TimeoutError" });
    },
    logger: silent,
  });
  await assert.rejects(timeout.fetchNewCases(), (error: SourceError) => error.kind === "TIMEOUT");

  const invalid = new JiraRestAdapter({ config: jiraConfig(), fetchImpl: async () => jsonResponse(200, { nope: true }), logger: silent });
  await assert.rejects(invalid.fetchNewCases(), (error: SourceError) => error.kind === "INVALID_RESPONSE");
});

test("Jira adapter retries rate limiting then succeeds, and health check reports state", async () => {
  let calls = 0;
  const adapter = new JiraRestAdapter({
    config: jiraConfig(),
    fetchImpl: async () => (++calls === 1 ? jsonResponse(429, {}, { "Retry-After": "1" }) : jsonResponse(200, { name: "svc" })),
    logger: silent,
    sleep: async () => undefined,
  });
  assert.equal((await adapter.healthCheck()).state, "CONNECTED");
  assert.equal(calls, 2);

  const down = new JiraRestAdapter({ config: jiraConfig({ JIRA_API_TOKEN: "" }), logger: silent });
  const status = await down.healthCheck();
  assert.equal(status.state, "DISCONNECTED");
  assert.ok(!JSON.stringify(status).includes("secret"));
});

test("Jira adapter: JQL derives from configured statuses and LIVE return uses a verified transition", async () => {
  const config = jiraConfig({ JIRA_NEW_CASE_STATUSES: "Open,Created", JIRA_RETURN_TRANSITION_NAME: "Need Info" });
  assert.equal(buildNewCasesJql(config.jira), 'project = "SUP" AND status in ("Open", "Created") ORDER BY created ASC');

  const seen: string[] = [];
  const adapter = new JiraRestAdapter({
    config,
    logger: silent,
    fetchImpl: async (url, init) => {
      seen.push(`${init?.method} ${url.replace("https://jira.example.test", "")}`);
      if (url.endsWith("/transitions") && init?.method === "GET") return jsonResponse(200, { transitions: [{ id: "31", name: "Need Info" }] });
      return jsonResponse(init?.method === "POST" && url.endsWith("/transitions") ? 204 : 201, { id: "1" });
    },
  });
  const result = await adapter.returnForInformation("SUP-1", "faltan datos");
  assert.equal(result.type, "RETURNED");
  assert.equal(result.evidence.transitionId, "31");
  assert.ok(seen.includes("POST /rest/api/2/issue/SUP-1/transitions"));

  const missing = new JiraRestAdapter({
    config,
    logger: silent,
    fetchImpl: async () => jsonResponse(200, { transitions: [{ id: "5", name: "Other" }] }),
  });
  await assert.rejects(missing.returnForInformation("SUP-1", "x"), (error: SourceError) => error.kind === "CONFIGURATION");
});

test("polling: disabled scheduler never runs; API exposes overview, cases and detail without secrets", async () => {
  const config = makeConfig({ JIRA_API_TOKEN: "secret-token" });
  const adapter = new MockJiraAdapter(demoCases());
  const store = new StateStore();
  const intake = new CaseIntakeService(adapter, config, store, silent);
  const scheduler = new PollingScheduler(intake, config.polling, silent);
  scheduler.start();
  assert.equal(scheduler.status(null).enabled, false);

  const app = createApp({ productName: "t", version: "1", corsOrigin: "http://localhost" }, { adapter, config, store, intake, scheduler });
  const run = await request(app).post("/api/support-guard/validation/run");
  assert.equal(run.status, 200);
  assert.equal(run.body.summary.found, demoCases().length);

  const overview = await request(app).get("/api/support-guard/overview");
  assert.equal(overview.body.connection.state, "CONNECTED");
  assert.equal(overview.body.sourceMode, "MOCK_JIRA");
  assert.equal(overview.body.autoValidation.enabled, false);
  assert.ok(!JSON.stringify(overview.body).includes("secret-token"));

  const list = await request(app).get("/api/support-guard/cases");
  assert.equal(list.body.cases.length, demoCases().length);
  const detail = await request(app).get("/api/support-guard/cases/DEMO-102");
  assert.equal(detail.status, 200);
  assert.equal(detail.body.case.sufficiency.status, "INSUFFICIENT");
  assert.equal((await request(app).get("/api/support-guard/cases/NOPE-1")).status, 404);
});
