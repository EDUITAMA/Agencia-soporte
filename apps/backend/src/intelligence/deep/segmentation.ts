import { createHash } from "node:crypto";

import { detectSignature, SIGNIFICANT_GROUP_MIN_CASES, SIGNIFICANT_GROUP_MIN_PERCENT } from "../failures.js";
import { fold, round } from "../text.js";
import type { CanonicalUnit, ClusterResult, FailureGroup } from "../types.js";

export interface SegmentedGroup extends FailureGroup {
  /** FAILURE_MODE has a recognizable technical signature; UNSPECIFIED only means "no common signature was found". */
  kind: "FAILURE_MODE" | "UNSPECIFIED";
  confidence: number;
}

export interface Reclassification {
  canonicalKey: string;
  jiraKey: string;
  service: string;
  expectedService: string;
  status: "POSSIBLE_RECLASSIFICATION";
}

export interface Segmentation {
  groups: SegmentedGroup[];
  /** Cases with a rare signature: kept visible but not forced into a group. */
  outliers: string[];
  reclassifications: Reclassification[];
  analyzableCases: number;
  mixed: boolean;
}

const groupId = (keys: string[], signature: string) => `fg_${createHash("sha1").update(`${[...keys].sort().join("|")}:${signature}`).digest("hex").slice(0, 12)}`;

/**
 * Splits a cluster into failure modes without forcing sub-groups: significant signatures become groups, rare ones are
 * outliers, and cases that clearly belong to another service are flagged instead of analyzed under this cluster.
 */
export function segmentCluster(cluster: ClusterResult, members: CanonicalUnit[]): Segmentation {
  const expected = fold(cluster.service ?? "").trim();
  const reclassifications: Reclassification[] = [];
  const analyzable: CanonicalUnit[] = [];
  for (const unit of members) {
    const service = fold(unit.service ?? "").trim();
    if (expected && service && service !== expected) reclassifications.push({ canonicalKey: unit.canonicalKey, jiraKey: unit.root.jiraKey, service: unit.service, expectedService: cluster.service, status: "POSSIBLE_RECLASSIFICATION" });
    else analyzable.push(unit);
  }

  const buckets = new Map<string, { label: string; units: CanonicalUnit[]; signals: Set<string> }>();
  for (const unit of analyzable) {
    const signature = detectSignature(unit);
    const entry = buckets.get(signature.id) ?? { label: signature.label, units: [], signals: new Set<string>() };
    entry.units.push(unit);
    signature.signals.forEach((signal) => entry.signals.add(signal));
    buckets.set(signature.id, entry);
  }

  const total = analyzable.length;
  const significant = (count: number) => count >= SIGNIFICANT_GROUP_MIN_CASES || (total > 0 && (count / total) * 100 >= SIGNIFICANT_GROUP_MIN_PERCENT);
  const groups: SegmentedGroup[] = [];
  const outliers: string[] = [];
  const make = (signature: string, entry: { label: string; units: CanonicalUnit[]; signals: Set<string> }, kind: SegmentedGroup["kind"]): SegmentedGroup => ({
    id: groupId(entry.units.map((unit) => unit.canonicalKey), signature),
    signature,
    label: entry.label,
    members: entry.units.map((unit) => unit.canonicalKey).sort(),
    percentage: round((entry.units.length / Math.max(total, 1)) * 100, 1),
    signals: [...entry.signals].slice(0, 5),
    representative: entry.units.slice(0, 3).map((unit) => unit.canonicalKey),
    kind,
    confidence: kind === "UNSPECIFIED" ? 0.3 : round(Math.min(0.95, 0.6 + 0.35 * (entry.units.length / Math.max(total, 1))), 2),
  });

  for (const [id, entry] of buckets) {
    if (id === "OTHER") continue;
    if (significant(entry.units.length)) groups.push(make(id, entry, "FAILURE_MODE"));
    else outliers.push(...entry.units.map((unit) => unit.canonicalKey));
  }
  const unspecified = buckets.get("OTHER");
  if (unspecified) groups.push(make("OTHER", { ...unspecified, label: "Sin firma técnica común" }, "UNSPECIFIED"));
  if (!groups.length && outliers.length) {
    const all = analyzable.filter((unit) => outliers.includes(unit.canonicalKey));
    groups.push(make("OTHER", { label: "Sin firma técnica común", units: all, signals: new Set<string>() }, "UNSPECIFIED"));
    outliers.length = 0;
  }
  groups.sort((a, b) => b.members.length - a.members.length || a.signature.localeCompare(b.signature));
  return { groups, outliers: outliers.sort(), reclassifications, analyzableCases: total, mixed: groups.filter((group) => group.kind === "FAILURE_MODE").length >= 2 };
}
