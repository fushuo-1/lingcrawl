import { Request } from "express";
import { validate as isUuid } from "uuid";
import { logger } from "../../../src/lib/logger";

// Without a database, all idempotency keys are considered valid (not duplicates).
export async function validateIdempotencyKey(req: Request): Promise<boolean> {
  const idempotencyKey = req.headers["x-idempotency-key"];
  if (!idempotencyKey) {
    return true;
  }
  const key = Array.isArray(idempotencyKey)
    ? idempotencyKey[0]
    : idempotencyKey;
  if (!isUuid(key)) {
    logger.debug("Invalid idempotency key provided in the request headers.");
    return false;
  }
  // Without a database, we cannot check for duplicates.
  // Always return true (valid = not a duplicate).
  return true;
}
