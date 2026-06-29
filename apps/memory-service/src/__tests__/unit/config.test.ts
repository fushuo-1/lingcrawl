/**
 * Unit tests for apps/memory-service/src/config.ts
 *
 * Strategy: import the exported `parseConfig` pure function and exercise it
 * directly under controlled `process.env` values. `parseConfig` is the only
 * place where env parsing / validation / defaults live, so testing it directly
 * avoids the module-singleton caching problems that come with dynamic `import()`
 * in ESM mode.
 */
import { jest } from "@jest/globals";
import fs from "fs";
import os from "os";
import path from "path";
import { parseConfig } from "../../config.js";

/* Snapshot env so each test starts from a known-clean state. */
const ENV_KEYS = [
  "HOST",
  "PORT",
  "DATA_DIR",
  "KB_DATA_DIR",
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

describe("config — defaults", () => {
  it("applies all defaults when no env is set", () => {
    const cfg = parseConfig(process.env);

    expect(cfg.HOST).toBe("127.0.0.1");
    expect(cfg.PORT).toBe(3001);
    expect(cfg.DATA_DIR).toBe(path.join(os.homedir(), ".lingcrawl"));
    expect(cfg.KB_DATA_DIR).toBe(path.join(os.homedir(), ".lingcrawl/knowledge/"));
  });

  it("coerces numeric strings from env", () => {
    setEnv({
      PORT: "4000",
    });
    const cfg = parseConfig(process.env);

    expect(cfg.PORT).toBe(4000);
  });

  it("expands a leading ~ in DATA_DIR to os.homedir()", () => {
    setEnv({ DATA_DIR: "~/.lingcrawl-test" });
    const cfg = parseConfig(process.env);
    expect(cfg.DATA_DIR).toBe(path.join(os.homedir(), ".lingcrawl-test"));
  });

  it("preserves a bare ~ as os.homedir()", () => {
    setEnv({ DATA_DIR: "~" });
    const cfg = parseConfig(process.env);
    expect(cfg.DATA_DIR).toBe(os.homedir());
  });

  it("leaves an absolute DATA_DIR untouched", () => {
    const abs = path.resolve(os.tmpdir(), "memory-svc-test-abs");
    setEnv({ DATA_DIR: abs });
    const cfg = parseConfig(process.env);
    expect(cfg.DATA_DIR).toBe(abs);
  });
});

describe("config — DATA_DIR auto-create", () => {
  it("creates DATA_DIR (recursive) if it does not exist", () => {
    const target = path.join(
      os.tmpdir(),
      `memory-svc-mkdir-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      "nested",
      "deep",
    );
    expect(fs.existsSync(target)).toBe(false);

    setEnv({ DATA_DIR: target });
    parseConfig(process.env);

    expect(fs.existsSync(target)).toBe(true);
    fs.rmSync(path.dirname(path.dirname(target)), {
      recursive: true,
      force: true,
    });
  });
});

describe("config — fail-fast on invalid env", () => {
  it("rejects non-numeric PORT with exit(1)", () => {
    const cap = stubExit();
    setEnv({ PORT: "not-a-number" });
    expect(() => parseConfig(process.env)).toThrow(/__process_exit__:1/);
    expect(cap.exit).toHaveBeenCalledWith(1);
    expect(cap.errors.join("\n")).toMatch(/PORT/);
    cap.restore();
  });
});

describe("config — accepts valid values", () => {
  it("accepts custom HOST", () => {
    setEnv({ HOST: "0.0.0.0" });
    const cfg = parseConfig(process.env);
    expect(cfg.HOST).toBe("0.0.0.0");
  });

  it("accepts custom KB_DATA_DIR", () => {
    setEnv({ KB_DATA_DIR: "~/notes" });
    const cfg = parseConfig(process.env);
    expect(cfg.KB_DATA_DIR).toBe(path.join(os.homedir(), "notes"));
  });
});

/* `Config` is exported as a TypeScript type only — it is erased at runtime.
 * This test documents the intent that the module exposes the type alias. */
describe("Config type", () => {
  it("parseConfig returns an object", () => {
    const cfg = parseConfig(process.env);
    expect(typeof cfg).toBe("object");
    expect(cfg.PORT).toBeDefined();
  });
});
