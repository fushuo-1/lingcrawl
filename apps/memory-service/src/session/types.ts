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
