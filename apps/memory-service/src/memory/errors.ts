/**
 * Custom error types for the memory module. Separating them from `db/errors.ts`
 * keeps storage-layer concerns (connection, schema) distinct from store-level
 * concerns (capacity policy, validation).
 *
 * Only `CapacityExceededError` is needed for issue #69; this file exists as the
 * home for the rest of the memory error taxonomy so follow-up issues (#70 dedupe,
 * security scan, etc.) have an obvious place to add their error classes.
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
