import { createHash } from "node:crypto";

import { verifyCitation } from "../evidence.js";
import { jaccard, tokenize } from "../text.js";
import type { CanonicalUnit, CauseLevel, Claim, ClusterResult, EvidenceItem, EvidenceRef, Recommendation, RootCauseCandidate } from "../types.js";

const LEVELS: CauseLevel[] = ["OBSERVED_PATTERN", "HYPOTHESIS", "LIKELY_CAUSE", "SUPPORTED_CAUSE", "CONFIRMED_CAUSE"];
const FIELDS: EvidenceItem["field"][] = ["summary", "description", "errorMessage", "closeMessage", "comment", "classification"];
const rank = (level: CauseLevel) => LEVELS.indexOf(level);
const cap = (level: CauseLevel, max: CauseLevel): CauseLevel => (rank(level) > rank(max) ? max : level);

export const CLAIM_SIMILARITY_THRESHOLD = 0.64;

export interface ParsedAnalysis {
  clusterSummary: string;
  claims: Claim[];
  recommendations: Recommendation[];
}

const str = (value: unknown, max = 600): string => (typeof value === "string" ? value.trim().slice(0, max) : "");

/** Strict schema check. Anything malformed is rejected instead of repaired. */
export function parseAnalysis(raw: unknown): ParsedAnalysis {
  if (!raw || typeof raw !== "object") throw new Error("analysis is not an object");
  const body = raw as Record<string, unknown>;
  if (!Array.isArray(body.claims)) throw new Error("analysis.claims must be an array");
  const claims: Claim[] = body.claims.slice(0, 12).map((item, index) => {
    const entry = (item ?? {}) as Record<string, unknown>;
    const claim = str(entry.claim);
    if (!claim) throw new Error(`claims[${index}].claim is empty`);
    const level = str(entry.level) as CauseLevel;
    if (!LEVELS.includes(level)) throw new Error(`claims[${index}].level is invalid`);
    const confidence = Number(entry.confidence);
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) throw new Error(`claims[${index}].confidence must be between 0 and 1`);
    const evidence = (Array.isArray(entry.evidence) ? entry.evidence : []).slice(0, 8).map((ref): EvidenceRef => {
      const value = (ref ?? {}) as Record<string, unknown>;
      return { evidenceId: str(value.evidenceId, 20) || undefined, jiraKey: str(value.jiraKey, 40), field: str(value.field, 20) as EvidenceItem["field"], excerpt: str(value.excerpt, 500) };
    });
    return {
      id: str(entry.id, 20) || `c${index + 1}`,
      claim,
      failureGroupId: str(entry.failureGroupId, 40) || undefined,
      level,
      confidence,
      evidence,
      limitations: (Array.isArray(entry.limitations) ? entry.limitations : []).map((limit) => str(limit, 300)).filter(Boolean).slice(0, 5),
    };
  });
  const recommendations: Recommendation[] = (Array.isArray(body.recommendations) ? body.recommendations : []).slice(0, 6).map((item) => {
    const entry = (item ?? {}) as Record<string, unknown>;
    return { action: str(entry.action, 400), rationale: str(entry.rationale, 400), relatedClaimIds: (Array.isArray(entry.relatedClaimIds) ? entry.relatedClaimIds : []).map((id) => str(id, 20)).filter(Boolean) };
  }).filter((item) => item.action);
  return { clusterSummary: str(body.clusterSummary, 800), claims, recommendations };
}

export function parseVerdicts(raw: unknown): Map<string, { verdict: "SUPPORTED" | "UNSUPPORTED"; reason: string }> {
  const verdicts = new Map<string, { verdict: "SUPPORTED" | "UNSUPPORTED"; reason: string }>();
  const list = (raw as { verdicts?: unknown })?.verdicts;
  if (!Array.isArray(list)) throw new Error("verdicts must be an array");
  for (const item of list) {
    const entry = (item ?? {}) as Record<string, unknown>;
    const verdict = str(entry.verdict).toUpperCase();
    if (str(entry.claimId) && (verdict === "SUPPORTED" || verdict === "UNSUPPORTED")) verdicts.set(str(entry.claimId), { verdict, reason: str(entry.reason, 300) });
  }
  return verdicts;
}

export interface CitationResult {
  claims: Claim[];
  dropped: { claimId: string; reason: string }[];
  invalidReferences: number;
}

/** Keeps only references whose excerpt really exists in the cited Jira field; claims left without any are discarded. */
export function verifyClaims(claims: Claim[], index: Map<string, string[]>, memberKeys: Set<string>): CitationResult {
  const kept: Claim[] = [];
  const dropped: CitationResult["dropped"] = [];
  let invalidReferences = 0;
  for (const claim of claims) {
    const valid = claim.evidence.filter((ref) => FIELDS.includes(ref.field) && verifyCitation(ref, index));
    invalidReferences += claim.evidence.length - valid.length;
    const inCluster = valid.filter((ref) => memberKeys.has(ref.jiraKey));
    if (!inCluster.length) {
      dropped.push({ claimId: claim.id, reason: claim.evidence.length ? "citas no verificables contra los datos de Jira" : "afirmación sin evidencia" });
      continue;
    }
    kept.push({ ...claim, evidence: inCluster });
  }
  return { claims: kept, dropped, invalidReferences };
}

const TECHNICAL_FIELDS = new Set<EvidenceItem["field"]>(["errorMessage", "closeMessage", "description", "comment"]);

