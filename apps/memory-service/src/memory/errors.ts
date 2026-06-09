/**
 * Custom error types for the memory module. Separating them from `db/errors.ts`
 * keeps storage-layer concerns (connection, schema) distinct from store-level
 * concerns (capacity policy, validation, security).
 *
 * - `CapacityExceededError` — issue #69 (capacity ceiling on add)
 * - `SubstringMatchError`    — issue #70 (substring replace/remove ambiguity)
 * - `SecurityScanError`      — issue #70 (prompt-injection / invisible Unicode)
 */
import type { MemoryEntry, Usage } from "./types.js";

/**
 * Thrown by `MemoryStore.add` when a write would push a target's character
 * usage above its configured ceiling.
 *
 * Carries the snapshot the caller needs to make a consolidation decision:
 *   - `currentEntries` — what is already stored, so the agent can prune
 *   - `usage` — the post-rejection capacity numbers (used == limit)
 */
export class CapacityExceededError extends Error {
  readonly currentEntries: MemoryEntry[];
  readonly usage: Usage;

  constructor(currentEntries: MemoryEntry[], usage: Usage) {
    super(
      `Memory at ${usage.used}/${usage.limit} chars. ` +
        `Adding this entry would exceed the limit.`,
    );
    this.name = "CapacityExceededError";
    this.currentEntries = currentEntries;
    this.usage = usage;
  }
}

/**
 * Thrown by `MemoryStore.replace` / `MemoryStore.remove` when `oldText` does
 * not resolve to exactly one row in the target's entries.
 *
 * - `matches === 0` — no row contained the substring at all
 * - `matches >= 2` — substring was ambiguous; caller must provide a longer /
 *   more specific substring to disambiguate
 *
 * Carries the count so MCP adapters can report it back to the agent in a
 * human-readable way ("ambiguous: 3 entries contain 'foo'").
 */
export class SubstringMatchError extends Error {
  readonly matches: number;
  readonly substring: string;

  constructor(matches: number, substring: string) {
    super(
      matches === 0
        ? `No memory entry contains substring "${substring}".`
        : `Ambiguous match: ${matches} entries contain "${substring}". ` +
          `Provide a more specific substring.`,
    );
    this.name = "SubstringMatchError";
    this.matches = matches;
    this.substring = substring;
  }
}

/**
 * Thrown by `MemoryStore.add` / `replace` when the content fails the security
 * scan. The scan rejects known prompt-injection patterns and invisible Unicode
 * characters (zero-width spaces, etc.) — see `security.ts` for the rule list.
 *
 * - `reason` — short machine code (`'prompt-injection'`, `'invisible-unicode'`)
 * - `pattern` — the regex source that matched (only for injection reasons)
 */
export class SecurityScanError extends Error {
  readonly reason: string;
  readonly pattern?: string;

  constructor(reason: string, pattern?: string) {
    super(`Memory entry rejected by security scan: ${reason}`);
    this.name = "SecurityScanError";
    this.reason = reason;
    this.pattern = pattern;
  }
}
