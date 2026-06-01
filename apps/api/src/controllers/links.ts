import { Request, Response } from "express";
import { logger as _logger } from "../../lib/logger";
import { extractLinks } from "../scraper/scrapeURL/lib/extractLinks";
import { scrapeURLWithFetch } from "../scraper/scrapeURL/engines/fetch";

interface LinksRequest {
  url: string;
}

export async function linksController(
  req: Request<{}, any, LinksRequest>,
  res: Response,
) {
  const logger = _logger.child({ method: "linksController" });
  const { url } = req.body;

  if (!url) {
    return res.status(400).json({ success: false, error: "url is required" });
  }

  try {
    const parsed = new URL(url);
    const sourceOrigin = parsed.origin;

    // Fetch the page using the fetch engine
    const result = await scrapeURLWithFetch({
      url,
      logger,
      featureFlags: new Set(),
      options: {
        formats: [{ type: "rawHtml" }],
        headers: {},
        waitFor: 0,
      },
      internalOptions: {},
      abort: new AbortController().signal,
    } as any);

    if (!result.html) {
      return res.status(200).json({
        success: true,
        data: { links: [], sourceURL: url },
      });
    }

    // Extract links using the existing extractLinks function
    const extractedUrls = await extractLinks(result.html, url);

    // Classify links as internal/external
    const links = extractedUrls
      .filter(linkUrl => linkUrl && linkUrl.startsWith("http"))
      .map(linkUrl => {
        try {
          const u = new URL(linkUrl);
          return {
            url: u.href,
            type: u.origin === sourceOrigin ? "internal" as const : "external" as const,
          };
        } catch {
          return {
            url: linkUrl,
            type: "external" as const,
          };
        }
      });

    return res.status(200).json({
      success: true,
      data: {
        links,
        sourceURL: url,
        total: links.length,
        internal: links.filter(l => l.type === "internal").length,
        external: links.filter(l => l.type === "external").length,
      },
    });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    logger.error("Links extraction failed", { error, url });

    return res.status(500).json({
      success: false,
      error: `Failed to extract links: ${error}`,
    });
  }
}