const OVERSTATEMENT = /causa ra[ií]z (confirmada|definitiva)|root cause (confirmed|is)|se confirm[oó] que|est[aá] confirmado que|sin duda alguna/gi;
export const sanitizeWording = (text: string) => text.replace(OVERSTATEMENT, "causa probable");

export interface GuardrailContext {
  cluster: ClusterResult;
  units: Map<string, CanonicalUnit>;
  /** Claims approved by the independent reviewer. */
  approved: Set<string>;
}

/**
 * Wording never outruns the evidence. CONFIRMED_CAUSE is reserved for a human decision and is never produced here.
 */
export function applyGuardrails(claims: Claim[], context: GuardrailContext): Claim[] {
  const rootOf = (key: string) => [...context.units.values()].find((unit) => unit.root.jiraKey === key || unit.children.some((child) => child.jiraKey === key))?.canonicalKey ?? key;
  return claims.map((claim) => {
    const notes = [...claim.limitations];
    const cases = new Set(claim.evidence.map((ref) => rootOf(ref.jiraKey)));
    const technicalCases = new Set(claim.evidence.filter((ref) => TECHNICAL_FIELDS.has(ref.field)).map((ref) => rootOf(ref.jiraKey)));
    const resolutionCases = new Set(claim.evidence.filter((ref) => ref.field === "closeMessage").map((ref) => rootOf(ref.jiraKey)));
    let level = claim.level;
    const lower = (max: CauseLevel, note: string) => {
      const next = cap(level, max);
      if (next !== level) {
        notes.push(note);
        level = next;
      }
    };

    if (context.cluster.lowConfidence) lower("OBSERVED_PATTERN", "Cluster de baja confianza: solo se reporta el patrón observado.");
    if (cases.size < 2) lower("OBSERVED_PATTERN", "Evidencia de un único caso.");
    if (!technicalCases.size) lower("HYPOTHESIS", "La evidencia es únicamente funcional (títulos), sin señal técnica.");
    if (technicalCases.size < 2) lower("HYPOTHESIS", "La señal técnica aparece en menos de 2 casos.");
    if (!(resolutionCases.size >= 3 && context.approved.has(claim.id))) lower("LIKELY_CAUSE", "Sin resolución consistente en ≥3 casos validada por el revisor independiente.");
    lower("SUPPORTED_CAUSE", "La confirmación definitiva requiere decisión humana.");

    return { ...claim, claim: sanitizeWording(claim.claim), level, confidence: Math.min(claim.confidence, level === "OBSERVED_PATTERN" ? 0.5 : level === "HYPOTHESIS" ? 0.6 : 0.85), limitations: [...new Set(notes)] };
  });
}

/** Merges near-duplicate claims (same failure group, similar wording), pooling their evidence. */
export function consolidateClaims(claims: Claim[]): Claim[] {
  const merged: { claim: Claim; tokens: string[] }[] = [];
  for (const claim of [...claims].sort((a, b) => rank(b.level) - rank(a.level) || b.confidence - a.confidence)) {
    const tokens = tokenize(claim.claim);
    const match = merged.find((item) => (item.claim.failureGroupId ?? "") === (claim.failureGroupId ?? "") && jaccard(item.tokens, tokens) >= CLAIM_SIMILARITY_THRESHOLD);
    if (!match) {
      merged.push({ claim: { ...claim, evidence: [...claim.evidence] }, tokens });
      continue;
    }
    const seen = new Set(match.claim.evidence.map((ref) => `${ref.jiraKey}:${ref.field}:${ref.excerpt}`));
    for (const ref of claim.evidence) if (!seen.has(`${ref.jiraKey}:${ref.field}:${ref.excerpt}`)) match.claim.evidence.push(ref);
    match.claim.limitations = [...new Set([...match.claim.limitations, ...claim.limitations])];
  }
  return merged.map((item) => item.claim);
}

export function toCandidates(cluster: ClusterResult, claims: Claim[], recommendations: Recommendation[], units: Map<string, CanonicalUnit>): RootCauseCandidate[] {
  const keysOf = (jiraKeys: string[]) => new Set(jiraKeys);
  return claims
    .filter((claim) => claim.level !== "OBSERVED_PATTERN" || claim.evidence.length > 0)
    .map((claim) => {
      const group = cluster.failureGroups.find((item) => item.id === claim.failureGroupId);
      const affected = group ? group.members : cluster.members.map((member) => member.canonicalKey);
      const cited = keysOf(claim.evidence.map((ref) => ref.jiraKey));
      const hours = affected.reduce((sum, key) => sum + (units.get(key)?.totalHours ?? 0), 0);
      return {
        id: `rc_${createHash("sha1").update(`${cluster.id}:${claim.id}:${claim.claim}`).digest("hex").slice(0, 12)}`,
        clusterId: cluster.id,
        failureGroupId: claim.failureGroupId,
        title: group && group.signature !== "OTHER" ? `${group.label} — ${cluster.title}` : cluster.title,
        description: claim.claim,
        level: claim.level,
        confidence: claim.confidence,
        evidence: claim.evidence,
        affectedCases: affected,
        businessImpact: `${affected.length} caso(s) afectado(s)${hours ? `, ${Math.round(hours)} h registradas` : ""}; ${cited.size} con evidencia citada.`,
        technicalSignals: group?.signals ?? [],
        limitations: claim.limitations,
        recommendedNextSteps: recommendations.filter((item) => item.relatedClaimIds.includes(claim.id)),
      };
    });
}
