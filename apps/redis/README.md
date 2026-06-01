# LingCrawl Redis

Redis configuration for LingCrawl, used as the message broker and caching layer for the API and worker services.

## Role in LingCrawl

Redis serves two purposes in the LingCrawl stack:

- **Rate limiting** — via `REDIS_RATE_LIMIT_URL`
- **Queue & caching** — via `REDIS_URL`

Both are configured in `apps/api/.env` (see `SELF_HOST.md` at the repo root for the full environment variable reference).

## Running locally

The simplest way is through Docker Compose from the repo root:

```bash
docker compose up -d redis
```

This starts Redis on `localhost:6379`, which matches the default `.env` values.

## Deploying to Fly.io

This directory contains the Dockerfile and `fly.toml` for deploying Redis to [Fly.io](https://fly.io).

### Setup

1. Create the app:
   ```bash
   fly launch --no-deploy
   ```

2. Set a password before deploying:
   ```bash
   fly secrets set REDIS_PASSWORD=<your-password>
   ```

3. Create a persistent volume (data is lost across restarts without one):
   ```bash
   flyctl volumes create redis_server --region ord
   ```

4. Deploy:
   ```bash
   fly deploy
   ```

### Connecting from LingCrawl

Set these environment variables in your LingCrawl API deployment to point at the Fly.io Redis instance:

```
REDIS_URL=redis://:<password>@<app-name>.flycast:6379
REDIS_RATE_LIMIT_URL=redis://:<password>@<app-name>.flycast:6379
```

## Notes

- By default, Redis only accepts connections on the private IPv6 network (port 6379). Add a `[[services]]` section to `fly.toml` if you need public access.
- Keep `REDIS_PASSWORD` consistent between this service and your LingCrawl API `.env`.
