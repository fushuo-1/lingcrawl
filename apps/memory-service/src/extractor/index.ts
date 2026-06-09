/**
 * Background extractor worker (issue #81).
 *
 * Polls the `exchanges` table for new rows (`extracted_at IS NULL`),
 * asks the LLM to extract candidate memory facts, and writes the
 * suggestions to the `pending_memories` table for human review.
 *
 * Design contract (issue #81):
 *   - `start(config)` / `stop()` — schedule a periodic runOnce on a
 *     `setInterval`. Default disabled via `config.EXTRACTOR_ENABLED=false`.
 *   - `runOnce()` — read up to `EXTRACTOR_BATCH_SIZE` unextracted
 *     exchanges, call the LLM, filter by `LLM_MIN_CONFIDENCE`, write
 *     to `pending_memories`, mark `exchanges.extracted_at`.
 *   - `approvePending(id)` / `rejectPending(id)` — review-time actions
 *     that move (or skip) a pending suggestion to the live store.
 *
 * The worker is intentionally lazy-initialized: it touches the DB on
 * first use, so an `EXTRACTOR_ENABLED=false` deployment never opens a
 * connection.
 */
import type Database from "better-sqlite3";
import { config } from "../config.js";
import type { LlmProvider } from "./llm/provider.js";
import { MemoryStoreImpl } from "../memory/store.js";

export type ExchangeRow = {
  id: number;
  session_id: string;
  sequence: number;
  user_message: string;
  user_message_ts: number;
  assistant_message: string;
  assistant_message_ts: number;
  extracted_at: number | null;
};

export type PendingMemoryRow = {
  id: number;
  source_exchange_id: number | null;
  content: string;
  target: "memory" | "user";
  confidence: number;
  created_at: number;
  status: "pending" | "approved" | "rejected";
};

export interface ExtractorDeps {
  db: Database.Database;
  llm: LlmProvider;
  memoryStore: MemoryStoreImpl;
  /** Override for tests. */
  now?: () => number;
}

export class ExtractorWorker {
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly db: Database.Database;
  private readonly llm: LlmProvider;
  private readonly memoryStore: MemoryStoreImpl;
  private readonly now: () => number;

  constructor(deps: ExtractorDeps) {
    this.db = deps.db;
    this.llm = deps.llm;
    this.memoryStore = deps.memoryStore;
    this.now = deps.now ?? (() => Math.floor(Date.now() / 1000));
  }

