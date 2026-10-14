import assert from "node:assert/strict";
import { test } from "node:test";

import { ClusterAnalyzer } from "../../src/intelligence/ai/analysis.js";
import { LlmError, MockLlmClient, type LlmClient } from "../../src/intelligence/ai/llm.js";
import { AnalyticalStore } from "../../src/intelligence/analytical-store.js";
import { loadIntelligenceConfig } from "../../src/intelligence/config.js";
import { RolePipeline, type RoleCache } from "../../src/intelligence/deep/pipeline.js";
import { selectRoles } from "../../src/intelligence/deep/roles.js";
import { segmentCluster } from "../../src/intelligence/deep/segmentation.js";
import { IntelligenceService } from "../../src/intelligence/service.js";
import { MockHistoricalSource } from "../../src/intelligence/source.js";
import type { CanonicalUnit, ClusterResult } from "../../src/intelligence/types.js";

const config = loadIntelligenceConfig({ INTELLIGENCE_AI_ENABLED: "true", INTELLIGENCE_AI_PROVIDER: "MOCK_AI" } as NodeJS.ProcessEnv);

const unit = (key: string, extra: { summary?: string; error?: string; close?: string; service?: string; description?: string } = {}): CanonicalUnit => {
  const root = { jiraKey: key, summary: extra.summary ?? "Error al causar contratos", description: extra.description ?? "", errorMessage: extra.error ?? "", closeMessage: extra.close ?? "", comments: [], version: "v1" };
  return { canonicalKey: key, root, children: [], periodDate: "2025-06-01", service: extra.service ?? "Contratos", team: "T", classification: "C", errorMessage: extra.error ?? "", closeMessage: extra.close ?? "", errorUseful: Boolean(extra.error), closed: true, reopened: false, totalHours: 1 } as unknown as CanonicalUnit;
};

const clusterOf = (units: CanonicalUnit[], extra: Partial<ClusterResult> = {}): ClusterResult =>
  ({ id: "cl_test", title: "Errores al causar contratos", topTerms: ["contratos"], service: "Contratos", lowConfidence: false, failureGroups: [], members: units.map((item) => ({ canonicalKey: item.canonicalKey, similarity: 0.9, representative: false })), ...extra }) as unknown as ClusterResult;

const dbUnits = (count: number, offset = 0) => Array.from({ length: count }, (_, i) => unit(`DB-${offset + i}`, { error: `ORA-00001 unique constraint violated en contrato ${offset + i}`, close: `Se depuró el registro duplicado ${offset + i}` }));
const timeoutUnits = (count: number) => Array.from({ length: count }, (_, i) => unit(`TO-${i}`, { error: `Timeout al consultar el servicio de contratos ${i}`, close: `Se reinició el servicio ${i}` }));
const mapOf = (units: CanonicalUnit[]) => new Map(units.map((item) => [item.canonicalKey, item]));

type Json = Record<string, unknown>;
interface Evidence { id: string; jiraKey: string; field: string; snippet: string; failureGroupId?: string }

/** Scripted model: tests decide what each role and the validator answer. */
class Scripted implements LlmClient {
  readonly provider = "SCRIPTED";
  readonly calls: string[] = [];
  constructor(private readonly script: { role?: (task: string, payload: Json) => Json | Error; validate?: (claims: { id: string }[]) => Json | Error } = {}) {}
  async complete(task: Parameters<LlmClient["complete"]>[0], messages: Parameters<LlmClient["complete"]>[1]) {
    this.calls.push(task);
    const payload = JSON.parse(messages.at(-1)!.content) as Json;
    let json: Json | Error;
    if (task === "VALIDATE") json = this.script.validate ? this.script.validate((payload.claims as { id: string }[]) ?? []) : { verdicts: ((payload.claims as { id: string }[]) ?? []).map((claim) => ({ claimId: claim.id, verdict: "SUPPORTED", action: "ACCEPT", reason: "ok" })) };
    else if (task === "LABEL") json = { title: "Errores de contratos", description: "Casos de contratos." };
    else json = (this.script.role ?? defaultRole)(task, payload);
    if (json instanceof Error) throw json;
    return { json, model: `m-${task}`, durationMs: 5 };
  }
  count(prefix: string) {
    return this.calls.filter((call) => call.startsWith(prefix)).length;
  }
}

