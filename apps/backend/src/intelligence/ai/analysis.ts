import { buildSourceIndex, selectEvidence } from "../evidence.js";
import type { IntelligenceConfig } from "../config.js";
import type { CanonicalUnit, Claim, ClusterResult, EvidenceItem, Recommendation, RootCauseCandidate } from "../types.js";
import { applyGuardrails, consolidateClaims, parseAnalysis, parseVerdicts, toCandidates, verifyClaims } from "./claims.js";
import { LlmError, type ChatMessage, type LlmClient } from "./llm.js";

const SYSTEM_ANALYZE = `Eres un analista de soporte que estudia un grupo de casos de Jira ya agrupados por similitud.
Reglas estrictas:
- Responde solo JSON con {"clusterSummary": string, "claims": [...], "recommendations": [...]}.
- Cada claim: {"id","claim","failureGroupId","level","confidence","evidence":[{"evidenceId","jiraKey","field","excerpt"}],"limitations":[]}.
- level solo puede ser OBSERVED_PATTERN, HYPOTHESIS o LIKELY_CAUSE. Nunca declares una causa confirmada.
- excerpt debe ser un fragmento LITERAL copiado del campo citado. No parafrasees ni inventes.
- Usa solo la evidencia entregada. Si no alcanza para una causa, reporta el patrón observado o una hipótesis y explica la limitación.
- Analiza cada failureGroup por separado; no unas modos de falla distintos bajo una sola causa.
- Las recomendaciones son acciones de investigación, separadas de las causas.`;

const SYSTEM_VALIDATE = `Eres un revisor independiente. Para cada claim indica si las citas respaldan lo afirmado.
Responde solo JSON: {"verdicts":[{"claimId","verdict":"SUPPORTED"|"UNSUPPORTED","reason"}]}. Sé estricto: si la cita solo muestra el síntoma y no la causa, UNSUPPORTED.`;

const SYSTEM_LABEL = `Nombra un grupo de casos de soporte. Responde solo JSON {"title": string (máx. 8 palabras), "description": string (una frase)}. Describe el síntoma, no inventes causas.`;

const SYSTEM_SUMMARY = `Redacta un resumen ejecutivo breve (máx. 120 palabras) en español usando SOLO las cifras entregadas en metrics. No calcules ni inventes números ni causas.
Responde solo JSON {"narrative": string, "highlights": string[]}.`;

const messages = (system: string, payload: unknown): ChatMessage[] => [
  { role: "system", content: system },
  { role: "user", content: JSON.stringify(payload) },
];

export interface ClusterAnalysis {
  clusterId: string;
  label?: { title: string; description: string };
  summary: string;
  candidates: RootCauseCandidate[];
  recommendations: Recommendation[];
  claims: Claim[];
  evidence: EvidenceItem[];
  evidenceMeta: { totalCases: number; sentCases: number; sampled: boolean };
  dropped: { claimId: string; reason: string }[];
  invalidReferences: number;
  status: "COMPLETED" | "PARTIAL" | "FAILED" | "SKIPPED";
  error?: string;
  deep?: import("../deep/pipeline.js").DeepDetail;
  calls: { task: string; model: string; durationMs: number; ok: boolean; error?: string }[];
}

export class ClusterAnalyzer {
  constructor(
    private readonly llm: LlmClient,
    private readonly config: IntelligenceConfig,
  ) {}

