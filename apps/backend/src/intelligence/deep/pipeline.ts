import { redactSecrets } from "../canonical.js";
import { LlmError, type ChatMessage, type LlmClient } from "../ai/llm.js";
import { parseAnalysis } from "../ai/claims.js";
import { applyGuardrails } from "../ai/claims.js";
import type { ClusterAnalysis, ClusterAnalyzer } from "../ai/analysis.js";
import { ANALYST_PIPELINE_VERSION, EVIDENCE_VERSION, ROLE_PROMPT_VERSIONS, SEGMENTATION_VERSION, type IntelligenceConfig } from "../config.js";
import { buildSourceIndex, selectEvidence } from "../evidence.js";
import { sha } from "../lifecycle.js";
import type { CanonicalUnit, Claim, ClusterResult, EvidenceItem, Recommendation } from "../types.js";
import { verifyClaims } from "../ai/claims.js";
import { applyChecks, buildCandidates, buildRecommendations, consolidate, dataQuality, parseClaimChecks, type ClaimCheck, type DataQualityFinding, type Finding, type RoleClaim } from "./findings.js";
import { promptVersionOf, ROLES, rolePrompt, selectRoles, type RoleDefinition, type RoleId, type RoleSelection } from "./roles.js";
import { segmentCluster, type Segmentation } from "./segmentation.js";

export interface RoleCache {
  get(key: string): Promise<unknown | undefined>;
  put(key: string, value: unknown): Promise<void>;
}

export interface Hooks {
  event?: (level: "INFO" | "WARN" | "ERROR", phase: string, message: string) => Promise<void> | void;
  /** Ignores stored role results and calls the AI again (explicit user request only). */
  bypassCache?: boolean;
}

export type RoleRunStatus = "QUEUED" | "RUNNING" | "COMPLETED" | "REUSED" | "FAILED" | "SKIPPED";

export interface RoleRun {
  role: string;
  task: string;
  model: string;
  status: RoleRunStatus;
  reason?: string;
  attempts: number;
  durationMs: number;
  promptVersion: string;
  promptHash?: string;
  evidenceHash?: string;
  rawClaims: number;
  verifiedClaims: number;
  summary?: string;
  missingInformation: string[];
  response?: string;
  error?: string;
}

export interface DeepDetail {
  pipelineVersion: string;
  segmentationVersion: string;
  evidenceVersion: string;
  segmentation: { groups: Segmentation["groups"]; outliers: string[]; reclassifications: Segmentation["reclassifications"]; mixed: boolean };
  evidence: { hash: string; items: number; totalCases: number; casesRepresented: number; sampled: boolean };
  roles: RoleSelection;
  roleRuns: RoleRun[];
  validation: { status: RoleRunStatus; model: string; checks: ClaimCheck[]; durationMs: number; error?: string };
  counts: { raw: number; verified: number; validated: number; rejected: number; contradicted: number; reusedRoles: number; ranRoles: number };
  rejected: { claimId: string; role: string; verdict: string; reason: string }[];
  findings: Finding[];
  recommendations: Recommendation[];
  dataQuality: DataQualityFinding[];
  limitations: string[];
  partial: boolean;
}

interface RoleResult {
  claims: RoleClaim[];
  recommendations: (Recommendation & { claimIdsRaw: string[] })[];
  summary: string;
  missing: string[];
  dropped: { claimId: string; reason: string }[];
  invalidReferences: number;
  raw: number;
  response: string;
}

const messages = (system: string, payload: unknown): ChatMessage[] => [
  { role: "system", content: system },
  { role: "user", content: JSON.stringify(payload) },
];

