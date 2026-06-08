/**
 * Type contracts for the MemoryStore — the public interface that downstream
 * modules (MCP tools, SnapshotRenderer, CLI) depend on. Issue #69 freezes this
 * shape; do not modify it without a coordinated interface change.
 */

/** A single stored fact, indexed by autoincrement id. */
export interface MemoryEntry {
  id: number;
  target: "memory" | "user";
  content: string;
  /** Unix epoch seconds (matches `unixepoch()` default in schema.sql). */
  createdAt: number;
  updatedAt: number;
}

/** Capacity snapshot for one of the two targets. */
export interface Usage {
  target: "memory" | "user";
  /** Sum of LENGTH(content) across all entries for this target. */
  used: number;
  /** Configured character ceiling (`config.MEMORY_CHAR_LIMIT` / `config.USER_CHAR_LIMIT`). */
  limit: number;
  /** 0–100 — `used / limit * 100`, rounded to one decimal place. */
  pct: number;
}

/** Result of a successful `add`. */
export interface AddResult {
  id: number;
  usage: Usage;
}

/** The four-method CRUD surface that #69 ships. */
export interface MemoryStore {
  add(target: "memory" | "user", content: string): Promise<AddResult>;
  get(id: number): Promise<MemoryEntry | null>;
  list(target: "memory" | "user"): Promise<MemoryEntry[]>;
  getUsage(target: "memory" | "user"): Promise<Usage>;
}
