/**
 * LLM provider abstraction for the background extractor (issue #79).
 *
 * v0.1 ships an `LlmProvider` interface and two adapters:
 *   - `OpenAICompatibleProvider` — covers OpenAI, vLLM, Ollama, LM Studio,
 *     and any gateway that follows the OpenAI Chat Completions spec.
 *   - `AnthropicProvider` — Anthropic Messages API.
 *
 * The provider is a synchronous, request-shaped adapter: it takes a batch
 * of exchanges and returns a list of `ExtractedMemory` suggestions. All
 * IO is via the global `fetch`, no SDKs.
 */
import type {
  ExchangeForExtraction,
  ExtractedMemory,
  LlmProvider,
} from "./types.js";

export type { ExchangeForExtraction, ExtractedMemory, LlmProvider } from "./types.js";

/* ----- Errors ----- */

export class LlmNetworkError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "LlmNetworkError";
  }
}

export class LlmAuthError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "LlmAuthError";
  }
}

export class LlmBadRequestError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "LlmBadRequestError";
  }
}

export class LlmTransientError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "LlmTransientError";
  }
}

export class LlmOutputParseError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "LlmOutputParseError";
  }
}

/* ----- OpenAI-compatible adapter ----- */

export interface OpenAICompatibleConfig {
  baseUrl: string;
  apiKey?: string;
  model: string;
  temperature?: number;
  /** Override for testing. Defaults to global `fetch`. */
  fetchImpl?: typeof fetch;
}

const EXTRACTOR_SYSTEM_PROMPT = `You are a memory extractor for an AI agent.

You will receive a JSON array of conversation exchanges. For each one, identify any facts worth remembering:
- User preferences, communication style, identity
- Environment facts (project, OS, tools)
- Project conventions and configuration
- Tool quirks / workarounds
- Lessons learned (corrections, debugging context)

Return ONLY a JSON array (no prose) of objects with this exact shape:
[{"content": "string", "target": "memory" | "user", "confidence": number}]

Where:
- "content" is a single concise fact (max 200 chars). Combine related facts when possible.
- "target" is "user" for facts about the human (preferences, identity) and "memory" for everything else.
- "confidence" is 0..1 — how certain you are the fact is worth remembering.

If nothing is worth remembering, return [].
`;

/**
 * Adapter for any OpenAI Chat Completions-compatible endpoint.
 * Post to `{baseUrl}/chat/completions`, parse `choices[0].message.content`
 * as a JSON array of `ExtractedMemory`.
 */
export class OpenAICompatibleProvider implements LlmProvider {
  readonly name: string;

  constructor(private readonly config: OpenAICompatibleConfig) {
    this.name = `openai-compatible(${config.model})`;
  }

  async extract(
    exchanges: ExchangeForExtraction[],
  ): Promise<ExtractedMemory[]> {
    if (exchanges.length === 0) return [];
    const fetchImpl = this.config.fetchImpl ?? fetch;
    const url = `${stripTrailingSlash(this.config.baseUrl)}/chat/completions`;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.config.apiKey) {
      headers["Authorization"] = `Bearer ${this.config.apiKey}`;
    }

    const body = {
      model: this.config.model,
      temperature: this.config.temperature ?? 0.2,
      messages: [
        { role: "system" as const, content: EXTRACTOR_SYSTEM_PROMPT },
        {
          role: "user" as const,
          content: JSON.stringify(
            exchanges.map((e) => ({
              id: e.id,
              userMessage: e.userMessage,
              assistantMessage: e.assistantMessage,
              timestamp: e.timestamp,
            })),
          ),
        },
      ],
    };

    let res: Response;
    try {
      res = await fetchImpl(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });
    } catch (err) {
      throw new LlmNetworkError(
        `Network error calling ${url}: ${err instanceof Error ? err.message : String(err)}`,
        err,
      );
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      if (res.status === 401 || res.status === 403) {
        throw new LlmAuthError(
          `Auth failure (${res.status}) calling ${url}: ${text.slice(0, 200)}`,
        );
      }
      if (res.status === 400 || res.status === 422) {
        throw new LlmBadRequestError(
          `Bad request (${res.status}) calling ${url}: ${text.slice(0, 200)}`,
        );
      }
      throw new LlmTransientError(
        `HTTP ${res.status} from ${url}: ${text.slice(0, 200)}`,
      );
    }

    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const text = json.choices?.[0]?.message?.content ?? "";
    return parseExtractorOutput(text, exchanges);
  }
}

/* ----- Anthropic adapter ----- */

export interface AnthropicProviderConfig {
  baseUrl: string;
  apiKey?: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
  anthropicVersion?: string;
  fetchImpl?: typeof fetch;
}

/**
 * Adapter for the Anthropic Messages API. The default baseUrl is
 * https://api.anthropic.com — the adapter strips any trailing slash
 * and appends `/v1/messages`.
 */
