import dotenv from "dotenv";

import { createApp } from "./app.js";
import { isAuthConfigured } from "./config/config.js";
import { createIntelligence, IntelligenceScheduler } from "./intelligence/create.js";
import { createSupportGuard } from "./support-guard.js";

dotenv.config();

const port = Number(process.env.PORT ?? 3000);
const productName = process.env.PRODUCT_NAME ?? "Nuevo Producto";
const version = process.env.PRODUCT_VERSION ?? "0.1.0";
const corsOrigin = process.env.CORS_ORIGIN ?? "http://localhost:4200";
const supportGuard = createSupportGuard();
try {
  supportGuard.intelligence = await createIntelligence(supportGuard.adapter, supportGuard.config);
} catch (error) {
  console.error("[intelligence] disabled: could not start the analytical store:", (error as Error).message);
}
const intelligenceScheduler = supportGuard.intelligence ? new IntelligenceScheduler(supportGuard.intelligence) : undefined;
const app = createApp({ productName, version, corsOrigin }, supportGuard);

const server = app.listen(port, () => {
  console.info(`[api] ${productName} listening on port ${port}`);
  console.info(
    `[support-guard] source=${supportGuard.config.sourceMode} actions=${supportGuard.config.jira.actionsMode} auto=${supportGuard.config.polling.enabled}`,
  );
  console.info(
    `[support-guard] ai=${supportGuard.config.ai.enabled ? supportGuard.config.ai.provider : "DISABLED"} auth=${isAuthConfigured(supportGuard.config.auth) ? "configured" : "open"}${supportGuard.config.liveBlockedReason ? ` live-blocked: ${supportGuard.config.liveBlockedReason}` : ""}`,
  );
  supportGuard.scheduler.start();
  intelligenceScheduler?.start();
});

function shutdown(signal: string) {
  console.info(`[api] received ${signal}; shutting down`);
  supportGuard.scheduler.stop();
  intelligenceScheduler?.stop();
  server.close((error) => {
    if (error) {
      console.error("[api] shutdown failed", error);
      process.exitCode = 1;
    }
    try {
      supportGuard.intelligence?.close();
    } catch (closeError) {
      console.error("[api] analytical store close failed", (closeError as Error).message);
    }
  });
  setTimeout(() => process.exit(process.exitCode ?? 0), 10_000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
