export function isSelfHosted(): boolean {
  return true;
}

export function getErrorContactMessage(errorId?: string): string {
  return errorId
    ? `An error occurred. Please check your logs for more details. Error ID: ${errorId}`
    : "An error occurred. Please check your logs for more details.";
}
