import assert from "node:assert/strict";
import { test } from "node:test";

import { AnalyticalStore } from "../../src/intelligence/analytical-store.js";
import { LlmError, MockLlmClient, type LlmClient } from "../../src/intelligence/ai/llm.js";
import { loadIntelligenceConfig } from "../../src/intelligence/config.js";
import { NarrativeError, parseNarrative, type ExecutivePayload } from "../../src/intelligence/ops/executive.js";
import { renderExecutiveHtml } from "../../src/intelligence/ops/html.js";
import { kpi } from "../../src/intelligence/ops/metrics.js";
import { operationalPriority } from "../../src/intelligence/ops/priority.js";
import { OpsService } from "../../src/intelligence/ops/service.js";
import { classifyTrend } from "../../src/intelligence/ops/trends.js";
import { ReviewError, ReviewService } from "../../src/intelligence/ops/review.js";
import { IntelligenceScheduler } from "../../src/intelligence/create.js";
import { IntelligenceService } from "../../src/intelligence/service.js";
import { MockHistoricalSource } from "../../src/intelligence/source.js";

const NOW = new Date("2025-06-15T12:00:00Z");
const thresholds = { change: 0.15, persistentPeriods: 2 };
const series = (...counts: number[]) => counts.map((count, index) => ({ from: `2025-0${index + 1}-01`, to: `2025-0${index + 1}-28`, count }));

test("trends: classification is deterministic and NOT_SEEN is never 'resolved'", () => {
  assert.equal(classifyTrend(series(0, 5), thresholds).trend, "NEW");
  assert.equal(classifyTrend(series(10, 20), thresholds).trend, "GROWING");
  assert.equal(classifyTrend(series(20, 10), thresholds).trend, "DECLINING");
  assert.equal(classifyTrend(series(10, 10, 10), thresholds).trend, "PERSISTENT");
  assert.equal(classifyTrend(series(10, 0), thresholds).trend, "NOT_SEEN");
  assert.equal(classifyTrend(series(5), thresholds).limitedHistory, true);
});

test("trends: PERSISTENT needs history, NEW is not a lone period, a gap yields RECURRING", () => {
  assert.equal(classifyTrend(series(10), thresholds).trend, "INSUFFICIENT_HISTORY");
  assert.notEqual(classifyTrend(series(10, 10), thresholds).trend, "PERSISTENT");
  assert.equal(classifyTrend(series(3, 0, 4), thresholds).trend, "RECURRING");
  assert.equal(classifyTrend(series(0, 0, 0, 4), thresholds).trend, "NEW");
  assert.equal(classifyTrend(series(5, 5, 4), thresholds).trend, "PERSISTENT");
  assert.equal(classifyTrend(series(6, 5, 6), thresholds).trend, "PERSISTENT");
});

test("kpi: no previous period means no delta", () => {
  const value = kpi("cases", "Casos", "cases", 10, null, "DOWN");
  assert.equal(value.previous, null);
  assert.equal(value.change, null);
  assert.equal(value.changePct, null);
  assert.equal(value.tone, null);
});

const base = { cases: 30, maxCases: 30, open: 24, reopened: 0, highPriorityCases: 0, totalHours: 100, maxHours: 100, confidence: 0.9, lowConfidence: false };

test("priority: explainable components, CRITICAL only when the rule fires", () => {
  const growing = operationalPriority({ ...base, trend: classifyTrend(series(10, 20, 30), thresholds), rcaLevel: "SUPPORTED_CAUSE" });
  assert.ok(growing.components.length >= 8 && growing.reasons.length > 0);
  assert.equal(growing.badge === "CRITICAL", Boolean(growing.criticalRule));
  const calm = operationalPriority({ ...base, cases: 2, open: 0, trend: classifyTrend(series(2, 2), thresholds) });
  assert.notEqual(calm.badge, "CRITICAL");
  const lowConfidence = operationalPriority({ ...base, lowConfidence: true, trend: classifyTrend(series(10, 20, 30), thresholds) });
  assert.notEqual(lowConfidence.badge, "CRITICAL");
});

