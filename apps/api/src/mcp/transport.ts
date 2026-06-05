import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpServer } from "./server.js";
import { logger } from "../lib/logger";

/**
 * Fastify route handler for MCP Streamable HTTP transport.
 * Stateless mode: each request creates a fresh server + transport.
 */
export default async function mcpRoutes(fastify: FastifyInstance) {
  fastify.all("/mcp", async (request: FastifyRequest, reply: FastifyReply) => {
    const mcpLogger = logger.child({ module: "mcp" });

    try {
      const server = createMcpServer();

      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined, // stateless
      });

      await server.connect(transport);
      await transport.handleRequest(request.raw, reply.raw, request.body);

      // Clean up after response is sent
      reply.raw.on("close", () => {
        transport.close();
        server.close();
      });

      // Fastify must not try to send its own response — MCP transport handled it
      reply.hijack();
    } catch (e: any) {
      mcpLogger.error("MCP request failed", { error: e.message });

      if (!reply.sent) {
        return reply.code(500).send({
          jsonrpc: "2.0",
          error: {
            code: -32603,
            message: "Internal MCP error",
          },
          id: null,
        });
      }
    }
  });
}
