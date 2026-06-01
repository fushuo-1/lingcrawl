/**
 * LingCrawl JS/TS SDK — unified entrypoint.
 * - V2-based client (V1 removed)
 * - Exports: `LingCrawl` (default), `LingCrawlClient` (alias), and types
 */

/** Main client. */
export { LingCrawlClient } from "./client";
/** Public request/response types. */
export * from "./types";
/** Watcher class and options for crawl/batch job monitoring. */
export { Watcher, type WatcherOptions } from "./watcher";

export type { LingCrawlClientOptions } from "./client";

import { LingCrawlClient, type LingCrawlClientOptions } from "./client";

/** LingCrawl client — alias for LingCrawlClient. */
export class LingCrawl extends LingCrawlClient {
  constructor(opts: LingCrawlClientOptions = {}) {
    super(opts);
  }
}

export default LingCrawl;
