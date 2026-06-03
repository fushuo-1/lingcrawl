import { v7 as uuidv7 } from "uuid";
import type { NuQJob } from "./worker/nuq";
import type { ScrapeJobData } from "../types";
import type { BaseScrapeOptions } from "../controllers/types";

const DEFAULT_TEAM_ID = "local";

export type BuildSyncScrapeJobOptions = {
  url: string;
  scrapeOptions: BaseScrapeOptions;
  jobId?: string;
  origin?: string;
  integration?: string | null;
  startTime?: number;
  zeroDataRetention?: boolean;
  concurrencyLimited?: boolean;
  unnormalizedSourceURL?: string;
};

/**
 * Builds a NuQJob for a synchronous (internal) single-URL scrape.
 *
 * Centralises the job shape shared by scrape, extract, and other
 * controllers that call `processJobInternal` directly instead of
 * going through the queue.
 */
export function buildSyncScrapeJob(
  opts: BuildSyncScrapeJobOptions,
): NuQJob<ScrapeJobData> {
  const jobId = opts.jobId ?? uuidv7();
  const teamId = DEFAULT_TEAM_ID;
  const zeroDataRetention = opts.zeroDataRetention ?? false;

  return {
    id: jobId,
    status: "active",
    createdAt: new Date(),
    priority: 10,
    data: {
      url: opts.url,
      mode: "single_urls",
      team_id: teamId,
      scrapeOptions: opts.scrapeOptions,
      internalOptions: {
        teamId,
        unnormalizedSourceURL: opts.unnormalizedSourceURL ?? opts.url,
        bypassBilling: true,
        zeroDataRetention,
        teamFlags: null,
      },
      skipNuq: true,
      origin: opts.origin ?? "api",
      integration: opts.integration ?? null,
      startTime: opts.startTime ?? Date.now(),
      zeroDataRetention,
      apiKeyId: null,
      concurrencyLimited: opts.concurrencyLimited ?? false,
    },
  };
}
