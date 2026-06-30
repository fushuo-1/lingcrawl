/**
 * MCP tool: `kb_search`.
 *
 * Thin adapter over `IndexStore.searchNotes` that exposes full-text search
 * over the knowledge base via the MCP protocol. Supports optional financial
 * memory filtering via `FinancialIndexStore`.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { IndexStore } from "../../kb/index-store.js";
import type { FinancialIndexStore } from "../../financial/financial-index-store.js";

export function registerKbSearchTool(
  server: McpServer,
  indexStore: IndexStore,
  financialIndexStore: FinancialIndexStore,
): void {
  server.tool(
    "kb_search",
    "Full-text search over the knowledge base notes (FTS5 + BM25 ranking). Returns matching notes with snippets, tags, and relevance scores. Supports optional filtering by tags, path prefix, and financial memory fields (entity_type, ticker, direction, market).",
    {
      query: z
        .string()
        .min(1)
        .describe("Search keywords (FTS5 query syntax, e.g. 'redis OR cache')."),
      tags: z
        .array(z.string())
        .optional()
        .describe(
          "Optional list of tags to filter by. A note matches if it has ANY of the listed tags.",
        ),
      path: z
        .string()
        .optional()
        .describe(
          "Optional path prefix filter. Only notes whose path starts with this value are returned.",
        ),
      entity_type: z
        .enum(["opinion", "strategy", "position", "lesson"])
        .optional()
        .describe("Filter by financial memory entity type."),
      ticker: z
        .string()
        .optional()
        .describe("Filter by financial memory ticker (e.g. 'AAPL', 'BTC')."),
      direction: z
        .enum(["bullish", "bearish", "neutral"])
        .optional()
        .describe("Filter by financial memory direction."),
      market: z
        .string()
        .optional()
        .describe("Filter by financial memory market (e.g. 'NASDAQ', 'Crypto')."),
      limit: z
        .number()
        .int()
        .min(1)
        .max(100)
        .default(20)
        .describe("Maximum number of hits to return (1-100, default 20)."),
    },
    async ({ query, tags, path, entity_type, ticker, direction, market, limit }) => {
      try {
        // 有金融过滤参数时，先从 financial_memories 获取匹配的 notePath 集合
        const hasFinancialFilters = entity_type || ticker || direction || market;
        let allowedPaths: Set<string> | null = null;

        if (hasFinancialFilters) {
          const finResults = financialIndexStore.search({
            entityTypes: entity_type ? [entity_type] : undefined,
            ticker: ticker ?? undefined,
            direction: direction ?? undefined,
            market: market ?? undefined,
            limit: 1000, // 取足够大，后续由 FTS5 + limit 截取
          });
          allowedPaths = new Set(finResults.map((r) => r.notePath));

          // 金融过滤无匹配 → 直接返回空
          if (allowedPaths.size === 0) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify(
                    { success: true, query, count: 0, hits: [] },
                    null,
                    2,
                  ),
                },
              ],
            };
          }
        }

        // FTS5 搜索
        const hits = indexStore.searchNotes(query, {
          tags,
          pathPrefix: path,
          limit: hasFinancialFilters ? 1000 : limit,
        });

        // 金融过滤 + FTS5 取交集，然后截取 limit
        const filtered = allowedPaths
          ? hits.filter((h) => allowedPaths!.has(h.path)).slice(0, limit)
          : hits;

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  success: true,
                  query,
                  count: filtered.length,
                  hits: filtered.map((h) => ({
                    path: h.path,
                    title: h.title,
                    tags: h.tags,
                    snippet: h.snippet,
                    score: h.score,
                  })),
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          content: [
            { type: "text" as const, text: `Error: kb_search: ${msg}` },
          ],
          isError: true,
        };
      }
    },
  );
}
