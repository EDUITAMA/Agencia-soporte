import { maskVolatile, normalizeSpaces, tokenize, truncate, fold } from "./text.js";
import type { IntelligenceConfig } from "./config.js";
import { readableClassification } from "./normalize.js";
import type { AnalyticalCase, CanonicalUnit, CaseComment, Eligibility } from "./types.js";

const PLACEHOLDER = /^(n\/?a|none|null|ninguno|ninguna|sin error|no aplica|no error|-+|\.+|error|unknown|desconocido|undefined)$/i;
const SECRET = /\b(bearer\s+[a-z0-9._~+/=-]{12,}|(?:password|passwd|pwd|secret|token|api[_-]?key)\s*[:=]\s*\S+)/gi;

export const redactSecrets = (value: string) => value.replace(SECRET, "[redacted]");

export interface ErrorProfile {
  total: number;
  withValue: number;
  /** Normalized values that repeat too often to be informative (boilerplate/default values). */
  boilerplate: Set<string>;
  usefulCount: number;
  isUseful(message: string): boolean;
}

const errorKey = (message: string) => normalizeSpaces(fold(maskVolatile(message)));

/**
 * Error Message may be filled in almost every case with default values. Before it gets weight it is profiled:
 * placeholders, empty semantic content and values repeated across a large share of cases are not evidence.
 */
