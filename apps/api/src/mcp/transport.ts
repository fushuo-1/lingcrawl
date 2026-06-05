import { Request, Response } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpServer } from "./server.js";
import { logger } from "../lib/logger";

/**
 * Express route handler for MCP Streamable HTTP transport.
 * Stateless mode: each request creates a fresh server + transport.
 */
export async function mcpRouter(req: Request, res: Response) {
  const mcpLogger = logger.child({ module: "mcp" });

  try {
    const server = createMcpServer();

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless
    });

    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);

    // Clean up after response is sent
    res.on("close", () => {
      transport.close();
      server.close();
    });
  } catch (e: any) {
    mcpLogger.error("MCP request failed", { error: e.message });

    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: {
          code: -32603,
          message: "Internal MCP error",
        },
        id: null,
      });
    }
  }
}
