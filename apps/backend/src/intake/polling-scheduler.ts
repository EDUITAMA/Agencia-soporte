import type { CaseIntakeService } from "./case-intake-service.js";

export interface SchedulerStatus {
  enabled: boolean;
  intervalSeconds: number;
  running: boolean;
  lastRunAt: string | null;
  nextRunAt: string | null;
}

/** Controlled polling: one run at a time, fixed interval, no overlapping executions. */
export class PollingScheduler {
  private timer: NodeJS.Timeout | null = null;
  private nextRunAt: string | null = null;
  private lastRunAt: string | null = null;

  constructor(
    private readonly intake: CaseIntakeService,
    private readonly options: { enabled: boolean; intervalSeconds: number },
    private readonly logger: Pick<Console, "error" | "info"> = console,
  ) {}

  start(): void {
    if (!this.options.enabled || this.timer) return;
    const intervalMs = this.options.intervalSeconds * 1000;
    this.scheduleNext(intervalMs);
    this.timer = setInterval(() => {
      this.scheduleNext(intervalMs);
      void this.tick();
    }, intervalMs);
    this.timer.unref();
  }

  /** Single scheduled execution; exposed for tests. */
  async tick(): Promise<void> {
    if (this.intake.isRunning) return;
    try {
      const summary = await this.intake.run("AUTO");
      this.lastRunAt = summary.finishedAt;
    } catch (error) {
      this.logger.error(`[scheduler] run failed: ${(error as Error).message}`);
    }
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.nextRunAt = null;
  }

  private scheduleNext(intervalMs: number): void {
    this.nextRunAt = new Date(Date.now() + intervalMs).toISOString();
  }

  status(lastRunFallback: string | null): SchedulerStatus {
    return {
      enabled: this.options.enabled,
      intervalSeconds: this.options.intervalSeconds,
      running: this.intake.isRunning,
      lastRunAt: this.lastRunAt ?? lastRunFallback,
      nextRunAt: this.options.enabled ? this.nextRunAt : null,
    };
  }
}
