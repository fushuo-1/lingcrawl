/**
 * SessionStore — CRUD over `sessions` + `exchanges`.
 *
 * Implements:
 * - issue #72: `logExchange` (atomic session upsert + exchange insert),
 *   `listSessions` (recent first), `getSession` (session + exchanges).
 * - issue #73: `search` (FTS5 full-text search over user + assistant
 *   messages, with optional surrounding-exchange context expansion).
 *
 * The store is constructed with a `better-sqlite3` `Database` handle so it is
 * trivially testable against `:memory:` databases (see `__tests__/unit/`).
 * In production, callers pass the process-wide handle from `getDb()`.
 */
import type Database from "better-sqlite3";
import { FtsQueryError } from "./errors.js";
import type {
  Exchange,
  LogExchangeParams,
  LogExchangeResult,
  SearchContext,
  SearchHit,
  SearchParams,
  Session,
  SessionSource,
  SessionWithExchanges,
} from "./types.js";

/* ----- Internal row shapes (snake_case, as stored in SQLite) ----- */

interface SessionRow {
  id: string;
  source: SessionSource;
  client_name: string | null;
  started_at: number;
  ended_at: number | null;
  metadata: string | null;
}

interface ExchangeRow {
  id: number;
  session_id: string;
  sequence: number;
  user_message: string;
  user_message_ts: number;
  assistant_message: string;
  assistant_message_ts: number;
  extracted_at: number | null;
}

/* ----- Row → public shape converters ----- */

function rowToSession(row: SessionRow): Session {
  return {
    id: row.id,
    source: row.source,
    clientName: row.client_name,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    metadata:
      row.metadata === null || row.metadata === ""
        ? null
        : (JSON.parse(row.metadata) as Record<string, unknown>),
  };
}

function rowToExchange(row: ExchangeRow): Exchange {
  return {
    id: row.id,
    sessionId: row.session_id,
    sequence: row.sequence,
    userMessage: row.user_message,
    userMessageTs: row.user_message_ts,
    assistantMessage: row.assistant_message,
    assistantMessageTs: row.assistant_message_ts,
    extractedAt: row.extracted_at,
  };
}

/* ----- The store ----- */

export class SessionStore {
  private readonly db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  /**
   * Atomically append one exchange to a session.
   *
   * - If the session row does not exist yet, it is inserted (`INSERT OR IGNORE`
   * keeps the call idempotent against concurrent writers — the second writer
   * will see the existing row and just append its exchange).
   * - `sequence` is computed as `COALESCE(MAX(sequence),0) +1` per session.
   * - Session insert + sequence read + exchange insert are wrapped in a single
   * `BEGIN…COMMIT` transaction so a crash mid-write cannot leave a session
   * without its exchange or vice versa.
   *
   * Returns the new exchange's `id`, its `sequence` within the session, and the
   * `sessionId` echoed back for caller convenience.
   */
  logExchange(params: LogExchangeParams): LogExchangeResult {
    const {
      sessionId,
      userMessage,
      assistantMessage,
      source,
      clientName,
      metadata,
      timestamp,
    } = params;

    const metadataJson = metadata === undefined ? null : JSON.stringify(metadata);

    const insertSession = this.db.prepare(
      "INSERT OR IGNORE INTO sessions (id, source, client_name, metadata) " +
        "VALUES (?, ?, ?, ?)",
    );

    const nextSequence = this.db.prepare(
      "SELECT COALESCE(MAX(sequence),0) +1 AS seq " +
        "FROM exchanges WHERE session_id = ?",
    );

    // If the caller provided an explicit `timestamp`, use it for both ts columns;
    // otherwise let the SQL default (`unixepoch()`) fill them.
    const insertExchange = this.db.prepare(
      timestamp === undefined
        ? "INSERT INTO exchanges " +
          "(session_id, sequence, user_message, user_message_ts, " +
          " assistant_message, assistant_message_ts) " +
          "VALUES (?, ?, ?, unixepoch(), ?, unixepoch())"
        : "INSERT INTO exchanges " +
          "(session_id, sequence, user_message, user_message_ts, " +
          " assistant_message, assistant_message_ts) " +
          "VALUES (?, ?, ?, ?, ?, ?)",
    );

    // `better-sqlite3` is synchronous — wrap the three statements in an explicit
    // transaction so they are guaranteed to commit atomically.
    const tx = this.db.transaction((): LogExchangeResult => {
      insertSession.run(sessionId, source, clientName ?? null, metadataJson);

      const seqRow = nextSequence.get(sessionId) as { seq: number };
      const sequence = seqRow.seq;

      // `better-sqlite3` exposes the last insert id on `run()`'s return value
      // (`lastInsertRowid` is `number | bigint` — coerce to a plain number so the
      // public surface stays uniform; the `exchanges.id` column is INTEGER PRIMARY
      // KEY, so it fits comfortably in 53 bits for any realistic session count).
      const info =
        timestamp === undefined
          ? insertExchange.run(sessionId, sequence, userMessage, assistantMessage)
          : insertExchange.run(
              sessionId,
              sequence,
              userMessage,
              timestamp,
              assistantMessage,
              timestamp,
            );

      const exchangeId = Number(info.lastInsertRowid);

      return { exchangeId, sequence, sessionId };
    });

    return tx();
  }

