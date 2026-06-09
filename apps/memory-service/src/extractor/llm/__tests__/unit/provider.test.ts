/**
 * Unit tests for the LLM provider layer (issue #79).
 *
 * Coverage:
 *  - OpenAI-compatible adapter: request shape, response parsing,
 *    error classification (auth, bad request, transient, network)
 *  - Anthropic adapter: request shape, response parsing, error
 *    classification
 *  - Output parser: JSON array (bare + fenced), validation of
 *    target/confidence, sourceExchangeId default
 *  - Factory: routes to the right adapter
 *
 * These tests use a stub `fetch` to avoid any real network calls and
 * any reliance on the better-sqlite3 native binding.
 */
import {
  AnthropicProvider,
  LlmAuthError,
  LlmBadRequestError,
  LlmNetworkError,
  LlmOutputParseError,
  LlmTransientError,
  OpenAICompatibleProvider,
} from "../../provider.js";
import { createLlmProvider } from "../../factory.js";
import type { ExchangeForExtraction } from "../../types.js";

/* ----- fetch stub helper ----- */

type FetchInput = string | URL | Request;
type FetchInit = RequestInit | undefined;

function makeFetchStub(responses: Array<() => Response | Promise<Response>>): {
  fetch: typeof fetch;
  calls: Array<{ url: FetchInput; init: FetchInit }>;
} {
  const calls: Array<{ url: FetchInput; init: FetchInit }> = [];
  let i = 0;
  const stub: typeof fetch = async (url, init) => {
    calls.push({ url, init });
    const fn = responses[i++];
    if (!fn) {
      throw new Error(`Stub fetch called ${i} times but only ${responses.length} responses queued`);
    }
    return fn();
  };
  return { fetch: stub, calls };
}

const SAMPLE_EXCHANGES: ExchangeForExtraction[] = [
  {
    id: 1,
    userMessage: "I prefer concise replies",
    assistantMessage: "Got it, I'll keep things brief.",
    timestamp: 1700000000,
  },
  {
    id: 2,
    userMessage: "The project uses pnpm",
    assistantMessage: "OK, noted.",
    timestamp: 1700000060,
  },
];

/* ----- OpenAI-compatible adapter ----- */

