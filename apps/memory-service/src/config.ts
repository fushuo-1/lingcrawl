<<<<<<< HEAD
import "dotenv/config";
import { configDotenv } from "dotenv";
import path from "path";
import os from "os";
import fs from "fs";

// Fallback: load .env from repo root when running from apps/memory-service/
configDotenv({ path: path.resolve(__dirname, "..", "..", "..", ".env"), override: false });

import { z } from "zod";

/* Schema */
const configSchema = z.object({
  // Application
  HOST: z.string().default("127.0.0.1"),
  PORT: z.coerce.number().int().positive().default(3001),

  // Storage
  DATA_DIR: z.string().default("~/.lingcrawl"),

  // Capacity limits (chars)
  MEMORY_CHAR_LIMIT: z.coerce.number().int().positive().default(2200),
  USER_CHAR_LIMIT: z.coerce.number().int().positive().default(1375),

  // v0.2 — Background LLM extractor (schema-only in v0.1)
  EXTRACTOR_ENABLED: z.stringbool().default(false),
  EXTRACTOR_INTERVAL: z.string().default("30m"),
  EXTRACTOR_BATCH_SIZE: z.coerce.number().int().positive().default(20),
  LLM_PROVIDER: z.enum(["openai", "anthropic"]).default("openai"),
  LLM_BASE_URL: z.string().default("https://api.openai.com/v1"),
  LLM_API_KEY: z.string().optional(),
  LLM_MODEL: z.string().default("gpt-4o-mini"),
  LLM_TEMPERATURE: z.coerce.number().min(0).max(2).default(0.2),
  LLM_MIN_CONFIDENCE: z.coerce.number().min(0).max(1).default(0.7),
  LLM_OUTPUT_TARGET: z.enum(["pending", "direct"]).default("pending"),
});

/* Parse — fail-fast with a readable error */
function parseConfig(env: NodeJS.ProcessEnv) {
  const result = configSchema.safeParse(env);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    // eslint-disable-next-line no-console
    console.error(`[memory-service] Invalid configuration:\n${issues}`);
    process.exit(1);
  }

  // Expand ~ in DATA_DIR to os.homedir()
  const rawDataDir = result.data.DATA_DIR;
  const dataDir =
    rawDataDir === "~"
      ? os.homedir()
      : rawDataDir.startsWith("~/")
        ? path.join(os.homedir(), rawDataDir.slice(2))
        : rawDataDir;

  // Ensure DATA_DIR exists (mkdir -p). Fail fast on permissions / path errors.
  try {
    fs.mkdirSync(dataDir, { recursive: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // eslint-disable-next-line no-console
    console.error(
      `[memory-service] Failed to create DATA_DIR "${dataDir}": ${message}`,
    );
    process.exit(1);
  }

  return { ...result.data, DATA_DIR: dataDir };
}

export const config = parseConfig(process.env);
export type Config = z.infer<typeof configSchema>;
=======
// TODO(#68): replace with full Zod schema + env loading
export const config = {
  HOST: process.env.HOST ?? "127.0.0.1",
  PORT: Number(process.env.PORT ?? 3001),
  DATA_DIR: process.env.DATA_DIR ?? "~/.lingcrawl",
} as const;
>>>>>>> feat/memory-service-scaffold