  /**
   * Return the most recent sessions, newest first.
   *
   * `limit` defaults to 50 when omitted. Sessions with `started_at = NULL` are
   * not possible by schema (the column has `NOT NULL DEFAULT unixepoch()`), so
   * the `DESC` order is total.
   */
  listSessions(limit: number = 50): Session[] {
    const rows = this.db
      .prepare(
        "SELECT id, source, client_name, started_at, ended_at, metadata " +
          "FROM sessions ORDER BY started_at DESC LIMIT ?",
      )
      .all(limit) as SessionRow[];

    return rows.map(rowToSession);
  }

  /**
   * Fetch a single session + all of its exchanges (ordered by `sequence ASC`).
   *
   * Returns `null` when no session exists with the given id — callers can
   * distinguish "not found" from "empty session" by checking the result.
   */
  getSession(sessionId: string): SessionWithExchanges | null {
    const sessionRow = this.db
      .prepare(
        "SELECT id, source, client_name, started_at, ended_at, metadata " +
          "FROM sessions WHERE id = ?",
      )
      .get(sessionId) as SessionRow | undefined;

    if (!sessionRow) return null;

    const exchangeRows = this.db
      .prepare(
        "SELECT id, session_id, sequence, user_message, user_message_ts, " +
          "assistant_message, assistant_message_ts, extracted_at " +
          "FROM exchanges WHERE session_id = ? ORDER BY sequence ASC",
      )
      .all(sessionId) as ExchangeRow[];

    return {
      session: rowToSession(sessionRow),
      exchanges: exchangeRows.map(rowToExchange),
    };
  }

  /**
   * FTS5 full-text search over the user + assistant message columns.
   *
   * Behaviour:
   * - The raw `query` string is passed straight to FTS5 (no v0.1 parsing).
   *   Invalid syntax (unbalanced quotes, stray operators) surfaces as
   *   `FtsQueryError` so callers can show a useful message instead of a raw
   *   SQLite exception.
   * - `limit` defaults to 20, must be `>= 1`.
   * - Results are ordered by `bm25(exchanges_fts)` ascending — smaller (more
   *   negative) scores are more relevant. The raw `bm25()` value is returned
   *   on each hit; the sign convention is left intact.
   * - When `includeContext === true`, every hit gains a `context` object with
   *   the `sequence -1` and `sequence +1` exchanges (or `null` if the hit is
   *   on a session boundary).
   *
   * The FTS5 index is maintained by the `exchanges_ai/au/ad` triggers defined
   * in `db/schema.sql`, so `logExchange` automatically feeds the search index.
   */
  search(params: SearchParams): SearchHit[] {
    const { query, limit = 20, includeContext = false } = params;

    if (!Number.isInteger(limit) || limit < 1) {
      throw new RangeError(`search.limit must be a positive integer, got ${limit}`);
    }

    const stmt = this.db.prepare(
      "SELECT e.id, e.session_id, e.sequence, e.user_message, " +
        "e.assistant_message, bm25(exchanges_fts) AS score " +
        "FROM exchanges_fts f " +
        "JOIN exchanges e ON e.id = f.rowid " +
        "WHERE exchanges_fts MATCH ? " +
        "ORDER BY score " +
        "LIMIT ?",
    );

    let rows: SearchHitRow[];
    try {
      rows = stmt.all(query, limit) as SearchHitRow[];
    } catch (err) {
      if (isFtsSyntaxError(err)) {
        const message = err instanceof Error ? err.message : String(err);
        throw new FtsQueryError(query, message);
      }
      throw err;
    }

    if (!includeContext) {
      return rows.map(rowToSearchHit);
    }

    return rows.map((row) => {
      const hit = rowToSearchHit(row);
      hit.context = loadContext(this.db, row.session_id, row.sequence);
      return hit;
    });
  }
}

/* ----- search helpers ----- */

interface SearchHitRow {
  id: number;
  session_id: string;
  sequence: number;
  user_message: string;
  assistant_message: string;
  score: number;
}

function rowToSearchHit(row: SearchHitRow): SearchHit {
  return {
    exchangeId: row.id,
    sessionId: row.session_id,
    sequence: row.sequence,
    userMessage: row.user_message,
    assistantMessage: row.assistant_message,
    score: row.score,
  };
}

/**
 * Look up the `sequence -1` / `sequence +1` exchanges in a session.
 *
 * Returns `null` for whichever side falls off the session's sequence range
 * (the first exchange has no `prev`, the last has no `next`).
 */
function loadContext(
  db: Database.Database,
  sessionId: string,
  sequence: number,
): SearchContext {
  const fetchNeighbour = db.prepare(
    "SELECT id, session_id, sequence, user_message, user_message_ts, " +
      "assistant_message, assistant_message_ts, extracted_at " +
      "FROM exchanges WHERE session_id = ? AND sequence = ?",
  );

  const prevRow =
    sequence > 1
      ? (fetchNeighbour.get(sessionId, sequence - 1) as ExchangeRow | undefined)
      : undefined;
  const nextRow = fetchNeighbour.get(
    sessionId,
    sequence + 1,
  ) as ExchangeRow | undefined;

  return {
    prev: prevRow ? rowToExchange(prevRow) : null,
    next: nextRow ? rowToExchange(nextRow) : null,
  };
}

/**
 * Heuristic: an FTS5 MATCH failure always surfaces as a `SqliteError` whose
 * `message` starts with `fts5:` (per SQLite's own error format). We treat any
 * error with that prefix as an FTS-syntax issue and rewrap it as
 * `FtsQueryError`; other errors propagate untouched.
 */
function isFtsSyntaxError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return err.message.includes("fts5:");
}
