/**
 * Factory for picking the right LlmProvider based on the LLM_PROVIDER
 * config value (issue #79). The factory is the single source of truth
 * for which adapter handles which provider string.
 */
import {
  AnthropicProvider,
  OpenAICompatibleProvider,
} from "./provider.js";
import type { LlmProvider } from "./types.js";

export interface LlmConfig {
  provider: "openai" | "anthropic";
  baseUrl: string;
  apiKey?: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
}

export function createLlmProvider(config: LlmConfig): LlmProvider {
  switch (config.provider) {
    case "openai":
      return new OpenAICompatibleProvider({
        baseUrl: config.baseUrl,
        apiKey: config.apiKey,
        model: config.model,
        temperature: config.temperature,
      });
    case "anthropic":
      return new AnthropicProvider({
        baseUrl: config.baseUrl,
        apiKey: config.apiKey,
        model: config.model,
        temperature: config.temperature,
        maxTokens: config.maxTokens,
      });
    default: {
      const _exhaustive: never = config.provider;
      throw new Error(`Unknown LLM provider: ${String(_exhaustive)}`);
    }
  }
}
