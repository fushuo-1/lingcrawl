import robotsParser, { Robot } from "robots-parser";
import { config } from "../config";
import { Logger } from "winston";
import { ScrapeOptions, scrapeOptions } from "../controllers/types";
import { scrapeURL } from "../scraper/scrapeURL";
import { Engine } from "../scraper/scrapeURL/engines";

const ROBOTS_MAX_AGE = 1 * 24 * 60 * 60 * 1000;

interface RobotsTxtChecker {
  robotsTxtUrl: string;
  robotsTxt: string;
  robots: Robot;
}

export async function fetchRobotsTxt(
  {
    url,
    zeroDataRetention,
    location,
  }: {
    url: string;
    zeroDataRetention: boolean;
    location?: ScrapeOptions["location"];
  },
  scrapeId: string,
  logger: Logger,
  abort?: AbortSignal,
): Promise<{ content: string; url: string }> {
  const urlObj = new URL(url);
  const robotsTxtUrl = `${urlObj.protocol}//${urlObj.host}/robots.txt`;

  const forceEngine: Engine[] = ["fetch"];

  let content: string = "";
  const response = await scrapeURL(
    "robots-txt;" + scrapeId,
    robotsTxtUrl,
    scrapeOptions.parse({
      formats: ["rawHtml"],
      timeout: 8000,
      maxAge: ROBOTS_MAX_AGE,
      ...(location ? { location } : {}),
    }),
    {
      forceEngine,
      externalAbort: abort
        ? {
            signal: abort,
            tier: "external",
            throwable() {
              return new Error("Robots.txt fetch aborted");
            },
          }
        : undefined,
      teamId: "robots-txt",
      zeroDataRetention,
    },
  );

  if (
    response.success &&
    response.document.metadata.statusCode >= 200 &&
    response.document.metadata.statusCode < 300
  ) {
    content = response.document.rawHtml!;
  } else {
    if (response.success && response.document.metadata.statusCode === 404) {
      logger.warn("Robots.txt not found", { robotsTxtUrl });
      return { content: "", url: robotsTxtUrl };
    }

    logger.error(`Request failed for robots.txt fetch`, {
      method: "fetchRobotsTxt",
      robotsTxtUrl,
      error: response.success
        ? response.document.metadata.statusCode
        : response.error,
    });
    return { content: "", url: robotsTxtUrl };
  }

  return {
    content: content,
    url: response.document.metadata.url || robotsTxtUrl,
  };
}

export function createRobotsChecker(
  url: string,
  robotsTxt: string,
): RobotsTxtChecker {
  const urlObj = new URL(url);
  const robotsTxtUrl = `${urlObj.protocol}//${urlObj.host}/robots.txt`;
  const robots = robotsParser(robotsTxtUrl, robotsTxt);
  return {
    robotsTxtUrl,
    robotsTxt,
    robots,
  };
}

export function isUrlAllowedByRobots(
  url: string,
  robots: Robot | null,
  userAgents: string[] = ["LingCrawlAgent", "lingcrawl"],
): boolean {
  if (!robots) return true;

  for (const userAgent of userAgents) {
    let isAllowed = robots.isAllowed(url, userAgent);

    if (isAllowed === null || isAllowed === undefined) {
      isAllowed = true;
    }

    if (isAllowed == null) {
      isAllowed = true;
    }

    if (isAllowed && !url.endsWith("/")) {
      const urlWithSlash = url + "/";
      let isAllowedWithSlash = robots.isAllowed(urlWithSlash, userAgent);

      if (isAllowedWithSlash == null) {
        isAllowedWithSlash = true;
      }

      if (isAllowedWithSlash === false) {
        isAllowed = false;
      }
    }

    if (isAllowed) {
      return true;
    }
  }

  return false;
}
