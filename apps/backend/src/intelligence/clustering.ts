import { createHash } from "node:crypto";

import { addDays } from "./periods.js";
import { round, tokenize } from "./text.js";
import type { IntelligenceConfig } from "./config.js";
import type { CanonicalUnit, ClusterResult, FailureGroup } from "./types.js";

type Vector = Map<string, number>;

const SERVICE_BONUS = 0.12;
const CLASSIFICATION_BONUS = 0.08;
const CENTROID_TERMS = 40;

/** Weighted features: title counts most, then error text, then free text. Classification is a structured token. */
export function featureTokens(unit: CanonicalUnit): string[] {
  const { root } = unit;
  const repeat = (tokens: string[], times: number) => Array.from({ length: times }, () => tokens).flat();
  const children = unit.children.map((child) => `${child.summary} ${child.closeMessage}`).join(" ");
  const comments = root.comments.filter((comment) => !comment.noise).slice(0, 5).map((comment) => comment.body).join(" ");
  return [
    ...repeat(tokenize(root.summary), 3),
    ...repeat(tokenize(unit.errorMessage), 2),
    ...tokenize(root.description),
    ...tokenize(unit.closeMessage),
    ...tokenize(children),
    ...tokenize(comments),
    ...tokenize(unit.classification).map((token) => `cls:${token}`),
  ];
}

export interface VectorModel {
  idf: Map<string, number>;
  defaultIdf: number;
}

const normalizeVector = (vector: Vector): Vector => {
  const norm = Math.sqrt([...vector.values()].reduce((sum, value) => sum + value * value, 0));
  if (norm === 0) return vector;
  return new Map([...vector].map(([term, value]) => [term, value / norm]));
};

export function buildModel(units: CanonicalUnit[]): { model: VectorModel; vectors: Map<string, Vector> } {
  const documents = units.map((unit) => ({ key: unit.canonicalKey, tokens: featureTokens(unit) }));
  const df = new Map<string, number>();
  for (const { tokens } of documents) for (const term of new Set(tokens)) df.set(term, (df.get(term) ?? 0) + 1);
  const total = documents.length;
  const idf = new Map([...df].map(([term, count]) => [term, Math.log((total + 1) / (count + 1)) + 1]));
  const model: VectorModel = { idf, defaultIdf: Math.log(total + 1) + 1 };
  return { model, vectors: new Map(documents.map(({ key, tokens }) => [key, weigh(tokens, model)])) };
}

function weigh(tokens: string[], model: VectorModel): Vector {
  const tf = new Map<string, number>();
  for (const token of tokens) tf.set(token, (tf.get(token) ?? 0) + 1);
  return normalizeVector(new Map([...tf].map(([term, count]) => [term, Math.log1p(count) * (model.idf.get(term) ?? model.defaultIdf)])));
}

export const vectorize = (unit: CanonicalUnit, model: VectorModel) => weigh(featureTokens(unit), model);

function dot(a: Vector, b: Vector): number {
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let sum = 0;
  for (const [term, value] of small) {
    const other = large.get(term);
    if (other !== undefined) sum += value * other;
  }
  return sum;
}

interface Group {
  members: CanonicalUnit[];
  centroid: Vector;
}

function centroidOf(members: CanonicalUnit[], vectors: Map<string, Vector>): Vector {
  const sum = new Map<string, number>();
  for (const member of members) for (const [term, value] of vectors.get(member.canonicalKey)!) sum.set(term, (sum.get(term) ?? 0) + value);
  return normalizeVector(sum);
}

/** Similarity combines text semantics with structured context (service/classification) without relying on them alone. */
function similarity(unit: CanonicalUnit, vector: Vector, group: Group): number {
  const text = dot(vector, group.centroid);
  const head = group.members[0];
  let bonus = 0;
  if (unit.service && head.service && unit.service.toLowerCase() === head.service.toLowerCase()) bonus += SERVICE_BONUS;
  if (unit.classification && head.classification && unit.classification.toLowerCase() === head.classification.toLowerCase()) bonus += CLASSIFICATION_BONUS;
  return text === 0 ? 0 : text * (1 - SERVICE_BONUS - CLASSIFICATION_BONUS) + bonus * (text > 0.1 ? 1 : 0);
}