const groups = (payload: Json) => payload.failureGroups as { id: string; kind: string; signature: string }[];
const evidenceOf = (payload: Json) => payload.evidence as Evidence[];

function claimFor(payload: Json, group: { id: string }, text: string, level = "LIKELY_CAUSE", id = "c1") {
  const item = evidenceOf(payload).find((entry) => entry.failureGroupId === group.id && entry.field === "errorMessage")!;
  return { id, claim: text, failureGroupId: group.id, level, confidence: 0.8, evidence: [{ jiraKey: item.jiraKey, field: "errorMessage", excerpt: item.snippet.slice(0, 30) }], limitations: [] };
}

function defaultRole(_task: string, payload: Json): Json {
  const modes = groups(payload).filter((group) => group.kind === "FAILURE_MODE");
  return {
    clusterSummary: "Resumen del rol",
    claims: modes.map((group, index) => claimFor(payload, group, `El grupo ${group.signature} repite el mismo error de base de datos`, "LIKELY_CAUSE", `c${index + 1}`)),
    recommendations: modes.slice(0, 1).map(() => ({ action: "Revisar la restricción única del contrato", rationale: "Se repite", owner: "DEV", priority: "HIGH", relatedClaimIds: ["c1"] })),
    missingInformation: [],
  };
}

const pipelineOf = (llm: LlmClient, cache?: RoleCache, overrides: Record<string, string> = {}) => {
  const cfg = overrides ? loadIntelligenceConfig({ INTELLIGENCE_AI_ENABLED: "true", INTELLIGENCE_AI_PROVIDER: "MOCK_AI", ...overrides } as NodeJS.ProcessEnv) : config;
  return new RolePipeline(llm, cfg, new ClusterAnalyzer(llm, cfg), cache);
};
const memoryCache = (): RoleCache & { store: Map<string, unknown> } => {
  const store = new Map<string, unknown>();
  return { store, get: async (key) => store.get(key), put: async (key, value) => void store.set(key, value) };
};

test("segmentation: separates failure modes, keeps rare signatures as outliers and does not force sub-groups", () => {
  const units = [...dbUnits(8), ...timeoutUnits(5), unit("RARE-1", { error: "HTTP 503 service error", summary: "Otro" })];
  const seg = segmentCluster(clusterOf(units), units);
  const signatures = seg.groups.map((group) => group.signature).sort();
  assert.deepEqual(signatures, ["DB_ERROR", "TIMEOUT"]);
  assert.equal(seg.mixed, true);
  assert.deepEqual(seg.outliers, ["RARE-1"]);
  assert.ok(seg.groups.every((group) => group.members.length >= 2));

  const plain = [unit("P-1"), unit("P-2"), unit("P-3")];
  const single = segmentCluster(clusterOf(plain), plain);
  assert.equal(single.groups.length, 1);
  assert.equal(single.groups[0].kind, "UNSPECIFIED");
  assert.equal(single.mixed, false);
});

test("segmentation: cases of another service are flagged POSSIBLE_RECLASSIFICATION and not analyzed here", () => {
  const units = [...dbUnits(3), unit("FOREIGN-1", { service: "Facturación", error: "ORA-00001 otro" })];
  const seg = segmentCluster(clusterOf(units), units);
  assert.equal(seg.reclassifications.length, 1);
  assert.equal(seg.reclassifications[0].status, "POSSIBLE_RECLASSIFICATION");
  assert.ok(!seg.groups.flatMap((group) => group.members).includes("FOREIGN-1"));
});

test("roles: selected from the evidence and every skipped role is explained", () => {
  const dbOnly = dbUnits(4);
  const picked = selectRoles(dbOnly, segmentCluster(clusterOf(dbOnly), dbOnly));
  assert.ok(picked.selected.some((entry) => entry.role === "FAILURE") && picked.selected.some((entry) => entry.role === "TECHNICAL"));
  const infra = picked.skipped.find((entry) => entry.role === "INFRA");
  assert.ok(infra && infra.reason.length > 10, "infraestructura omitida sin señales, con razón");
  const slow = timeoutUnits(4);
  assert.ok(selectRoles(slow, segmentCluster(clusterOf(slow), slow)).selected.some((entry) => entry.role === "INFRA"));
});

