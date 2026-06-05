import { logger } from "../../lib/logger";

type HeadersBag = Record<string, string | string[] | undefined>;

// No-op: idempotency key creation without database
export async function createIdempotencyKey(
  headers: HeadersBag,
): Promise<string> {
  const idempotencyKey = headers["x-idempotency-key"];
  if (!idempotencyKey) {
    throw new Error("No idempotency key provided in the request headers.");
  }
  // Without a database, idempotency keys are not persisted.
  // The key is still passed through for client-side tracking.
  logger.debug(`Idempotency key received: ${idempotencyKey} (not persisted)`);
  return Array.isArray(idempotencyKey) ? idempotencyKey[0] : idempotencyKey;
}