const byDateThenKey = (a: CanonicalUnit, b: CanonicalUnit) => a.periodDate.localeCompare(b.periodDate) || a.canonicalKey.localeCompare(b.canonicalKey);

function weekStart(day: string): string {
  const date = new Date(`${day}T00:00:00Z`);
  return addDays(day, -((date.getUTCDay() + 6) % 7));
}

export interface ClusteringOutput {
  clusters: ClusterResult[];
  /** Units that did not reach the minimum cluster size. */
  isolated: string[];
  model: VectorModel;
}

/** Deterministic centroid clustering (single pass + refinement + merge). Not a keyword/application grouping. */
export function clusterUnits(units: CanonicalUnit[], config: IntelligenceConfig, window: { from: string; to: string }, segment: (members: CanonicalUnit[]) => FailureGroup[]): ClusteringOutput {
  const { model, vectors } = buildModel(units);
  const threshold = config.clustering.similarityThreshold;
  const ordered = [...units].sort(byDateThenKey);
  let groups: Group[] = [];

  for (const unit of ordered) {
    const vector = vectors.get(unit.canonicalKey)!;
    let best = -1;
    let bestScore = 0;
    groups.forEach((group, index) => {
      const score = similarity(unit, vector, group);
      if (score > bestScore) {
        bestScore = score;
        best = index;
      }
    });
    if (best >= 0 && bestScore >= threshold) {
      groups[best].members.push(unit);
      groups[best].centroid = centroidOf(groups[best].members, vectors);
    } else groups.push({ members: [unit], centroid: vectors.get(unit.canonicalKey)! });
  }

  for (let pass = 0; pass < 3; pass++) {
    const next: Group[] = groups.map((group) => ({ members: [], centroid: group.centroid }));
    let moved = false;
    for (const unit of ordered) {
      const vector = vectors.get(unit.canonicalKey)!;
      let best = 0;
      let bestScore = -1;
      groups.forEach((group, index) => {
        const score = similarity(unit, vector, { members: group.members.length ? group.members : [unit], centroid: group.centroid });
        if (score > bestScore) {
          bestScore = score;
          best = index;
        }
      });
      if (!groups[best].members.includes(unit)) moved = true;
      next[best].members.push(unit);
    }
    groups = next.filter((group) => group.members.length > 0).map((group) => ({ members: group.members, centroid: centroidOf(group.members, vectors) }));
    if (!moved) break;
  }

  // Merge near-identical clusters produced by order effects.
  let merged = true;
  while (merged) {
    merged = false;
    outer: for (let i = 0; i < groups.length; i++) {
      for (let j = i + 1; j < groups.length; j++) {
        if (dot(groups[i].centroid, groups[j].centroid) >= Math.min(0.9, threshold + 0.25)) {
          const members = [...groups[i].members, ...groups[j].members];
          groups.splice(j, 1);
          groups[i] = { members, centroid: centroidOf(members, vectors) };
          merged = true;
          break outer;
        }
      }
    }
  }

  const spanDays = Math.round((Date.parse(window.to) - Date.parse(window.from)) / 86_400_000) + 1;
  const weekly = spanDays > 31;
  const clusters: ClusterResult[] = [];
  const isolated: string[] = [];
  for (const group of groups) {
    if (group.members.length < config.clustering.minClusterSize) {
      isolated.push(...group.members.map((member) => member.canonicalKey));
      continue;
    }
    clusters.push(describeCluster(group, vectors, config, units.length, weekly, segment));
  }
  clusters.sort((a, b) => b.members.length - a.members.length || a.id.localeCompare(b.id));
  return { clusters, isolated, model };
}