test("evidence: <=20 cases all represented; >20 stratified; items are fingerprinted and error text is not truncated", async () => {
  const llm = new Scripted();
  const small = [...dbUnits(8), ...timeoutUnits(6)];
  const a = (await pipelineOf(llm).analyze(clusterOf(small), mapOf(small)));
  assert.equal(a.deep!.evidence.casesRepresented, 14);
  assert.equal(a.deep!.evidence.sampled, false);
  assert.ok(a.evidence.every((item) => item.fingerprint?.length === 16));

  const long = unit("LONG-1", { error: `ORA-00001 ${"detalle ".repeat(120)}fin-del-mensaje`, close: "ok" });
  const withLong = [long, ...dbUnits(3, 100)];
  const b = await pipelineOf(new Scripted()).analyze(clusterOf(withLong), mapOf(withLong));
  assert.ok(b.evidence.some((item) => item.jiraKey === "LONG-1" && item.snippet.endsWith("fin-del-mensaje")));

  const big = [...dbUnits(30), ...timeoutUnits(20)];
  const c = await pipelineOf(new Scripted()).analyze(clusterOf(big), mapOf(big));
  assert.equal(c.deep!.evidence.sampled, true);
  assert.equal(c.deep!.evidence.totalCases, 50);
  assert.ok(c.deep!.evidence.casesRepresented <= 20 && c.deep!.evidence.casesRepresented > 0);
  assert.ok(c.deep!.limitations.some((text) => text.includes("muestra estratificada")));
});

test("pipeline: role claims are verified, validated, consolidated across roles and traceable", async () => {
  const units = [...dbUnits(6), ...timeoutUnits(4)];
  const llm = new Scripted();
  const result = await pipelineOf(llm).analyze(clusterOf(units), mapOf(units));
  assert.equal(result.status, "COMPLETED");
  const deep = result.deep!;
  assert.ok(deep.counts.raw >= 2 && deep.counts.verified === deep.counts.raw);
  assert.equal(llm.count("ROLE_"), deep.roles.selected.length, "una llamada por rol seleccionado");
  assert.equal(llm.count("VALIDATE"), 1, "una sola validación por cluster");
  assert.ok(deep.findings.some((finding) => finding.roles.length >= 2), "afirmaciones equivalentes se consolidan entre roles");
  assert.ok(deep.findings.length < deep.counts.verified);
  assert.ok(deep.findings.every((finding) => finding.evidence.length > 0));
  assert.ok(result.candidates.every((candidate) => candidate.level !== "CONFIRMED_CAUSE"));
  assert.ok(deep.roleRuns.every((run) => run.promptVersion && (run.status === "SKIPPED" || run.evidenceHash)));
  assert.ok(deep.recommendations.length > 0 && deep.recommendations.every((rec) => (rec.findingIds?.length ?? 0) > 0));
});

test("citations: a claim with an invented excerpt never reaches the findings", async () => {
  const units = dbUnits(6);
  const llm = new Scripted({ role: (_task, payload) => ({ clusterSummary: "x", claims: [{ ...claimFor(payload, groups(payload)[0], "Causa inventada"), evidence: [{ jiraKey: "DB-0", field: "errorMessage", excerpt: "texto que jamás existió en Jira" }] }], recommendations: [], missingInformation: [] }) });
  const result = await pipelineOf(llm).analyze(clusterOf(units), mapOf(units));
  assert.equal(result.deep!.findings.length, 0);
  assert.ok(result.dropped.length > 0);
  assert.equal(result.candidates[0].status, "INSUFFICIENT_EVIDENCE_FOR_RCA");
});

