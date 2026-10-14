import assert from "node:assert/strict";
import { test } from "node:test";

import { MockLlmClient, parseJsonContent, LlmError, type LlmClient } from "../../src/intelligence/ai/llm.js";
import { applyGuardrails, consolidateClaims, parseAnalysis, sanitizeWording, verifyClaims } from "../../src/intelligence/ai/claims.js";
import { AnalyticalStore } from "../../src/intelligence/analytical-store.js";
import { loadIntelligenceConfig } from "../../src/intelligence/config.js";
import { buildSourceIndex } from "../../src/intelligence/evidence.js";
import { PeriodError, resolvePeriod } from "../../src/intelligence/periods.js";
import { trendOf } from "../../src/intelligence/report.js";
import { SelectionError } from "../../src/intelligence/lifecycle.js";
import { ActiveRunError, IntelligenceService, RunStateError, StaleRunError } from "../../src/intelligence/service.js";
import { MockHistoricalSource } from "../../src/intelligence/source.js";
import type { CanonicalUnit, Claim, ClusterResult } from "../../src/intelligence/types.js";

const NOW = new Date("2025-06-15T12:00:00Z");
const limits = { maxCustomDays: 92, warnCustomDays: 31 };

async function build(overrides: Record<string, string> = {}, llm?: LlmClient) {
  const config = loadIntelligenceConfig({ INTELLIGENCE_AI_ENABLED: "true", INTELLIGENCE_AI_PROVIDER: "MOCK_AI", ...overrides } as NodeJS.ProcessEnv);
  const store = await AnalyticalStore.open(":memory:");
  const service = new IntelligenceService({ config, store, source: new MockHistoricalSource(config.fieldIds), llm: llm ?? new MockLlmClient(config.ai.models), projectKey: "DEMO", now: () => NOW });
  return { config, store, service };
}

test("periods: monthly defaults to the last full month and custom is bounded", () => {
  const monthly = resolvePeriod({ type: "MONTHLY" }, limits, NOW);
  assert.deepEqual([monthly.from, monthly.to], ["2025-05-01", "2025-05-31"]);
  assert.deepEqual([resolvePeriod({ type: "DAILY" }, limits, NOW).from], ["2025-06-14"]);
  assert.throws(() => resolvePeriod({ type: "CUSTOM", from: "2025-01-01", to: "2025-06-01" }, limits, NOW), PeriodError);
  assert.throws(() => resolvePeriod({ type: "CUSTOM", from: "2025-06-20", to: "2025-06-25" }, limits, NOW), PeriodError);
  assert.ok(resolvePeriod({ type: "CUSTOM", from: "2025-05-01", to: "2025-06-10" }, limits, NOW).warnings.length > 0);
});
const settle = async (service: IntelligenceService) => {
  while (service.activeRun) await new Promise((resolve) => setTimeout(resolve, 20));
};

/** Counts AI calls per task so tests can prove which operations spend AI. */
class CountingLlm implements LlmClient {
  readonly provider = "COUNTING";
  readonly calls: Record<string, number> = {};
  private readonly inner: MockLlmClient;
  constructor(models: ConstructorParameters<typeof MockLlmClient>[0]) {
    this.inner = new MockLlmClient(models);
  }
  async complete(task: Parameters<LlmClient["complete"]>[0], messages: Parameters<LlmClient["complete"]>[1]) {
    this.calls[task] = (this.calls[task] ?? 0) + 1;
    return this.inner.complete(task, messages);
  }
  get total() {
    return Object.values(this.calls).reduce((sum, n) => sum + n, 0);
  }
}

/** Records every JQL and can simulate a Jira edit by changing the summary of one issue. */
class SpySource extends MockHistoricalSource {
  readonly jqls: string[] = [];
  mutate = false;
  async searchIssues(jql: string, options: Parameters<MockHistoricalSource["searchIssues"]>[1]) {
    this.jqls.push(jql);
    const issues = await super.searchIssues(jql, options);
    if (this.mutate && issues.length) {
      const first = issues[0] as unknown as { fields: Record<string, unknown> };
      first.fields.summary = `${String(first.fields.summary)} (editado)`;
    }
    return issues;
  }
}

