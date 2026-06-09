/**
 * Shared types for the LLM provider layer (issue #79).
 *
 * The provider layer is intentionally framework-free: it depends only on
 * the global `fetch`, not on any SDK, so a single implementation can
 * cover OpenAI / vLLM / Ollama / LM Studio / Anthropic / etc.
 */

export interface ExchangeForExtraction {
  id: number;
  userMessage: string;
  assistantMessage: string;
  /** Unix epoch seconds — lets the LLM reason about recency. */
  timestamp: number;
}

export interface ExtractedMemory {
  content: string;
  target: "memory" | "user";
  /** 0..1 — how confident the LLM is this fact is worth remembering. */
  confidence: number;
  /** The exchange this fact was extracted from (for traceability). */
  sourceExchangeId: number;
}

export interface LlmProvider {
  readonly name: string;
  extract(exchanges: ExchangeForExtraction[]): Promise<ExtractedMemory[]>;
}
