/**
 * Custom error types for the session module. Kept separate from `db/errors.ts`
 * so storage-layer concerns (connection, schema) stay distinct from
 * store-level concerns (FTS5 query validation, future domain errors).
 *
 * `FtsQueryError` is the only error class needed for issue #73; this file
 * exists as the home for the rest of the session error taxonomy so follow-up
 * issues have an obvious place to add theirs.
 */

/**
 * Thrown by `SessionStore.search` when the user-supplied query cannot be
 * parsed by SQLite's FTS5 engine (unbalanced quotes, stray operators, etc.).
 *
 * The original SQLite error message is preserved on `sqliteMessage` so
 * callers can surface a helpful hint ("did you mean `term1 OR term2`?").
 * The original query is preserved on `query` for log/debug context.
 */
export class FtsQueryError extends Error {
  readonly query: string;
  readonly sqliteMessage: string;

  constructor(query: string, sqliteMessage: string) {
    super(`FTS5 query error for "${query}": ${sqliteMessage}`);
    this.name = "FtsQueryError";
    this.query = query;
    this.sqliteMessage = sqliteMessage;
  }
}