async function buildSpy(overrides: Record<string, string> = {}) {
  const config = loadIntelligenceConfig({ INTELLIGENCE_AI_ENABLED: "true", INTELLIGENCE_AI_PROVIDER: "MOCK_AI", ...overrides } as NodeJS.ProcessEnv);
  const store = await AnalyticalStore.open(":memory:");
  const source = new SpySource(config.fieldIds);
  const llm = new CountingLlm(config.ai.models);
  const service = new IntelligenceService({ config, store, source, llm, projectKey: "DEMO", now: () => NOW });
  return { config, store, source, llm, service };
}

test("pipeline: prepares data without AI, then analyzes on demand and keeps reports consistent", async () => {
  const { service, store, llm } = await buildSpy();
  const { runId, reused } = await service.start({ type: "MONTHLY" }, { wait: true });
  assert.equal(reused, false);
  const prepared = await service.getRun(runId);
  assert.equal(prepared?.status, "PREPARED");
  assert.ok(prepared!.eligible > 0 && prepared!.clusters > 0);
  assert.equal(llm.total, 0, "preparar datos no debe usar IA");

  const pre = (await service.preAnalysis(runId))!;
  assert.ok(pre.groups.length > 0 && pre.topGroups.length <= 3);

  await service.analyze(runId, { mode: "TOP_RCA" }, { wait: true });
  const run = await service.getRun(runId);
  assert.equal(run?.status, "COMPLETED");

  const clusters = (await service.clusters(runId))!;
  assert.ok(clusters.every((cluster) => cluster.cases >= 2));
  const detail = (await service.clusterDetail(runId, clusters[0].id))!;
  assert.ok(detail.candidates.every((candidate) => candidate.level !== "CONFIRMED_CAUSE"));

  const page1 = (await service.cases(runId, { page: 1, pageSize: 5 }))!;
  assert.equal(page1.items.length, 5);
  const parents = (await service.cases(runId, { eligibility: "ELIGIBLE_FOR_RCA", pageSize: 100 }))!;
  assert.ok(parents.items.every((item) => item.issueType !== "Sub-Support"));
  const children = await store.query(`SELECT COUNT(*) AS n FROM analysis_run_cases WHERE run_id = ? AND eligibility = 'CHILD_ONLY'`, [runId]);
  assert.ok(Number(children[0].n) > 0);
  for (const kind of ["executive", "cluster", "rootcause", "data_quality", "period_comparison"] as const) assert.ok(await service.report(runId, kind), kind);
});

test("reuse: same period loads the previous run, does not recreate it and does not touch Jira", async () => {
  const { service, store, source, llm } = await buildSpy();
  const first = await service.start({ type: "MONTHLY" }, { wait: true });
  const jqlCount = source.jqls.length;
  const second = await service.start({ type: "MONTHLY" }, { wait: true });
  assert.equal(second.reused, true);
  assert.equal(second.state, "REUSABLE");
  assert.equal(second.runId, first.runId);
  assert.equal(source.jqls.length, jqlCount, "no debe consultar Jira");
  assert.equal(llm.total, 0);
  assert.equal(Number((await store.query(`SELECT COUNT(*) AS n FROM analysis_runs`))[0].n), 1);
  const lookup = await service.lookup({ type: "MONTHLY" });
  assert.equal(lookup.state, "REUSABLE");
  assert.equal(lookup.run?.id, first.runId);
  assert.equal((await service.lookup({ type: "WEEKLY" })).state, "NOT_FOUND");
});

test("reuse: unchanged Jira avoids a full sync and stays reusable", async () => {
  const { service, source } = await buildSpy();
  await service.start({ type: "MONTHLY" }, { wait: true });
  const before = source.jqls.length;
  const check = await service.checkChanges({ type: "MONTHLY" });
  assert.equal(check.checked, true);
  assert.equal(check.changedCases, 0);
  assert.equal(check.state, "REUSABLE");
  const checkJql = source.jqls.slice(before).filter((jql) => !jql.startsWith("key in"));
  assert.ok(checkJql.length > 0 && checkJql.every((jql) => jql.includes("updated >=")), "solo consulta cambios incrementales");
});

test("reuse: explicit recalculation creates a new run and keeps the old one", async () => {
  const { service } = await buildSpy();
  const first = await service.start({ type: "MONTHLY" }, { wait: true });
  const forced = await service.start({ type: "MONTHLY", refresh: true }, { wait: true });
  assert.notEqual(forced.runId, first.runId);
  assert.equal(forced.reused, false);
  const runs = await service.listRuns();
  assert.deepEqual(runs.map((run) => run.id).sort(), [first.runId, forced.runId].sort());
});