export function profileErrorMessages(cases: AnalyticalCase[]): ErrorProfile {
  const counts = new Map<string, number>();
  let withValue = 0;
  for (const item of cases) {
    if (!item.errorMessage) continue;
    withValue++;
    const key = errorKey(item.errorMessage);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const boilerplate = new Set<string>();
  const repeatThreshold = Math.max(5, Math.ceil(withValue * 0.25));
  for (const [key, count] of counts) if (count >= repeatThreshold) boilerplate.add(key);

  const isUseful = (message: string) => {
    const trimmed = message.trim();
    if (!trimmed || PLACEHOLDER.test(trimmed)) return false;
    if ((trimmed.match(/[a-zA-ZÀ-ÿ]/g) ?? []).length < 4) return false;
    return !boilerplate.has(errorKey(trimmed));
  };
  const usefulCount = cases.filter((item) => item.errorMessage && isUseful(item.errorMessage)).length;
  return { total: cases.length, withValue, boilerplate, usefulCount, isUseful };
}

const dayOf = (iso: string) => iso.slice(0, 10);

function relevantComments(comments: CaseComment[], limit: number): CaseComment[] {
  return comments
    .filter((comment) => !comment.noise && comment.body.length >= 25)
    .sort((a, b) => b.body.length - a.body.length)
    .slice(0, limit)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export interface BuildUnitsInput {
  /** Cases created inside the analysis period. */
  inPeriod: AnalyticalCase[];
  /** Every case available locally (context for parents/children). */
  universe: AnalyticalCase[];
  from: string;
  to: string;
}

/** Collapses a Support parent and its Sub-Support children into one analysis unit. Children stay individually stored. */
export function buildUnits(input: BuildUnitsInput, config: IntelligenceConfig, errorProfile: ErrorProfile): { units: CanonicalUnit[]; childRows: { child: AnalyticalCase; unit: CanonicalUnit; inherited: string[] }[] } {
  const byKey = new Map(input.universe.map((item) => [item.jiraKey, item]));
  const childrenOf = new Map<string, AnalyticalCase[]>();
  for (const item of byKey.values()) {
    if (item.parentKey) childrenOf.set(item.parentKey, [...(childrenOf.get(item.parentKey) ?? []), item]);
  }

  const rootKeys = new Set<string>();
  const orphanKeys = new Set<string>();
  for (const item of input.inPeriod) {
    if (item.parentKey && byKey.has(item.parentKey)) rootKeys.add(item.parentKey);
    else {
      rootKeys.add(item.jiraKey);
      if (item.parentKey) orphanKeys.add(item.jiraKey);
    }
  }

  const inPeriodKeys = new Set(input.inPeriod.map((item) => item.jiraKey));
  const units: CanonicalUnit[] = [];
  const childRows: { child: AnalyticalCase; unit: CanonicalUnit; inherited: string[] }[] = [];

  for (const key of [...rootKeys].sort()) {
    const root = byKey.get(key)!;
    const children = (childrenOf.get(key) ?? []).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const members = [root, ...children];
    const inPeriodMembers = members.filter((member) => inPeriodKeys.has(member.jiraKey));
    const periodDate = dayOf(inPeriodMembers.map((member) => member.createdAt).sort()[0] ?? root.createdAt);
    const firstNonEmpty = (pick: (item: AnalyticalCase) => string) => members.map(pick).find(Boolean) ?? "";

    const service = firstNonEmpty((item) => item.service);
    const team = firstNonEmpty((item) => item.team);
    const classification = firstNonEmpty((item) => readableClassification(item.classification));
    const errorCandidates = members.map((item) => item.errorMessage).filter((message) => message && errorProfile.isUseful(message));
    const errorMessage = errorCandidates[0] ?? "";
    const closeMessage = firstNonEmpty((item) => item.closeMessage);
    const rootHours = root.totalHours ?? 0;
    const totalHours = rootHours > 0 ? rootHours : children.reduce((sum, child) => sum + (child.totalHours ?? 0), 0);

    const unit: CanonicalUnit = {
      canonicalKey: key,
      root,
      children,
      periodDate,
      inheritedFields: [],
      orphanChild: orphanKeys.has(key),
      analysisText: "",
      eligibility: "ELIGIBLE_FOR_RCA",
      eligibilityReason: "",
      service,
      team,
      classification,
      errorMessage,
      closeMessage,
      errorUseful: Boolean(errorMessage),
      closed: members.every((member) => member.closed),
      reopened: members.some((member) => member.reopened),
      totalHours,
      resolvedAt: root.resolvedAt ?? children.map((child) => child.resolvedAt).filter(Boolean).sort().at(-1),
    };
    unit.analysisText = buildAnalysisText(unit, config);
    classify(unit, config);

    for (const child of children) {
      if (!inPeriodKeys.has(child.jiraKey)) continue;
      const inherited: string[] = [];
      if (!child.description && root.description) inherited.push("description");
      if (!child.service && root.service) inherited.push("service");
      if (!child.team && root.team) inherited.push("team");
      if (!child.classification && root.classification) inherited.push("classification");
      unit.inheritedFields = [...new Set([...unit.inheritedFields, ...inherited])];
      childRows.push({ child, unit, inherited });
    }
    units.push(unit);
  }
  markDuplicates(units);
  return { units, childRows };
}

/** Deterministic text for AI and traceability: only useful fields, redacted, with explicit provenance. */
export function buildAnalysisText(unit: CanonicalUnit, config: IntelligenceConfig): string {
  const { root, children } = unit;
  const lines: string[] = [];
  const push = (label: string, value: string, max: number) => {
    const clean = normalizeSpaces(redactSecrets(value));
    if (clean) lines.push(`${label}: ${truncate(clean, max)}`);
  };
  push("Resumen", root.summary, 300);
  push("Descripción", root.description, config.evidence.maxDescriptionChars);
  push("Mensaje de error", unit.errorMessage, 500);
  push("Mensaje de cierre", unit.closeMessage, 600);
  push("Clasificación", unit.classification, 120);
  push("Servicio", unit.service, 120);
  push("Equipo", unit.team, 120);
  for (const comment of relevantComments(root.comments, 3)) push(`Comentario (${comment.author || "anónimo"}, ${dayOf(comment.createdAt)})`, comment.body, 400);
  for (const child of children.slice(0, 5)) {
    const note = child.closeMessage || relevantComments(child.comments, 1)[0]?.body || child.description;
    push(`Subcaso ${child.jiraKey} (heredado del caso padre ${root.jiraKey})`, [child.summary, note].filter(Boolean).join(" — "), 400);
  }
  return lines.join("\n");
}

function classify(unit: CanonicalUnit, config: IntelligenceConfig): void {
  const set = (eligibility: Eligibility, reason: string) => {
    unit.eligibility = eligibility;
    unit.eligibilityReason = reason;
  };
  const { root } = unit;
  if (config.excludedIssueTypes.some((type) => type.toLowerCase() === root.issueType.toLowerCase())) return set("OTHER", `Tipo de caso excluido: ${root.issueType}`);
  const noise = config.noisePatterns.map((pattern) => new RegExp(pattern, "i"));
  if (noise.some((pattern) => pattern.test(root.summary)) && root.description.length < 40) return set("NOISE", "Resumen coincide con un patrón de ruido y no tiene descripción");
  const duplicateOf = root.links.find((link) => /duplicat/i.test(link.type) && link.direction === "outward");
  if (duplicateOf) return set("DUPLICATE", `Marcado como duplicado de ${duplicateOf.key}`);
  if (config.expectedServices.length > 0 && unit.service && !config.expectedServices.some((service) => service.toLowerCase() === unit.service.toLowerCase())) {
    return set("FOREIGN_SERVICE", `Servicio "${unit.service}" fuera del alcance configurado: posible reclasificación`);
  }
  const usefulTokens = tokenize([root.summary, root.description, unit.errorMessage, unit.closeMessage, ...unit.children.map((child) => `${child.summary} ${child.closeMessage}`), ...relevantComments(root.comments, 3).map((comment) => comment.body)].join(" "));
  if (usefulTokens.length < 4) return set("INSUFFICIENT_CONTEXT", "Texto útil insuficiente para agrupar o analizar");
  set("ELIGIBLE_FOR_RCA", "Contexto suficiente");
}

function markDuplicates(units: CanonicalUnit[]): void {
  const keys = new Set(units.map((unit) => unit.canonicalKey));
  for (const unit of units) {
    if (unit.eligibility === "DUPLICATE") {
      const target = unit.root.links.find((link) => /duplicat/i.test(link.type) && link.direction === "outward")?.key;
      if (target && !keys.has(target)) unit.eligibilityReason += " (el caso original está fuera del período)";
    }
  }
}
