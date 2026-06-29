/**
 * Financial memory error types — issue #99.
 */
export class FinancialValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FinancialValidationError";
  }
}
