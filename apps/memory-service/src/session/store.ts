/**
 * SessionStore — CRUD over `sessions` + `exchanges`.
 *
 * Implements the writing subset of issue #72:
 * - `logExchange` — atomic write (session upsert + exchange insert in one tx)
 * - `listSessions` — recent sessions ordered by `started_at DESC`
 * - `getSession` — session + exchanges ordered by `sequence ASC`
 *
 * FTS5 search is deliberately NOT implemented here — that lives in #73.
 *
 * The store is constructed with a `better-sqlite3` `Database` handle so it is
 * trivially testable against `:memory:` databases (see `__tests__/unit/store.test.ts`).
 * In production, callers pass the process-wide handle from `getDb()`.
 */
import type Database from "better-sqlite3";
import type {
 Exchange,
 LogExchangeParams,
 LogExchangeResult,
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
 // KEY, so it fits comfortably in53 bits for any realistic session count).
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
 * `limit` defaults to50 when omitted. Sessions with `started_at = NULL` are
 * not possible by schema (the column has `NOT NULL DEFAULT unixepoch()`), so
 * the `DESC` order is total.
 */
 listSessions(limit: number =50): Session[] {
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
}
