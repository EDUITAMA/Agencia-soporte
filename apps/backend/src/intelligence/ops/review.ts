import { randomUUID } from "node:crypto";

import type { IntelligenceService } from "../service.js";

export const REVIEW_VERDICTS = ["VALIDATED", "PARTIALLY_VALIDATED", "REJECTED", "NEEDS_MORE_EVIDENCE"] as const;
export type ReviewVerdict = (typeof REVIEW_VERDICTS)[number];

export class ReviewError extends Error {}

export interface ReviewRecord {
  id: string;
  runId: string;
  clusterId: string;
  candidateId: string;
  verdict: ReviewVerdict;
  reviewer: string;
  reviewedAt: string;
  comment: string;
}

export interface ReviewMetrics {
  /** Root-cause candidates plus consolidated findings available for review. */
  candidatesTotal: number;
  candidatesReviewed: number;
  validated: number;
  partiallyValidated: number;
  rejected: number;
  needsMoreEvidence: number;
  /** Share of reviewed candidates a human marked VALIDATED. */
  acceptanceRate: number | null;
  /** Share of reviewed candidates marked VALIDATED or PARTIALLY_VALIDATED. */
  acceptanceOrPartialRate: number | null;
  note: string;
}

const s = (value: unknown) => String(value ?? "");
const pct = (part: number, total: number) => (total ? Math.round((part / total) * 1000) / 10 : null);
const MAX_COMMENT = 2000;
const MAX_REVIEWER = 120;

export function renderReviewPackMarkdown(pack: NonNullable<Awaited<ReturnType<ReviewService["pack"]>>>): string {
  const line = (value: unknown) => String(value ?? "").replace(/\r?\n/g, " ").trim();
  const out = [`# Paquete de revisión humana`, ``, `Análisis: ${pack.runId}${pack.period ? ` · ${pack.period.from} → ${pack.period.to}` : ""}`, `Generado: ${pack.generatedAt}`, ``, `> La revisión humana se registra para auditoría; no reentrena ni modifica el sistema. Las métricas reflejan el criterio de los revisores, no precisión de la IA.`, ``];
  for (const [index, item] of pack.items.entries()) {
    out.push(`## ${index + 1}. ${line(item.cluster.title)}`, ``, `- Cluster: \`${item.clusterId}\` (${item.selectionReasons.join(", ")})`, `- Servicio: ${line(item.cluster.service)} · Tendencia: ${line(item.cluster.trend)} · Confianza del grupo: ${item.cluster.confidence}${item.cluster.lowConfidence ? " (BAJA)" : ""}`);
    out.push(`- Casos del grupo: ${item.cluster.cases} · Casos representados en la evidencia: ${item.casesRepresented.represented}/${item.casesRepresented.total}${item.casesRepresented.sampled ? " (muestra)" : ""} · Cobertura de evidencia: ${item.evidenceCoverage}%`);
    out.push(`- Análisis profundo: ${item.analyzed ? "sí" : "NO (sin candidatos)"}`, ``, `**Grupos de falla (${item.failureGroups.length})**`);
    for (const group of item.failureGroups) out.push(`- ${line(group.label)} — ${group.cases} caso(s)${group.signals.length ? ` · señales: ${group.signals.map(line).join(", ")}` : ""}`);
    out.push(``, `**Hallazgos validados (${item.validatedFindings.length})**`);
    for (const finding of item.validatedFindings) out.push(`- [${finding.level} · ${finding.confidence} · ${finding.status} · ${finding.evidence} evidencia(s)] \`${finding.id}\` ${line(finding.statement)}${finding.limitations.length ? ` _(límites: ${finding.limitations.map(line).join("; ")})_` : ""}`);
    out.push(``, `**Hallazgos rechazados (${item.rejectedFindings.length})**`);
    for (const rejected of item.rejectedFindings) out.push(`- ${rejected.role}/${rejected.claimId}: ${rejected.verdict} — ${line(rejected.reason)}`);
    out.push(``, `**Candidatos de causa raíz (${item.candidates.length})**`);
    for (const candidate of item.candidates) out.push(`- [${candidate.level} · ${candidate.confidence}] \`${candidate.id}\` ${line(candidate.title)}${candidate.limitations.length ? ` _(límites: ${candidate.limitations.map(line).join("; ")})_` : ""}`);
    out.push(``, `**Limitaciones**`, ...item.limitations.map((limitation) => `- ${line(limitation)}`), ``, `**Recomendaciones**`);
    for (const recommendation of item.recommendations) out.push(`- ${line(recommendation.action)}${recommendation.owner ? ` (responsable sugerido: ${line(recommendation.owner)})` : ""} — ${line(recommendation.rationale)}`);
    out.push(``, `**Decisión del revisor** (por candidato/hallazgo: VALIDATED · PARTIALLY_VALIDATED · REJECTED · NEEDS_MORE_EVIDENCE)`, `- Revisor: ______  Fecha: ______  Comentario: ______`, ``);
  }
  return out.join("\n");
}

