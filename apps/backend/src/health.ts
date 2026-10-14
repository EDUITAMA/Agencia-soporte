import { Router } from "express";

import type { SupportGuardDeps } from "./api/routes.js";
import { isAuthConfigured } from "./config/config.js";

export type HealthState = "UP" | "DEGRADED" | "DOWN";

export interface HealthCheck {
  name: string;
  state: HealthState;
  critical: boolean;
  latencyMs?: number;
  message: string;
  details?: Record<string, unknown>;
}

const CHECK_TIMEOUT_MS = 5_000;
const CACHE_TTL_MS = 15_000;
const started = Date.now();

class ProbeTimeout extends Error {}

function withTimeout<T>(work: Promise<T>, label: string): Promise<T> {
  let timer: NodeJS.Timeout;
  const limit = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new ProbeTimeout(`${label} no respondió en ${CHECK_TIMEOUT_MS / 1000}s`)), CHECK_TIMEOUT_MS);
  });
  return Promise.race([work, limit]).finally(() => clearTimeout(timer));
}

async function timed(name: string, critical: boolean, probe: () => Promise<Omit<HealthCheck, "name" | "critical" | "latencyMs">>): Promise<HealthCheck> {
  const startedAt = Date.now();
  try {
    const result = await withTimeout(probe(), name);
    return { name, critical, latencyMs: Date.now() - startedAt, ...result };
  } catch (error) {
    // Only a generic message: probe errors may carry technical detail from upstream systems.
    return { name, critical, latencyMs: Date.now() - startedAt, state: "DOWN", message: error instanceof ProbeTimeout ? error.message : "La verificación falló" };
  }
}

/**
 * Operational health of the backend. `/live` only proves the process answers; `/ready` checks dependencies.
 * Only critical dependencies (the analytical store) turn the response into 503; Jira or AI trouble reports DEGRADED
 * because the app still serves cached/local data. Responses never include credentials, URLs or raw upstream errors.
 */
export function createHealthRouter(deps: SupportGuardDeps, meta: { productName: string; version: string }): Router {
  const router = Router();
  let cache: { at: number; body: Record<string, unknown>; status: number } | undefined;

  async function evaluate() {
    const { adapter, config, ai, intelligence, scheduler } = deps;
    const checks = await Promise.all([
      timed("jira", false, async () => {
        const status = await adapter.healthCheck();
        const state: HealthState = status.state === "CONNECTED" ? "UP" : status.state === "DEGRADED" ? "DEGRADED" : "DOWN";
        return { state, message: status.message, details: { mode: adapter.mode, source: adapter.sourceName, actionsMode: config.jira.actionsMode } };
      }),
      timed("ai", false, async () => {
        if (!ai) return { state: "UP" as const, message: "IA deshabilitada", details: { enabled: false } };
        const status = await ai.getHealth();
        const state: HealthState = status.state === "CONNECTED" ? "UP" : status.state === "DISABLED" ? "UP" : "DEGRADED";
        return { state, message: status.message, details: { provider: status.provider, model: status.model, state: status.state } };
      }),
      timed("analyticalStore", true, async () => {
        if (!intelligence) return { state: "DOWN" as const, message: "Support Intelligence no está disponible (el almacén analítico no inició)" };
        const snapshot = await intelligence.healthSnapshot();
        const stuck = (snapshot.runsByStatus.INTERRUPTED ?? 0) + (snapshot.runsByStatus.PARTIAL ?? 0);
        return { state: "UP" as const, message: "Almacén analítico operativo", details: { schemaVersion: snapshot.schemaVersion, activeRun: snapshot.activeRun, runsByStatus: snapshot.runsByStatus, lastFailure: snapshot.lastFailure, runsNeedingRetry: stuck } };
      }),
    ]);
    checks.push({
      name: "scheduler",
      critical: false,
      state: "UP",
      message: scheduler ? "Planificador de intake configurado" : "Sin planificador",
      details: { pollingEnabled: config.polling.enabled, authentication: isAuthConfigured(config.auth) ? "configured" : "open" },
    });

    const criticalDown = checks.some((check) => check.critical && check.state === "DOWN");
    const anyIssue = checks.some((check) => check.state !== "UP");
    const status: HealthState = criticalDown ? "DOWN" : anyIssue ? "DEGRADED" : "UP";
    return {
      status: criticalDown ? 503 : 200,
      body: {
        status,
        service: meta.productName,
        version: meta.version,
        timestamp: new Date().toISOString(),
        uptimeSeconds: Math.round((Date.now() - started) / 1000),
        checks,
      } as Record<string, unknown>,
    };
  }

  router.get("/live", (_request, response) => {
    response.json({ status: "UP", service: meta.productName, timestamp: new Date().toISOString(), uptimeSeconds: Math.round((Date.now() - started) / 1000) });
  });

  router.get("/ready", async (request, response) => {
    // Short cache so probes polling every few seconds do not hammer Jira or the AI bridge.
    if (!cache || request.query.fresh === "true" || Date.now() - cache.at > CACHE_TTL_MS) {
      const result = await evaluate();
      cache = { at: Date.now(), ...result };
    }
    response.status(cache.status).json(cache.body);
  });

  return router;
}
