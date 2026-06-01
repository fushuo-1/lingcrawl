import { logger as _logger } from "../../lib/logger";
import {
  finishCrawl,
  getCrawlJobs,
  getDoneJobsOrderedLength,
} from "../../lib/crawl-redis";
import { getCrawl } from "../../lib/crawl-redis";
import { getJobs } from "../../controllers/crawl-status";
import { logCrawl, logBatchScrape } from "../logging/log_job";
import { createWebhookSender, WebhookEvent } from "../webhook/index";
import type { NuQJob } from "./nuq";

export async function finishCrawlSuper(job: NuQJob<any>) {
  const crawlId = job.groupId;

  if (!crawlId) {
    return;
  }

  const sc = await getCrawl(crawlId);

  if (!sc) {
    return;
  }

  const logger = _logger.child({
    module: "queue-worker",
    method: "finishCrawl",
    jobId: job.id,
    scrapeId: job.id,
    crawlId,
    zeroDataRetention: sc.internalOptions.zeroDataRetention,
  });

  logger.info("Finishing crawl");
  await finishCrawl(crawlId, logger);

  if (!job.data.v1) {
    const jobIDs = await getCrawlJobs(crawlId);

    const jobs = (await getJobs(jobIDs)).sort(
      (a, b) => a.timestamp - b.timestamp,
    );
    const jobStatus = sc.cancelled ? "failed" : "completed";

    const fullDocs = jobs
      .map(x =>
        x.returnvalue
          ? Array.isArray(x.returnvalue)
            ? x.returnvalue[0]
            : x.returnvalue
          : null,
      )
      .filter(x => x !== null);

    if (sc.crawlerOptions !== null) {
      await logCrawl(
        {
          id: crawlId,
          request_id: job.data.requestId ?? crawlId,
          url: sc.originUrl!,
          team_id: job.data.team_id,
          options: sc.crawlerOptions,
          num_docs: fullDocs.length,
          credits_cost: fullDocs.reduce(
            (acc, doc) => acc + (doc?.metadata?.creditsUsed ?? 0),
            0,
          ),
          zeroDataRetention: sc.zeroDataRetention || job.data.zeroDataRetention,
          cancelled: sc.cancelled ?? false,
        },
        false,
      );
    } else {
      await logBatchScrape(
        {
          id: crawlId,
          request_id: job.data.requestId ?? crawlId,
          team_id: job.data.team_id,
          num_docs: fullDocs.length,
          credits_cost: fullDocs.reduce(
            (acc, doc) => acc + (doc?.metadata?.creditsUsed ?? 0),
            0,
          ),
          zeroDataRetention: sc.zeroDataRetention || job.data.zeroDataRetention,
          cancelled: sc.cancelled ?? false,
        },
        false,
      );
    }

    // v0 web hooks
    if (!job.data.v1) {
      const sender = await createWebhookSender({
        teamId: job.data.team_id,
        jobId: crawlId,
        webhook: job.data.webhook,
        v0: true,
      });
      if (sender) {
        const documents = fullDocs.map((doc: any) => ({
          content: {
            content: doc?.content ?? doc?.rawHtml ?? doc?.markdown ?? "",
            markdown: doc?.markdown,
            metadata: doc?.metadata ?? {},
          },
          source: doc?.metadata?.sourceURL ?? doc?.url ?? "",
        }));
        if (sc.crawlerOptions !== null) {
          sender.send(WebhookEvent.CRAWL_COMPLETED, {
            success: true,
            data: documents,
          });
        } else {
          sender.send(WebhookEvent.BATCH_SCRAPE_COMPLETED, {
            success: true,
            data: documents,
          });
        }
      }
    }
  } else {
    const num_docs = await getDoneJobsOrderedLength(crawlId);

    if (sc.crawlerOptions !== null) {
      await logCrawl(
        {
          id: crawlId,
          request_id: job.data.requestId ?? crawlId,
          url: sc.originUrl!,
          team_id: job.data.team_id,
          options: sc.crawlerOptions,
          num_docs: num_docs,
          credits_cost: 0,
          zeroDataRetention: sc.zeroDataRetention || job.data.zeroDataRetention,
          cancelled: sc.cancelled ?? false,
        },
        false,
      );
    } else {
      await logBatchScrape(
        {
          id: crawlId,
          request_id: job.data.requestId ?? crawlId,
          team_id: job.data.team_id,
          num_docs: num_docs,
          credits_cost: 0,
          zeroDataRetention: sc.zeroDataRetention || job.data.zeroDataRetention,
          cancelled: sc.cancelled ?? false,
        },
        false,
      );
    }

    // v1 web hooks
    if (job.data.v1 && job.data.webhook) {
      const sender = await createWebhookSender({
        teamId: job.data.team_id,
        jobId: crawlId,
        webhook: job.data.webhook,
        v0: false,
      });
      if (sender) {
        if (sc.crawlerOptions !== null) {
          sender.send(WebhookEvent.CRAWL_COMPLETED, {
            success: true,
            data: [],
          });
        } else {
          sender.send(WebhookEvent.BATCH_SCRAPE_COMPLETED, {
            success: true,
            data: [],
          });
        }
      }
    }
  }
}