const payload: ExecutivePayload = {
  period: { label: "mayo", from: "2025-05-01", to: "2025-05-31" },
  headlineFacts: { headline: "86 casos" },
  kpis: [{ label: "Casos", value: 86, unit: "cases", previous: 112, changePercent: -23 }],
  health: {},
  changes: [],
  topProblems: [],
  findings: [{ cluster: "A", statement: "x", level: "LIKELY_CAUSE", confidence: 0.6, limitations: [] }],
  recommendations: [],
  dataQuality: { level: "GOOD", score: 80, description: 90, errorMessage: 70, closeMessage: null },
  limitations: ["Historial limitado"],
};
const narrative = (overrides: Record<string, unknown> = {}) => ({ headline: "86 casos", periodSummary: "Bajaron 23% frente a 112.", keyChanges: [], topRisks: [], importantFindings: [], recommendedFocus: [], limitations: [], ...overrides });

test("narrative guard: rejects invented numbers, money/SLA and confirmed causes", () => {
  assert.equal(parseNarrative(narrative(), payload).headline, "86 casos");
  assert.throws(() => parseNarrative(narrative({ periodSummary: "Subieron 999 casos" }), payload), NarrativeError);
  assert.throws(() => parseNarrative(narrative({ topRisks: ["Impacto financiero alto"] }), payload), NarrativeError);
  assert.throws(() => parseNarrative(narrative({ importantFindings: ["Causa raíz confirmada en A"] }), payload), NarrativeError);
  assert.deepEqual(parseNarrative(narrative(), payload).limitations, ["Historial limitado"]);
});

test("html export escapes content", () => {
  const html = renderExecutiveHtml({ version: 1, generatedAt: "now", dataFingerprint: "abcdef1234567890", content: { narrative: { headline: "<script>x</script>" } } });
  assert.ok(!html.includes("<script>x"));
});

class CountingLlm implements LlmClient {
  readonly provider = "COUNTING";
  calls = 0;
  failNarrative = false;
  private readonly inner: MockLlmClient;
  constructor(models: ConstructorParameters<typeof MockLlmClient>[0]) {
    this.inner = new MockLlmClient(models);
  }
  async complete(task: Parameters<LlmClient["complete"]>[0], messages: Parameters<LlmClient["complete"]>[1]) {
    if (task === "EXEC_NARRATIVE") {
      this.calls += 1;
      if (this.failNarrative) throw new LlmError("down");
    }
    return this.inner.complete(task, messages);
  }
}

async function build() {
  const config = loadIntelligenceConfig({ INTELLIGENCE_AI_ENABLED: "true", INTELLIGENCE_AI_PROVIDER: "MOCK_AI" } as NodeJS.ProcessEnv);
  const store = await AnalyticalStore.open(":memory:");
  const llm = new CountingLlm(config.ai.models);
  const service = new IntelligenceService({ config, store, source: new MockHistoricalSource(config.fieldIds), llm, projectKey: "DEMO", now: () => NOW });
  const { runId } = await service.start({ type: "MONTHLY" }, { wait: true });
  return { service, ops: new OpsService(service), runId, llm };
}

test("ops: dashboard is local, honest about history, and reports are reused/versioned", async () => {
  const { ops, runId, llm } = await build();
  const dashboard = await ops.dashboard(runId);
  assert.ok(dashboard);
  assert.equal(llm.calls, 0);
  for (const item of dashboard.kpis) if (item.previous === null) assert.equal(item.change, null);
  assert.ok(dashboard.problems.every((problem) => problem.priority.badge !== "CRITICAL" || problem.priority.criticalRule));

  const first = (await ops.generateReports(runId))!;
  assert.equal(first.length, 5);
  assert.equal(llm.calls, 1);
  assert.ok(first.every((report) => report.version === 1));
  const second = (await ops.generateReports(runId))!;
  assert.ok(second.every((report) => report.status === "REUSED" && report.version === 1));
  assert.equal(llm.calls, 1);
  const forced = (await ops.generateReports(runId, { kinds: ["EXECUTIVE"], force: true }))!;
  assert.equal(forced[0]!.version, 2);
});

test("ops: narrative failure falls back to deterministic text without failing the report", async () => {
  const { ops, runId, llm } = await build();
  llm.failNarrative = true;
  const [executive] = (await ops.generateReports(runId, { kinds: ["EXECUTIVE"] }))!;
  assert.equal(executive!.status, "COMPLETED");
  const stored = await ops.getReport(runId, "EXECUTIVE");
  assert.ok((stored!.content as { narrativeSource: string }).narrativeSource !== "AI");
});

test("ops: recommendation state accepts only known states and history lists the run", async () => {
  const { ops, runId } = await build();
  await assert.rejects(() => ops.setRecommendationState(runId, "c", "r", "NOPE"));
  assert.ok((await ops.history()).length >= 1);
});

