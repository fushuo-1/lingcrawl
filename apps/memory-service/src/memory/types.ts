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
  /** Set when the entry was a duplicate of an existing one; INSERT was skipped. */
  noDuplicateAdded?: boolean;
  /** When `noDuplicateAdded` is true, the id of the existing entry. */
  existingId?: number;
}

/** Result of a successful `replace`. */
export interface ReplaceResult {
  id: number;
  usage: Usage;
}

/** Result of a successful `remove`. */
export interface RemoveResult {
  success: true;
  removedId: number;
}

/** The full CRUD surface (issues #69 + #70). */
export interface MemoryStore {
  add(target: "memory" | "user", content: string): Promise<AddResult>;
  get(id: number): Promise<MemoryEntry | null>;
  list(target: "memory" | "user"): Promise<MemoryEntry[]>;
  getUsage(target: "memory" | "user"): Promise<Usage>;
  replace(
    target: "memory" | "user",
    oldText: string,
    content: string,
  ): Promise<ReplaceResult>;
  remove(
    target: "memory" | "user",
    oldText: string,
  ): Promise<RemoveResult>;
}