test("reuse: a case updated in Jira marks the run STALE_DATA and blocks AI on outdated data", async () => {
  const { service, source, llm } = await buildSpy();
  const { runId } = await service.start({ type: "MONTHLY" }, { wait: true });
  source.mutate = true;
  const check = await service.checkChanges({ type: "MONTHLY" });
  assert.ok(check.changedCases > 0);
  assert.equal(check.state, "STALE_DATA");
  await assert.rejects(service.analyze(runId, { mode: "TOP_RCA" }, { wait: true }), StaleRunError);
  assert.equal(llm.total, 0);
  source.mutate = false;
  const updated = await service.start({ type: "MONTHLY" }, { wait: true });
  assert.notEqual(updated.runId, runId);
  assert.equal((await service.getRun(runId))?.status, "PREPARED", "el run histórico no se sobrescribe");
});

test("period: selector, Jira query, run and executive report use the same dates (September never yields October)", async () => {
  const { service, source } = await buildSpy();
  for (const request of [{ type: "CUSTOM" as const, from: "2025-05-01", to: "2025-05-30" }, { type: "WEEKLY" as const }, { type: "MONTHLY" as const }]) {
    const selected = service.previewPeriod(request);
    source.jqls.length = 0;
    const { runId, period } = await service.start({ ...request, refresh: true }, { wait: true });
    assert.deepEqual([period.from, period.to], [selected.from, selected.to]);
    const run = (await service.getRun(runId))!;
    assert.deepEqual([run.from, run.to], [selected.from, selected.to]);
    const mainJql = source.jqls.find((jql) => jql.includes("created >="))!;
    assert.ok(mainJql.includes(`created >= "${selected.from}"`));
    const report = (await service.report(runId, "executive"))!.content as unknown as { period: { from: string; to: string } };
    assert.deepEqual([report.period.from, report.period.to], [selected.from, selected.to]);
    const pre = (await service.preAnalysis(runId))!;
    assert.deepEqual([pre.period.from, pre.period.to], [selected.from, selected.to]);
  }
  const other = await service.start({ type: "CUSTOM", from: "2025-04-01", to: "2025-04-30" }, { wait: true });
  const report = (await service.report(other.runId, "executive"))!.content as unknown as { period: { from: string; to: string } };
  assert.equal(report.period.from, "2025-04-01");
  assert.equal(report.period.to, "2025-04-30");
});

test("modes: SUMMARY and RECURRENCE run no deep analysis; SUMMARY uses at most one summary call", async () => {
  const { service, llm } = await buildSpy();
  const { runId } = await service.start({ type: "MONTHLY" }, { wait: true });
  await service.analyze(runId, { mode: "SUMMARY" }, { wait: true });
  assert.equal(llm.calls.ANALYZE ?? 0, 0);
  assert.equal(llm.calls.VALIDATE ?? 0, 0);
  assert.equal(llm.calls.LABEL ?? 0, 0);
  assert.ok((llm.calls.SUMMARY ?? 0) <= 1);
  assert.equal((await service.getRun(runId))?.analysis?.mode, "SUMMARY");

  await service.analyze(runId, { mode: "RECURRENCE" }, { wait: true });
  assert.equal(llm.calls.ANALYZE ?? 0, 0, "RECURRENCE no ejecuta análisis profundo");
  assert.equal(llm.calls.VALIDATE ?? 0, 0);
  assert.ok((llm.calls.LABEL ?? 0) > 0);
  assert.equal((await service.getRun(runId))?.analysis?.mode, "RECURRENCE");
});

