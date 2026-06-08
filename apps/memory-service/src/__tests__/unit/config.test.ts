/**
 * Unit tests for apps/memory-service/src/config.ts
 *
 * Strategy: dynamically `import()` the config module under controlled
 * `process.env` values. The config module is a top-level singleton that
 * calls `parseConfig(process.env)` on import, so:
 *   - For success paths: we capture `config` and assert on it.
 *   - For failure paths: we stub `process.exit` to a throwing sentinel
 *     and `console.error` to a capture array, then re-import the module
 *     and assert that the stub was called with the expected args.
 *
 * `jest.isolateModules` is sync-only in ESM mode and cannot re-evaluate
 * an already-loaded module, so we use dynamic `import()` plus
 * `jest.resetModules()` to force a fresh evaluation.
 */
import fs from "fs";
import os from "os";
import path from "path";

/* Snapshot env so each test starts from a known-clean state. */
const ENV_KEYS = [
  "HOST",
  "PORT",
  "DATA_DIR",
  "MEMORY_CHAR_LIMIT",
  "USER_CHAR_LIMIT",
  "EXTRACTOR_ENABLED",
  "EXTRACTOR_INTERVAL",
  "EXTRACTOR_BATCH_SIZE",
  "LLM_PROVIDER",
  "LLM_BASE_URL",
  "LLM_API_KEY",
  "LLM_MODEL",
  "LLM_TEMPERATURE",
  "LLM_MIN_CONFIDENCE",
  "LLM_OUTPUT_TARGET",
] as const;

const savedEnv: Record<string, string | undefined> = {};

function clearEnv() {
  for (const k of ENV_KEYS) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
}

function setEnv(overrides: Record<string, string | undefined>) {
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined) {
      delete process.env[k];
    } else {
      process.env[k] = v;
    }
  }
}

function restoreEnv() {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) {
      delete process.env[k];
    } else {
      process.env[k] = savedEnv[k];
    }
  }
}

beforeEach(() => {
  clearEnv();
});

afterAll(() => {
  restoreEnv();
});

/* Stub process.exit to a throwing sentinel + capture console.error. */
function stubExit() {
  const errors: string[] = [];
  const origError = console.error;
  const origExit = process.exit;
  console.error = (...args: unknown[]) => {
    errors.push(args.map((a) => String(a)).join(" "));
  };
  const exit = jest.fn((code?: number) => {
    throw new Error(`__process_exit__:${code ?? "undefined"}`);
  });
  process.exit = exit as unknown as typeof process.exit;
  return {
    exit,
    errors,
    restore: () => {
      console.error = origError;
      process.exit = origExit;
    },
  };
}

async function loadConfig(): Promise<{ config: any; Config?: unknown }> {
  jest.resetModules();
  return import("../config");
}

describe("config — defaults", () => {
  it("applies all defaults when no env is set", async () => {
    const mod = await loadConfig();
    const cfg = mod.config;

    expect(cfg.HOST).toBe("127.0.0.1");
    expect(cfg.PORT).toBe(3001);
    expect(cfg.DATA_DIR).toBe(path.join(os.homedir(), ".lingcrawl"));
    expect(cfg.MEMORY_CHAR_LIMIT).toBe(2200);
    expect(cfg.USER_CHAR_LIMIT).toBe(1375);
    expect(cfg.EXTRACTOR_ENABLED).toBe(false);
    expect(cfg.EXTRACTOR_INTERVAL).toBe("30m");
    expect(cfg.EXTRACTOR_BATCH_SIZE).toBe(20);
    expect(cfg.LLM_PROVIDER).toBe("openai");
    expect(cfg.LLM_BASE_URL).toBe("https://api.openai.com/v1");
    expect(cfg.LLM_API_KEY).toBeUndefined();
    expect(cfg.LLM_MODEL).toBe("gpt-4o-mini");
    expect(cfg.LLM_TEMPERATURE).toBe(0.2);
    expect(cfg.LLM_MIN_CONFIDENCE).toBe(0.7);
    expect(cfg.LLM_OUTPUT_TARGET).toBe("pending");
  });

  it("coerces numeric strings from env", async () => {
    setEnv({
      PORT: "4000",
      MEMORY_CHAR_LIMIT: "5000",
      USER_CHAR_LIMIT: "1000",
      EXTRACTOR_BATCH_SIZE: "50",
      LLM_TEMPERATURE: "0.9",
      LLM_MIN_CONFIDENCE: "0.5",
    });
    const mod = await loadConfig();
    const cfg = mod.config;

    expect(cfg.PORT).toBe(4000);
    expect(cfg.MEMORY_CHAR_LIMIT).toBe(5000);
    expect(cfg.USER_CHAR_LIMIT).toBe(1000);
    expect(cfg.EXTRACTOR_BATCH_SIZE).toBe(50);
    expect(cfg.LLM_TEMPERATURE).toBe(0.9);
    expect(cfg.LLM_MIN_CONFIDENCE).toBe(0.5);
  });

  it("expands a leading ~ in DATA_DIR to os.homedir()", async () => {
    setEnv({ DATA_DIR: "~/.lingcrawl-test" });
    const mod = await loadConfig();
    expect(mod.config.DATA_DIR).toBe(
      path.join(os.homedir(), ".lingcrawl-test"),
    );
  });

  it("preserves a bare ~ as os.homedir()", async () => {
    setEnv({ DATA_DIR: "~" });
    const mod = await loadConfig();
    expect(mod.config.DATA_DIR).toBe(os.homedir());
  });

  it("leaves an absolute DATA_DIR untouched", async () => {
    const abs = path.resolve(os.tmpdir(), "memory-svc-test-abs");
    setEnv({ DATA_DIR: abs });
    const mod = await loadConfig();
    expect(mod.config.DATA_DIR).toBe(abs);
  });

  it("coerces EXTRACTOR_ENABLED='true' from env", async () => {
    setEnv({ EXTRACTOR_ENABLED: "true" });
    const mod = await loadConfig();
    expect(mod.config.EXTRACTOR_ENABLED).toBe(true);
  });
});

