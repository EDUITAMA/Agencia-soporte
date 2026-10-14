import type { CaseSourceAdapter } from "../adapters/case-source.js";
import { JiraRestAdapter } from "../adapters/jira-rest-adapter.js";
import type { SupportGuardConfig } from "../config/config.js";
import { DisabledLlmClient, BridgeLlmClient, MockLlmClient, type LlmClient } from "./ai/llm.js";
import { AnalyticalStore } from "./analytical-store.js";
import { loadIntelligenceConfig, type IntelligenceConfig } from "./config.js";
import { resolvePeriod } from "./periods.js";
import { OpsService } from "./ops/service.js";
import { IntelligenceService } from "./service.js";
import { MockHistoricalSource, type HistoricalIssueSource } from "./source.js";

export function createLlm(config: IntelligenceConfig): LlmClient {
  if (!config.ai.enabled) return new DisabledLlmClient();
  return config.ai.provider === "MOCK_AI" ? new MockLlmClient(config.ai.models) : new BridgeLlmClient(config.ai);
}

export function createHistoricalSource(adapter: CaseSourceAdapter, config: IntelligenceConfig): HistoricalIssueSource {
  return adapter instanceof JiraRestAdapter ? adapter : new MockHistoricalSource(config.fieldIds);
}

/** Opens the analytical store and wires the read-only pipeline. Returns undefined when the module is disabled. */
export async function createIntelligence(adapter: CaseSourceAdapter, appConfig: SupportGuardConfig, env: NodeJS.ProcessEnv = process.env): Promise<IntelligenceService | undefined> {
  const config = loadIntelligenceConfig(env);
  if (!config.enabled) return undefined;
  const store = await AnalyticalStore.open(config.dbPath);
  const service = new IntelligenceService({ config, store, source: createHistoricalSource(adapter, config), llm: createLlm(config), projectKey: appConfig.jira.projectKey });
  const recovered = await service.recoverInterrupted();
  if (recovered.interrupted || recovered.partial) console.warn(`[intelligence] recovered interrupted runs: interrupted=${recovered.interrupted} partial=${recovered.partial}`);
  return service;
}

/** Starts the configured automatic analysis for the last closed period when none exists yet. Read-only. */
export class IntelligenceScheduler {
  private timer?: NodeJS.Timeout;

  constructor(private readonly service: IntelligenceService) {}

  start(): void {
    const { auto } = this.service.config;
    if (!auto.enabled || this.timer) return;
    const tick = () => void this.check().catch((error) => console.error("[intelligence] scheduled check failed", (error as Error).message));
    setTimeout(tick, 30_000).unref();
    this.timer = setInterval(tick, auto.checkIntervalMinutes * 60_000);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  async check(now: Date = new Date()): Promise<boolean> {
    const { auto, maxCustomDays, warnCustomDays } = this.service.config;
    if (this.service.activeRun) return false;
    const period = resolvePeriod({ type: auto.period }, { maxCustomDays, warnCustomDays }, now);
    if (await this.service.hasRunFor(period)) return false;
    // Scheduled runs are limited to SUMMARY/RECURRENCE. Deep analysis is only prepared (estimate), never executed.
    // The simulated clock must drive the period, so calendar-based periods are passed explicitly.
    const request = auto.period === "MONTHLY" ? { type: auto.period, month: period.from.slice(0, 7) } : auto.period === "DAILY" ? { type: auto.period, day: period.from } : { type: auto.period };
    const { runId } = await this.service.start({ ...request, trigger: "SCHEDULED", mode: auto.mode });
    await this.service.logEvent(runId, "INFO", "MONTHLY_ANALYSIS_STARTED", `period=${period.from}..${period.to} mode=${auto.mode}`);
    await this.service.waitForIdle();
    await this.followUp(runId);
    return true;
  }

  /** Prepares the TOP_RCA proposal and the operational reports. No deep analysis is run without explicit confirmation. */
  async followUp(runId: string): Promise<void> {
    const run = await this.service.getRun(runId);
    if (!run || run.status === "FAILED") return;
    const ops = new OpsService(this.service);
    const proposal = await this.service.estimate(runId, { mode: "TOP_RCA" });
    const reports = await ops.generateReports(runId);
    await this.service.logEvent(runId, "INFO", "MONTHLY_ANALYSIS_COMPLETED", `topRcaProposal=${proposal.selected.length} reports=${reports?.length ?? 0} deepAnalysis=NOT_EXECUTED`);
  }
}