test("modes: TOP_RCA limits groups, SELECTED_RCA respects ids, FULL_RCA excludes low confidence by default", async () => {
  const { service } = await buildSpy();
  const { runId } = await service.start({ type: "MONTHLY" }, { wait: true });
  const clusters = (await service.clusters(runId))!;
  assert.ok(clusters.length > 3);

  const top = await service.estimate(runId, { mode: "TOP_RCA" });
  assert.ok(top.selected.length <= 3 && top.selected.length > 0);
  assert.ok(top.selected.every((item) => item.reason.length > 0));

  const ids = [clusters[1].id, clusters[2].id];
  const selected = await service.estimate(runId, { mode: "SELECTED_RCA", clusterIds: ids });
  assert.deepEqual(selected.selected.map((item) => item.id).sort(), [...ids].sort());
  await assert.rejects(service.estimate(runId, { mode: "SELECTED_RCA", clusterIds: ["cl_inexistente"] }), SelectionError);
  await assert.rejects(service.estimate(runId, { mode: "SELECTED_RCA", clusterIds: [] }), SelectionError);

  const full = await service.estimate(runId, { mode: "FULL_RCA" });
  const low = clusters.filter((cluster) => cluster.lowConfidence).map((cluster) => cluster.id);
  assert.ok(full.selected.every((item) => !low.includes(item.id)));
  assert.ok(full.warnings.some((warning) => warning.includes("más tiempo")));
  if (low.length) {
    const withLow = await service.estimate(runId, { mode: "FULL_RCA", includeLowConfidence: true });
    assert.ok(withLow.selected.length > full.selected.length);
  }
});

test("AI reuse: an existing result for the same cluster snapshot is not recomputed", async () => {
  const { service, llm } = await buildSpy();
  const { runId } = await service.start({ type: "MONTHLY" }, { wait: true });
  await service.analyze(runId, { mode: "TOP_RCA" }, { wait: true });
  const spent = llm.total;
  assert.ok(spent > 0);
  const estimate = await service.estimate(runId, { mode: "TOP_RCA" });
  assert.ok(estimate.selected.every((item) => item.willReuse));
  await service.analyze(runId, { mode: "TOP_RCA" }, { wait: true });
  assert.equal(llm.total, spent, "no se consumió IA adicional");
  const run = (await service.getRun(runId))!;
  assert.equal(run.analysis?.reusedClusters, run.analysis?.processedClusters);
  assert.ok((run.analysis?.aiSkippedByReuse ?? 0) > 0);

  const recalculated = await service.start({ type: "MONTHLY", refresh: true }, { wait: true });
  await service.analyze(recalculated.runId, { mode: "TOP_RCA" }, { wait: true });
  assert.equal(llm.total, spent, "un run recalculado con los mismos datos reutiliza los resultados de IA");
});

test("discard: soft-deletes a run so the period can be redone; forceAi re-calls the AI; role activity is readable", async () => {
  const { service, llm } = await buildSpy();
  const { runId } = await service.start({ type: "MONTHLY" }, { wait: true });
  await service.analyze(runId, { mode: "TOP_RCA" }, { wait: true });
  const spent = llm.total;
  const activity = (await service.roleActivity(runId))!;
  assert.ok(activity.length > 0 && activity.every((group) => group.roles.length > 0));

  const forced = await service.estimate(runId, { mode: "TOP_RCA", forceAi: true });
  assert.ok(forced.selected.every((item) => !item.willReuse));
  await service.analyze(runId, { mode: "TOP_RCA", forceAi: true }, { wait: true });
  assert.ok(llm.total > spent, "forceAi vuelve a llamar a la IA");

  await service.discardRun(runId);
  assert.equal((await service.lookup({ type: "MONTHLY" })).state, "NOT_FOUND");
  assert.equal((await service.getRun(runId))?.status, "DISCARDED", "el run se conserva en el almacén");
  await assert.rejects(() => service.discardRun(runId));
  const redo = await service.start({ type: "MONTHLY" }, { wait: true });
  assert.notEqual(redo.runId, runId);
});

test("execute requires a prepared run and the AI stage never starts by itself", async () => {
  const { service, llm } = await buildSpy();
  await assert.rejects(service.analyze("run_inexistente", { mode: "SUMMARY" }), RunStateError);
  await service.start({ type: "MONTHLY" }, { wait: true });
  assert.equal(llm.total, 0);
});

test("pipeline: one active run at a time", async () => {
  const { service } = await build();
  const first = await service.start({ type: "MONTHLY" });
  await assert.rejects(service.start({ type: "WEEKLY" }), ActiveRunError);
  await settle(service);
  assert.equal((await service.getRun(first.runId))?.status, "PREPARED");
});

test("AI failure degrades to a partial run and keeps deterministic clusters", async () => {
  const failing: LlmClient = { provider: "FAIL", complete: async () => { throw new LlmError("TIMEOUT", "no response"); } };
  const { service } = await build({}, failing);
  const { runId } = await service.start({ type: "MONTHLY" }, { wait: true });
  await service.analyze(runId, { mode: "TOP_RCA" }, { wait: true });
  const run = (await service.getRun(runId))!;
  assert.equal(run.status, "PARTIAL");
  assert.ok(run.clusters > 0);
  const events = await service.events(runId, 200);
  assert.ok(events.some((event) => event.phase === "AI_ANALYSIS_FAILED"));
});

