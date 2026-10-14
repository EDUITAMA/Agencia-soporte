import type { CaseAttachment, SupportCase } from "../domain/types.js";

type JiraValue = unknown;

export interface JiraIssue {
  id?: string;
  key?: string;
  self?: string;
  fields?: Record<string, JiraValue>;
}

/** Flattens the many shapes Jira uses for field values (string, {name}, {value}, arrays, ADF) into plain text. */
export function flattenJiraValue(value: JiraValue): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(flattenJiraValue).filter(Boolean).join(", ");
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (record.type === "doc") return flattenAdf(record).trim();
    for (const key of ["displayName", "name", "value", "key"]) {
      if (typeof record[key] === "string" && record[key]) return (record[key] as string).trim();
    }
  }
  return "";
}

function flattenAdf(node: Record<string, unknown>): string {
  if (typeof node.text === "string") return node.text;
  const content = Array.isArray(node.content) ? (node.content as Record<string, unknown>[]) : [];
  const text = content.map(flattenAdf).join(node.type === "doc" ? "\n" : "");
  return node.type === "paragraph" ? `${text}\n` : text;
}

function firstNonEmpty(fields: Record<string, JiraValue>, candidates: string[] | undefined): string {
  for (const id of candidates ?? []) {
    const flattened = flattenJiraValue(fields[id]);
    if (flattened) return flattened;
  }
  return "";
}

export interface NormalizeOptions {
  baseUrl?: string;
  fieldMap: Record<string, string[]>;
}

/** Maps a Jira issue to the source-agnostic SupportCase. Throws when the payload has no usable key. */
export function normalizeJiraIssue(issue: JiraIssue, options: NormalizeOptions): SupportCase {
  if (!issue || typeof issue !== "object" || !issue.key || typeof issue.fields !== "object" || issue.fields === null) {
    throw new Error("Jira issue payload is missing key or fields");
  }
  const fields = issue.fields;
  const attachments: CaseAttachment[] = Array.isArray(fields.attachment)
    ? (fields.attachment as Record<string, unknown>[]).map((item) => ({
        id: String(item.id ?? ""),
        filename: String(item.filename ?? ""),
        mimeType: typeof item.mimeType === "string" ? item.mimeType : undefined,
        size: typeof item.size === "number" ? item.size : undefined,
      }))
    : [];

  const mapped = new Set(["summary", "description", "status", "priority", "reporter", "created", "updated", "issuetype", "attachment"]);
  const extra: Record<string, string> = {};
  for (const [canonical, candidates] of Object.entries(options.fieldMap)) {
    if (canonical === "application" || canonical === "environment") continue;
    const value = firstNonEmpty(fields, candidates);
    if (value) extra[canonical] = value;
    candidates.forEach((candidate) => mapped.add(candidate));
  }
  const labels = flattenJiraValue(fields.labels);
  if (labels) extra.labels = labels;

  return {
    id: issue.key,
    externalId: issue.id ?? issue.key,
    source: "JIRA",
    summary: flattenJiraValue(fields.summary),
    description: flattenJiraValue(fields.description),
    status: flattenJiraValue(fields.status),
    priority: flattenJiraValue(fields.priority),
    application: firstNonEmpty(fields, options.fieldMap.application),
    environment: firstNonEmpty(fields, options.fieldMap.environment),
    reporter: flattenJiraValue(fields.reporter),
    createdAt: flattenJiraValue(fields.created),
    updatedAt: flattenJiraValue(fields.updated),
    issueType: flattenJiraValue(fields.issuetype) || undefined,
    url: options.baseUrl ? `${options.baseUrl}/browse/${issue.key}` : undefined,
    attachments,
    fields: extra,
  };
}

/** Jira field ids to request: standard fields plus everything referenced by the field map. */
export function requestedJiraFields(fieldMap: Record<string, string[]>): string[] {
  const base = ["summary", "description", "status", "priority", "reporter", "created", "updated", "issuetype", "attachment", "labels"];
  return [...new Set([...base, ...Object.values(fieldMap).flat()])];
}