/**
 * Lightweight human validation of root-cause candidates. Reviews are append-only (audit trail); the latest review per
 * candidate wins. Nothing here feeds back into prompts, clustering or any automatic learning.
 */
export class ReviewService {
  constructor(private readonly svc: IntelligenceService) {}

  async submit(runId: string, clusterId: string, candidateId: string, input: { verdict: string; reviewer: string; comment?: string }): Promise<ReviewRecord> {
    const { store, now } = this.svc.internals;
    const id = await this.svc.resolveRunId(runId);
    if (!id) throw new ReviewError("Análisis no encontrado");
    const verdict = String(input.verdict ?? "").toUpperCase() as ReviewVerdict;
    if (!REVIEW_VERDICTS.includes(verdict)) throw new ReviewError(`Veredicto inválido. Valores: ${REVIEW_VERDICTS.join(", ")}`);
    const reviewer = String(input.reviewer ?? "").trim().slice(0, MAX_REVIEWER);
    if (!reviewer) throw new ReviewError("Indique el revisor");
    const comment = String(input.comment ?? "").trim().slice(0, MAX_COMMENT);
    if ((verdict === "REJECTED" || verdict === "NEEDS_MORE_EVIDENCE") && !comment) throw new ReviewError("Agregue un comentario que explique el veredicto");
    const exists =
      (await store.queryOne(`SELECT id FROM rootcause_candidates WHERE run_id = ? AND cluster_id = ? AND id = ?`, [id, clusterId, candidateId])) ??
      (await store.queryOne(`SELECT id FROM consolidated_findings WHERE run_id = ? AND cluster_id = ? AND id = ?`, [id, clusterId, candidateId]));
    if (!exists) throw new ReviewError("Candidato o hallazgo no encontrado en este análisis");
    const record: ReviewRecord = { id: randomUUID(), runId: id, clusterId, candidateId, verdict, reviewer, reviewedAt: now().toISOString(), comment };
    await store.run(`INSERT INTO candidate_reviews (id, run_id, cluster_id, candidate_id, verdict, reviewer, reviewed_at, comment) VALUES (?,?,?,?,?,?,?,?)`, [record.id, id, clusterId, candidateId, verdict, reviewer, record.reviewedAt, comment]);
    return record;
  }

  /** Latest review per candidate, plus the full history when requested. */
  async list(runId: string, options: { history?: boolean } = {}): Promise<ReviewRecord[]> {
    const { store } = this.svc.internals;
    const id = await this.svc.resolveRunId(runId);
    if (!id) return [];
    const rows = await store.query(`SELECT * FROM candidate_reviews WHERE run_id = ? ORDER BY reviewed_at DESC, rowid DESC`, [id]);
    const all = rows.map((row) => ({ id: s(row.id), runId: s(row.run_id), clusterId: s(row.cluster_id), candidateId: s(row.candidate_id), verdict: s(row.verdict) as ReviewVerdict, reviewer: s(row.reviewer), reviewedAt: s(row.reviewed_at), comment: s(row.comment) }));
    if (options.history) return all;
    const seen = new Set<string>();
    return all.filter((record) => (seen.has(`${record.clusterId}:${record.candidateId}`) ? false : (seen.add(`${record.clusterId}:${record.candidateId}`), true)));
  }

  async metrics(runId?: string): Promise<ReviewMetrics> {
    const { store } = this.svc.internals;
    const id = runId ? await this.svc.resolveRunId(runId) : undefined;
    const scope = id ? `WHERE run_id = ?` : "";
    const params = id ? [id] : [];
    const total = Number((await store.queryOne(`SELECT COUNT(*) AS n FROM rootcause_candidates ${scope}`, params))?.n ?? 0) + Number((await store.queryOne(`SELECT COUNT(*) AS n FROM consolidated_findings ${scope}`, params))?.n ?? 0);
    const latest = await store.query(
      `SELECT verdict, COUNT(*) AS n FROM (SELECT verdict, row_number() OVER (PARTITION BY run_id, cluster_id, candidate_id ORDER BY reviewed_at DESC, rowid DESC) AS rn FROM candidate_reviews ${scope}) WHERE rn = 1 GROUP BY verdict`,
      params,
    );
    const count = (verdict: ReviewVerdict) => Number(latest.find((row) => s(row.verdict) === verdict)?.n ?? 0);
    const reviewed = REVIEW_VERDICTS.reduce((sum, verdict) => sum + count(verdict), 0);
    return {
      candidatesTotal: total,
      candidatesReviewed: reviewed,
      validated: count("VALIDATED"),
      partiallyValidated: count("PARTIALLY_VALIDATED"),
      rejected: count("REJECTED"),
      needsMoreEvidence: count("NEEDS_MORE_EVIDENCE"),
      acceptanceRate: pct(count("VALIDATED"), reviewed),
      acceptanceOrPartialRate: pct(count("VALIDATED") + count("PARTIALLY_VALIDATED"), reviewed),
      note: "Mide el criterio de los revisores sobre los candidatos revisados; no es precisión del sistema ni existe verdad de referencia.",
    };
  }

