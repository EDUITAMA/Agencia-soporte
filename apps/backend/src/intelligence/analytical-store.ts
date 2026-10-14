import { DuckDBInstance, type DuckDBConnection } from "@duckdb/node-api";
import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { basename, dirname, join } from "node:path";

type Param = string | number | boolean | null | undefined;
export type Row = Record<string, unknown>;

/** Idempotent schema. The analytical store never replaces Jira as the source of truth. */
const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS jira_sync_runs (
    id VARCHAR PRIMARY KEY, started_at VARCHAR, finished_at VARCHAR, status VARCHAR, jql VARCHAR,
    period_from VARCHAR, period_to VARCHAR, incremental BOOLEAN, fetched INTEGER, changed INTEGER, error VARCHAR)`,
  `CREATE TABLE IF NOT EXISTS jira_cases (
    jira_key VARCHAR PRIMARY KEY, jira_id VARCHAR, issue_type VARCHAR, parent_key VARCHAR, summary VARCHAR, description VARCHAR,
    status VARCHAR, closed BOOLEAN, priority VARCHAR, service VARCHAR, team VARCHAR, service_line VARCHAR, commercial_group VARCHAR,
    classification VARCHAR, equipment_id VARCHAR, prioritized VARCHAR, reopened BOOLEAN, total_hours DOUBLE, error_message VARCHAR,
    close_message VARCHAR, ai_usage VARCHAR, sla VARCHAR, reporter VARCHAR, creator VARCHAR, assignee VARCHAR, labels VARCHAR,
    created_at VARCHAR, updated_at VARCHAR, resolution VARCHAR, resolved_at VARCHAR, url VARCHAR, attachment_count INTEGER,
    version VARCHAR, case_json VARCHAR, raw_json VARCHAR, first_synced_at VARCHAR, last_synced_at VARCHAR)`,
  `CREATE TABLE IF NOT EXISTS jira_case_comments (
    id VARCHAR PRIMARY KEY, jira_key VARCHAR, author VARCHAR, created_at VARCHAR, body VARCHAR, noise BOOLEAN)`,
  `CREATE TABLE IF NOT EXISTS jira_case_relationships (
    jira_key VARCHAR, related_key VARCHAR, relationship VARCHAR, link_type VARCHAR, PRIMARY KEY (jira_key, related_key, relationship))`,
  `CREATE TABLE IF NOT EXISTS analysis_runs (
    id VARCHAR PRIMARY KEY, period_type VARCHAR, period_from VARCHAR, period_to VARCHAR, previous_from VARCHAR, previous_to VARCHAR,
    status VARCHAR, progress_json VARCHAR, fingerprint VARCHAR, analysis_version VARCHAR, clustering_version VARCHAR,
    prompt_version VARCHAR, model_config VARCHAR, trigger VARCHAR, started_at VARCHAR, completed_at VARCHAR,
    cases_fetched INTEGER, cases_eligible INTEGER, cases_excluded INTEGER, clusters INTEGER, failure_groups INTEGER, ai_runs INTEGER,
    error VARCHAR, warnings_json VARCHAR)`,
  `CREATE TABLE IF NOT EXISTS analysis_run_cases (
    run_id VARCHAR, canonical_key VARCHAR, jira_key VARCHAR, role VARCHAR, case_version VARCHAR, case_updated_at VARCHAR,
    eligibility VARCHAR, eligibility_reason VARCHAR, analysis_text VARCHAR, inherited_fields VARCHAR, period_date VARCHAR,
    service VARCHAR, team VARCHAR, classification VARCHAR, closed BOOLEAN, reopened BOOLEAN, total_hours DOUBLE,
    cluster_id VARCHAR, failure_group_id VARCHAR, PRIMARY KEY (run_id, jira_key))`,
  `CREATE TABLE IF NOT EXISTS clusters (
    id VARCHAR, run_id VARCHAR, title VARCHAR, description VARCHAR, case_count INTEGER, percentage DOUBLE, service VARCHAR, team VARCHAR,
    dominant_classification VARCHAR, first_seen VARCHAR, last_seen VARCHAR, open_cases INTEGER, closed_cases INTEGER, reopened_cases INTEGER,
    total_hours DOUBLE, cohesion DOUBLE, confidence DOUBLE, low_confidence BOOLEAN, mixed_failure_modes BOOLEAN, evidence_coverage DOUBLE,
    outliers_json VARCHAR, top_terms_json VARCHAR, timeline_json VARCHAR, centroid_json VARCHAR, previous_count INTEGER, trend VARCHAR,
    rootcause_status VARCHAR, PRIMARY KEY (run_id, id))`,
  `CREATE TABLE IF NOT EXISTS cluster_members (
    run_id VARCHAR, cluster_id VARCHAR, canonical_key VARCHAR, similarity DOUBLE, representative BOOLEAN, PRIMARY KEY (run_id, cluster_id, canonical_key))`,
  `CREATE TABLE IF NOT EXISTS failure_groups (
    id VARCHAR, run_id VARCHAR, cluster_id VARCHAR, signature VARCHAR, label VARCHAR, case_count INTEGER, percentage DOUBLE,
    signals_json VARCHAR, representative_json VARCHAR, PRIMARY KEY (run_id, id))`,
  `CREATE TABLE IF NOT EXISTS cluster_evidence (
    id VARCHAR, run_id VARCHAR, cluster_id VARCHAR, failure_group_id VARCHAR, jira_key VARCHAR, field VARCHAR, snippet VARCHAR,
    reason VARCHAR, PRIMARY KEY (run_id, cluster_id, id))`,
  `CREATE TABLE IF NOT EXISTS ai_task_runs (
    id VARCHAR PRIMARY KEY, run_id VARCHAR, cluster_id VARCHAR, failure_group_id VARCHAR, role VARCHAR, task VARCHAR, model VARCHAR,
    status VARCHAR, retry INTEGER, error_class VARCHAR, started_at VARCHAR, completed_at VARCHAR, duration_ms INTEGER, output_json VARCHAR)`,
  `CREATE TABLE IF NOT EXISTS rootcause_candidates (
    id VARCHAR, run_id VARCHAR, cluster_id VARCHAR, failure_group_id VARCHAR, title VARCHAR, description VARCHAR, level VARCHAR,
    confidence DOUBLE, evidence_json VARCHAR, affected_cases_json VARCHAR, business_impact VARCHAR, technical_signals_json VARCHAR,
    limitations_json VARCHAR, next_steps_json VARCHAR, PRIMARY KEY (run_id, id))`,
  `CREATE TABLE IF NOT EXISTS analysis_reports (
    run_id VARCHAR, kind VARCHAR, generated_at VARCHAR, content_json VARCHAR, PRIMARY KEY (run_id, kind))`,
  `CREATE TABLE IF NOT EXISTS analysis_events (
    id VARCHAR PRIMARY KEY, run_id VARCHAR, ts VARCHAR, level VARCHAR, phase VARCHAR, message VARCHAR)`,
  `CREATE TABLE IF NOT EXISTS cluster_ai_state (
    run_id VARCHAR, cluster_id VARCHAR, priority_score DOUBLE, priority_json VARCHAR, depth VARCHAR, reused BOOLEAN,
    fingerprint VARCHAR, analysis_json VARCHAR, updated_at VARCHAR, PRIMARY KEY (run_id, cluster_id))`,
  `CREATE TABLE IF NOT EXISTS ai_result_cache (
    fingerprint VARCHAR PRIMARY KEY, cluster_id VARCHAR, depth VARCHAR, created_at VARCHAR, analysis_json VARCHAR)`,
  ...[
    "data_fingerprint VARCHAR", "analysis_mode VARCHAR", "requested_clusters VARCHAR", "processed_clusters INTEGER", "reused_clusters INTEGER",
    "ai_skipped INTEGER", "pipeline_version VARCHAR", "ai_fingerprint VARCHAR", "last_checked_at VARCHAR", "prepared_at VARCHAR", "normalization_version VARCHAR",
    "selection_json VARCHAR", "ai_started_at VARCHAR", "ai_completed_at VARCHAR",
  ].map((column) => `ALTER TABLE analysis_runs ADD COLUMN IF NOT EXISTS ${column}`),
  `ALTER TABLE rootcause_candidates ADD COLUMN IF NOT EXISTS status VARCHAR`,
  `CREATE TABLE IF NOT EXISTS analysis_failure_groups (
    run_id VARCHAR, cluster_id VARCHAR, id VARCHAR, signature VARCHAR, label VARCHAR, kind VARCHAR, case_count INTEGER, percentage DOUBLE,
    confidence DOUBLE, signals_json VARCHAR, members_json VARCHAR, segmentation_version VARCHAR, PRIMARY KEY (run_id, cluster_id, id))`,
  `CREATE TABLE IF NOT EXISTS analysis_evidence_items (
    run_id VARCHAR, cluster_id VARCHAR, id VARCHAR, fingerprint VARCHAR, failure_group_id VARCHAR, jira_key VARCHAR, field VARCHAR,
    snippet VARCHAR, reason VARCHAR, evidence_version VARCHAR, PRIMARY KEY (run_id, cluster_id, id))`,
  `CREATE TABLE IF NOT EXISTS role_runs (
    id VARCHAR PRIMARY KEY, run_id VARCHAR, cluster_id VARCHAR, role VARCHAR, task VARCHAR, model VARCHAR, status VARCHAR, reason VARCHAR,
    attempts INTEGER, duration_ms INTEGER, prompt_version VARCHAR, prompt_hash VARCHAR, evidence_hash VARCHAR, pipeline_version VARCHAR,
    raw_claims INTEGER, verified_claims INTEGER, error_class VARCHAR, summary VARCHAR, missing_json VARCHAR, response_json VARCHAR)`,
  `CREATE TABLE IF NOT EXISTS role_claims (
    run_id VARCHAR, cluster_id VARCHAR, id VARCHAR, role VARCHAR, failure_group_id VARCHAR, claim VARCHAR, level VARCHAR, confidence DOUBLE,
    evidence_json VARCHAR, limitations_json VARCHAR, PRIMARY KEY (run_id, cluster_id, id))`,
  `CREATE TABLE IF NOT EXISTS claim_validations (
    run_id VARCHAR, cluster_id VARCHAR, claim_id VARCHAR, verdict VARCHAR, action VARCHAR, reason VARCHAR, PRIMARY KEY (run_id, cluster_id, claim_id))`,
  `CREATE TABLE IF NOT EXISTS consolidated_findings (
    run_id VARCHAR, cluster_id VARCHAR, id VARCHAR, failure_group_id VARCHAR, statement VARCHAR, level VARCHAR, confidence DOUBLE, status VARCHAR,
    roles_json VARCHAR, claim_ids_json VARCHAR, evidence_json VARCHAR, limitations_json VARCHAR, PRIMARY KEY (run_id, cluster_id, id))`,
  `CREATE TABLE IF NOT EXISTS cluster_recommendations (
    run_id VARCHAR, cluster_id VARCHAR, id VARCHAR, action VARCHAR, rationale VARCHAR, owner VARCHAR, priority VARCHAR, finding_ids_json VARCHAR,
    roles_json VARCHAR, PRIMARY KEY (run_id, cluster_id, id))`,
  `CREATE TABLE IF NOT EXISTS ops_reports (
    id VARCHAR PRIMARY KEY, run_id VARCHAR, kind VARCHAR, version INTEGER, status VARCHAR, cache_key VARCHAR, report_version VARCHAR,
    data_fingerprint VARCHAR, pipeline_version VARCHAR, prompt_version VARCHAR, model VARCHAR, ai_calls INTEGER, generated_at VARCHAR, content_json VARCHAR)`,
  `CREATE TABLE IF NOT EXISTS cluster_period_series (
    run_id VARCHAR, cluster_id VARCHAR, period_from VARCHAR, period_to VARCHAR, case_count INTEGER, PRIMARY KEY (run_id, cluster_id, period_from))`,
  `CREATE TABLE IF NOT EXISTS recommendation_state (
    run_id VARCHAR, cluster_id VARCHAR, recommendation_id VARCHAR, state VARCHAR, updated_at VARCHAR, PRIMARY KEY (run_id, cluster_id, recommendation_id))`,
  `CREATE TABLE IF NOT EXISTS candidate_reviews (
    id VARCHAR PRIMARY KEY, run_id VARCHAR, cluster_id VARCHAR, candidate_id VARCHAR, verdict VARCHAR, reviewer VARCHAR, reviewed_at VARCHAR, comment VARCHAR)`,
  `CREATE TABLE IF NOT EXISTS schema_meta (key VARCHAR PRIMARY KEY, value VARCHAR)`,
  `DROP INDEX IF EXISTS idx_jira_cases_created`,
  `DROP INDEX IF EXISTS idx_jira_cases_parent`,
  `CREATE INDEX IF NOT EXISTS idx_run_cases_run ON analysis_run_cases(run_id)`,
];

/**
 * Bump when the schema changes in a way that justifies a safety copy. Version 2 drops the secondary indexes on jira_cases:
 * DuckDB can raise a fatal "Failed to delete all rows from index" when a cached case is replaced in place.
 */
const SCHEMA_VERSION = "2";
const BACKUP_RETENTION = 5;

const normalize = (value: unknown): unknown => {
  if (typeof value === "bigint") return Number(value);
  if (value instanceof Date) return value.toISOString();
  return value;
};

/**
 * Thin wrapper over the embedded analytical database (DuckDB). Statements are serialized through one queue so a
 * single connection is safe from concurrent analysis jobs and API reads.
 */
export class AnalyticalStore {
  private queue: Promise<unknown> = Promise.resolve();

  private constructor(
    private readonly connection: DuckDBConnection,
    readonly path: string,
  ) {}

  static async open(path: string): Promise<AnalyticalStore> {
    const existed = path !== ":memory:" && existsSync(path);
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    const instance = await DuckDBInstance.create(path);
    const store = new AnalyticalStore(await instance.connect(), path);
    if (existed) {
      const version = await store.storedVersion();
      if (version !== SCHEMA_VERSION) await store.backup(`pre-v${SCHEMA_VERSION}`).catch((error) => console.error(`[intelligence] backup before migration failed: ${(error as Error).message}`));
    }
    for (const statement of SCHEMA) await store.run(statement);
    await store.run(`INSERT OR REPLACE INTO schema_meta VALUES ('schema_version', ?)`, [SCHEMA_VERSION]);
    return store;
  }

  private async storedVersion(): Promise<string | null> {
    try {
      const rows = await this.query(`SELECT value FROM schema_meta WHERE key = 'schema_version'`);
      return rows.length ? String(rows[0].value) : null;
    } catch {
      return null;
    }
  }

  /** Online single-file copy (works while the database is open). Restore: stop the service and replace the database file with the copy. */
  async backup(label = "manual"): Promise<string | null> {
    if (this.path === ":memory:") return null;
    const directory = join(dirname(this.path), "backups");
    mkdirSync(directory, { recursive: true });
    const stem = basename(this.path).replace(/\.duckdb$/i, "");
    const target = join(directory, `${stem}-${label}-${new Date().toISOString().replace(/[:.]/g, "-")}.duckdb`);
    const main = String((await this.query(`SELECT current_database() AS name`))[0].name);
    await this.run(`CHECKPOINT`);
    await this.run(`ATTACH '${target.replaceAll("'", "''")}' AS backup_copy`);
    try {
      await this.run(`COPY FROM DATABASE "${main.replaceAll('"', '""')}" TO backup_copy`);
    } finally {
      await this.run(`DETACH backup_copy`);
    }
    const copies = readdirSync(directory).filter((name) => name.startsWith(`${stem}-`) && name.endsWith(".duckdb")).sort();
    for (const stale of copies.slice(0, Math.max(0, copies.length - BACKUP_RETENTION))) rmSync(join(directory, stale), { force: true });
    return target;
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const next = this.queue.then(task, task);
    this.queue = next.catch(() => undefined);
    return next;
  }

  run(sql: string, params: Param[] = []): Promise<void> {
    return this.enqueue(async () => {
      await this.connection.run(sql, params.map((p) => (p === undefined ? null : p)));
    });
  }

  query<T extends Row = Row>(sql: string, params: Param[] = []): Promise<T[]> {
    return this.enqueue(async () => {
      const reader = await this.connection.runAndReadAll(sql, params.map((p) => (p === undefined ? null : p)));
      return reader.getRowObjects().map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, normalize(value)]))) as T[];
    });
  }

  async queryOne<T extends Row = Row>(sql: string, params: Param[] = []): Promise<T | undefined> {
    return (await this.query<T>(sql, params))[0];
  }

  /** Runs statements atomically. Callers must not call other store methods while the transaction is open from another job. */
  transaction(work: (tx: { run: (sql: string, params?: Param[]) => Promise<void> }) => Promise<void>): Promise<void> {
    return this.enqueue(async () => {
      await this.connection.run("BEGIN TRANSACTION");
      try {
        await work({ run: async (sql, params = []) => void (await this.connection.run(sql, params.map((p) => (p === undefined ? null : p)))) });
        await this.connection.run("COMMIT");
      } catch (error) {
        await this.connection.run("ROLLBACK").catch(() => undefined);
        throw error;
      }
    });
  }

  close(): void {
    this.connection.closeSync();
  }
}
