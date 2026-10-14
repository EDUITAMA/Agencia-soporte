import { createHash } from "node:crypto";

import { jaccard, tokenize } from "../text.js";
import type { CanonicalUnit, CandidateStatus, CauseLevel, Claim, ClusterResult, EvidenceRef, Recommendation, RootCauseCandidate } from "../types.js";
import type { Segmentation } from "./segmentation.js";

export type ClaimVerdict = "SUPPORTED" | "PARTIALLY_SUPPORTED" | "UNSUPPORTED" | "CONTRADICTED";
export type ClaimAction = "ACCEPT" | "REVISE" | "REJECT";

export interface ClaimCheck {
  claimId: string;
  verdict: ClaimVerdict;
  action: ClaimAction;
  reason: string;
}

export interface RoleClaim extends Claim {
  role: string;
}

const VERDICTS: ClaimVerdict[] = ["SUPPORTED", "PARTIALLY_SUPPORTED", "UNSUPPORTED", "CONTRADICTED"];
const str = (value: unknown, max = 400) => (typeof value === "string" ? value.trim().slice(0, max) : "");
const defaultAction = (verdict: ClaimVerdict): ClaimAction => (verdict === "SUPPORTED" ? "ACCEPT" : verdict === "PARTIALLY_SUPPORTED" ? "REVISE" : "REJECT");

/** Strict parse; a verdict outside the contract is ignored and the claim is then treated conservatively. */
export function parseClaimChecks(raw: unknown): Map<string, ClaimCheck> {
  const list = (raw as { verdicts?: unknown })?.verdicts;
  if (!Array.isArray(list)) throw new Error("verdicts must be an array");
  const checks = new Map<string, ClaimCheck>();
  for (const item of list) {
    const entry = (item ?? {}) as Record<string, unknown>;
    const verdict = str(entry.verdict).toUpperCase() as ClaimVerdict;
    const claimId = str(entry.claimId, 80);
    if (!claimId || !VERDICTS.includes(verdict)) continue;
    const action = str(entry.action).toUpperCase() as ClaimAction;
    checks.set(claimId, { claimId, verdict, action: ["ACCEPT", "REVISE", "REJECT"].includes(action) ? action : defaultAction(verdict), reason: str(entry.reason, 300) });
  }
  return checks;
}

export interface ValidationOutcome {
  approved: Set<string>;
  accepted: RoleClaim[];
  rejected: { claimId: string; role: string; verdict: ClaimVerdict | "NO_VERDICT"; reason: string }[];
  contradicted: RoleClaim[];
}

/** Applies the independent reviewer's decisions: only ACCEPT/REVISE survive; REVISE and missing verdicts are capped later. */
export function applyChecks(claims: RoleClaim[], checks: Map<string, ClaimCheck> | undefined): ValidationOutcome {
  const outcome: ValidationOutcome = { approved: new Set(), accepted: [], rejected: [], contradicted: [] };
  for (const claim of claims) {
    const check = checks?.get(claim.id);
    if (!checks) {
      outcome.accepted.push({ ...claim, limitations: [...claim.limitations, "No hubo validación semántica independiente."] });
      continue;
    }
    if (!check) {
      outcome.accepted.push({ ...claim, level: claim.level === "OBSERVED_PATTERN" ? claim.level : "HYPOTHESIS", limitations: [...claim.limitations, "El validador no emitió veredicto para esta afirmación."] });
      continue;
    }
    if (check.verdict === "CONTRADICTED") outcome.contradicted.push(claim);
    if (check.action === "REJECT" || check.verdict === "UNSUPPORTED" || check.verdict === "CONTRADICTED") {
      outcome.rejected.push({ claimId: claim.id, role: claim.role, verdict: check.verdict, reason: check.reason });
      continue;
    }
    if (check.verdict === "SUPPORTED" && check.action === "ACCEPT") outcome.approved.add(claim.id);
    else outcome.accepted.push({ ...claim, level: claim.level === "OBSERVED_PATTERN" ? claim.level : "HYPOTHESIS", limitations: [...claim.limitations, `Respaldo parcial: ${check.reason || "requiere revisión"}`] });
    if (check.verdict === "SUPPORTED" && check.action === "ACCEPT") outcome.accepted.push(claim);
  }
  return outcome;
}

