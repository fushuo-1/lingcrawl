import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { crawlRequestSchema, toV0CrawlerOptions } from "../../controllers/types";
import {
  crawlToCrawler,
  saveCrawl,
  StoredCrawl,
  markCrawlActive,
  getCrawl,
} from "../../lib/crawl-redis";
import { _addScrapeJobToBullMQ } from "../../services/queue-jobs";
import { crawlGroup, scrapeQueue } from "../../services/worker/nuq";
import { logger } from "../../lib/logger";
import { v7 as uuidv7 } from "uuid";

const POLL_INTERVAL_MS = 2000;
const MAX_WAIT_MS = 5 * 60 * 1000; // 5 minutes

export function registerCrawlTool(server: McpServer) {
  server.tool(
    "crawl",
    "Crawl an entire website starting from a URL. Automatically discovers and scrapes all linked pages. Returns all scraped content when complete.",
    {
      url: z.string().url().describe("The starting URL for the crawl"),
      limit: z
        .number()
        .min(1)
        .max(500)
        .default(50)
        .describe("Maximum number of pages to crawl (1-500)"),
      includePaths: z
        .array(z.string())
        .optional()
        .describe("Regex patterns for paths to include (e.g. ['/blog/.*'])"),
      excludePaths: z
        .array(z.string())
        .optional()
        .describe("Regex patterns for paths to exclude (e.g. ['/admin/.*'])"),
    },
    async ({ url, limit, includePaths, excludePaths }) => {
      try {
        // Validate regex patterns
        for (const pattern of [...(includePaths || []), ...(excludePaths || [])]) {
          try { new RegExp(pattern); } catch (e: any) {
            return {
              content: [{ type: "text" as const, text: `Error: Invalid regex pattern '${pattern}': ${e.message}` }],
            };
          }
        }

        // Submit crawl job
        const id = uuidv7();
        const crawlerOptions = {
          limit,
          includePaths,
          excludePaths,
          url: undefined,
          scrapeOptions: undefined,
          prompt: undefined,
        };

        const sc: StoredCrawl = {
          originUrl: url,
          crawlerOptions: toV0CrawlerOptions(crawlerOptions as any),
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

        const crawler = crawlToCrawler(id, sc, null);

        try {
          sc.robots = await crawler.getRobotsTxt(false);
        } catch {
          // robots.txt failure is tolerated
        }

        await crawlGroup.addGroup(id, "mcp", 24 * 60 * 60 * 1000);
        await saveCrawl(id, sc);
        await markCrawlActive(id);

        await _addScrapeJobToBullMQ(
          {
            url,
            mode: "kickoff" as const,
            team_id: "mcp",
            crawlerOptions,
            scrapeOptions: sc.scrapeOptions,
            internalOptions: sc.internalOptions,
            origin: "mcp",
            crawl_id: id,
            v1: true,
            zeroDataRetention: false,
          } as any,
          uuidv7(),
        );

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
          total || 100,
          0,
          logger,
        );

        const pages: string[] = [];
        for (const job of doneJobs) {
          const val = job.returnvalue;
          if (val?.markdown) {
            const title = val.metadata?.title ? `**${val.metadata.title}**\n` : "";
            pages.push(`### ${val.metadata?.sourceURL || url}\n${title}\n${val.markdown}`);
          }
        }

        if (pages.length === 0) {
          if (status === "scraping") {
            return {
              content: [{
                type: "text" as const,
                text: `Crawl timed out after ${MAX_WAIT_MS / 1000}s. ${completed} of ${total} pages were completed but no content was extracted. Try reducing the limit or adding path filters.`,
              }],
            };
          }
          return {
            content: [{
              type: "text" as const,
              text: "No pages were successfully crawled. The site may be blocking automated access.",
            }],
          };
        }

        const summary = status === "scraping"
          ? `Crawl timed out after ${MAX_WAIT_MS / 1000}s. Returning ${pages.length} of ${total} pages.\n\n`
          : `Crawl complete. ${pages.length} pages scraped.\n\n`;

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
