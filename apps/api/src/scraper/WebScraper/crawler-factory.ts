import { InternalOptions } from "../scrapeURL";
import { ScrapeOptions, TeamFlags } from "../../controllers/types";
import { WebCrawler } from "./crawler";
import { getAdjustedMaxDepth } from "./utils/maxDepthUtils";

import type { StoredCrawl } from "../../lib/crawl-redis";

export function crawlToCrawler(
  id: string,
  sc: StoredCrawl,
  teamFlags: TeamFlags,
  newBase?: string,
  crawlerOptions?: any,
): WebCrawler {
  const crawler = new WebCrawler({
    jobId: id,
    initialUrl: sc.originUrl!,
    baseUrl: newBase ? new URL(newBase).origin : undefined,
    includes: (sc.crawlerOptions?.includes ?? []).filter(
      x => x.trim().length > 0,
    ),
    excludes: (sc.crawlerOptions?.excludes ?? []).filter(
      x => x.trim().length > 0,
    ),
    maxCrawledLinks: sc.crawlerOptions?.maxCrawledLinks ?? 1000,
    maxCrawledDepth: getAdjustedMaxDepth(
      sc.originUrl!,
      sc.crawlerOptions?.maxDepth ?? 10,
    ),
    limit: sc.crawlerOptions?.limit ?? 10000,
    generateImgAltText: sc.crawlerOptions?.generateImgAltText ?? false,
    allowBackwardCrawling: sc.crawlerOptions?.allowBackwardCrawling ?? false,
    allowExternalContentLinks:
      sc.crawlerOptions?.allowExternalContentLinks ?? false,
    allowSubdomains: sc.crawlerOptions?.allowSubdomains ?? false,
    ignoreRobotsTxt:
      teamFlags?.ignoreRobots ?? sc.crawlerOptions?.ignoreRobotsTxt ?? false,
    regexOnFullURL: sc.crawlerOptions?.regexOnFullURL ?? false,
    maxDiscoveryDepth: sc.crawlerOptions?.maxDiscoveryDepth,
    currentDiscoveryDepth: crawlerOptions?.currentDiscoveryDepth ?? 0,
    zeroDataRetention: (teamFlags?.forceZDR || sc.zeroDataRetention) ?? false,
    location: sc.scrapeOptions?.location,
    headers: sc.scrapeOptions?.headers,
  });

  if (sc.robots !== undefined) {
    try {
      crawler.importRobotsTxt(sc.robots);
    } catch (_) {}
  }

  return crawler;
}
