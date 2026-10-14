import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";

import { createHealthRouter } from "./health.js";
import { createSupportGuardRouter, type SupportGuardDeps } from "./api/routes.js";

export interface AppConfig {
  productName: string;
  version: string;
  corsOrigin: string;
}

export function createApp(config: AppConfig, supportGuard?: SupportGuardDeps) {
  const app = express();

  app.use(cors({ origin: config.corsOrigin }));
  app.use(express.json());
  if (supportGuard) app.use("/api/support-guard", createSupportGuardRouter(supportGuard));
  if (supportGuard) app.use("/api/health", createHealthRouter(supportGuard, config));

  app.get("/api/health", (_request, response) => {
    response.json({
      status: "ok",
      service: config.productName,
      timestamp: new Date().toISOString(),
    });
  });

  app.get("/api/version", (_request, response) => {
    response.json({
      status: "ok",
      version: config.version,
    });
  });

  app.use((_request, response) => {
    response.status(404).json({
      status: "error",
      error: {
        code: "NOT_FOUND",
        message: "Route not found",
      },
    });
  });

  app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    console.error("Unhandled API error", error);
    response.status(500).json({
      status: "error",
      error: {
        code: "INTERNAL_ERROR",
        message: "An unexpected error occurred",
      },
    });
  });

  return app;
}