test("monthly scheduler prepares reports and a TOP_RCA proposal but never executes deep analysis", async () => {
  const config = loadIntelligenceConfig({ INTELLIGENCE_AI_ENABLED: "true", INTELLIGENCE_AI_PROVIDER: "MOCK_AI", INTELLIGENCE_AUTO_ANALYSIS_ENABLED: "true", INTELLIGENCE_AUTO_ANALYSIS_PERIOD: "MONTHLY" } as NodeJS.ProcessEnv);
  const store = await AnalyticalStore.open(":memory:");
  const llm = new CountingLlm(config.ai.models);
  const service = new IntelligenceService({ config, store, source: new MockHistoricalSource(config.fieldIds), llm, projectKey: "DEMO", now: () => NOW });
  assert.equal(await new IntelligenceScheduler(service).check(NOW), true);
  const run = (await service.listRuns())[0]!;
  assert.notEqual(run.analysis?.mode, "FULL_RCA");
  assert.notEqual(run.analysis?.mode, "TOP_RCA");
  assert.equal((await new OpsService(service).listReports(run.id))?.length, 5);
  const events = await service.events(run.id);
  assert.ok(events.some((event) => event.phase === "MONTHLY_ANALYSIS_STARTED") && events.some((event) => event.phase === "MONTHLY_ANALYSIS_COMPLETED"));
  assert.equal(await new IntelligenceScheduler(service).check(NOW), false);
});
test("scheduler: a simulated date analyzes the previous full month once, with limited AI mode", async () => {
  const config = loadIntelligenceConfig({ INTELLIGENCE_AI_ENABLED: "true", INTELLIGENCE_AI_PROVIDER: "MOCK_AI", INTELLIGENCE_AUTO_ANALYSIS_ENABLED: "true", INTELLIGENCE_AUTO_ANALYSIS_PERIOD: "MONTHLY" } as NodeJS.ProcessEnv);
  const store = await AnalyticalStore.open(":memory:");
  const service = new IntelligenceService({ config, store, source: new MockHistoricalSource(config.fieldIds), llm: new CountingLlm(config.ai.models), projectKey: "DEMO", now: () => NOW });
  const scheduler = new IntelligenceScheduler(service);
  assert.equal(await scheduler.check(new Date("2025-04-02T08:00:00Z")), true);
  const run = (await service.listRuns())[0]!;
  assert.deepEqual([run.from, run.to], ["2025-03-01", "2025-03-31"]);
  assert.ok(["SUMMARY", "RECURRENCE"].includes(run.analysis?.mode ?? ""));
  assert.equal(await scheduler.check(new Date("2025-04-02T20:00:00Z")), false, "no repite el mes ya analizado");
  assert.equal((await service.lookup({ type: "MONTHLY", month: "2025-03" })).state, "REUSABLE");
});

test("review: verdicts are validated, append-only and summarized without calling it AI accuracy", async () => {
  const { service, ops, runId } = await build();
  await ops.generateReports(runId);
  const { store } = service.internals;
  await store.run(`INSERT INTO rootcause_candidates (id, run_id, cluster_id, title, level, confidence) VALUES ('c1', ?, 'k1', 't', 'OBSERVED_PATTERN', 0.4)`, [runId]);
  const reviews = new ReviewService(service);
  await assert.rejects(() => reviews.submit(runId, "k1", "c1", { verdict: "MAYBE", reviewer: "ana" }), ReviewError);
  await assert.rejects(() => reviews.submit(runId, "k1", "c1", { verdict: "REJECTED", reviewer: "ana" }), ReviewError, "rechazar exige comentario");
  await assert.rejects(() => reviews.submit(runId, "k1", "missing", { verdict: "VALIDATED", reviewer: "ana" }), ReviewError);
  await reviews.submit(runId, "k1", "c1", { verdict: "NEEDS_MORE_EVIDENCE", reviewer: "ana", comment: "faltan logs" });
  await reviews.submit(runId, "k1", "c1", { verdict: "PARTIALLY_VALIDATED", reviewer: "luis", comment: "" });
  assert.equal((await reviews.list(runId)).length, 1);
  assert.equal((await reviews.list(runId, { history: true })).length, 2);
  const metrics = await reviews.metrics(runId);
  assert.equal(metrics.candidatesReviewed, 1);
  assert.equal(metrics.partiallyValidated, 1);
  assert.equal(metrics.acceptanceRate, 0);
  assert.equal(metrics.acceptanceOrPartialRate, 100);
  assert.ok(!/accuracy/i.test(JSON.stringify(Object.keys(metrics))));
});
