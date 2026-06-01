// Stub: sentry service removed in self-hosted trim
import * as Sentry from "@sentry/node";

export function applyZdrScope(zeroDataRetention?: boolean) {
  // No-op in self-hosted mode
}

export function captureExceptionWithZdrCheck(
  error: any,
  context?: Record<string, any>,
) {
  try {
    Sentry.captureException(error, context);
  } catch {
    // Sentry may not be initialized
  }
}