function describeCluster(group: Group, vectors: Map<string, Vector>, config: IntelligenceConfig, totalUnits: number, weekly: boolean, segment: (members: CanonicalUnit[]) => FailureGroup[]): ClusterResult {
  const sims = group.members.map((member) => ({ member, similarity: dot(vectors.get(member.canonicalKey)!, group.centroid) }));
  const cohesion = sims.reduce((sum, item) => sum + item.similarity, 0) / sims.length;
  const ranked = [...sims].sort((a, b) => b.similarity - a.similarity || a.member.canonicalKey.localeCompare(b.member.canonicalKey));
  const representativeKeys = new Set(ranked.slice(0, 5).map((item) => item.member.canonicalKey));
  const outliers = sims.filter((item) => item.similarity < config.clustering.similarityThreshold * 0.8).map((item) => item.member.canonicalKey);

  const topTerms = [...group.centroid]
    .filter(([term]) => !term.startsWith("cls:"))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 6)
    .map(([term]) => term);
  const centroid = Object.fromEntries([...group.centroid].sort((a, b) => b[1] - a[1]).slice(0, CENTROID_TERMS).map(([term, value]) => [term, round(value, 4)]));

  const dominant = (pick: (unit: CanonicalUnit) => string) => {
    const counts = new Map<string, number>();
    for (const member of group.members) {
      const value = pick(member);
      if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
    }
    return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? "";
  };

  const dates = group.members.map((member) => member.periodDate).sort();
  const timelineCounts = new Map<string, number>();
  for (const member of group.members) {
    const bucket = weekly ? weekStart(member.periodDate) : member.periodDate;
    timelineCounts.set(bucket, (timelineCounts.get(bucket) ?? 0) + 1);
  }
  const evidenceCoverage = group.members.filter((member) => member.errorUseful || member.closeMessage || member.root.description.length >= 40).length / group.members.length;
  const failureGroups = segment(group.members);
  const mixedFailureModes = failureGroups.filter((item) => item.signature !== "OTHER").length >= 2;
  const confidence = round(Math.min(1, cohesion * 0.5 + Math.min(1, group.members.length / 10) * 0.2 + evidenceCoverage * 0.3));
  const lowConfidence = cohesion < config.clustering.lowConfidenceCohesion || group.members.length < 3 || confidence < 0.45;
  const id = `cl_${createHash("sha1").update(group.members.map((member) => member.canonicalKey).sort().join("|")).digest("hex").slice(0, 12)}`;
  const service = dominant((unit) => unit.service);

  return {
    id,
    title: [topTerms.slice(0, 3).join(" · "), service].filter(Boolean).join(" — ") || id,
    members: sims.map((item) => ({ canonicalKey: item.member.canonicalKey, similarity: round(item.similarity), representative: representativeKeys.has(item.member.canonicalKey) })).sort((a, b) => b.similarity - a.similarity),
    topTerms,
    service,
    team: dominant((unit) => unit.team),
    dominantClassification: dominant((unit) => unit.classification),
    firstSeen: dates[0],
    lastSeen: dates.at(-1)!,
    openCases: group.members.filter((member) => !member.closed).length,
    closedCases: group.members.filter((member) => member.closed).length,
    reopenedCases: group.members.filter((member) => member.reopened).length,
    totalHours: round(group.members.reduce((sum, member) => sum + member.totalHours, 0), 1),
    cohesion: round(cohesion),
    outliers,
    mixedFailureModes,
    evidenceCoverage: round(evidenceCoverage),
    confidence,
    lowConfidence,
    failureGroups,
    timeline: [...timelineCounts].sort((a, b) => a[0].localeCompare(b[0])).map(([bucket, count]) => ({ bucket, count })),
    centroid,
  };
}

/** Assigns units from another period to existing clusters (same vector space). Used for period comparison. */
export function matchToClusters(units: CanonicalUnit[], model: VectorModel, clusters: ClusterResult[], threshold: number): { counts: Map<string, number>; unmatched: CanonicalUnit[] } {
  const counts = new Map<string, number>();
  const unmatched: CanonicalUnit[] = [];
  const centroids = clusters.map((cluster) => ({ id: cluster.id, vector: new Map(Object.entries(cluster.centroid)) as Vector }));
  for (const unit of units) {
    const vector = vectorize(unit, model);
    let best: string | undefined;
    let bestScore = 0;
    for (const centroid of centroids) {
      const score = dot(vector, normalizeVector(centroid.vector));
      if (score > bestScore) {
        bestScore = score;
        best = centroid.id;
      }
    }
    if (best && bestScore >= threshold) counts.set(best, (counts.get(best) ?? 0) + 1);
    else unmatched.push(unit);
  }
  return { counts, unmatched };
}
