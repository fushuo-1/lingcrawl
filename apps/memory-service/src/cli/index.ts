#!/usr/bin/env node
/**
 * `lingcrawl` CLI entry point (issue #77).
 *
 * Two public surfaces:
 *
 *   1. `run(argv: string[]): Promise<number>` — programmatic entry used by
 *      the unit tests. Builds the Commander program, dispatches argv,
 *      catches `CliError` / Commander's `CommanderError` and returns an
 *      exit code. NEVER calls `process.exit` so the test process stays
 *      alive.
 *
 *   2. The `if (require.main === module)` block at the bottom — invokes
 *      `run(process.argv.slice(2))` and calls `process.exit` with the
 *      returned code. This is what `lingcrawl-memory` (the bin name) ends
 *      up running.
 *
 * The CLI closes the SQLite singleton on the way out (`closeDb()`) so a
 * second invocation from the same process does not leak file handles.
 */
import { fileURLToPath } from "url";
import { Command, CommanderError } from "commander";
import { closeDb } from "../db/client.js";
import { CliError, buildMemoryCommand } from "./memory.js";
import { buildSessionCommand } from "./session.js";
// Re-export CliError from the canonical home (memory.ts) so callers that
// import from `cli/index.ts` still get a stable handle.
export { CliError } from "./memory.js";

/** Build a fresh root program. Exported so the test suite can assert on
 *  help / version output without spawning a subprocess. */
export function buildProgram(): Command {
  const program = new Command();
  program
    .name("lingcrawl-memory")
    .description(
      "Inspect and manage the LingCrawl Memory Service (agent notes, user profile, sessions).",
    )
    .version("0.1.0");

  program.addCommand(buildMemoryCommand());
  program.addCommand(buildSessionCommand());

  return program;
}

/** Run the CLI with the given argv. Returns the intended exit code.
 *  Does NOT call process.exit — the caller (the bin shim or a test) does
 *  that. The DB singleton is always closed before returning. */
export async function run(argv: string[]): Promise<number> {
  const program = buildProgram();
  try {
    // `parseAsync` is the async-friendly variant of `program.parse`; the
    //  actions we attach are all async, so awaiting here ensures the
    //  process doesn't terminate before stdout is flushed.
    await program.parseAsync(argv);
    return 0;
  } catch (err) {
    return handleError(err);
  } finally {
    closeDb();
  }
}

function handleError(err: unknown): number {
  if (err instanceof CliError) {
    process.stderr.write(`error: ${err.message}\n`);
    return 1;
  }
  // Commander's own errors (unknown command, missing arg, bad option) —
  // they already print to stderr via the default exit override, so we
  // only need to return the right code.
  if (err instanceof CommanderError) {
    return err.exitCode;
  }
  // Anything else: print a generic message + the stack. We do NOT swallow
  // unknown errors silently because silent swallowing is what makes CLI
  // bugs impossible to diagnose.
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`error: unexpected: ${message}\n`);
  if (err instanceof Error && err.stack) {
    process.stderr.write(err.stack + "\n");
  }
  return 1;
}

if (import.meta.url === `file:///${process.argv[1]?.replace(/\\/g, "/")}`) {
  void run(process.argv.slice(2)).then((code) => {
    process.exit(code);
  });
}
