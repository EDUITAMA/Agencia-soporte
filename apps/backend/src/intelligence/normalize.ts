import { createHash } from "node:crypto";

import { flattenJiraValue, type JiraIssue } from "../adapters/jira-normalizer.js";
import type { IntelligenceFieldIds } from "./config.js";
import type { AnalyticalCase, CaseComment, CaseLink } from "./types.js";

const asRecord = (value: unknown): Record<string, unknown> => (typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {});

const NOISE_COMMENT = [/^\s*(ok|gracias|thanks|listo|done|de acuerdo|recibido)[.!\s]*$/i, /^\s*\[?\s*(automatic|automático|auto)\b/i, /^\s*$/];

/** Jira fields requested for historical analysis (standard + configured analytical custom fields). */
export function historicalJiraFields(fieldIds: IntelligenceFieldIds): string[] {
  const base = [
    "summary", "description", "issuetype", "status", "priority", "created", "updated", "reporter", "creator", "assignee",
    "labels", "parent", "resolution", "resolutiondate", "issuelinks", "attachment", "comment",
  ];
  return [...new Set([...base, ...Object.values(fieldIds)])];
}

const text = (value: unknown) => flattenJiraValue(value);

/**
 * In this Jira instance the field named "Clasificación" (customfield_10705) is a LexoRank ordering token (type
 * gh-lexo-rank, e.g. "1|ikb8e0:"), not a category. Such values are ignored so no opaque ID reaches clustering or the UI.
 */
export function readableClassification(value: string): string {
  return /^\d+\|[0-9a-z]+:[0-9a-z]*$/i.test(value.trim()) ? "" : value;
}

/**
 * The "message" custom fields (Error Message, Close Message, equipment) hold a static HTML/JS UI banner identical on every
 * case, not case data. Markup or script-like content is treated as empty so it is never counted as coverage or cited as evidence.
 */
export function readableMessage(value: string): string {
  return /<\/?[a-z][a-z0-9]*[\s>/]|document\.|getElementById|ajs-user-locale/i.test(value) ? "" : value;
}

/** Applies the readability guards to a case loaded from the store (covers data persisted before the guards existed). */
export function sanitizeCase(item: AnalyticalCase): AnalyticalCase {
  return { ...item, classification: readableClassification(item.classification), errorMessage: readableMessage(item.errorMessage), closeMessage: readableMessage(item.closeMessage), equipmentId: readableMessage(item.equipmentId) };
}

function parseHours(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : Number(text(value).replace(",", "."));
  return Number.isFinite(parsed) && text(value) !== "" ? parsed : undefined;
}

const isYes = (value: string) => /^(yes|si|sí|true|1|reopened|reabierto)$/i.test(value.trim());

function parseComments(raw: unknown): CaseComment[] {
  const comments = asRecord(raw).comments;
  if (!Array.isArray(comments)) return [];
  return comments.map((entry, index) => {
    const comment = asRecord(entry);
    const body = text(comment.body);
    return {
      id: String(comment.id ?? index),
      author: text(comment.author),
      createdAt: text(comment.created),
      body,
      noise: NOISE_COMMENT.some((pattern) => pattern.test(body)),
    };
  });
}

function parseLinks(raw: unknown): CaseLink[] {
  if (!Array.isArray(raw)) return [];
  const links: CaseLink[] = [];
  for (const entry of raw) {
    const link = asRecord(entry);
    const type = text(asRecord(link.type).name);
    const inward = asRecord(link.inwardIssue).key;
    const outward = asRecord(link.outwardIssue).key;
    if (typeof inward === "string") links.push({ key: inward, type, direction: "inward" });
    if (typeof outward === "string") links.push({ key: outward, type, direction: "outward" });
  }
  return links;
}

/** Normalizes one Jira issue into the analytical model. Throws when the payload has no usable key. */
export function toAnalyticalCase(issue: JiraIssue, fieldIds: IntelligenceFieldIds, baseUrl?: string): AnalyticalCase {
  if (!issue?.key || typeof issue.fields !== "object" || issue.fields === null) throw new Error("Jira issue payload is missing key or fields");
  const fields = issue.fields;
  const statusCategory = text(asRecord(asRecord(fields.status).statusCategory).key).toLowerCase();
  const resolution = text(fields.resolution);
  const resolvedAt = text(fields.resolutiondate) || undefined;
  const closed = statusCategory ? statusCategory === "done" : Boolean(resolution || resolvedAt);
  const parentKey = text(asRecord(fields.parent).key) || undefined;
  const comments = parseComments(fields.comment);

  const base = {
    jiraKey: issue.key,
    jiraId: issue.id ?? issue.key,
    issueType: text(fields.issuetype),
    parentKey,
    summary: text(fields.summary),
    description: text(fields.description),
    status: text(fields.status),
    closed,
    priority: text(fields.priority),
    service: text(fields[fieldIds.service]),
    team: text(fields[fieldIds.team]),
    serviceLine: text(fields[fieldIds.serviceLine]),
    commercialGroup: text(fields[fieldIds.commercialGroup]),
    classification: readableClassification(text(fields[fieldIds.classification])),
    equipmentId: readableMessage(text(fields[fieldIds.equipmentId])),
    prioritized: text(fields[fieldIds.prioritized]),
    reopened: isYes(text(fields[fieldIds.reopened])),
    totalHours: parseHours(fields[fieldIds.totalHours]),
    errorMessage: readableMessage(text(fields[fieldIds.errorMessage])),
    closeMessage: readableMessage(text(fields[fieldIds.closeMessage])),
    aiUsage: text(fields[fieldIds.aiUsage]),
    sla: text(fields[fieldIds.sla]),
    reporter: text(fields.reporter),
    creator: text(fields.creator),
    assignee: text(fields.assignee),
    labels: Array.isArray(fields.labels) ? (fields.labels as unknown[]).map(String) : [],
    createdAt: text(fields.created),
    updatedAt: text(fields.updated),
    resolution,
    resolvedAt,
    url: baseUrl ? `${baseUrl}/browse/${issue.key}` : undefined,
    comments,
    links: parseLinks(fields.issuelinks),
    attachmentCount: Array.isArray(fields.attachment) ? fields.attachment.length : 0,
  };
  const version = createHash("sha1")
    .update(JSON.stringify([base.updatedAt, base.status, base.summary, base.description, base.errorMessage, base.closeMessage, base.service, base.team, base.classification, base.reopened, base.totalHours, comments.length, base.parentKey]))
    .digest("hex")
    .slice(0, 16);
  return { ...base, version };
}
