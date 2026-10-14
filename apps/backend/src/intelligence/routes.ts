import { type Request, type Response, Router } from "express";

import { PeriodError } from "./periods.js";
import { renderExecutiveHtml } from "./ops/html.js";
import { OpsService, REPORT_TYPES, type OpsReportKind } from "./ops/service.js";
import { ReviewError, ReviewService, renderReviewPackMarkdown } from "./ops/review.js";
import { REPORT_KINDS, type ReportKind } from "./report.js";
import { ANALYSIS_MODES, SelectionError, type AnalysisMode } from "./lifecycle.js";
import { ActiveRunError, RunStateError, StaleRunError, type ExecuteRequest, type IntelligenceService } from "./service.js";
import type { PeriodType } from "./types.js";

const TYPES: PeriodType[] = ["MONTHLY", "BIWEEKLY", "WEEKLY", "DAILY", "CUSTOM"];
const text = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : undefined);
const fail = (response: Response, status: number, code: string, message: string) => response.status(status).json({ status: "error", error: { code, message } });

function periodRequest(source: Record<string, unknown>) {
  const type = (text(source.periodType) ?? text(source.type) ?? "MONTHLY").toUpperCase() as PeriodType;
  if (!TYPES.includes(type)) throw new PeriodError(`Tipo de periodo inválido: ${type}`);
  return { type, month: text(source.month), day: text(source.day), from: text(source.from), to: text(source.to) };
}

function executeRequest(source: unknown): ExecuteRequest {
  const body = (source ?? {}) as Record<string, unknown>;
  const mode = String(body.mode ?? "").toUpperCase() as AnalysisMode;
  if (!ANALYSIS_MODES.includes(mode)) throw new SelectionError(`Modo de análisis inválido: ${String(body.mode)}`);
  const clusterIds = Array.isArray(body.clusterIds) ? body.clusterIds.filter((id): id is string => typeof id === "string") : undefined;
  return { mode, clusterIds, includeLowConfidence: body.includeLowConfidence === true };
}

