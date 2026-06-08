# Memory Service

AI Agent long-term memory + session history retrieval. See the parent PRD
in [issue #65](https://github.com/fushuo-1/lingcrawl/issues/65).

> **Scaffold status (issue #67)** — this is the minimum skeleton. Only `/health`
> is implemented. The MCP server, tools, resources, SQLite store, and CLI land
> in follow-up issues (#74, #75, #76, etc.). Do not use in production yet.

## What ships in this skeleton

- `apps/memory-service/` directory structure (`src/`, `__tests__/`, …)
- `package.json` with the planned dependencies
- `tsconfig.json` matching `apps/api` (strict mode, NodeNext)
- `Dockerfile` (multi-stage, Node 20 LTS)
- `docker-compose.yaml` integration (`memory-service` service)
- `GET /health` returning `{"status":"ok"}` on `127.0.0.1:3001`
- Local-only binding — the service is **not** exposed on `0.0.0.0`

## How to run

The service is part of the root `docker-compose.yaml`. From the repository root:

```bash
docker compose up -d memory-service
curl http://127.0.0.1:3001/health
# -> {"status":"ok"}
```

To stop:

```bash
docker compose down
```

Persistent data (the SQLite file, once #74 lands) is stored in the named volume
`lingcrawl_memory_data`, mounted at `/data` inside the container.

## Configuration

| Env var   | Default          | Notes                                       |
| --------- | ---------------- | ------------------------------------------- |
| `HOST`    | `127.0.0.1`      | Binds locally only — do not change to `0.0.0.0` |
| `PORT`    | `3001`           | Avoid conflict with `apps/api` (3002)       |
| `DATA_DIR`| `~/.lingcrawl`   | Placeholder for issue #68 — full Zod schema |

The full Zod schema (with `MEMORY_CHAR_LIMIT`, `EXTRACTOR_ENABLED`, `LLM_*`,
etc.) is added in [issue #68](https://github.com/fushuo-1/lingcrawl/issues/68).

## How to connect an MCP client

> **Not yet implemented.** The MCP server (`/mcp`, Streamable HTTP) and the
> 8 tools (`memory_add`, `memory_replace`, `memory_remove`, `memory_search`,
> `user_get`, `user_update`, `session_log`, `session_search`) and 2 resources
> (`memory://notes`, `memory://user`) land in
> [issue #75](https://github.com/fushuo-1/lingcrawl/issues/75). Once they ship,
> a Claude Code / Codex / Hermes client will be configured with:

```json
{
  "mcpServers": {
    "lingcrawl-memory": {
      "url": "http://127.0.0.1:3001/mcp"
    }
  }
}
```

## Development

For local iteration without Docker:

```bash
cd apps/memory-service
pnpm install
pnpm dev          # tsx src/index.ts
pnpm build        # tsc -> dist/
pnpm start        # node dist/index.js
```

## Project layout

```
apps/memory-service/
├── Dockerfile
├── package.json
├── tsconfig.json
├── README.md
├── .dockerignore
├── src/
│   ├── index.ts          # Fastify HTTP server, /health endpoint
│   ├── config.ts         # Placeholder — replaced in #68
│   ├── db/               # SQLite schema (issue #74)
│   ├── memory/           # MemoryStore (issue #73)
│   ├── session/          # SessionStore + FTS5 search
│   ├── mcp/              # MCP server + tools + resources (issue #75)
│   ├── cli/              # Commander CLI
│   └── lib/              # logger, errors, helpers
└── __tests__/            # E2E snips (issue #12)
```