describe("config — DATA_DIR auto-create", () => {
  it("creates DATA_DIR (recursive) if it does not exist", async () => {
    const target = path.join(
      os.tmpdir(),
      `memory-svc-mkdir-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      "nested",
      "deep",
    );
    expect(fs.existsSync(target)).toBe(false);

    setEnv({ DATA_DIR: target });
    await loadConfig();

    expect(fs.existsSync(target)).toBe(true);
    fs.rmSync(path.dirname(path.dirname(target)), {
      recursive: true,
      force: true,
    });
  });
});

describe("config — fail-fast on invalid env", () => {
  it("rejects LLM_PROVIDER='bogus' with a readable error and exit(1)", async () => {
    const cap = stubExit();
    setEnv({ LLM_PROVIDER: "bogus" });
    await expect(loadConfig()).rejects.toThrow(/__process_exit__:1/);
    expect(cap.exit).toHaveBeenCalledWith(1);
    expect(cap.errors.join("\n")).toMatch(/LLM_PROVIDER/);
    cap.restore();
  });

  it("rejects LLM_OUTPUT_TARGET='invalid' with a readable error and exit(1)", async () => {
    const cap = stubExit();
    setEnv({ LLM_OUTPUT_TARGET: "invalid" });
    await expect(loadConfig()).rejects.toThrow(/__process_exit__:1/);
    expect(cap.exit).toHaveBeenCalledWith(1);
    expect(cap.errors.join("\n")).toMatch(/LLM_OUTPUT_TARGET/);
    cap.restore();
  });

  it("rejects non-numeric PORT with exit(1)", async () => {
    const cap = stubExit();
    setEnv({ PORT: "not-a-number" });
    await expect(loadConfig()).rejects.toThrow(/__process_exit__:1/);
    expect(cap.exit).toHaveBeenCalledWith(1);
    expect(cap.errors.join("\n")).toMatch(/PORT/);
    cap.restore();
  });

  it("rejects LLM_TEMPERATURE > 2 (out of range) with exit(1)", async () => {
    const cap = stubExit();
    setEnv({ LLM_TEMPERATURE: "5" });
    await expect(loadConfig()).rejects.toThrow(/__process_exit__:1/);
    expect(cap.exit).toHaveBeenCalledWith(1);
    expect(cap.errors.join("\n")).toMatch(/LLM_TEMPERATURE/);
    cap.restore();
  });
});

describe("config — accepts both LLM_PROVIDER enum values", () => {
  it("accepts 'openai'", async () => {
    setEnv({ LLM_PROVIDER: "openai" });
    const mod = await loadConfig();
    expect(mod.config.LLM_PROVIDER).toBe("openai");
  });

  it("accepts 'anthropic'", async () => {
    setEnv({ LLM_PROVIDER: "anthropic" });
    const mod = await loadConfig();
    expect(mod.config.LLM_PROVIDER).toBe("anthropic");
  });
});

describe("config — accepts both LLM_OUTPUT_TARGET enum values", () => {
  it("accepts 'pending'", async () => {
    setEnv({ LLM_OUTPUT_TARGET: "pending" });
    const mod = await loadConfig();
    expect(mod.config.LLM_OUTPUT_TARGET).toBe("pending");
  });

  it("accepts 'direct'", async () => {
    setEnv({ LLM_OUTPUT_TARGET: "direct" });
    const mod = await loadConfig();
    expect(mod.config.LLM_OUTPUT_TARGET).toBe("direct");
  });
});

/* `Config` is exported as a TypeScript type only — it is erased at runtime.
 * This test documents the intent that the module exposes the type alias. */
describe("Config type", () => {
  it("module loads and exports the config object", async () => {
    const mod = await loadConfig();
    expect(typeof mod).toBe("object");
    expect(mod.config).toBeDefined();
  });
});
