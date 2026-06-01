import { Request } from "express";
import { logger } from "../../../src/lib/logger";

// No-op: idempotency key creation without database
export async function createIdempotencyKey(req: Request): Promise<string> {
  const idempotencyKey = req.headers["x-idempotency-key"] as string;
  if (!idempotencyKey) {
    throw new Error("No idempotency key provided in the request headers.");
  }
  // Without a database, idempotency keys are not persisted.
  // The key is still passed through for client-side tracking.
  logger.debug(`Idempotency key received: ${idempotencyKey} (not persisted)`);
  return idempotencyKey;
}