export interface Finding {
  id: string;
  failureGroupId?: string;
  statement: string;
  level: CauseLevel;
  confidence: number;
  roles: string[];
  claimIds: string[];
  evidence: EvidenceRef[];
  limitations: string[];
  status: "ACCEPTED" | "CONFLICTING_EVIDENCE";
}

const LEVELS: CauseLevel[] = ["OBSERVED_PATTERN", "HYPOTHESIS", "LIKELY_CAUSE", "SUPPORTED_CAUSE", "CONFIRMED_CAUSE"];
const SIMILARITY = 0.55;

/**
 * Merges equivalent claims from different roles (same failure group, similar wording), pools their citations and keeps
 * the most conservative confidence. A group where the reviewer found a contradicted claim is marked CONFLICTING_EVIDENCE.
 */
export function consolidate(claims: RoleClaim[], contradicted: RoleClaim[]): Finding[] {
  const merged: { finding: Finding; tokens: string[] }[] = [];
  for (const claim of [...claims].sort((a, b) => LEVELS.indexOf(b.level) - LEVELS.indexOf(a.level) || b.confidence - a.confidence)) {
    const tokens = tokenize(claim.claim);
    const match = merged.find((item) => (item.finding.failureGroupId ?? "") === (claim.failureGroupId ?? "") && jaccard(item.tokens, tokens) >= SIMILARITY);
    if (!match) {
      merged.push({ tokens, finding: { id: `f_${createHash("sha1").update(`${claim.failureGroupId ?? ""}:${claim.claim}`).digest("hex").slice(0, 12)}`, failureGroupId: claim.failureGroupId, statement: claim.claim, level: claim.level, confidence: claim.confidence, roles: [claim.role], claimIds: [claim.id], evidence: [...claim.evidence], limitations: [...claim.limitations], status: "ACCEPTED" } });
      continue;
    }
    const { finding } = match;
    finding.roles = [...new Set([...finding.roles, claim.role])];
    finding.claimIds.push(claim.id);
    const seen = new Set(finding.evidence.map((ref) => `${ref.jiraKey}:${ref.field}:${ref.excerpt}`));
    for (const ref of claim.evidence) if (!seen.has(`${ref.jiraKey}:${ref.field}:${ref.excerpt}`)) finding.evidence.push(ref);
    finding.confidence = Math.min(finding.confidence, claim.confidence);
    finding.limitations = [...new Set([...finding.limitations, ...claim.limitations])];
  }
  const conflicted = new Set(contradicted.map((claim) => claim.failureGroupId ?? ""));
  return merged.map(({ finding }) => {
    const single = finding.roles.length < 2;
    const conflict = conflicted.has(finding.failureGroupId ?? "");
    const notes = [...finding.limitations];
    if (conflict) notes.push("Otro rol aportó una afirmación contradicha por la evidencia en este mismo grupo.");
    return { ...finding, confidence: Math.min(finding.confidence, single ? 0.65 : 0.9, conflict ? 0.5 : 1), limitations: [...new Set(notes)], status: conflict ? "CONFLICTING_EVIDENCE" : "ACCEPTED" };
  });
}