test("validator: UNSUPPORTED is rejected, PARTIALLY_SUPPORTED is capped to HYPOTHESIS, CONTRADICTED creates CONFLICTING_EVIDENCE", async () => {
  const units = dbUnits(6);
  const roleScript = (text: string, id: string) => (_task: string, payload: Json) => ({ clusterSummary: "x", claims: [claimFor(payload, groups(payload)[0], text, "LIKELY_CAUSE", id)], recommendations: [], missingInformation: [] });

  const partial = await pipelineOf(new Scripted({ role: roleScript("Causa A", "c1"), validate: (claims) => ({ verdicts: claims.map((claim) => ({ claimId: claim.id, verdict: "PARTIALLY_SUPPORTED", action: "REVISE", reason: "solo el síntoma" })) }) })).analyze(clusterOf(units), mapOf(units));
  assert.ok(partial.deep!.findings.length > 0 && partial.deep!.findings.every((finding) => finding.level === "HYPOTHESIS" || finding.level === "OBSERVED_PATTERN"));

  const rejected = await pipelineOf(new Scripted({ role: roleScript("Causa B", "c1"), validate: (claims) => ({ verdicts: claims.map((claim) => ({ claimId: claim.id, verdict: "UNSUPPORTED", action: "REJECT", reason: "no" })) }) })).analyze(clusterOf(units), mapOf(units));
  assert.equal(rejected.deep!.findings.length, 0);
  assert.ok(rejected.deep!.counts.rejected > 0);
  assert.equal(rejected.candidates[0].status, "INSUFFICIENT_EVIDENCE_FOR_RCA");

  let flip = 0;
  const conflict = await pipelineOf(new Scripted({
    role: (task, payload) => (task === "ROLE_FAILURE" ? { clusterSummary: "x", claims: [claimFor(payload, groups(payload)[0], "El error es un problema de datos duplicados", "HYPOTHESIS", "c1"), claimFor(payload, groups(payload)[0], "La falla proviene exclusivamente de red", "HYPOTHESIS", "c2")], recommendations: [], missingInformation: [] } : { clusterSummary: "y", claims: [], recommendations: [], missingInformation: [] }),
    validate: (claims) => ({ verdicts: claims.map((claim) => ({ claimId: claim.id, verdict: flip++ === 0 ? "SUPPORTED" : "CONTRADICTED", action: flip === 1 ? "ACCEPT" : "REJECT", reason: "r" })) }),
  })).analyze(clusterOf(units), mapOf(units));
  assert.ok(conflict.deep!.findings.some((finding) => finding.status === "CONFLICTING_EVIDENCE"));
  assert.ok(conflict.candidates.some((candidate) => candidate.status === "CONFLICTING_EVIDENCE"));
});

test("unspecified groups are capped to OBSERVED_PATTERN and unclustered signal stays visible as outliers", async () => {
  const units = [unit("U-1"), unit("U-2"), unit("U-3")];
  const llm = new Scripted({ role: (_task, payload) => ({ clusterSummary: "x", claims: [{ id: "c1", claim: "Los casos describen la misma solicitud", failureGroupId: groups(payload)[0].id, level: "LIKELY_CAUSE", confidence: 0.9, evidence: [{ jiraKey: "U-1", field: "summary", excerpt: "Error al causar contratos" }], limitations: [] }], recommendations: [], missingInformation: [] }) });
  const result = await pipelineOf(llm).analyze(clusterOf(units), mapOf(units));
  assert.ok(result.deep!.findings.every((finding) => finding.level === "OBSERVED_PATTERN"));
  assert.ok(result.candidates.every((candidate) => candidate.level === "OBSERVED_PATTERN"));
});

test("failures: a failing role gives PARTIAL, a failing validator keeps claims capped, no role gives FAILED", async () => {
  const units = [...dbUnits(6), ...timeoutUnits(4)];
  const oneRoleDown = await pipelineOf(new Scripted({ role: (task, payload) => (task === "ROLE_TECHNICAL" ? new LlmError("TIMEOUT", "slow") : defaultRole(task, payload)) })).analyze(clusterOf(units), mapOf(units));
  assert.equal(oneRoleDown.status, "PARTIAL");
  assert.ok(oneRoleDown.deep!.roleRuns.some((run) => run.role === "TECHNICAL" && run.status === "FAILED" && run.attempts === 2), "reintento acotado");
  assert.ok(oneRoleDown.deep!.findings.length > 0, "se conserva lo que sí se completó");

  const noValidator = await pipelineOf(new Scripted({ validate: () => new LlmError("TIMEOUT", "slow") })).analyze(clusterOf(units), mapOf(units));
  assert.equal(noValidator.status, "PARTIAL");
  assert.ok(noValidator.deep!.findings.every((finding) => finding.level !== "LIKELY_CAUSE"));

  const down: LlmClient = { provider: "DOWN", complete: async (task) => { if (task === "LABEL") return { json: { title: "t", description: "d" }, model: "m", durationMs: 1 }; throw new LlmError("UNAVAILABLE", "down"); } };
  const dead = await pipelineOf(down).analyze(clusterOf(units), mapOf(units));
  assert.equal(dead.status, "FAILED");
});

