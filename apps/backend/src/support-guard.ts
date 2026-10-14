import { createAIProvider } from "./ai/create-provider.js";
import { AIAnalysisService } from "./ai/ai-analysis-service.js";
import { createSourceAdapter } from "./adapters/create-adapter.js";
import { loadConfig } from "./config/config.js";
import { CaseIntakeService } from "./intake/case-intake-service.js";
import { PollingScheduler } from "./intake/polling-scheduler.js";
import type { SupportGuardDeps } from "./api/routes.js";
import { StateStore } from "./store/state-store.js";

/** Composition root for Support Guard: wires adapter, store, AI layer, intake and scheduler from configuration. */
export function createSupportGuard(env: NodeJS.ProcessEnv = process.env): SupportGuardDeps {
  const config = loadConfig(env);
  const adapter = createSourceAdapter(config);
  const store = new StateStore(config.storeFile);
  const ai = new AIAnalysisService(createAIProvider(config.ai), config.ai, store);
  const intake = new CaseIntakeService(adapter, config, store, console, ai);
  const scheduler = new PollingScheduler(intake, config.polling);
  return { adapter, config, store, intake, scheduler, ai };
}