/** One candidate per failure group. A group without a defensible hypothesis yields INSUFFICIENT_EVIDENCE_FOR_RCA, which is a valid result. */
export function buildCandidates(cluster: ClusterResult, segmentation: Segmentation, findings: Finding[], recommendations: Recommendation[], units: Map<string, CanonicalUnit>): RootCauseCandidate[] {
  const hoursOf = (keys: string[]) => keys.reduce((sum, key) => sum + (units.get(key)?.totalHours ?? 0), 0);
  return segmentation.groups.map((group) => {
    const own = findings.filter((finding) => finding.failureGroupId === group.id);
    const causal = own.filter((finding) => finding.level !== "OBSERVED_PATTERN" && finding.status === "ACCEPTED");
    const conflicting = own.filter((finding) => finding.status === "CONFLICTING_EVIDENCE");
    const best = [...(causal.length ? causal : conflicting.length ? conflicting : own)].sort((a, b) => b.confidence - a.confidence)[0];
    const status: CandidateStatus = causal.length ? "CANDIDATE" : conflicting.length ? "CONFLICTING_EVIDENCE" : "INSUFFICIENT_EVIDENCE_FOR_RCA";
    const hours = hoursOf(group.members);
    const ids = new Set(own.map((finding) => finding.id));
    return {
      id: `rc_${createHash("sha1").update(`${cluster.id}:${group.id}:${best?.id ?? "none"}`).digest("hex").slice(0, 12)}`,
      clusterId: cluster.id,
      failureGroupId: group.id,
      title: `${group.label} — ${cluster.title}`,
      description: status === "INSUFFICIENT_EVIDENCE_FOR_RCA" ? `No hay evidencia suficiente para proponer una causa raíz. ${best ? `Patrón observado: ${best.statement}` : "Solo se observa el patrón de casos."}` : best.statement,
      level: status === "INSUFFICIENT_EVIDENCE_FOR_RCA" ? "OBSERVED_PATTERN" : best.level,
      confidence: status === "INSUFFICIENT_EVIDENCE_FOR_RCA" ? Math.min(best?.confidence ?? 0.3, 0.4) : best.confidence,
      evidence: best?.evidence ?? [],
      affectedCases: group.members,
      businessImpact: `${group.members.length} caso(s) afectado(s)${hours ? `, ${Math.round(hours)} h registradas` : ""}.`,
      technicalSignals: group.signals,
      limitations: best?.limitations ?? ["Sin afirmaciones validadas para este grupo."],
      recommendedNextSteps: recommendations.filter((rec) => rec.findingIds?.some((id) => ids.has(id))),
      status,
    };
  });
}

/** Recommendations must be tied to surviving findings; near-duplicates (same owner) are merged. */
export function buildRecommendations(raw: { role: string; items: (Recommendation & { claimIdsRaw: string[] })[] }[], findings: Finding[]): Recommendation[] {
  const findingOf = new Map<string, string>();
  for (const finding of findings) for (const claimId of finding.claimIds) findingOf.set(claimId, finding.id);
  const out: { rec: Recommendation; tokens: string[] }[] = [];
  for (const { role, items } of raw) {
    for (const item of items) {
      const findingIds = [...new Set(item.claimIdsRaw.map((id) => findingOf.get(id)).filter((id): id is string => Boolean(id)))];
      if (!findingIds.length) continue;
      const tokens = tokenize(item.action);
      const same = out.find((entry) => (entry.rec.owner ?? "") === (item.owner ?? "") && jaccard(entry.tokens, tokens) >= 0.6);
      if (same) {
        same.rec.findingIds = [...new Set([...(same.rec.findingIds ?? []), ...findingIds])];
        same.rec.roles = [...new Set([...(same.rec.roles ?? []), role])];
        continue;
      }
      out.push({ tokens, rec: { action: item.action, rationale: item.rationale, relatedClaimIds: item.claimIdsRaw, owner: item.owner, priority: item.priority, findingIds, roles: [role] } });
    }
  }
  return out.map((entry) => entry.rec);
}

export interface DataQualityFinding {
  code: string;
  message: string;
  cases: number;
}

export function dataQuality(units: CanonicalUnit[], segmentation: Segmentation, evidence: { sampled: boolean; sentCases: number; totalCases: number }): DataQualityFinding[] {
  const out: DataQualityFinding[] = [];
  const add = (code: string, message: string, cases: number) => cases > 0 && out.push({ code, message, cases });
  add("NO_ERROR_MESSAGE", "Casos sin mensaje de error estructurado.", units.filter((unit) => !unit.errorMessage.trim()).length);
  add("NO_CLOSE_MESSAGE", "Casos sin mensaje de cierre (no hay resolución documentada).", units.filter((unit) => !unit.closeMessage.trim()).length);
  const unspecified = segmentation.groups.find((group) => group.kind === "UNSPECIFIED");
  add("UNSPECIFIED_FAILURE_MODE", "Casos sin una firma técnica común reconocible.", unspecified?.members.length ?? 0);
  add("OUTLIERS", "Casos con una firma poco frecuente, mantenidos fuera de los grupos.", segmentation.outliers.length);
  add("POSSIBLE_RECLASSIFICATION", "Casos de otro servicio dentro del cluster; no se analizaron como parte de él.", segmentation.reclassifications.length);
  if (evidence.sampled) add("SAMPLED_EVIDENCE", `El análisis usó una muestra estratificada de ${evidence.sentCases} de ${evidence.totalCases} casos.`, evidence.totalCases - evidence.sentCases);
  return out;
}