/** Read-only analytical API. Nothing here writes to Jira. */
export function createIntelligenceRouter(service: IntelligenceService): Router {
  const router = Router();

  const guard = (handler: (request: Request, response: Response) => Promise<unknown>) => async (request: Request, response: Response) => {
    try {
      await handler(request, response);
    } catch (error) {
      if (error instanceof PeriodError) return fail(response, 400, "INVALID_PERIOD", error.message);
      if (error instanceof SelectionError) return fail(response, 400, "INVALID_SELECTION", error.message);
      if (error instanceof StaleRunError) return fail(response, 409, "STALE_DATA", error.message);
      if (error instanceof RunStateError) return fail(response, 409, "INVALID_RUN_STATE", error.message);
      if (error instanceof ActiveRunError) return response.status(409).json({ status: "error", error: { code: "RUN_IN_PROGRESS", message: error.message }, activeRunId: error.runId });
      console.error("[intelligence] request failed", (error as Error)?.message);
      return fail(response, 500, "INTERNAL_ERROR", "No fue posible completar la solicitud");
    }
  };

  router.get("/overview", guard(async (_request, response) => response.json(await service.overview())));

  router.get("/periods", guard(async (request, response) => {
    const types = request.query.type ? [periodRequest(request.query as Record<string, unknown>)] : TYPES.filter((type) => type !== "CUSTOM").map((type) => ({ type }));
    response.json({ periods: types.map((item) => service.previewPeriod(item)), recommended: "MONTHLY" });
  }));

  router.get("/analysis/lookup", guard(async (request, response) => response.json(await service.lookup(periodRequest(request.query as Record<string, unknown>)))));

  router.post("/analysis/check", guard(async (request, response) => response.json(await service.checkChanges(periodRequest((request.body ?? {}) as Record<string, unknown>)))));

  router.post("/analysis", guard(async (request, response) => {
    const body = (request.body ?? {}) as Record<string, unknown>;
    const { runId, period, reused, state } = await service.start({ ...periodRequest(body), refresh: body.refresh === true });
    response.status(reused ? 200 : 202).json({ runId, period, reused, state });
  }));

  router.get("/analysis/:id/pre-analysis", guard(async (request, response) => {
    const result = await service.preAnalysis(String(request.params.id));
    if (!result) return fail(response, 404, "NOT_FOUND", "Análisis no encontrado");
    response.json(result);
  }));

  router.post("/analysis/:id/estimate", guard(async (request, response) => response.json(await service.estimate(String(request.params.id), executeRequest(request.body)))));

  router.post("/analysis/:id/execute", guard(async (request, response) => {
    const body = (request.body ?? {}) as Record<string, unknown>;
    if (body.confirm !== true) return fail(response, 400, "CONFIRMATION_REQUIRED", "Confirme explícitamente antes de ejecutar el análisis con IA");
    const result = await service.analyze(String(request.params.id), executeRequest(body));
    response.status(202).json({ runId: result.runId, mode: result.selection.mode, selected: result.selection.selected.map((item) => item.id), estimate: result.estimate });
  }));

  router.get("/analysis", guard(async (_request, response) => response.json({ runs: await service.listRuns() })));

  router.get("/analysis/:id", guard(async (request, response) => {
    const run = await service.getRun(String(request.params.id));
    if (!run) return fail(response, 404, "NOT_FOUND", "Análisis no encontrado");
    response.json({ run, events: await service.events(run.id) });
  }));

  router.get("/analysis/:id/status", guard(async (request, response) => {
    const run = await service.getRun(String(request.params.id));
    if (!run) return fail(response, 404, "NOT_FOUND", "Análisis no encontrado");
    response.json({ id: run.id, status: run.status, progress: run.progress, error: run.error });
  }));

  router.get("/analysis/:id/clusters", guard(async (request, response) => {
    const clusters = await service.clusters(String(request.params.id));
    if (!clusters) return fail(response, 404, "NOT_FOUND", "Análisis no encontrado");
    response.json({ clusters });
  }));

  router.get("/analysis/:id/clusters/:clusterId", guard(async (request, response) => {
    const detail = await service.clusterDetail(String(request.params.id), String(request.params.clusterId));
    if (!detail) return fail(response, 404, "NOT_FOUND", "Grupo no encontrado");
    response.json(detail);
  }));

  router.get("/analysis/:id/cases", guard(async (request, response) => {
    const q = request.query as Record<string, string | undefined>;
    const result = await service.cases(String(request.params.id), { page: Number(q.page) || 1, pageSize: Number(q.pageSize) || 25, eligibility: text(q.eligibility), clusterId: text(q.clusterId), service: text(q.service), status: text(q.status), search: text(q.search) });
    if (!result) return fail(response, 404, "NOT_FOUND", "Análisis no encontrado");
    response.json(result);
  }));

  router.get("/analysis/:id/report", guard(async (request, response) => {
    const kind = (text(request.query.kind) ?? "executive") as ReportKind;
    if (!REPORT_KINDS.includes(kind)) return fail(response, 400, "INVALID_REPORT", `Reporte inválido. Opciones: ${REPORT_KINDS.join(", ")}`);
    const report = await service.report(String(request.params.id), kind);
    if (!report) return fail(response, 404, "NOT_FOUND", "Reporte no disponible para este análisis");
    response.json(report);
  }));

  // ---- Operational intelligence (reads stored results; never re-analyses cases with AI)
  const ops = new OpsService(service);
  const reviews = new ReviewService(service);

  router.get("/analysis/:id/dashboard", guard(async (request, response) => {
    const dashboard = await ops.dashboard(String(request.params.id));
    if (!dashboard) return fail(response, 404, "NOT_FOUND", "Análisis no encontrado");
    response.json(dashboard);
  }));

  router.get("/analysis/:id/insights", guard(async (request, response) => {
    const result = await ops.insights(String(request.params.id));
    if (!result) return fail(response, 404, "NOT_FOUND", "Análisis no encontrado");
    response.json(result);
  }));

  router.get("/analysis/:id/recommendations", guard(async (request, response) => {
    const result = await ops.recommendations(String(request.params.id));
    if (!result) return fail(response, 404, "NOT_FOUND", "Análisis no encontrado");
    response.json(result);
  }));

  router.patch("/analysis/:id/recommendations/:clusterId/:recommendationId", guard(async (request, response) => {
    try {
      response.json(await ops.setRecommendationState(String(request.params.id), String(request.params.clusterId), String(request.params.recommendationId), String((request.body as Record<string, unknown> | undefined)?.state ?? "")));
    } catch (error) {
      return fail(response, 400, "INVALID_RECOMMENDATION", (error as Error).message);
    }
  }));

  router.get("/analysis/:id/reports", guard(async (request, response) => {
    const reports = await ops.listReports(String(request.params.id));
    if (!reports) return fail(response, 404, "NOT_FOUND", "Análisis no encontrado");
    response.json({ reports });
  }));

  router.post("/analysis/:id/reports", guard(async (request, response) => {
    const body = (request.body ?? {}) as Record<string, unknown>;
    const kinds = Array.isArray(body.kinds) ? body.kinds.map((item) => String(item).toUpperCase()) : undefined;
    if (kinds?.some((kind) => !REPORT_TYPES.includes(kind as OpsReportKind))) return fail(response, 400, "INVALID_REPORT", `Reportes válidos: ${REPORT_TYPES.join(", ")}`);
    const reports = await ops.generateReports(String(request.params.id), { kinds: kinds as OpsReportKind[] | undefined, force: body.force === true });
    if (!reports) return fail(response, 404, "NOT_FOUND", "Análisis no encontrado");
    response.status(201).json({ reports });
  }));

  router.get("/analysis/:id/reports/:kind", guard(async (request, response) => {
    const kind = String(request.params.kind).toUpperCase() as OpsReportKind;
    if (!REPORT_TYPES.includes(kind)) return fail(response, 400, "INVALID_REPORT", `Reportes válidos: ${REPORT_TYPES.join(", ")}`);
    const report = await ops.getReport(String(request.params.id), kind, Number(request.query.version) || undefined);
    if (!report) return fail(response, 404, "NOT_FOUND", "Reporte no generado para este análisis");
    response.json(report);
  }));

  router.get("/analysis/:id/reports/:kind/export", guard(async (request, response) => {
    const kind = String(request.params.kind).toUpperCase();
    if (kind !== "EXECUTIVE") return fail(response, 400, "INVALID_REPORT", "Solo el reporte ejecutivo tiene exportación HTML");
    const report = await ops.getReport(String(request.params.id), "EXECUTIVE");
    if (!report) return fail(response, 404, "NOT_FOUND", "Genere el reporte ejecutivo antes de exportarlo");
    response.type("html").send(renderExecutiveHtml(report));
  }));

  router.get("/analysis/:id/review-pack", guard(async (request, response) => {
    const ids = text(request.query.clusterIds)?.split(",").map((item) => item.trim()).filter(Boolean);
    const pack = await reviews.pack(String(request.params.id), { clusterIds: ids, limit: Math.min(Number(request.query.limit) || 5, 10) });
    if (!pack) return fail(response, 404, "NOT_FOUND", "Análisis no encontrado");
    if (request.query.format === "md") return response.type("text/markdown").send(renderReviewPackMarkdown(pack));
    response.json(pack);
  }));

  router.get("/analysis/:id/reviews", guard(async (request, response) => {
    response.json({ reviews: await reviews.list(String(request.params.id), { history: request.query.history === "true" }), metrics: await reviews.metrics(String(request.params.id)) });
  }));

  router.post("/analysis/:id/reviews", guard(async (request, response) => {
    const body = (request.body ?? {}) as Record<string, unknown>;
    try {
      response.status(201).json(await reviews.submit(String(request.params.id), String(body.clusterId ?? ""), String(body.candidateId ?? ""), { verdict: String(body.verdict ?? ""), reviewer: String(body.reviewer ?? ""), comment: typeof body.comment === "string" ? body.comment : "" }));
    } catch (error) {
      if (error instanceof ReviewError) return fail(response, 400, "INVALID_REVIEW", error.message);
      throw error;
    }
  }));

  router.get("/reviews/metrics", guard(async (_request, response) => response.json(await reviews.metrics())));

  router.get("/history", guard(async (_request, response) => response.json({ runs: await ops.history() })));

  router.get("/history/compare", guard(async (request, response) => {
    const a = text(request.query.a);
    const b = text(request.query.b);
    if (!a || !b) return fail(response, 400, "INVALID_COMPARISON", "Indique los análisis a comparar con a y b");
    const result = await ops.compare(a, b);
    if (!result) return fail(response, 404, "NOT_FOUND", "Análisis no encontrado");
    response.json(result);
  }));

  return router;
}
