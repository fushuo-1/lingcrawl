import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { extractLinks } from "../../scraper/scrapeURL/lib/extractLinks";
import * as undici from "undici";

export function registerLinksTool(server: McpServer) {
  server.tool(
    "links",
    "Extract all hyperlinks from a web page. Returns links classified as internal or external.",
    {
      url: z.string().url().describe("The URL to extract links from"),
    },
    async ({ url }) => {
      try {
        const parsed = new URL(url);
        const sourceOrigin = parsed.origin;

        const response = await undici.fetch(url, {
          method: "GET",
          headers: {
            "User-Agent": "Mozilla/5.0 (compatible; LingCrawl/1.0)",
            Accept: "text/html",
          },
        });

        const html = await response.text();
        if (!html) {
          return { content: [{ type: "text" as const, text: "No content found at URL." }] };
        }

        const extractedUrls = await extractLinks(html, url);
        const links = extractedUrls
          .filter(linkUrl => linkUrl?.startsWith("http"))
          .map(linkUrl => {
            try {
              const u = new URL(linkUrl);
              return {
                url: u.href,
                type: u.origin === sourceOrigin ? "internal" : "external",
              };
            } catch {
              return { url: linkUrl, type: "external" };
            }
          });

        const internal = links.filter(l => l.type === "internal");
        const external = links.filter(l => l.type === "external");

        const text = [
          `Found ${links.length} links (${internal.length} internal, ${external.length} external):\n`,
          ...links.map(l => `[${l.type}] ${l.url}`),
        ].join("\n");

        return { content: [{ type: "text" as const, text }] };
      } catch (e: any) {
        return {
          content: [{ type: "text" as const, text: `Error: ${e.message || String(e)}` }],
        };
      }
    },
  );
}