test("AI disabled still produces deterministic clusters and reports", async () => {
  const { service } = await build({ INTELLIGENCE_AI_ENABLED: "false", SUPPORT_GUARD_AI_ENABLED: "false" });
  const { runId } = await service.start({ type: "MONTHLY" }, { wait: true });
  await service.analyze(runId, { mode: "SUMMARY" }, { wait: true });
  const report = (await service.report(runId, "executive"))!.content as { narrativeSource: string };
  assert.equal(report.narrativeSource, "DETERMINISTIC");
});

const unit = (key: string, extra: Partial<CanonicalUnit["root"]> = {}): CanonicalUnit =>
  ({ canonicalKey: key, root: { jiraKey: key, summary: "Timeout al consultar", description: "", errorMessage: "", closeMessage: "", comments: [], ...extra }, children: [], totalHours: 0 }) as unknown as CanonicalUnit;

test("citations: only literal excerpts of real fields survive, orphan claims are dropped", () => {
  const index = buildSourceIndex([unit("A-1", { errorMessage: "ORA-01013: user requested cancel of current operation" })]);
  const claim = (excerpt: string): Claim => ({ id: "c1", claim: "x", level: "LIKELY_CAUSE", confidence: 0.7, limitations: [], evidence: [{ jiraKey: "A-1", field: "errorMessage", excerpt }] });
  const ok = verifyClaims([claim("ORA-01013: user requested cancel")], index, new Set(["A-1"]));
  assert.equal(ok.claims.length, 1);
  const bad = verifyClaims([claim("texto inventado que no existe en jira")], index, new Set(["A-1"]));
  assert.equal(bad.claims.length, 0);
  assert.equal(bad.invalidReferences, 1);
});

test("guardrails: functional-only, single-case and low-confidence evidence are capped; nothing is confirmed", () => {
  const units = new Map([["A-1", unit("A-1")], ["A-2", unit("A-2")]]);
  const cluster = { lowConfidence: false } as ClusterResult;
  const claim = (level: Claim["level"], evidence: Claim["evidence"]): Claim => ({ id: "c1", claim: "Causa raíz confirmada: pool agotado", level, confidence: 0.99, limitations: [], evidence });
  const ref = (jiraKey: string, field: Claim["evidence"][number]["field"]) => ({ jiraKey, field, excerpt: "texto de ejemplo" });
  const run = (claims: Claim[], lowConfidence = false) => applyGuardrails(claims, { cluster: { ...cluster, lowConfidence }, units, approved: new Set(["c1"]) });

  assert.equal(run([claim("CONFIRMED_CAUSE", [ref("A-1", "summary"), ref("A-2", "summary")])])[0].level, "HYPOTHESIS");
  assert.equal(run([claim("LIKELY_CAUSE", [ref("A-1", "errorMessage")])])[0].level, "OBSERVED_PATTERN");
  assert.equal(run([claim("LIKELY_CAUSE", [ref("A-1", "errorMessage"), ref("A-2", "errorMessage")])])[0].level, "LIKELY_CAUSE");
  assert.equal(run([claim("LIKELY_CAUSE", [ref("A-1", "errorMessage"), ref("A-2", "errorMessage")])], true)[0].level, "OBSERVED_PATTERN");
  assert.ok(!/confirmada/i.test(run([claim("LIKELY_CAUSE", [ref("A-1", "errorMessage"), ref("A-2", "errorMessage")])])[0].claim));
  assert.ok(!/confirmada/i.test(sanitizeWording("La causa raíz confirmada es X")));
});

test("claims: schema is strict and similar claims are consolidated", () => {
  assert.throws(() => parseAnalysis({ claims: [{ claim: "x", level: "WRONG", confidence: 0.5 }] }));
  assert.throws(() => parseAnalysis({ claims: [{ claim: "x", level: "HYPOTHESIS", confidence: 4 }] }));
  const a: Claim = { id: "a", claim: "El pool de conexiones se agota en horas pico", level: "LIKELY_CAUSE", confidence: 0.7, limitations: [], evidence: [{ jiraKey: "A-1", field: "errorMessage", excerpt: "uno" }] };
  const b: Claim = { ...a, id: "b", claim: "El pool de conexiones se agota en horas pico del día", evidence: [{ jiraKey: "A-2", field: "errorMessage", excerpt: "dos" }] };
  const merged = consolidateClaims([a, b]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].evidence.length, 2);
});

