import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerScrapeTool } from "./tools/scrape.js";
import { registerSearchTool } from "./tools/search.js";
import { registerMapTool } from "./tools/map.js";
import { registerLinksTool } from "./tools/links.js";
import { registerGithubReadTool } from "./tools/github-read.js";
import { registerExtractTool } from "./tools/extract.js";
import { registerReadPdfTool } from "./tools/read-pdf.js";
import { registerCrawlTool } from "./tools/crawl.js";
import { registerBatchScrapeTool } from "./tools/batch-scrape.js";

/**
 * Create a fully configured MCP server with all LingCrawl tools registered.
 */
export function createMcpServer(): McpServer {
  const server = new McpServer({
    name: "lingcrawl",
    version: "1.0.0",
  });

  registerScrapeTool(server);
  registerSearchTool(server);
  registerMapTool(server);
  registerLinksTool(server);
  registerGithubReadTool(server);
  registerExtractTool(server);
  registerReadPdfTool(server);
  registerCrawlTool(server);
  registerBatchScrapeTool(server);

  return server;
}
