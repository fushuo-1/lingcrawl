#!/usr/bin/env node
/**
 * `lingcrawl` CLI entry point (issue #97 — knowledge base edition).
 *
 * Two public surfaces:
 *
 *   1. `run(argv: string[]): Promise<number>` — programmatic entry used by
 *      the unit tests.
 *   2. The `if (require.main === module)` block at the bottom.
 *
 * The CLI closes the SQLite singleton on the way out (`closeDb()`).
 */
import { Command, CommanderError } from "commander";
import { closeDb } from "../db/client.js";
import { CliError, buildKbCommand } from "./kb.js";
export { CliError } from "./kb.js";

/** Build a fresh root program. */
export function buildProgram(): Command {
  const program = new Command();
  program
    .name("lingcrawl-memory")
    .description(
      "Inspect and manage the LingCrawl Knowledge Base.",
    )
    .version("0.1.0");

  program.addCommand(buildKbCommand());

  return program;
}

/** Run the CLI with the given argv. Returns the intended exit code.
 *  Does NOT call `process.exit`. The DB singleton is always closed
 *  before returning. */
export async function run(argv: string[]): Promise<number> {
  const program = buildProgram();
  // Prevent Commander from calling process.exit() — throw CommanderError
  // instead so callers (and tests) can catch it. The custom callback
  // swallows exit(0) so successful commands don't throw.
  // exitOverride must be set on child commands too since addCommand()
  // does not propagate _exitCallback.
  const overrideFn = (err: InstanceType<typeof CommanderError>) => {
    if (err.exitCode !== 0) throw err;
  };
  program.exitOverride(overrideFn);
  for (const sub of program.commands) {
    sub.exitOverride(overrideFn);
  }
  try {
    await program.parseAsync(["node", "lingcrawl-memory", ...argv]);
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
  if (err instanceof CommanderError) {
    return err.exitCode;
  }
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
