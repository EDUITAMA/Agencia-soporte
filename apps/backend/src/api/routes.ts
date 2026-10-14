import { type Request, type Response, Router } from "express";

import type { CaseSourceAdapter } from "../adapters/case-source.js";
import type { AIAnalysisService } from "../ai/ai-analysis-service.js";
import { JwtVerifier } from "../auth/jwt-verifier.js";
import { type SupportGuardConfig, isAuthConfigured, toPublicConfig } from "../config/config.js";
import type { ConnectionStatus } from "../domain/types.js";
import type { CaseIntakeService } from "../intake/case-intake-service.js";
import type { PollingScheduler } from "../intake/polling-scheduler.js";
import { createIntelligenceRouter } from "../intelligence/routes.js";
import type { IntelligenceService } from "../intelligence/service.js";
import type { StateStore } from "../store/state-store.js";

export interface SupportGuardDeps {
  adapter: CaseSourceAdapter;
  config: SupportGuardConfig;
  store: StateStore;
  intake: CaseIntakeService;
  scheduler: PollingScheduler;
  ai?: AIAnalysisService;
  intelligence?: IntelligenceService;
  verifier?: JwtVerifier;
}

const CONNECTION_TTL_MS = 30_000;

export function createSupportGuardRouter(deps: SupportGuardDeps): Router {
  const { adapter, config, store, intake, scheduler, ai } = deps;
  const router = Router();

  // Fail closed: when auth is configured every route requires a valid aXet/Okta JWT; an unverifiable token is rejected.
  const verifier = deps.verifier ?? (isAuthConfigured(config.auth) ? new JwtVerifier(config.auth) : undefined);
  if (verifier) {
    router.use(async (request, response, next) => {
      const header = request.headers.authorization ?? "";
      const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
      try {
        if (!token) throw new Error("missing token");
        await verifier.verify(token);
        next();
      } catch {
        response.status(401).json({ status: "error", error: { code: "UNAUTHORIZED", message: "Authentication required" } });
      }
    });
  }

  if (deps.intelligence) router.use("/intelligence", createIntelligenceRouter(deps.intelligence));

  async function connection(force = false): Promise<ConnectionStatus> {
    const cached = store.lastConnection;
    if (!force && cached && Date.now() - Date.parse(cached.checkedAt) < CONNECTION_TTL_MS) return cached;
    let status = await adapter.healthCheck();
    if (status.state === "CONNECTED" && store.lastRun?.sourceError) {
      status = { ...status, state: "DEGRADED", message: `Conectado, pero la última sincronización falló: ${store.lastRun.sourceError}` };
    }
    store.lastConnection = status;
    return status;
  }

  router.get("/overview", async (_request, response) => {
    const records = store.allCases();
    const lastRun = store.lastRun;
    response.json({
      connection: await connection(),
      sourceMode: adapter.mode,
      syncing: intake.isRunning,
      lastSyncAt: store.lastSyncAt,
      actionsMode: config.jira.actionsMode,
      liveBlockedReason: config.liveBlockedReason ?? null,
      ai: {
        health: ai ? await ai.getHealth() : { state: "DISABLED", provider: config.ai.provider, model: config.ai.model, checkedAt: new Date().toISOString(), message: "Análisis con IA deshabilitado" },
        stats: ai?.stats() ?? { analyzed: 0, queued: 0, analyzing: 0, failed: 0, skipped: 0 },
        pending: ai?.pending ?? 0,
      },
      kpis: {
        newCases: lastRun?.found ?? 0,
        completeCases: records.filter((r) => r.validationStatus === "COMPLETE").length,
        missingInformation: records.filter((r) => !r.validation.valid).length,
        sufficientCases: records.filter((r) => r.sufficiency.status === "SUFFICIENT").length,
        insufficientCases: records.filter((r) => r.sufficiency.status === "INSUFFICIENT").length,
        returnedCases: records.filter((r) => r.validationStatus === "RETURNED").length,
        dryRunCases: records.filter((r) => r.validationStatus === "DRY_RUN").length,
        errorCases: records.filter((r) => r.validationStatus === "ERROR").length,
      },
      lastRun,
      autoValidation: scheduler.status(lastRun?.finishedAt ?? null),
      recentActivity: store.recentAudit(10),
      config: toPublicConfig(config),
    });
  });

  router.post("/sync/startup", async (_request, response) => {
    const result = await intake.startupSync();
    if (result.performed) store.lastConnection = null;
    response.json(result);
  });

  router.post("/validation/run", async (_request: Request, response: Response) => {
    const summary = await intake.run("MANUAL");
    store.lastConnection = null;
    response.json({ summary });
  });

  router.get("/cases", (_request, response) => {
    response.json({ cases: store.allCases(), lastRun: store.lastRun });
  });

  router.get("/cases/:id", (request, response) => {
    const record = store.getCase(String(request.params.id));
    if (!record) {
      response.status(404).json({ status: "error", error: { code: "CASE_NOT_FOUND", message: "Case has not been processed yet" } });
      return;
    }
    response.json({ case: record, audit: store.recentAudit(50, record.caseId) });
  });

  router.post("/cases/:id/return", async (request, response) => {
    const result = await intake.returnWithRequest(String(request.params.id));
    if (result.ok) {
      response.json({ case: result.record, mode: config.jira.actionsMode });
      return;
    }
    const statusByCode = { NOT_FOUND: 404, NO_REQUEST: 409, AI_PENDING: 409, ALREADY_RETURNED: 409, JIRA_ERROR: 502 } as const;
    response.status(statusByCode[result.code]).json({ status: "error", error: { code: result.code, message: result.message } });
  });

  router.get("/audit", (_request, response) => {
    response.json({ entries: store.recentAudit(100) });
  });

  return router;
}
