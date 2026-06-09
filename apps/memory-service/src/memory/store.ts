/**
 * MemoryStore — CRUD over the `memory_entries` SQLite table with character
 * capacity enforcement, exact-match dedupe, substring replace/remove, and
 * prompt-injection scanning. Implements issues #69 (basic CRUD + capacity)
 * and #70 (dedupe + replace/remove + security).
 *
 * Capacity policy:
 *   - Each target ('memory' | 'user') has its own ceiling
 *     (`config.MEMORY_CHAR_LIMIT` / `config.USER_CHAR_LIMIT`).
 *   - `add` and `replace` check `currentUsed + newContent.length > limit`
 *     before INSERT/UPDATE and throw `CapacityExceededError`.
 *
 * Security policy (issue #70):
 *   - Every write (`add` / `replace`) runs `securityScan` on the incoming
 *     content. Failure throws `SecurityScanError` BEFORE the capacity check,
 *     so malicious payloads cannot consume capacity budget.
 *
 * Dedupe policy (issue #70):
 *   - `add` checks for an exact `(target, content)` match first; if one
 *     exists, returns the existing id with `noDuplicateAdded: true` and
 *     does NOT throw.
 *
 * Substring policy (issue #70):
 *   - `replace(target, oldText, content)` and `remove(target, oldText)` use
 *     `LIKE '%' || oldText || '%'` substring matching. Exactly one match
 *     is required; 0 or >=2 throws `SubstringMatchError`.
 */
import type Database from "better-sqlite3";
import { config } from "../config.js";
import {
  CapacityExceededError,
  SecurityScanError,
  SubstringMatchError,
} from "./errors.js";
import { securityScan } from "./security.js";
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

/** Row shape returned by `SELECT id, content FROM memory_entries WHERE LIKE ?`. */
interface MatchRow {
  id: number | bigint;
  content: string;
}

export class MemoryStoreImpl implements MemoryStore {
  private readonly db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  async add(target: Target, content: string): Promise<AddResult> {
    // Security scan first — reject malicious content before any capacity or
    // dedupe work, and before charging the budget against capacity.
    const scan = securityScan(content);
    if (!scan.safe) {
      throw new SecurityScanError(scan.reason ?? "unknown", scan.pattern);
    }

    const limit = this.charLimit(target);
    const newLen = content.length;

    // Capacity check + dedupe + INSERT in one transaction so two concurrent
    // `add` calls cannot both pass the check and overflow the ceiling, and
    // cannot both miss an existing duplicate.
    const insert = this.db.transaction((): AddResult => {
      // Dedupe: exact (target, content) match returns the existing id.
      const dup = this.db
        .prepare(
          "SELECT id FROM memory_entries WHERE target = ? AND content = ?",
        )
        .get(target, content) as { id: number | bigint } | undefined;
      if (dup) {
        const usage = this.usageFromUsed(target, this.sumUsed(target));
        return {
          id: Number(dup.id),
          usage,
          noDuplicateAdded: true,
          existingId: Number(dup.id),
        };
      }

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

  async replace(
    target: Target,
    oldText: string,
    content: string,
  ): Promise<{ id: number; usage: Usage }> {
    // Security scan first — same rationale as add.
    const scan = securityScan(content);
    if (!scan.safe) {
      throw new SecurityScanError(scan.reason ?? "unknown", scan.pattern);
    }

    const limit = this.charLimit(target);
    const newLen = content.length;

    // Substring match (1-only) + capacity + UPDATE in one transaction.
    const update = this.db.transaction((): { id: number; usage: Usage } => {
      const matches = this.findMatches(target, oldText);
      if (matches !== 1) {
        throw new SubstringMatchError(matches, oldText);
      }

      // Capacity check: net change in usage = newLen - oldContent.length.
      // Easier to reason about: compute used WITHOUT this row, then check
      // (usedWithout + newLen) <= limit.
      const row = this.db
        .prepare(
          "SELECT id, content FROM memory_entries WHERE target = ? AND content LIKE '%' || ? || '%'",
        )
        .get(target, oldText) as MatchRow;
      const oldLen = row.content.length;
      const usedWithout = this.sumUsed(target) - oldLen;
      if (usedWithout + newLen > limit) {
        const entries = this.listSync(target);
        const usage = this.usageFromUsed(target, usedWithout);
        throw new CapacityExceededError(entries, usage);
      }

      const info = this.db
        .prepare(
          "UPDATE memory_entries SET content = ?, updated_at = unixepoch() " +
            "WHERE id = ?",
        )
        .run(content, row.id);
      const id = Number(row.id);
      const usage = this.usageFromUsed(target, usedWithout + newLen);
      return { id, usage };
    });

    return update();
  }

  async remove(
    target: Target,
    oldText: string,
  ): Promise<{ success: true; removedId: number }> {
    // Substring match (1-only) + DELETE in one transaction.
    const del = this.db.transaction((): { success: true; removedId: number } => {
      const matches = this.findMatches(target, oldText);
      if (matches !== 1) {
        throw new SubstringMatchError(matches, oldText);
      }
      const row = this.db
        .prepare(
          "SELECT id FROM memory_entries WHERE target = ? AND content LIKE '%' || ? || '%'",
        )
        .get(target, oldText) as { id: number | bigint };
      this.db.prepare("DELETE FROM memory_entries WHERE id = ?").run(row.id);
      return { success: true, removedId: Number(row.id) };
    });

    return del();
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

  /**
   * Count entries in `target` whose content contains `substring`. Used by
   * `replace` / `remove` to enforce the "exactly one match" rule.
   *
   * SQLite's `LIKE` is case-insensitive for ASCII by default; that matches
   * the substring semantics Hermes uses and is fine for v0.1.
   */
  private findMatches(target: Target, substring: string): number {
    const row = this.db
      .prepare(
        "SELECT COUNT(*) AS n FROM memory_entries " +
          "WHERE target = ? AND content LIKE '%' || ? || '%'",
      )
      .get(target, substring) as { n: number | bigint };
    return Number(row.n);
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