  async analyze(cluster: ClusterResult, units: Map<string, CanonicalUnit>): Promise<ClusterAnalysis> {
    const members = cluster.members.map((member) => units.get(member.canonicalKey)).filter((unit): unit is CanonicalUnit => Boolean(unit));
    const selection = selectEvidence(cluster, units, this.config);
    const result: ClusterAnalysis = {
      clusterId: cluster.id,
      summary: "",
      candidates: [],
      recommendations: [],
      claims: [],
      evidence: selection.items,
      evidenceMeta: { totalCases: selection.totalCases, sentCases: selection.sentCases, sampled: selection.sampled },
      dropped: [],
      invalidReferences: 0,
      status: "COMPLETED",
      calls: [],
    };
    const call = async (task: "LABEL" | "ANALYZE" | "VALIDATE", system: string, payload: unknown) => {
      try {
        const response = await this.llm.complete(task, messages(system, payload));
        result.calls.push({ task, model: response.model, durationMs: response.durationMs, ok: true });
        return response.json;
      } catch (error) {
        result.calls.push({ task, model: this.config.ai.models[task], durationMs: 0, ok: false, error: error instanceof LlmError ? error.kind : "ERROR" });
        throw error;
      }
    };

    try {
      const label = (await call("LABEL", SYSTEM_LABEL, { cluster: { id: cluster.id, topTerms: cluster.topTerms, service: cluster.service }, samples: members.slice(0, 6).map((unit) => unit.root.summary) }).catch(() => undefined)) as { title?: unknown; description?: unknown } | undefined;
      if (typeof label?.title === "string" && label.title.trim()) result.label = { title: label.title.trim().slice(0, 120), description: String(label.description ?? "").slice(0, 300) };

      const raw = await call("ANALYZE", SYSTEM_ANALYZE, {
        cluster: { id: cluster.id, title: cluster.title, topTerms: cluster.topTerms, size: cluster.members.length, service: cluster.service, lowConfidence: cluster.lowConfidence },
        failureGroups: cluster.failureGroups.map((group) => ({ id: group.id, signature: group.signature, label: group.label, cases: group.members.length, percentage: group.percentage, signals: group.signals })),
        evidence: selection.items,
      });
      const parsed = parseAnalysis(raw);
      const index = buildSourceIndex(members);
      const keys = new Set(members.flatMap((unit) => [unit.root.jiraKey, ...unit.children.map((child) => child.jiraKey)]));
      const verified = verifyClaims(parsed.claims, index, keys);
      result.dropped = verified.dropped;
      result.invalidReferences = verified.invalidReferences;

      const approved = new Set<string>();
      if (this.config.ai.validationEnabled && verified.claims.length) {
        try {
          const verdicts = parseVerdicts(await call("VALIDATE", SYSTEM_VALIDATE, { claims: verified.claims.map((claim) => ({ id: claim.id, claim: claim.claim, level: claim.level, evidence: claim.evidence })) }));
          for (const [id, verdict] of verdicts) if (verdict.verdict === "SUPPORTED") approved.add(id);
        } catch {
          /* The reviewer is optional: without it claims stay capped at LIKELY_CAUSE. */
        }
      }
      const guarded = consolidateClaims(applyGuardrails(verified.claims, { cluster, units, approved }));
      result.claims = guarded;
      result.summary = parsed.clusterSummary;
      result.recommendations = parsed.recommendations;
      result.candidates = toCandidates(cluster, guarded, parsed.recommendations, units);
    } catch (error) {
      result.status = "FAILED";
      result.error = error instanceof LlmError ? `${error.kind}: ${error.message}` : (error as Error).message;
    }
    return result;
  }

  /** Names a cluster without running the root-cause pipeline (one cheap call). */
  async labelOnly(cluster: ClusterResult, units: Map<string, CanonicalUnit>): Promise<ClusterAnalysis> {
    const members = cluster.members.map((member) => units.get(member.canonicalKey)).filter((unit): unit is CanonicalUnit => Boolean(unit));
    const result: ClusterAnalysis = { clusterId: cluster.id, summary: "", candidates: [], recommendations: [], claims: [], evidence: [], evidenceMeta: { totalCases: members.length, sentCases: 0, sampled: false }, dropped: [], invalidReferences: 0, status: "COMPLETED", calls: [] };
    try {
      const response = await this.llm.complete("LABEL", messages(SYSTEM_LABEL, { cluster: { id: cluster.id, topTerms: cluster.topTerms, service: cluster.service }, samples: members.slice(0, 6).map((unit) => unit.root.summary) }));
      result.calls.push({ task: "LABEL", model: response.model, durationMs: response.durationMs, ok: true });
      const label = response.json as { title?: unknown; description?: unknown };
      if (typeof label?.title !== "string" || !label.title.trim()) throw new LlmError("INVALID_RESPONSE", "Respuesta sin título");
      result.label = { title: label.title.trim().slice(0, 120), description: String(label.description ?? "").slice(0, 300) };
    } catch (error) {
      if (!result.calls.length) result.calls.push({ task: "LABEL", model: this.config.ai.models.LABEL, durationMs: 0, ok: false, error: error instanceof LlmError ? error.kind : "ERROR" });
      result.status = "FAILED";
      result.error = error instanceof LlmError ? `${error.kind}: ${error.message}` : (error as Error).message;
    }
    return result;
  }

  async summarize(metrics: Record<string, unknown>): Promise<{ narrative: string; highlights: string[]; model?: string } | undefined> {
    try {
      const response = await this.llm.complete("SUMMARY", messages(SYSTEM_SUMMARY, { metrics }));
      const body = response.json as { narrative?: unknown; highlights?: unknown };
      if (typeof body.narrative !== "string" || !body.narrative.trim()) return undefined;
      return { narrative: body.narrative.trim().slice(0, 1200), highlights: Array.isArray(body.highlights) ? body.highlights.map(String).slice(0, 6) : [], model: response.model };
    } catch {
      return undefined;
    }
  }
}