const SYSTEM_VALIDATE = `Eres un revisor independiente de afirmaciones sobre casos de soporte. Evalúa cada claim contra sus citas.
Responde solo JSON: {"verdicts":[{"claimId","verdict":"SUPPORTED"|"PARTIALLY_SUPPORTED"|"UNSUPPORTED"|"CONTRADICTED","action":"ACCEPT"|"REVISE"|"REJECT","reason"}]}.
- SUPPORTED: las citas muestran lo afirmado. PARTIALLY_SUPPORTED: muestran el síntoma pero no toda la afirmación (REVISE).
- UNSUPPORTED: las citas no sustentan la afirmación (REJECT). CONTRADICTED: las citas muestran lo contrario o el rol llegó a conclusiones opuestas (REJECT).
- Sé estricto: si la cita solo muestra el síntoma y no la causa, no es SUPPORTED.`;

const RETRYABLE = new Set(["TIMEOUT", "INVALID_RESPONSE", "HTTP_ERROR", "UNAVAILABLE"]);
const asStrings = (value: unknown, limit: number) => (Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").map((item) => item.trim().slice(0, 300)).filter(Boolean).slice(0, limit) : []);

export class RolePipeline {
  constructor(
    private readonly llm: LlmClient,
    private readonly config: IntelligenceConfig,
    private readonly analyzer: ClusterAnalyzer,
    private readonly cache?: RoleCache,
  ) {}

  async analyze(cluster: ClusterResult, units: Map<string, CanonicalUnit>, hooks: Hooks = {}): Promise<ClusterAnalysis> {
    const emit = async (level: "INFO" | "WARN" | "ERROR", phase: string, message: string) => void (await hooks.event?.(level, phase, `${cluster.id}: ${message}`));
    const members = cluster.members.map((member) => units.get(member.canonicalKey)).filter((unit): unit is CanonicalUnit => Boolean(unit));
    const segmentation = segmentCluster(cluster, members);
    const analyzableKeys = new Set(segmentation.groups.flatMap((group) => group.members).concat(segmentation.outliers));
    const analyzable = members.filter((unit) => analyzableKeys.has(unit.canonicalKey));
    const scoped: ClusterResult = { ...cluster, members: cluster.members.filter((member) => analyzableKeys.has(member.canonicalKey)), failureGroups: segmentation.groups };
    const selection = selectEvidence(scoped, units, this.config);
    const items: EvidenceItem[] = selection.items.map((item) => ({ ...item, fingerprint: sha([item.jiraKey, item.field, item.snippet]).slice(0, 16) }));
    const evidenceHash = sha(items.map((item) => item.fingerprint));
    const roles = selectRoles(analyzable, segmentation);
    await emit("INFO", "SEGMENTATION", `${segmentation.groups.length} grupo(s) de falla, ${segmentation.outliers.length} atípico(s), ${segmentation.reclassifications.length} posible(s) reclasificación(es)`);

    const result: ClusterAnalysis = {
      clusterId: cluster.id,
      summary: "",
      candidates: [],
      recommendations: [],
      claims: [],
      evidence: items,
      evidenceMeta: { totalCases: selection.totalCases, sentCases: selection.sentCases, sampled: selection.sampled },
      dropped: [],
      invalidReferences: 0,
      status: "COMPLETED",
      calls: [],
    };
    const detail: DeepDetail = {
      pipelineVersion: ANALYST_PIPELINE_VERSION,
      segmentationVersion: SEGMENTATION_VERSION,
      evidenceVersion: EVIDENCE_VERSION,
      segmentation: { groups: segmentation.groups, outliers: segmentation.outliers, reclassifications: segmentation.reclassifications, mixed: segmentation.mixed },
      evidence: { hash: evidenceHash, items: items.length, totalCases: selection.totalCases, casesRepresented: selection.sentCases, sampled: selection.sampled },
      roles,
      roleRuns: [],
      validation: { status: "SKIPPED", model: this.config.ai.models.VALIDATE, checks: [], durationMs: 0 },
      counts: { raw: 0, verified: 0, validated: 0, rejected: 0, contradicted: 0, reusedRoles: 0, ranRoles: 0 },
      rejected: [],
      findings: [],
      recommendations: [],
      dataQuality: dataQuality(analyzable, segmentation, selection),
      limitations: [],
      partial: false,
    };
    result.deep = detail;

    const label = await this.analyzer.labelOnly(cluster, units);
    result.calls.push(...label.calls);
    if (label.label) result.label = label.label;

    for (const skipped of roles.skipped) detail.roleRuns.push({ role: skipped.role, task: ROLES[skipped.role].task, model: this.config.ai.models[ROLES[skipped.role].task], status: "SKIPPED", reason: skipped.reason, attempts: 0, durationMs: 0, promptVersion: promptVersionOf(skipped.role), rawClaims: 0, verifiedClaims: 0, missingInformation: [] });

    const index = buildSourceIndex(analyzable);
    const memberKeys = new Set(analyzable.flatMap((unit) => [unit.root.jiraKey, ...unit.children.map((child) => child.jiraKey)]));
    const groupIds = new Set(segmentation.groups.map((group) => group.id));
    const unspecified = new Set(segmentation.groups.filter((group) => group.kind === "UNSPECIFIED").map((group) => group.id));
    const payload = {
      cluster: { id: cluster.id, title: cluster.title, topTerms: cluster.topTerms, size: analyzable.length, service: cluster.service, lowConfidence: cluster.lowConfidence },
      failureGroups: segmentation.groups.map((group) => ({ id: group.id, signature: group.signature, label: group.label, kind: group.kind, cases: group.members.length, percentage: group.percentage, signals: group.signals, confidence: group.confidence })),
      outliers: segmentation.outliers.length,
      evidence: items,
    };

    const runRole = async (selected: { role: RoleId; reason: string }): Promise<{ run: RoleRun; result?: RoleResult }> => {
      const definition = ROLES[selected.role];
      const system = rolePrompt(definition);
      const model = this.config.ai.models[definition.task];
      const base: RoleRun = { role: definition.id, task: definition.task, model, status: "QUEUED", reason: selected.reason, attempts: 0, durationMs: 0, promptVersion: promptVersionOf(definition.id), promptHash: sha(system).slice(0, 16), evidenceHash, rawClaims: 0, verifiedClaims: 0, missingInformation: [] };
      const key = sha({ kind: "ROLE", role: definition.id, evidence: evidenceHash, groups: segmentation.groups.map((group) => [group.id, group.kind]), prompt: base.promptVersion, promptHash: base.promptHash, model, pipeline: ANALYST_PIPELINE_VERSION });
      const hit = hooks.bypassCache ? undefined : ((await this.cache?.get(key)) as RoleResult | undefined);
      if (hit) {
        await emit("INFO", "AI_ROLE_REUSED", `${definition.id}: resultado existente reutilizado`);
        return { run: { ...base, status: "REUSED", rawClaims: hit.raw, verifiedClaims: hit.claims.length, summary: hit.summary, missingInformation: hit.missing, response: hit.response }, result: hit };
      }
      await emit("INFO", "AI_ROLE_STARTED", `${definition.id} (${model})`);
      let lastError = "ERROR";
      for (let attempt = 1; attempt <= 1 + this.config.ai.roleRetries; attempt++) {
        base.attempts = attempt;
        try {
          const response = await this.llm.complete(definition.task, messages(system, payload));
          result.calls.push({ task: definition.task, model: response.model, durationMs: response.durationMs, ok: true });
          base.durationMs += response.durationMs;
          const parsed = parseAnalysis(response.json);
          const body = response.json as Record<string, unknown>;
          const claims = parsed.claims.map((claim): RoleClaim => ({ ...claim, id: `${definition.id}:${claim.id}`, role: definition.id, failureGroupId: claim.failureGroupId && groupIds.has(claim.failureGroupId) ? claim.failureGroupId : undefined }));
          const verified = verifyClaims(claims, index, memberKeys);
          const verifiedClaims = (verified.claims as RoleClaim[]).map((claim) => (claim.failureGroupId && unspecified.has(claim.failureGroupId) && claim.level !== "OBSERVED_PATTERN" ? { ...claim, level: "OBSERVED_PATTERN" as const, limitations: [...claim.limitations, "Grupo sin firma técnica común: solo se reporta el patrón observado."] } : claim));
          const recommendations = parsed.recommendations.map((rec, position) => {
            const entry = ((body.recommendations as Record<string, unknown>[] | undefined) ?? [])[position] ?? {};
            const priority = String(entry.priority ?? "").toUpperCase();
            return { ...rec, owner: typeof entry.owner === "string" ? entry.owner.slice(0, 60) : undefined, priority: (["HIGH", "MEDIUM", "LOW"].includes(priority) ? priority : undefined) as Recommendation["priority"], claimIdsRaw: rec.relatedClaimIds.map((id) => `${definition.id}:${id}`) };
          });
          const out: RoleResult = { claims: verifiedClaims, recommendations, summary: parsed.clusterSummary, missing: asStrings(body.missingInformation, 5), dropped: verified.dropped, invalidReferences: verified.invalidReferences, raw: claims.length, response: redactSecrets(JSON.stringify(response.json)).slice(0, 20000) };
          await this.cache?.put(key, out);
          await emit("INFO", "AI_ROLE_COMPLETED", `${definition.id}: ${claims.length} afirmación(es), ${verifiedClaims.length} con citas verificadas`);
          return { run: { ...base, status: "COMPLETED", rawClaims: out.raw, verifiedClaims: verifiedClaims.length, summary: out.summary, missingInformation: out.missing, response: out.response }, result: out };
        } catch (error) {
          lastError = error instanceof LlmError ? error.kind : "INVALID_RESPONSE";
          if (!(error instanceof LlmError)) result.calls.push({ task: definition.task, model, durationMs: 0, ok: false, error: lastError });
          else result.calls.push({ task: definition.task, model, durationMs: 0, ok: false, error: lastError });
          if (!(error instanceof LlmError) || RETRYABLE.has(error.kind)) continue;
          break;
        }
      }
      await emit("WARN", "AI_ROLE_FAILED", `${definition.id}: ${lastError}`);
      return { run: { ...base, status: "FAILED", error: lastError } };
    };

    const outcomes = await Promise.all(roles.selected.map(runRole));
    detail.roleRuns.push(...outcomes.map((outcome) => outcome.run));
    const results = outcomes.flatMap((outcome) => (outcome.result ? [{ role: outcome.run.role, result: outcome.result }] : []));
    detail.counts.reusedRoles = outcomes.filter((outcome) => outcome.run.status === "REUSED").length;
    detail.counts.ranRoles = outcomes.filter((outcome) => outcome.run.status === "COMPLETED").length;
    const failedRoles = outcomes.filter((outcome) => outcome.run.status === "FAILED");

    if (!results.length) {
      result.status = "FAILED";
      result.error = `Ningún rol completó el análisis (${failedRoles.map((outcome) => `${outcome.run.role}: ${outcome.run.error}`).join("; ")})`;
      detail.partial = true;
      return result;
    }

    const allClaims = results.flatMap((entry) => entry.result.claims);
    detail.counts.raw = results.reduce((sum, entry) => sum + entry.result.raw, 0);
    detail.counts.verified = allClaims.length;
    result.dropped = results.flatMap((entry) => entry.result.dropped);
    result.invalidReferences = results.reduce((sum, entry) => sum + entry.result.invalidReferences, 0);

    let checks: Map<string, ClaimCheck> | undefined;
    if (this.config.ai.validationEnabled && allClaims.length) {
      const validatePayload = { claims: allClaims.map((claim) => ({ id: claim.id, role: claim.role, claim: claim.claim, level: claim.level, failureGroupId: claim.failureGroupId, evidence: claim.evidence })) };
      const key = sha({ kind: "VALIDATE", claims: validatePayload, model: this.config.ai.models.VALIDATE, prompt: ROLE_PROMPT_VERSIONS.VALIDATE, pipeline: ANALYST_PIPELINE_VERSION });
      const hit = hooks.bypassCache ? undefined : ((await this.cache?.get(key)) as ClaimCheck[] | undefined);
      if (hit) {
        checks = new Map(hit.map((check) => [check.claimId, check]));
        detail.validation = { status: "REUSED", model: this.config.ai.models.VALIDATE, checks: hit, durationMs: 0 };
        detail.counts.reusedRoles++;
        await emit("INFO", "AI_ROLE_REUSED", "VALIDATOR: resultado existente reutilizado");
      } else {
        await emit("INFO", "AI_ROLE_STARTED", `VALIDATOR (${this.config.ai.models.VALIDATE})`);
        try {
          const response = await this.llm.complete("VALIDATE", messages(SYSTEM_VALIDATE, validatePayload));
          result.calls.push({ task: "VALIDATE", model: response.model, durationMs: response.durationMs, ok: true });
          checks = parseClaimChecks(response.json);
          detail.validation = { status: "COMPLETED", model: response.model, checks: [...checks.values()], durationMs: response.durationMs };
          await this.cache?.put(key, [...checks.values()]);
          await emit("INFO", "AI_ROLE_COMPLETED", `VALIDATOR: ${checks.size} veredicto(s)`);
        } catch (error) {
          const kind = error instanceof LlmError ? error.kind : "INVALID_RESPONSE";
          result.calls.push({ task: "VALIDATE", model: this.config.ai.models.VALIDATE, durationMs: 0, ok: false, error: kind });
          detail.validation = { status: "FAILED", model: this.config.ai.models.VALIDATE, checks: [], durationMs: 0, error: kind };
          await emit("WARN", "AI_ROLE_FAILED", `VALIDATOR: ${kind}`);
        }
      }
    }
    const validationFailed = this.config.ai.validationEnabled && allClaims.length > 0 && !checks;

    const outcome = applyChecks(allClaims, checks);
    detail.counts.validated = outcome.accepted.length;
    detail.counts.rejected = outcome.rejected.length;
    detail.counts.contradicted = outcome.contradicted.length;
    detail.rejected = outcome.rejected;
    const roleOf = new Map(outcome.accepted.map((claim) => [claim.id, claim.role]));
    const guarded: RoleClaim[] = applyGuardrails(outcome.accepted as Claim[], { cluster, units, approved: outcome.approved }).map((claim) => ({ ...claim, role: roleOf.get(claim.id) ?? "FAILURE" }));
    const findings = consolidate(guarded, outcome.contradicted);
    const recommendations = buildRecommendations(results.map((entry) => ({ role: entry.role, items: entry.result.recommendations })), findings);
    detail.findings = findings;
    detail.recommendations = recommendations;
    result.claims = guarded;
    result.recommendations = recommendations;
    result.candidates = buildCandidates(cluster, segmentation, findings, recommendations, units);
    result.summary = (results.find((entry) => entry.role === "FAILURE") ?? results[0]).result.summary;

    detail.limitations = [
      ...failedRoles.map((outcomeRole) => `El rol ${outcomeRole.run.role} falló (${outcomeRole.run.error}); el análisis es parcial.`),
      ...(validationFailed ? ["La validación semántica no estuvo disponible; las afirmaciones no pudieron elevarse por encima de HYPOTHESIS."] : []),
      ...(selection.sampled ? [`Evidencia basada en una muestra estratificada de ${selection.sentCases} de ${selection.totalCases} casos.`] : []),
    ];
    detail.partial = failedRoles.length > 0 || validationFailed;
    if (detail.partial) {
      result.status = "PARTIAL";
      result.error = detail.limitations[0];
    }
    return result;
  }
}
