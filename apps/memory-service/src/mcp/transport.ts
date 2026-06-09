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
 */
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export interface MountMcpOptions {
  /** The McpServer instance to expose over HTTP. */
  server: McpServer;
  /** Path to mount on (default `/mcp`). */
  path?: string;
}

/**
 * Wire the MCP server onto the given Fastify app at `{path}`.
 *
 * One transport per HTTP request — matches the stateless / non-session
 * mode used by `apps/api`'s MCP mount. A new transport is created for
 * each incoming request; the underlying McpServer is shared.
 */
export function mountMcpHttpTransport(
  app: FastifyInstance,
  opts: MountMcpOptions,
): void {
  const path = opts.path ?? "/mcp";

  app.all(path, async (request: FastifyRequest, reply: FastifyReply) => {
    // The SDK reads from req-like and writes to res-like. We hand it
    // a Node IncomingMessage-compatible facade backed by Fastify's raw
    // request, and write the SDK's response back through reply.raw.
    const req = request.raw;
    const res = reply.raw;

    // Reconstruct headers in the shape Node's http.IncomingMessage expects.
    const headers: Record<string, string | string[] | undefined> = {};
    for (const [k, v] of Object.entries(request.headers)) {
      headers[k.toLowerCase()] = v as string | string[] | undefined;
    }
    (req as unknown as { headers: typeof headers }).headers = headers;

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless mode
    });

    try {
      await opts.server.connect(transport);
      await transport.handleRequest(req, res, request.body);
    } catch (err) {
      app.log.error({ err }, "MCP transport error");
      if (!reply.sent) {
        reply.code(500).send({ error: "mcp-transport-failed" });
      }
    }
  });
}