test("reuse: results are reused per role and only the role whose model changed is recomputed", async () => {
  const units = [...dbUnits(6), ...timeoutUnits(4)];
  const cache = memoryCache();
  const first = new Scripted();
  await pipelineOf(first, cache).analyze(clusterOf(units), mapOf(units));
  const roleCalls = first.count("ROLE_");
  assert.ok(roleCalls >= 2);

  const second = new Scripted();
  const again = await pipelineOf(second, cache).analyze(clusterOf(units), mapOf(units));
  assert.equal(second.count("ROLE_"), 0, "ningún rol vuelve a llamar a la IA");
  assert.equal(second.count("VALIDATE"), 0);
  assert.equal(again.deep!.counts.reusedRoles, roleCalls + 1);
  assert.ok(again.deep!.roleRuns.filter((run) => run.status === "REUSED").length === roleCalls);

  const third = new Scripted();
  await pipelineOf(third, cache, { INTELLIGENCE_AI_MODEL_TECHNICAL: "otro-modelo" }).analyze(clusterOf(units), mapOf(units));
  assert.equal(third.count("ROLE_TECHNICAL"), 1, "solo el rol con otro modelo se recalcula");
  assert.equal(third.count("ROLE_FAILURE"), 0);
});

test("service: TOP_RCA persists the audit trail per role and SUMMARY/RECURRENCE never run roles", async () => {
  const NOW = new Date("2025-06-15T12:00:00Z");
  const cfg = loadIntelligenceConfig({ INTELLIGENCE_AI_ENABLED: "true", INTELLIGENCE_AI_PROVIDER: "MOCK_AI" } as NodeJS.ProcessEnv);
  const store = await AnalyticalStore.open(":memory:");
  const calls: string[] = [];
  const inner = new MockLlmClient(cfg.ai.models);
  const llm: LlmClient = { provider: "SPY", complete: (task, messages) => (calls.push(task), inner.complete(task, messages)) };
  const service = new IntelligenceService({ config: cfg, store, source: new MockHistoricalSource(cfg.fieldIds), llm, projectKey: "DEMO", now: () => NOW });
  const settle = async () => { while (service.activeRun) await new Promise((resolve) => setTimeout(resolve, 20)); };
  const { runId } = await service.start({ type: "MONTHLY" }, { wait: true });

  await service.analyze(runId, { mode: "SUMMARY" }, { wait: true });
  await service.analyze(runId, { mode: "RECURRENCE" }, { wait: true });
  await settle();
  assert.equal(calls.filter((task) => task.startsWith("ROLE_") || task === "VALIDATE").length, 0);

  await service.analyze(runId, { mode: "TOP_RCA" }, { wait: true });
  await settle();
  assert.ok(calls.some((task) => task.startsWith("ROLE_")));
  const roleRuns = await store.query(`SELECT DISTINCT cluster_id FROM role_runs WHERE run_id = ?`, [runId]);
  assert.ok(roleRuns.length > 0 && roleRuns.length <= 3);
  const clusterId = String(roleRuns[0].cluster_id);
  const detail = (await service.clusterDetail(runId, clusterId))!;
  assert.ok(detail.deep && detail.deep.roleRuns.length > 0 && detail.deep.roleRuns.every((run) => !("response" in run)));
  const stored = await store.query(`SELECT COUNT(*) AS n FROM analysis_failure_groups WHERE run_id = ?`, [runId]);
  assert.ok(Number(stored[0].n) > 0);
  assert.ok(detail.candidates.every((candidate) => ["CANDIDATE", "INSUFFICIENT_EVIDENCE_FOR_RCA", "CONFLICTING_EVIDENCE"].includes(candidate.status)));

  const spent = calls.length;
  await service.analyze(runId, { mode: "TOP_RCA" }, { wait: true });
  assert.equal(calls.length, spent, "una repetición no gasta IA");
});
