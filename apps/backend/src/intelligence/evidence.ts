import { fold, normalizeSpaces, truncate } from "./text.js";
import { redactSecrets } from "./canonical.js";
import type { IntelligenceConfig } from "./config.js";
import type { CanonicalUnit, ClusterResult, EvidenceItem, EvidenceRef } from "./types.js";

export interface EvidenceSelection {
  items: EvidenceItem[];
  totalCases: number;
  sentCases: number;
  sampled: boolean;
}

/**
 * <= fullCaseLimit members: every case contributes evidence.
 * Above it: stratified by failure group (largest representative cases first), always keeping the oldest/newest case.
 * Only descriptions are truncated; error messages and close messages are kept whole because they carry the signal.
 */
export function selectEvidence(cluster: ClusterResult, units: Map<string, CanonicalUnit>, config: IntelligenceConfig): EvidenceSelection {
  const members = cluster.members.map((member) => ({ ...member, unit: units.get(member.canonicalKey)! })).filter((member) => member.unit);
  const total = members.length;
  let chosen = members;
  const sampled = total > config.evidence.fullCaseLimit;

  if (sampled) {
    const size = config.evidence.sampleSize;
    const picked = new Map<string, (typeof members)[number]>();
    const groupOf = new Map<string, string>();
    cluster.failureGroups.forEach((group) => group.members.forEach((key) => groupOf.set(key, group.id)));
    for (const group of cluster.failureGroups) {
      const quota = Math.max(1, Math.round((group.members.length / total) * size));
      members
        .filter((member) => groupOf.get(member.canonicalKey) === group.id)
        .sort((a, b) => Number(b.representative) - Number(a.representative) || b.similarity - a.similarity)
        .slice(0, quota)
        .forEach((member) => picked.set(member.canonicalKey, member));
    }
    const byDate = [...members].sort((a, b) => a.unit.periodDate.localeCompare(b.unit.periodDate));
    for (const edge of [byDate[0], byDate.at(-1)!]) if (picked.size < size) picked.set(edge.canonicalKey, edge);
    for (const member of members) {
      if (picked.size >= size) break;
      picked.set(member.canonicalKey, member);
    }
    chosen = [...picked.values()].slice(0, size);
  }

  const groupOf = new Map<string, string>();
  cluster.failureGroups.forEach((group) => group.members.forEach((key) => groupOf.set(key, group.id)));

  const items: EvidenceItem[] = [];
  const add = (jiraKey: string, field: EvidenceItem["field"], value: string, failureGroupId: string | undefined, reason: string, max?: number) => {
    const clean = normalizeSpaces(redactSecrets(value));
    if (!clean) return;
    items.push({ id: `E${items.length + 1}`, jiraKey, field, snippet: max ? truncate(clean, max) : clean, failureGroupId, reason });
  };
  for (const { unit, canonicalKey } of chosen) {
    const failureGroupId = groupOf.get(canonicalKey);
    const reason = sampled ? "muestra estratificada" : "todos los casos del cluster";
    add(unit.root.jiraKey, "summary", unit.root.summary, failureGroupId, reason);
    add(unit.root.jiraKey, "description", unit.root.description, failureGroupId, reason, config.evidence.maxDescriptionChars);
    add(unit.root.jiraKey, "errorMessage", unit.errorMessage, failureGroupId, reason);
    add(unit.root.jiraKey, "closeMessage", unit.closeMessage, failureGroupId, reason);
    unit.root.comments.filter((comment) => !comment.noise && comment.body.length >= 25).slice(0, 2).forEach((comment) => add(unit.root.jiraKey, "comment", comment.body, failureGroupId, reason, 400));
    for (const child of unit.children.slice(0, 2)) {
      add(child.jiraKey, "summary", child.summary, failureGroupId, `subcaso de ${unit.root.jiraKey}`);
      add(child.jiraKey, "closeMessage", child.closeMessage, failureGroupId, `subcaso de ${unit.root.jiraKey}`);
    }
  }
  return { items, totalCases: total, sentCases: chosen.length, sampled };
}

/** Full-text sources by `${jiraKey}:${field}` so citations can be checked against Jira data, not only the sampled snippet. */
export function buildSourceIndex(units: Iterable<CanonicalUnit>): Map<string, string[]> {
  const index = new Map<string, string[]>();
  const push = (key: string, field: string, value: string) => {
    if (!value) return;
    const id = `${key}:${field}`;
    index.set(id, [...(index.get(id) ?? []), normalizeSpaces(redactSecrets(value))]);
  };
  for (const unit of units) {
    for (const item of [unit.root, ...unit.children]) {
      push(item.jiraKey, "summary", item.summary);
      push(item.jiraKey, "description", item.description);
      push(item.jiraKey, "errorMessage", item.errorMessage);
      push(item.jiraKey, "closeMessage", item.closeMessage);
      item.comments.forEach((comment) => push(item.jiraKey, "comment", comment.body));
    }
  }
  return index;
}

const squash = (value: string) => fold(value).replace(/[^a-z0-9]+/g, " ").trim();

/** A reference is valid only if the cited case/field really contains the quoted excerpt. */
export function verifyCitation(ref: EvidenceRef, index: Map<string, string[]>): boolean {
  const excerpt = squash(ref.excerpt);
  if (excerpt.length < 6) return false;
  return (index.get(`${ref.jiraKey}:${ref.field}`) ?? []).some((source) => squash(source).includes(excerpt));
}
