/**
 * MCP tool: `fin_memory_write` — write a financial memory (issue #99).
 *
 * Thin adapter over FinancialStore.create with field validation.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { FinancialStore } from "../../financial/financial-store.js";
import { validateRequiredFields } from "../../financial/validators.js";

export function registerFinMemoryWriteTool(
  server: McpServer,
  store: FinancialStore,
): void {
  server.tool(
    "fin_memory_write",
    "Write a financial memory (opinion, strategy, position, or lesson) to the database. " +
      "For 'opinion' entity_type, ticker, direction, time_horizon, confidence, and thesis are required. " +
      "Returns the created memory with its generated id.",
    {
      id: z
        .string()
        .uuid()
        .optional()
        .describe("Optional UUID. If omitted, a random UUID is generated."),
      entity_type: z
        .enum(["opinion", "strategy", "position", "lesson"])
        .describe("Type of financial memory entity."),
      ticker: z
        .string()
        .optional()
        .describe("Stock / asset ticker symbol (e.g. 'AAPL', 'BTC')."),
      market: z
        .string()
        .optional()
        .describe("Market or exchange (e.g. 'NYSE', 'NASDAQ', 'Crypto')."),
      direction: z
        .enum(["bullish", "bearish", "neutral"])
        .optional()
        .describe("Directional bias for the opinion."),
      time_horizon: z
        .enum(["short", "medium", "long"])
        .optional()
        .describe("Expected time horizon for the opinion."),
      confidence: z
        .number()
        .int()
        .min(1)
        .max(5)
        .optional()
        .describe("Confidence level from 1 (low) to 5 (high)."),
      thesis: z
        .string()
        .optional()
        .describe("Investment thesis or reasoning."),
      risks: z
        .string()
        .optional()
        .describe("Key risks or counter-arguments."),
      source: z
        .string()
        .optional()
        .describe("Source of the opinion (e.g. 'earnings call', 'technical analysis')."),
      tags: z
        .array(z.string())
        .optional()
        .describe("Optional tags for categorization."),
      note_path: z
        .string()
        .optional()
        .describe("Optional linked knowledge-base note path."),
      /* ---- strategy fields (for future slices) ---- */
      name: z.string().optional().describe("Strategy name."),
      asset_class: z
        .enum(["stock", "etf", "bond", "crypto", "mixed"])
        .optional()
        .describe("Asset class the strategy targets."),
      rules: z.string().optional().describe("Strategy rules or logic."),
      parameters: z.string().optional().describe("Strategy parameters (JSON)."),
      backtests: z.string().optional().describe("Backtest results (JSON)."),
      strategy_status: z
        .enum(["draft", "active", "paused", "retired"])
        .optional()
        .describe("Current strategy status."),
      /* ---- position fields (for future slices) ---- */
      position_status: z
        .enum(["holding", "watching", "closed"])
        .optional()
        .describe("Current position status."),
      cost_basis: z.number().optional().describe("Average cost basis."),
      quantity: z.number().optional().describe("Number of shares / units."),
      target_price: z.number().optional().describe("Target price."),
      stop_loss: z.number().optional().describe("Stop loss price."),
      alert_conditions: z.string().optional().describe("Alert conditions (JSON)."),
      position_size_percent: z.number().optional().describe("Position size as portfolio percentage."),
      /* ---- lesson fields (for future slices) ---- */
      title: z.string().optional().describe("Lesson title."),
      lesson_category: z
        .enum(["mistake", "principle", "framework", "insight"])
        .optional()
        .describe("Lesson category."),
      scenario: z.string().optional().describe("Scenario or context."),
      lesson: z.string().optional().describe("Lesson content."),
    },
    async (args) => {
      try {
        const input = {
          id: args.id,
          entityType: args.entity_type,
          ticker: args.ticker,
          market: args.market,
          direction: args.direction,
          timeHorizon: args.time_horizon,
          confidence: args.confidence,
          thesis: args.thesis,
          risks: args.risks,
          source: args.source,
          tags: args.tags,
          notePath: args.note_path,
          name: args.name,
          assetClass: args.asset_class,
          rules: args.rules,
          parameters: args.parameters,
          backtests: args.backtests,
          strategyStatus: args.strategy_status,
          positionStatus: args.position_status,
          costBasis: args.cost_basis,
          quantity: args.quantity,
          targetPrice: args.target_price,
          stopLoss: args.stop_loss,
          alertConditions: args.alert_conditions,
          positionSizePercent: args.position_size_percent,
          title: args.title,
          lessonCategory: args.lesson_category,
          scenario: args.scenario,
          lesson: args.lesson,
        };

        validateRequiredFields(input);
        const memory = store.create(input);

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                { success: true, memory },
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
            { type: "text" as const, text: `Error: fin_memory_write: ${msg}` },
          ],
          isError: true,
        };
      }
    },
  );
}