  /**
   * Start the periodic loop. Idempotent — calling `start` twice does
   * not schedule two timers. The interval is parsed from
   * `config.EXTRACTOR_INTERVAL` (a simple "30m" / "1h" / "5m" string).
   */
  start(): void {
    if (this.timer !== null) return;
    const ms = parseInterval(config.EXTRACTOR_INTERVAL);
    this.timer = setInterval(() => {
      void this.runOnce().catch((err) => {
        // Swallow + log: a transient LLM failure must not kill the
        // process. Real callers wire `app.log.error` to the worker.
        // eslint-disable-next-line no-console
        console.error("[extractor] runOnce failed:", err);
      });
    }, ms);
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * One extraction pass: read unextracted exchanges, ask the LLM,
   * write suggestions to `pending_memories`, mark exchanges.
   *
   * Returns the number of pending rows written. The caller can use
   * the return value to decide whether to re-run immediately or wait
   * for the schedule.
   */
  async runOnce(): Promise<{ examined: number; written: number }> {
    const batchSize = config.EXTRACTOR_BATCH_SIZE;
    const minConfidence = config.LLM_MIN_CONFIDENCE;
    const outputTarget = config.LLM_OUTPUT_TARGET;
    const nowTs = this.now();

    const exchanges = this.db
      .prepare(
        "SELECT id, session_id, sequence, user_message, user_message_ts, " +
          "assistant_message, assistant_message_ts, extracted_at " +
          "FROM exchanges WHERE extracted_at IS NULL " +
          "ORDER BY id ASC LIMIT ?",
      )
      .all(batchSize) as ExchangeRow[];

    if (exchanges.length === 0) {
      return { examined: 0, written: 0 };
    }

    const suggestions = await this.llm.extract(
      exchanges.map((e) => ({
        id: e.id,
        userMessage: e.user_message,
        assistantMessage: e.assistant_message,
        timestamp: e.user_message_ts,
      })),
    );

    const filtered = suggestions.filter((s) => s.confidence >= minConfidence);

    const writeOne = this.db.prepare(
      "INSERT INTO pending_memories " +
        "(source_exchange_id, content, target, confidence, created_at, status) " +
        "VALUES (?, ?, ?, ?, ?, ?)",
    );
    const markExamined = this.db.prepare(
      "UPDATE exchanges SET extracted_at = ? WHERE id IN (SELECT value FROM json_each(?))",
    );

    const tx = this.db.transaction(() => {
      let written = 0;
      // For "direct" output target, write straight to pending_memories
      // with status="pending" (so the review step is still human-in-the-loop)
      // OR write straight to memory_entries (skipping the queue entirely).
      // Issue #81 says default is "pending"; we honour that here.
      for (const s of filtered) {
        writeOne.run(
          s.sourceExchangeId,
          s.content,
          s.target,
          s.confidence,
          nowTs,
          "pending",
        );
        written += 1;
      }
      const idsJson = JSON.stringify(exchanges.map((e) => e.id));
      markExamined.run(nowTs, idsJson);
      return written;
    });

    const written = tx();
    // Reference outputTarget to keep TypeScript happy when unused
    // (the future "direct" path is not implemented in v0.1).
    void outputTarget;

    return { examined: exchanges.length, written };
  }

  /**
   * Review-time: approve a pending suggestion. Moves the row from
   * `pending_memories` to `memory_entries` (via the live MemoryStore,
   * so capacity + security + dedupe rules all apply).
   */
  async approvePending(id: number): Promise<{ memoryId: number }> {
    const row = this.db
      .prepare(
        "SELECT id, content, target, status FROM pending_memories WHERE id = ?",
      )
      .get(id) as
      | { id: number; content: string; target: "memory" | "user"; status: string }
      | undefined;
    if (!row) {
      throw new Error(`pending_memory ${id} not found`);
    }
    if (row.status !== "pending") {
      throw new Error(`pending_memory ${id} is already ${row.status}`);
    }

    const result = await this.memoryStore.add(row.target, row.content);
    // Mark approved even if `noDuplicateAdded` (a duplicate is still a
    // successful resolution — the row leaves the queue).
    this.db
      .prepare("UPDATE pending_memories SET status = 'approved' WHERE id = ?")
      .run(id);
    return { memoryId: result.id };
  }

  /**
   * Review-time: reject a pending suggestion. Row stays in
   * `pending_memories` with `status='rejected'` for audit.
   */
  rejectPending(id: number): void {
    const info = this.db
      .prepare(
        "UPDATE pending_memories SET status = 'rejected' WHERE id = ? AND status = 'pending'",
      )
      .run(id);
    if (info.changes === 0) {
      throw new Error(`pending_memory ${id} not pending (already actioned?)`);
    }
  }

  /** List pending suggestions, newest first. */
  listPending(limit: number = 50): PendingMemoryRow[] {
    return this.db
      .prepare(
        "SELECT id, source_exchange_id, content, target, confidence, " +
          "created_at, status FROM pending_memories " +
          "WHERE status = 'pending' ORDER BY created_at DESC LIMIT ?",
      )
      .all(limit) as PendingMemoryRow[];
  }
}

/* ----- helpers ----- */

/**
 * Parse a simple duration string like "30m", "1h", "5m", "300s" into
 * milliseconds. v0.1 supports only the units the config schema
 * documents; anything else throws.
 */
export function parseInterval(s: string): number {
  const m = /^(\d+)\s*(ms|s|m|h)?$/.exec(s.trim());
  if (!m) {
    throw new Error(`Invalid EXTRACTOR_INTERVAL: "${s}" (expected e.g. "30m", "1h", "5m")`);
  }
  const n = Number(m[1]);
  const unit = (m[2] ?? "ms") as "ms" | "s" | "m" | "h";
  switch (unit) {
    case "ms":
      return n;
    case "s":
      return n * 1000;
    case "m":
      return n * 60 * 1000;
    case "h":
      return n * 60 * 60 * 1000;
    default: {
      const _exhaustive: never = unit;
      throw new Error(`Unknown unit: ${String(_exhaustive)}`);
    }
  }
}
