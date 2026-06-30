import "dotenv/config";
import { configDotenv } from "dotenv";
import path from "path";
import os from "os";
import fs from "fs";
import { fileURLToPath } from "url";

const moduleFilename = fileURLToPath(import.meta.url);
const moduleDirname = path.dirname(moduleFilename);

// Fallback: load .env from repo root when running from apps/memory-service/
configDotenv({ path: path.resolve(moduleDirname, "..", "..", "..", ".env"), override: false });

import { z } from "zod";

/* Schema */
const configSchema = z.object({
  // Application
  HOST: z.string().default("127.0.0.1"),
  PORT: z.coerce.number().int().positive().default(3001),

  // Storage — SQLite database directory (memory.db lives here)
  DATA_DIR: z.string().default("~/.lingcrawl"),

  // Knowledge Base — Markdown files directory
  KB_DATA_DIR: z.string().default("~/.lingcrawl/knowledge/"),

  // SQLite journal mode — DELETE is safe for Docker bind mounts on NTFS;
  // WAL is faster for concurrent readers but requires native fcntl locks
  // (unreliable across Windows→Linux volume mounts).
  SQLITE_JOURNAL_MODE: z.enum(["wal", "delete"]).default("delete"),
});

/* Parse — fail-fast with a readable error */
export function parseConfig(env: NodeJS.ProcessEnv) {
  const result = configSchema.safeParse(env);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    // eslint-disable-next-line no-console
    console.error(`[memory-service] Invalid configuration:\n${issues}`);
    process.exit(1);
  }

  // Expand ~ in paths to os.homedir()
  const expandHome = (p: string) =>
    p === "~"
      ? os.homedir()
      : p.startsWith("~/")
        ? path.join(os.homedir(), p.slice(2))
        : p;

  const dataDir = expandHome(result.data.DATA_DIR);
  const kbDataDir = expandHome(result.data.KB_DATA_DIR);

  // Ensure directories exist (mkdir -p). Fail fast on permissions / path errors.
  for (const [label, dir] of [
    ["DATA_DIR", dataDir],
    ["KB_DATA_DIR", kbDataDir],
  ] as const) {
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // eslint-disable-next-line no-console
      console.error(
        `[memory-service] Failed to create ${label} "${dir}": ${message}`,
      );
      process.exit(1);
    }
  }

  return { ...result.data, DATA_DIR: dataDir, KB_DATA_DIR: kbDataDir };
}

export const config = parseConfig(process.env);
export type Config = z.infer<typeof configSchema>;