describe("OpenAICompatibleProvider", () => {
  it("posts to {baseUrl}/chat/completions with correct headers", async () => {
    const { fetch: stub, calls } = makeFetchStub([
      () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: "[]" } }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    ]);
    const provider = new OpenAICompatibleProvider({
      baseUrl: "https://api.example.com/v1",
      apiKey: "sk-test",
      model: "gpt-4o-mini",
      temperature: 0.2,
      fetchImpl: stub,
    });
    await provider.extract(SAMPLE_EXCHANGES);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://api.example.com/v1/chat/completions");
    const init = calls[0].init!;
    const headers = init.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer sk-test");
    expect(headers["Content-Type"]).toBe("application/json");
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe("gpt-4o-mini");
    expect(body.temperature).toBe(0.2);
    expect(body.messages).toHaveLength(2);
    expect(body.messages[0].role).toBe("system");
    expect(body.messages[1].role).toBe("user");
  });

  it("parses a JSON-array response and returns the memories", async () => {
    const llmOutput = JSON.stringify([
      { content: "User prefers concise replies", target: "user", confidence: 0.9, sourceExchangeId: 1 },
      { content: "Project uses pnpm", target: "memory", confidence: 0.8, sourceExchangeId: 2 },
    ]);
    const { fetch: stub } = makeFetchStub([
      () =>
        new Response(
          JSON.stringify({ choices: [{ message: { content: llmOutput } }] }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    ]);
    const provider = new OpenAICompatibleProvider({
      baseUrl: "https://api.example.com/v1",
      apiKey: "sk-test",
      model: "gpt-4o-mini",
      fetchImpl: stub,
    });
    const result = await provider.extract(SAMPLE_EXCHANGES);
    expect(result).toEqual([
      { content: "User prefers concise replies", target: "user", confidence: 0.9, sourceExchangeId: 1 },
      { content: "Project uses pnpm", target: "memory", confidence: 0.8, sourceExchangeId: 2 },
    ]);
  });

  it("parses a fenced ```json response", async () => {
    const llmOutput = "```json\n[{\"content\":\"x\",\"target\":\"memory\",\"confidence\":0.5,\"sourceExchangeId\":1}]\n```";
    const { fetch: stub } = makeFetchStub([
      () => new Response(JSON.stringify({ choices: [{ message: { content: llmOutput } }] }), { status: 200 }),
    ]);
    const provider = new OpenAICompatibleProvider({
      baseUrl: "https://api.example.com/v1", apiKey: "k", model: "m", fetchImpl: stub,
    });
    const result = await provider.extract(SAMPLE_EXCHANGES);
    expect(result).toHaveLength(1);
    expect(result[0].content).toBe("x");
  });

  it("returns an empty array for an empty exchange list (no fetch call)", async () => {
    const { fetch: stub, calls } = makeFetchStub([]);
    const provider = new OpenAICompatibleProvider({
      baseUrl: "https://api.example.com/v1", apiKey: "k", model: "m", fetchImpl: stub,
    });
    const result = await provider.extract([]);
    expect(result).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it("classifies 401/403 as LlmAuthError", async () => {
    const { fetch: stub } = makeFetchStub([
      () => new Response("unauthorized", { status: 401 }),
      () => new Response("forbidden", { status: 403 }),
    ]);
    const provider = new OpenAICompatibleProvider({
      baseUrl: "https://api.example.com/v1", apiKey: "k", model: "m", fetchImpl: stub,
    });
    await expect(provider.extract(SAMPLE_EXCHANGES)).rejects.toBeInstanceOf(LlmAuthError);
    await expect(provider.extract(SAMPLE_EXCHANGES)).rejects.toBeInstanceOf(LlmAuthError);
  });

  it("classifies 400/422 as LlmBadRequestError", async () => {
    const { fetch: stub } = makeFetchStub([
      () => new Response("bad", { status: 400 }),
    ]);
    const provider = new OpenAICompatibleProvider({
      baseUrl: "https://api.example.com/v1", apiKey: "k", model: "m", fetchImpl: stub,
    });
    await expect(provider.extract(SAMPLE_EXCHANGES)).rejects.toBeInstanceOf(LlmBadRequestError);
  });

  it("classifies 5xx as LlmTransientError", async () => {
    const { fetch: stub } = makeFetchStub([
      () => new Response("server error", { status: 500 }),
      () => new Response("rate limited", { status: 429 }),
    ]);
    const provider = new OpenAICompatibleProvider({
      baseUrl: "https://api.example.com/v1", apiKey: "k", model: "m", fetchImpl: stub,
    });
    await expect(provider.extract(SAMPLE_EXCHANGES)).rejects.toBeInstanceOf(LlmTransientError);
    await expect(provider.extract(SAMPLE_EXCHANGES)).rejects.toBeInstanceOf(LlmTransientError);
  });

  it("classifies network failures as LlmNetworkError", async () => {
    const stub: typeof fetch = async () => {
      throw new Error("ECONNREFUSED");
    };
    const provider = new OpenAICompatibleProvider({
      baseUrl: "https://api.example.com/v1", apiKey: "k", model: "m", fetchImpl: stub,
    });
    await expect(provider.extract(SAMPLE_EXCHANGES)).rejects.toBeInstanceOf(LlmNetworkError);
  });

  it("rejects malformed output as LlmOutputParseError", async () => {
    const { fetch: stub } = makeFetchStub([
      () => new Response(JSON.stringify({ choices: [{ message: { content: "not json" } }] }), { status: 200 }),
    ]);
    const provider = new OpenAICompatibleProvider({
      baseUrl: "https://api.example.com/v1", apiKey: "k", model: "m", fetchImpl: stub,
    });
    await expect(provider.extract(SAMPLE_EXCHANGES)).rejects.toBeInstanceOf(LlmOutputParseError);
  });
});

/* ----- Anthropic adapter ----- */

describe("AnthropicProvider", () => {
  it("posts to {baseUrl}/v1/messages with x-api-key + anthropic-version headers", async () => {
    const { fetch: stub, calls } = makeFetchStub([
      () =>
        new Response(
          JSON.stringify({ content: [{ type: "text", text: "[]" }] }),
          { status: 200 },
        ),
    ]);
    const provider = new AnthropicProvider({
      baseUrl: "https://api.anthropic.com",
      apiKey: "sk-ant-test",
      model: "claude-haiku-4-5",
      fetchImpl: stub,
    });
    await provider.extract(SAMPLE_EXCHANGES);
    expect(calls[0].url).toBe("https://api.anthropic.com/v1/messages");
    const headers = calls[0].init!.headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("sk-ant-test");
    expect(headers["anthropic-version"]).toBe("2023-06-01");
    const body = JSON.parse(calls[0].init!.body as string);
    expect(body.model).toBe("claude-haiku-4-5");
    expect(body.system).toContain("memory extractor");
    expect(body.messages[0].role).toBe("user");
  });

  it("parses the text content block", async () => {
    const llmOutput = JSON.stringify([
      { content: "user is on Windows", target: "user", confidence: 0.7, sourceExchangeId: 1 },
    ]);
    const { fetch: stub } = makeFetchStub([
      () => new Response(JSON.stringify({ content: [{ type: "text", text: llmOutput }] }), { status: 200 }),
    ]);
    const provider = new AnthropicProvider({
      baseUrl: "https://api.anthropic.com",
      apiKey: "k",
      model: "m",
      fetchImpl: stub,
    });
    const result = await provider.extract(SAMPLE_EXCHANGES);
    expect(result).toHaveLength(1);
    expect(result[0].content).toBe("user is on Windows");
  });

  it("classifies 401 as LlmAuthError", async () => {
    const { fetch: stub } = makeFetchStub([() => new Response("unauth", { status: 401 })]);
    const provider = new AnthropicProvider({
      baseUrl: "https://api.anthropic.com", apiKey: "k", model: "m", fetchImpl: stub,
    });
    await expect(provider.extract(SAMPLE_EXCHANGES)).rejects.toBeInstanceOf(LlmAuthError);
  });

  it("classifies 500 as LlmTransientError", async () => {
    const { fetch: stub } = makeFetchStub([() => new Response("err", { status: 500 })]);
    const provider = new AnthropicProvider({
      baseUrl: "https://api.anthropic.com", apiKey: "k", model: "m", fetchImpl: stub,
    });
    await expect(provider.extract(SAMPLE_EXCHANGES)).rejects.toBeInstanceOf(LlmTransientError);
  });
});

/* ----- Factory ----- */

describe("createLlmProvider", () => {
  it("returns OpenAICompatibleProvider for provider='openai'", () => {
    const p = createLlmProvider({
      provider: "openai",
      baseUrl: "https://api.example.com/v1",
      model: "m",
    });
    expect(p.name).toContain("openai-compatible");
  });

  it("returns AnthropicProvider for provider='anthropic'", () => {
    const p = createLlmProvider({
      provider: "anthropic",
      baseUrl: "https://api.anthropic.com",
      model: "m",
    });
    expect(p.name).toContain("anthropic");
  });
});

/* ----- Output parser edge cases ----- */

describe("OpenAICompatibleProvider — output validation", () => {
  it("filters out items with invalid target", async () => {
    const llmOutput = JSON.stringify([
      { content: "valid", target: "user", confidence: 0.5, sourceExchangeId: 1 },
      { content: "invalid target", target: "system", confidence: 0.5, sourceExchangeId: 1 },
    ]);
    const { fetch: stub } = makeFetchStub([
      () => new Response(JSON.stringify({ choices: [{ message: { content: llmOutput } }] }), { status: 200 }),
    ]);
    const provider = new OpenAICompatibleProvider({
      baseUrl: "https://api.example.com/v1", apiKey: "k", model: "m", fetchImpl: stub,
    });
    const result = await provider.extract(SAMPLE_EXCHANGES);
    expect(result).toHaveLength(1);
    expect(result[0].content).toBe("valid");
  });

  it("filters out items with out-of-range confidence", async () => {
    const llmOutput = JSON.stringify([
      { content: "ok", target: "user", confidence: 0.5, sourceExchangeId: 1 },
      { content: "too high", target: "user", confidence: 1.5, sourceExchangeId: 1 },
      { content: "negative", target: "user", confidence: -0.1, sourceExchangeId: 1 },
    ]);
    const { fetch: stub } = makeFetchStub([
      () => new Response(JSON.stringify({ choices: [{ message: { content: llmOutput } }] }), { status: 200 }),
    ]);
    const provider = new OpenAICompatibleProvider({
      baseUrl: "https://api.example.com/v1", apiKey: "k", model: "m", fetchImpl: stub,
    });
    const result = await provider.extract(SAMPLE_EXCHANGES);
    expect(result).toHaveLength(1);
  });

  it("defaults sourceExchangeId to the first exchange when LLM omits it", async () => {
    const llmOutput = JSON.stringify([
      { content: "x", target: "memory", confidence: 0.5 }, // no sourceExchangeId
    ]);
    const { fetch: stub } = makeFetchStub([
      () => new Response(JSON.stringify({ choices: [{ message: { content: llmOutput } }] }), { status: 200 }),
    ]);
    const provider = new OpenAICompatibleProvider({
      baseUrl: "https://api.example.com/v1", apiKey: "k", model: "m", fetchImpl: stub,
    });
    const result = await provider.extract(SAMPLE_EXCHANGES);
    expect(result[0].sourceExchangeId).toBe(SAMPLE_EXCHANGES[0].id);
  });
});