  /** Diverse sample of clusters for human review: largest, medium, low confidence, most failure groups, best technical evidence. */
  async sample(runId: string, limit = 5): Promise<{ clusterId: string; reasons: string[] }[]> {
    const clusters = (await this.svc.clusters(runId)) ?? [];
    if (!clusters.length) return [];
    const { store } = this.svc.internals;
    const id = (await this.svc.resolveRunId(runId))!;
    const evidence = new Map((await store.query(`SELECT cluster_id, COUNT(*) AS n FROM analysis_evidence_items WHERE run_id = ? GROUP BY cluster_id`, [id])).map((row) => [s(row.cluster_id), Number(row.n)]));
    const picks = new Map<string, string[]>();
    const pick = (cluster: (typeof clusters)[number] | undefined, reason: string) => {
      if (cluster) picks.set(cluster.id, [...(picks.get(cluster.id) ?? []), reason]);
    };
    const free = (list: typeof clusters) => list.filter((cluster) => !picks.has(cluster.id));
    const bySize = [...clusters].sort((a, b) => b.cases - a.cases);
    pick(bySize[0], "Grupo grande");
    pick(free(bySize)[Math.floor(free(bySize).length / 2)], "Grupo mediano");
    pick(free(clusters.filter((cluster) => cluster.lowConfidence))[0], "Baja confianza");
    pick(free([...clusters].sort((a, b) => b.failureGroups - a.failureGroups))[0], "Múltiples grupos de falla");
    pick(free([...clusters].sort((a, b) => (evidence.get(b.id) ?? 0) - (evidence.get(a.id) ?? 0)))[0], "Mayor evidencia técnica/histórica");
    return [...picks.entries()].slice(0, Math.max(1, limit)).map(([clusterId, reasons]) => ({ clusterId, reasons }));
  }

  async pack(runId: string, options: { clusterIds?: string[]; limit?: number } = {}) {
    const id = await this.svc.resolveRunId(runId);
    if (!id) return undefined;
    const run = await this.svc.getRun(runId);
    const sample = options.clusterIds?.length ? options.clusterIds.map((clusterId) => ({ clusterId, reasons: ["Seleccionado manualmente"] })) : await this.sample(runId, options.limit ?? 5);
    const reviews = await this.list(runId);
    const items = [];
    for (const { clusterId, reasons } of sample) {
      const detail = await this.svc.clusterDetail(runId, clusterId);
      if (!detail?.cluster) continue;
      const deep = detail.deep;
      const analyzed = Boolean(deep);
      items.push({
        clusterId,
        selectionReasons: reasons,
        analyzed,
        cluster: { title: detail.cluster.title, description: detail.cluster.description, service: detail.cluster.service, cases: detail.cluster.cases, percentage: detail.cluster.percentage, confidence: detail.cluster.confidence, lowConfidence: detail.cluster.lowConfidence, trend: detail.cluster.trend },
        failureGroups: detail.failureGroups.map((group) => ({ id: group.id, label: group.label, cases: group.cases, signals: group.signals })),
        casesRepresented: deep ? { represented: deep.evidence.casesRepresented, total: deep.evidence.totalCases, sampled: deep.evidence.sampled } : { represented: 0, total: detail.cluster.cases, sampled: false },
        evidenceCoverage: deep && deep.evidence.totalCases ? Math.round((deep.evidence.casesRepresented / deep.evidence.totalCases) * 1000) / 10 : 0,
        validatedFindings: (deep?.findings ?? []).map((finding) => ({ id: finding.id, statement: finding.statement, level: finding.level, confidence: finding.confidence, status: finding.status, evidence: finding.evidence.length, limitations: finding.limitations, review: reviews.find((review) => review.clusterId === clusterId && review.candidateId === finding.id) ?? null })),
        rejectedFindings: (deep?.rejected ?? []).map((item) => ({ claimId: item.claimId, role: item.role, verdict: item.verdict, reason: item.reason })),
        candidates: detail.candidates.map((candidate) => ({
          id: candidate.id, failureGroupId: candidate.failureGroupId, title: candidate.title, description: candidate.description, level: candidate.level, confidence: candidate.confidence,
          evidence: candidate.evidence, affectedCases: candidate.affectedCases, limitations: candidate.limitations,
          review: reviews.find((review) => review.clusterId === clusterId && review.candidateId === candidate.id) ?? null,
        })),
        limitations: deep?.limitations ?? ["Este grupo aún no tiene análisis profundo; ejecute SELECTED_RCA sobre él para obtener candidatos."],
        recommendations: (deep?.recommendations ?? []).map((item) => ({ action: item.action, rationale: item.rationale, owner: item.owner ?? null, priority: item.priority ?? null })),
      });
    }
    return { runId: id, period: run ? { from: run.from, to: run.to } : null, generatedAt: this.svc.internals.now().toISOString(), items, metrics: await this.metrics(runId) };
  }
}