test("llm json parsing tolerates fences and trend classification", () => {
  assert.deepEqual(parseJsonContent('```json\n{"a":1}\n```'), { a: 1 });
  assert.throws(() => parseJsonContent("no json"));
  assert.equal(trendOf(10, 0), "NEW");
  assert.equal(trendOf(10, 5), "GROWING");
  assert.equal(trendOf(3, 6), "DECLINING");
  assert.equal(trendOf(5, 5), "PERSISTENT");
  assert.equal(trendOf(5, undefined), "NO_BASELINE");
});

const cloneCase = (store: AnalyticalStore, key: string, createdAt: string, version: string) =>
  store.run(`INSERT INTO jira_cases BY NAME SELECT * REPLACE ('${key}' AS jira_key, '${createdAt}' AS created_at, '${version}' AS version, NULL AS parent_key) FROM jira_cases WHERE parent_key IS NULL LIMIT 1`);

test("reuse: changes outside the period do not invalidate, a new case inside the period does", async () => {
  const { service, store } = await buildSpy();
  await service.start({ type: "MONTHLY" }, { wait: true });
  await cloneCase(store, "OUT-1", "2023-01-05T10:00:00.000+0000", "outside");
  assert.equal((await service.lookup({ type: "MONTHLY" })).state, "REUSABLE");
  await cloneCase(store, "NEW-IN-1", "2025-05-10T10:00:00.000+0000", "inside");
  assert.equal((await service.lookup({ type: "MONTHLY" })).state, "STALE_DATA");
});

test("recovery: runs killed in any phase never look COMPLETED and can be retried", async () => {
  const { service, store } = await buildSpy();
  const { runId } = await service.start({ type: "MONTHLY" }, { wait: true });
  for (const [id, phase, prepared] of [["k_sync", "SYNCING_JIRA", null], ["k_cluster", "CLUSTERING", null], ["k_ai", "ANALYZING", "2025-06-01"], ["k_report", "GENERATING_REPORT", "2025-06-01"]] as const) {
    await store.run(`INSERT INTO analysis_runs (id, period_type, period_from, period_to, status, prepared_at, started_at) VALUES (?,?,?,?,?,?,?)`, [id, "MONTHLY", "2025-01-01", "2025-01-31", phase, prepared, "2025-06-01T00:00:00Z"]);
  }
  assert.deepEqual(await service.recoverInterrupted(), { interrupted: 2, partial: 2 });
  const status = async (id: string) => (await service.getRun(id))?.status;
  assert.equal(await status("k_sync"), "INTERRUPTED");
  assert.equal(await status("k_cluster"), "INTERRUPTED");
  assert.equal(await status("k_ai"), "PARTIAL");
  assert.equal(await status("k_report"), "PARTIAL");
  assert.equal(await status(runId), "PREPARED", "runs sanos no se tocan");
  assert.notEqual((await service.lookup({ type: "CUSTOM", from: "2025-01-01", to: "2025-01-31" })).state, "REUSABLE", "un run interrumpido nunca es reutilizable");
  assert.deepEqual(await service.recoverInterrupted(), { interrupted: 0, partial: 0 });
});

test("store: backup is a restorable single-file copy and old copies are pruned", async () => {
  const { mkdtempSync, existsSync, readdirSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const directory = mkdtempSync(join(tmpdir(), "sg-store-"));
  try {
    const path = join(directory, "analytics.duckdb");
    const store = await AnalyticalStore.open(path);
    await store.run(`INSERT INTO analysis_events (id, run_id, ts, level, phase, message) VALUES ('e1','r1','t','INFO','P','hello')`);
    const copy = await store.backup("test");
    assert.ok(copy && existsSync(copy));
    store.close();
    const restored = await AnalyticalStore.open(copy!);
    assert.equal((await restored.query(`SELECT message FROM analysis_events WHERE id = 'e1'`))[0].message, "hello");
    restored.close();
    assert.ok(readdirSync(join(directory, "backups")).length <= 5);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
