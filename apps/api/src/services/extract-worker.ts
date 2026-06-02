// Stub: extract worker
import "dotenv/config";
import { config } from "../config";
import { logger } from "../lib/logger";

logger.info("Extract worker starting...");

// Keep the process alive
setInterval(() => {}, 60000);
