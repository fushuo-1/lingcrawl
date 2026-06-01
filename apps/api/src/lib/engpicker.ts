import { logger as _logger } from "./logger";

// Engpicker is disabled: relies on deleted fire-engine and index supabase features.
export async function processEngpickerJob() {
  _logger.debug("Engpicker is disabled in self-hosted mode");
  await new Promise(resolve => setTimeout(resolve, 5000));
}
