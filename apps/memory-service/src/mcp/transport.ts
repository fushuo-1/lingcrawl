/**
 * MCP HTTP transport adapter — issue #75.
 *
 * Mounts an MCP `StreamableHTTPServerTransport` to a Fastify route at
 * `/mcp`. The SDK's transport handles all the JSON-RPC / SSE plumbing;
 * we just need to feed it the raw HTTP request + write its response
 * back through Fastify's `reply`.
 *
 * Pattern follows `apps/api/src/mcp/transport.ts` (the main LingCrawl
 * app's MCP mount) but adapted to Fastify instead of Express.
 *
 * Each request creates a fresh McpServer + transport pair (stateless
 * mode) to avoid the "already connected" error from the shared McpServer
 * singleton.
 */
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { createMemoryMcpServer } from "./server.js";

export interface MountMcpOptions {
  /** Path to mount on (default `/mcp`). */
  path?: string;
}

export function mountMcpHttpTransport(
  app: FastifyInstance,
  opts: MountMcpOptions = {},
): void {
  const path = opts.path ?? "/mcp";

  app.all(path, async (request: FastifyRequest, reply: FastifyReply) => {
    const req = request.raw;
    const res = reply.raw;

    // Reconstruct headers in the shape Node's http.IncomingMessage expects.
    const headers: Record<string, string | string[] | undefined> = {};
    for (const [k, v] of Object.entries(request.headers)) {
      headers[k.toLowerCase()] = v as string | string[] | undefined;
    }
    (req as unknown as { headers: typeof headers }).headers = headers;

    // Create a fresh McpServer + transport per request
    const mcp = createMemoryMcpServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless mode
    });

    try {
      await mcp.server.connect(transport);
      await transport.handleRequest(req, res, request.body);
      reply.hijack();
      // Clean up after response
      reply.raw.on("close", () => {
        transport.close().catch(() => {});
        mcp.server.close().catch(() => {});
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      app.log.error({ err: { message: msg } }, "MCP transport error");
      if (!reply.sent) {
        reply.code(500).send({ error: "mcp-transport-failed" });
      }
    }
  });
}
