/**
 * Session Store — public types.
 *
 * `Session` and `Exchange` are the row shapes as the outside world sees them
 * (snake_case columns → camelCase fields, `metadata` JSON parsed back into a
 * plain object). `LogExchangeParams` is the writer-side contract.
 */

/** Origin of a session — who opened it. */
export type SessionSource = "cli" | "mcp" | "api";

/** A conversation session — one row per session in the `sessions` table. */
export interface Session {
  id: string;
  source: SessionSource;
  clientName: string | null;
  startedAt: number;
  endedAt: number | null;
  /** Parsed back from the JSON column on read; null on read if absent. */
  metadata: Record<string, unknown> | null;
}

/** A single user → assistant turn inside a session. */
export interface Exchange {
  id: number;
  sessionId: string;
  sequence: number;
  userMessage: string;
  userMessageTs: number;
  assistantMessage: string;
  assistantMessageTs: number;
  /** Always null in v0.1 (extractor worker fills this in v0.2). */
  extractedAt: number | null;
}

/** Params accepted by `SessionStore.logExchange`. */
export interface LogExchangeParams {
  sessionId: string;
  userMessage: string;
  assistantMessage: string;
  source: SessionSource;
  clientName?: string;
  metadata?: Record<string, unknown>;
  /**
   * Unix timestamp used for both `user_message_ts` and `assistant_message_ts`.
   * v0.1 simplification — the agent captures one `ts` per exchange.
   * If omitted, the SQL default `unixepoch()` is used.
   */
  timestamp?: number;
}

/** Return shape of `SessionStore.logExchange`. */
export interface LogExchangeResult {
  exchangeId: number;
  sequence: number;
  sessionId: string;
}

/** Result of `SessionStore.getSession` — session + ordered exchanges. */
export interface SessionWithExchanges {
  session: Session;
  exchanges: Exchange[];
}

/* ----- FTS5 search (issue #73) ----- */

/** Parameters accepted by `SessionStore.search`. */
export interface SearchParams {
  /**
   * Free-form keyword query. v0.1 hands the raw string to FTS5 — caller is
   * responsible for any escaping if they want literal term matching.
   * Invalid FTS5 syntax raises `FtsQueryError`.
   */
  query: string;
  /** Max hits to return; defaults to 20. */
  limit?: number;
  /**
   * When true, every hit carries the surrounding exchanges (`sequence -1` and
   * `sequence +1`) under `hit.context`. The first exchange in a session has
   * `prev = null`; the last has `next = null`.
   */
  includeContext?: boolean;
}

/** One neighbouring exchange — null when the hit is on the session boundary. */
export interface SearchContext {
  prev: Exchange | null;
  next: Exchange | null;
}

/** A single FTS5 hit, ordered by best score first (lowest `bm25()` value). */
export interface SearchHit {
  exchangeId: number;
  sessionId: string;
  sequence: number;
  userMessage: string;
  assistantMessage: string;
  /**
   * `bm25(exchanges_fts)` value — negative in SQLite; smaller = more relevant.
   * Returned as-is so callers can compare magnitudes if they want.
   */
  score: number;
  /** Only populated when `SearchParams.includeContext === true`. */
  context?: SearchContext;
}
