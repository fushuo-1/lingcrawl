/**
 * Custom error class for DB-level failures. Lets callers distinguish
 * persistence / schema problems from generic JS errors without having to
 * scrape `error.message` strings.
 *
 * Carries the underlying cause (e.g. the original `SqliteError`) on the
 * `cause` field per the standard `Error.cause` convention.
 */
export class DbError extends Error {
  override readonly name = "DbError";

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
  }
}
