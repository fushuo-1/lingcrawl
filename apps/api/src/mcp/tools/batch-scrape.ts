import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  URL as urlSchema,
} from "../../controllers/types";
import {
  addCrawlJobs,
  finishCrawlKickoff,
  lockURLs,
  markCrawlActive,
  saveCrawl,
  StoredCrawl,
} from "../../lib/crawl-redis";
import { addScrapeJobs } from "../../services/queue-jobs";
import { crawlGroup, scrapeQueue } from "../../services/worker/nuq";
import { logger } from "../../lib/logger";
import { isUrlBlocked } from "../../scraper/WebScraper/utils/blocklist";
import { v7 as uuidv7 } from "uuid";

const POLL_INTERVAL_MS = 2000;
const MAX_WAIT_MS = 5 * 60 * 1000; // 5 minutes

export function registerBatchScrapeTool(server: McpServer) {
  server.tool(
    "batch_scrape",
    "Scrape multiple URLs in parallel. Submits all URLs as individual scrape jobs and returns the combined results when complete.",
    {
      urls: z
        .array(z.string().url())
        .min(1)
        .describe("List of URLs to scrape"),
      ignoreInvalidURLs: z
        .boolean()
        .default(true)
        .describe("If true, silently skip invalid or blocked URLs instead of returning an error"),
    },
    async ({ urls, ignoreInvalidURLs }) => {
      try {
        const id = uuidv7();

        // Validate & filter URLs
        const validUrls: string[] = [];
        const invalidURLs: string[] = [];

        for (const u of urls) {
          try {
            const normalized = urlSchema.parse(u);
            if (!isUrlBlocked(normalized, null)) {
              validUrls.push(normalized);
            } else {
              invalidURLs.push(u);
            }
          } catch {
            if (ignoreInvalidURLs) {
              invalidURLs.push(u);
            } else {
              return {
                content: [{ type: "text" as const, text: `Error: Invalid URL '${u}'` }],
              };
            }
          }
        }

        if (validUrls.length === 0) {
          return {
            content: [{ type: "text" as const, text: "Error: No valid URLs provided" }],
          };
        }

        // Set up crawl storage
        const sc: StoredCrawl = {
          crawlerOptions: null,
          scrapeOptions: {} as any,
          internalOptions: {
            disableSmartWaitCache: true,
            teamId: "mcp",
            zeroDataRetention: false,
          },
          team_id: "mcp",
          createdAt: Date.now(),
          zeroDataRetention: false,
        };

        await crawlGroup.addGroup(id, "mcp", 24 * 60 * 60 * 1000);
        await saveCrawl(id, sc);
        await markCrawlActive(id);

        // Build individual scrape jobs
        const jobs = validUrls.map(url => ({
          jobId: uuidv7(),
          data: {
            url,
            mode: "single_urls" as const,
            team_id: "mcp",
            crawlerOptions: null,
            scrapeOptions: {},
            origin: "mcp",
            crawl_id: id,
            sitemapped: true,
            v1: true,
            internalOptions: sc.internalOptions,
            zeroDataRetention: false,
          },
          priority: 20,
        }));

        await finishCrawlKickoff(id);
        await lockURLs(id, sc, jobs.map(x => x.data.url), logger);
        await addCrawlJobs(id, jobs.map(x => x.jobId), logger);
        await addScrapeJobs(jobs as any);

        // Poll for completion
        const deadline = Date.now() + MAX_WAIT_MS;
        let status = "scraping";
        let completed = 0;
        let total = 0;

        while (Date.now() < deadline) {
          await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));

          const group = await crawlGroup.getGroup(id);
          if (!group) break;

          status = group.status === "active" ? "scraping" : group.status;
          const stats = await scrapeQueue.getGroupNumericStats(id, logger);
          completed = stats.completed ?? 0;
          total = (stats.completed ?? 0) + (stats.active ?? 0) + (stats.queued ?? 0) + (stats.backlog ?? 0);

          if (status !== "scraping") break;
        }

        // Collect results
        const doneJobs = await scrapeQueue.getCrawlJobsForListing(
          id,
          total || validUrls.length,
          0,
          logger,
        );

        const pages: string[] = [];
        for (const job of doneJobs) {
          const val = job.returnvalue;
          if (val?.markdown) {
            const title = val.metadata?.title ? `**${val.metadata.title}**\n` : "";
            pages.push(`### ${val.metadata?.sourceURL || ""}\n${title}\n${val.markdown}`);
          }
        }

        if (pages.length === 0) {
          if (status === "scraping") {
            return {
              content: [{
                type: "text" as const,
                text: `Batch scrape timed out after ${MAX_WAIT_MS / 1000}s. ${completed} of ${total} pages completed but no content was extracted.`,
              }],
            };
          }
          return {
            content: [{
              type: "text" as const,
              text: "No pages were successfully scraped. The sites may be blocking automated access.",
            }],
          };
        }

        const invalidNote = invalidURLs.length > 0
          ? `\n\nSkipped ${invalidURLs.length} invalid/blocked URL(s).\n`
          : "";

        const summary = status === "scraping"
          ? `Batch scrape timed out after ${MAX_WAIT_MS / 1000}s. Returning ${pages.length} of ${total} pages.${invalidNote}\n\n`
          : `Batch scrape complete. ${pages.length} pages scraped.${invalidNote}\n\n`;

        return {
          content: [{ type: "text" as const, text: summary + pages.join("\n\n---\n\n") }],
        };
      } catch (e: any) {
        return {
          content: [{ type: "text" as const, text: `Error: ${e.message || String(e)}` }],
        };
      }
    },
  );
}
