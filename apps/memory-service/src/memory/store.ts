/**
 * MemoryStore — CRUD over the `memory_entries` SQLite table with character
 * capacity enforcement. Issue #69 ships only the add / get / list / getUsage
 * surface; dedupe, substring replace/remove, and prompt-injection scanning
 * are tracked in issue #70.
 *
 * Capacity policy:
 *   - Each target ('memory' | 'user') has its own ceiling
 *     (`config.MEMORY_CHAR_LIMIT` / `config.USER_CHAR_LIMIT`).
 *   - `add` checks `currentUsed + newContent.length > limit` before INSERT and
 *     throws `CapacityExceededError` with the existing entries + the usage
 *     snapshot. The check + INSERT run inside a transaction so two concurrent
 *     callers cannot both pass the check and overflow the limit.
 */
import type Database from "better-sqlite3";
import { config } from "../config.js";
import { CapacityExceededError } from "./errors.js";
import type {
  AddResult,
  MemoryEntry,
  MemoryStore,
  Usage,
} from "./types.js";

type Target = "memory" | "user";

/** Row shape returned by `SELECT * FROM memory_entries`. */
interface MemoryEntryRow {
  id: number | bigint;
  target: string;
  content: string;
  created_at: number | bigint;
  updated_at: number | bigint;
}

/** Row shape returned by `SELECT SUM(LENGTH(content)) AS used ...`. */
interface UsageRow {
  used: number | bigint | null;
}

export class MemoryStoreImpl implements MemoryStore {
  private readonly db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  async add(target: Target, content: string): Promise<AddResult> {
    const limit = this.charLimit(target);
    const newLen = content.length;

    // Capacity check + INSERT in one transaction so two concurrent `add`
    // calls cannot both pass the check and overflow the ceiling. Issue #69
    // does not require multi-writer concurrency; the transaction is defensive.
    const insert = this.db.transaction((): AddResult => {
      const used = this.sumUsed(target);
      if (used + newLen > limit) {
        const entries = this.listSync(target);
        const usage = this.usageFromUsed(target, used);
        throw new CapacityExceededError(entries, usage);
      }
      const info = this.db
        .prepare(
          "INSERT INTO memory_entries (target, content) VALUES (?, ?)",
        )
        .run(target, content);
      const id = Number(info.lastInsertRowid);
      const usage = this.usageFromUsed(target, used + newLen);
      return { id, usage };
    });

    return insert();
  }

  async get(id: number): Promise<MemoryEntry | null> {
    const row = this.db
      .prepare("SELECT * FROM memory_entries WHERE id = ?")
      .get(id) as MemoryEntryRow | undefined;
    return row ? rowToEntry(row) : null;
  }

  async list(target: Target): Promise<MemoryEntry[]> {
    return this.listSync(target);
  }

  async getUsage(target: Target): Promise<Usage> {
    return this.usageFromUsed(target, this.sumUsed(target));
  }

  /* ---------- private helpers ---------- */

  private listSync(target: Target): MemoryEntry[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM memory_entries WHERE target = ? ORDER BY id ASC",
      )
      .all(target) as MemoryEntryRow[];
    return rows.map(rowToEntry);
  }

  private sumUsed(target: Target): number {
    const row = this.db
      .prepare(
        "SELECT SUM(LENGTH(content)) AS used FROM memory_entries WHERE target = ?",
      )
      .get(target) as UsageRow;
    // SQLite returns null for SUM over zero rows; coerce to 0.
    const raw = row?.used;
    if (raw === null || raw === undefined) return 0;
    return Number(raw);
  }

  private charLimit(target: Target): number {
    return target === "memory"
      ? config.MEMORY_CHAR_LIMIT
      : config.USER_CHAR_LIMIT;
  }

  private usageFromUsed(target: Target, used: number): Usage {
    const limit = this.charLimit(target);
    // pct rounded to one decimal place, clamped to [0, 100] for safety even
    // though `used` should never exceed `limit` in a well-formed store.
    const pct = limit > 0 ? Math.min(100, +((used / limit) * 100).toFixed(1)) : 0;
    return { target, used, limit, pct };
  }
}

function rowToEntry(row: MemoryEntryRow): MemoryEntry {
  return {
    id: Number(row.id),
    target: row.target as "memory" | "user",
    content: row.content,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}
