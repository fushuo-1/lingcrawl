# syntax=docker/dockerfile:1
# ---- Base stage ----------------------------------------------------------
FROM node:22-bookworm-slim AS base

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
ENV CI=true

# Pin pnpm to a version that works on Node 20 (corepack's default at time of
# build resolves to pnpm 11.x which requires Node 22's `node:sqlite` builtin).
ENV PNPM_VERSION=10.16.1

RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate

# ---- Build stage ---------------------------------------------------------
FROM base AS build

WORKDIR /app

# System deps for better-sqlite3 native build
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package.json ./

# Use --frozen-lockfile only if a lockfile is present (so the scaffold can
# be built before the first `pnpm install` runs locally).
RUN if [ -f pnpm-lock.yaml ]; then \
      pnpm install --frozen-lockfile; \
    else \
      pnpm install --no-frozen-lockfile; \
    fi

COPY tsconfig.json ./
COPY src ./src

RUN pnpm run build

# Drop dev deps for the runtime image
RUN pnpm prune --prod --ignore-scripts

# ---- Runtime stage --------------------------------------------------------
FROM base AS runtime

WORKDIR /app

# better-sqlite3 ships a prebuilt binary for linux-x64 / glibc — works on bookworm-slim
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./package.json

ENV NODE_ENV=production
ENV HOST=127.0.0.1
ENV PORT=3001

EXPOSE 3001

CMD ["node", "dist/index.js"]