export class AnthropicProvider implements LlmProvider {
  readonly name: string;

  constructor(private readonly config: AnthropicProviderConfig) {
    this.name = `anthropic(${config.model})`;
  }

  async extract(
    exchanges: ExchangeForExtraction[],
  ): Promise<ExtractedMemory[]> {
    if (exchanges.length === 0) return [];
    const fetchImpl = this.config.fetchImpl ?? fetch;
    const url = `${stripTrailingSlash(this.config.baseUrl)}/v1/messages`;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "anthropic-version":
        this.config.anthropicVersion ?? "2023-06-01",
    };
    if (this.config.apiKey) {
      headers["x-api-key"] = this.config.apiKey;
    }

    const body = {
      model: this.config.model,
      temperature: this.config.temperature ?? 0.2,
      max_tokens: this.config.maxTokens ?? 2000,
      system: EXTRACTOR_SYSTEM_PROMPT,
      messages: [
        {
          role: "user" as const,
          content: JSON.stringify(
            exchanges.map((e) => ({
              id: e.id,
              userMessage: e.userMessage,
              assistantMessage: e.assistantMessage,
              timestamp: e.timestamp,
            })),
          ),
        },
      ],
    };

    let res: Response;
    try {
      res = await fetchImpl(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });
    } catch (err) {
      throw new LlmNetworkError(
        `Network error calling ${url}: ${err instanceof Error ? err.message : String(err)}`,
        err,
      );
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      if (res.status === 401 || res.status === 403) {
        throw new LlmAuthError(
          `Auth failure (${res.status}) calling ${url}: ${text.slice(0, 200)}`,
        );
      }
      if (res.status === 400 || res.status === 422) {
        throw new LlmBadRequestError(
          `Bad request (${res.status}) calling ${url}: ${text.slice(0, 200)}`,
        );
      }
      throw new LlmTransientError(
        `HTTP ${res.status} from ${url}: ${text.slice(0, 200)}`,
      );
    }

    const json = (await res.json()) as {
      content?: Array<{ type: string; text?: string }>;
    };
    const block = json.content?.find((b) => b.type === "text");
    const text = block?.text ?? "";
    return parseExtractorOutput(text, exchanges);
  }
}

/* ----- Output parsing ----- */

function parseExtractorOutput(
  text: string,
  exchanges: ExchangeForExtraction[],
): ExtractedMemory[] {
  // The LLM is asked to return a JSON array. Be permissive: accept either
  // a bare array or one wrapped in ```json fences. Strip leading prose
  // and grab the first JSON-looking span.
  const trimmed = text.trim();
  if (!trimmed) {
    throw new LlmOutputParseError("Empty response from LLM");
  }

  // Try to extract the JSON array — handle ```json ... ``` fences.
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]+?)\s*```/i);
  const candidate = fenceMatch ? fenceMatch[1].trim() : trimmed;

  // Locate the first '[' and last ']'.
  const firstBracket = candidate.indexOf("[");
  const lastBracket = candidate.lastIndexOf("]");
  if (firstBracket === -1 || lastBracket === -1 || lastBracket <= firstBracket) {
    throw new LlmOutputParseError(
      `No JSON array found in LLM output: ${trimmed.slice(0, 200)}`,
    );
  }
  const json = candidate.slice(firstBracket, lastBracket + 1);

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (err) {
    throw new LlmOutputParseError(
      `Failed to parse LLM output as JSON: ${err instanceof Error ? err.message : String(err)}. ` +
        `Input: ${trimmed.slice(0, 200)}`,
      err,
    );
  }

  if (!Array.isArray(parsed)) {
    throw new LlmOutputParseError(
      `LLM output is not a JSON array: ${typeof parsed}`,
    );
  }

  // Build a set of valid source-exchange ids so we can validate the
  // LLM's `sourceExchangeId` (or default to the first one if missing).
  const validIds = new Set(exchanges.map((e) => e.id));

  const results: ExtractedMemory[] = [];
  for (const raw of parsed) {
    if (typeof raw !== "object" || raw === null) continue;
    const item = raw as Record<string, unknown>;

    const content = item.content;
    const target = item.target;
    const confidence = item.confidence;
    const sourceExchangeId = item.sourceExchangeId;

    if (typeof content !== "string" || content.length === 0) continue;
    if (target !== "memory" && target !== "user") continue;
    if (typeof confidence !== "number" || confidence < 0 || confidence > 1) continue;
    const sid =
      typeof sourceExchangeId === "number" && validIds.has(sourceExchangeId)
        ? sourceExchangeId
        : exchanges[0]?.id ?? 0;

    results.push({ content, target, confidence, sourceExchangeId: sid });
  }

  return results;
}

function stripTrailingSlash(s: string): string {
  return s.endsWith("/") ? s.slice(0, -1) : s;
}
