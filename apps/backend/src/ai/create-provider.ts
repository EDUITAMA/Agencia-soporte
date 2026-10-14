import type { AIConfig } from "../config/config.js";
import { AxetBridgeAIProvider } from "./axet-bridge-provider.js";
import { MockAIProvider } from "./mock-ai-provider.js";
import type { AIAnalysisProvider } from "./types.js";

/** Returns null when AI is disabled so callers degrade gracefully. Add new providers here only. */
export function createAIProvider(config: AIConfig): AIAnalysisProvider | null {
  if (!config.enabled) return null;
  switch (config.provider) {
    case "MOCK_AI":
      return new MockAIProvider();
    case "AXET_BRIDGE_LOCAL":
      return new AxetBridgeAIProvider(config);
  }
}
