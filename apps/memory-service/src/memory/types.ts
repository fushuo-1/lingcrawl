/**
 * Shared types for the memory slice.
 *
 * Sourced from PRD #65 (Section 9 "API Contracts" / "Modules — MemoryStore"
 * / "Resource Rendering Format"). These are intentionally framework-free and
 * have no IO; downstream store classes and the SnapshotRenderer both
 * consume them. The shape of `MemoryEntry` mirrors the `memory_entries`
 * SQLite table; `Usage` is what the store reports back to callers and what
 * the renderer shows in the capacity bar.
 */

/** A single persisted memory fact. `target` discriminates agent notes from
 *  user profile facts. `id` is the rowid from `memory_entries`. */
export interface MemoryEntry {
  id: number;
  target: "memory" | "user";
  content: string;
  createdAt: number; // unix epoch seconds (matches `unixepoch()` default)
  updatedAt: number;
}

/** Capacity usage for a single `target`. `pct` is 0..100, may be > 100 when
 *  a write pushes the store over the configured limit. `used` and `limit`
 *  are in characters (per the PRD's MEMORY_CHAR_LIMIT / USER_CHAR_LIMIT). */
export interface Usage {
  target: "memory" | "user";
  used: number;
  limit: number;
  pct: number;
}
