import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from "node:fs";
import { dirname } from "node:path";

import type { AuditEntry, CaseRecord, ConnectionStatus, RunSummary } from "../domain/types.js";

interface StateShape {
  cases: Record<string, CaseRecord>;
  audit: AuditEntry[];
  lastRun: RunSummary | null;
  lastSyncAt: string | null;
}

const MAX_AUDIT = 2000;

/** Small JSON-file backed store (in-memory when no file is given). Holds processed cases, idempotency data and audit. */
export class StateStore {
  private state: StateShape = { cases: {}, audit: [], lastRun: null, lastSyncAt: null };
  lastConnection: ConnectionStatus | null = null;

  constructor(private readonly filePath?: string) {
    if (filePath && existsSync(filePath)) {
      try {
        this.state = { ...this.state, ...(JSON.parse(readFileSync(filePath, "utf8")) as Partial<StateShape>) };
      } catch {
        console.error("[store] state file is unreadable; starting with an empty state");
      }
    }
  }

  private persist(): void {
    if (!this.filePath) return;
    mkdirSync(dirname(this.filePath), { recursive: true });
    const temp = `${this.filePath}.tmp`;
    writeFileSync(temp, JSON.stringify(this.state));
    renameSync(temp, this.filePath);
  }

  getCase(id: string): CaseRecord | undefined {
    return this.state.cases[id];
  }

  allCases(): CaseRecord[] {
    return Object.values(this.state.cases).sort((a, b) => b.supportCase.createdAt.localeCompare(a.supportCase.createdAt));
  }

  upsertCase(record: CaseRecord): void {
    this.state.cases[record.caseId] = record;
    this.persist();
  }

  appendAudit(entry: AuditEntry): void {
    this.state.audit.push(entry);
    if (this.state.audit.length > MAX_AUDIT) this.state.audit.splice(0, this.state.audit.length - MAX_AUDIT);
    this.persist();
  }

  recentAudit(limit = 50, caseId?: string): AuditEntry[] {
    const source = caseId ? this.state.audit.filter((entry) => entry.caseId === caseId) : this.state.audit;
    return source.slice(-limit).reverse();
  }

  get lastRun(): RunSummary | null {
    return this.state.lastRun;
  }

  get lastSyncAt(): string | null {
    return this.state.lastSyncAt;
  }

  recordRun(summary: RunSummary, synced: boolean): void {
    this.state.lastRun = summary;
    if (synced) this.state.lastSyncAt = summary.finishedAt;
    this.persist();
  }
}
