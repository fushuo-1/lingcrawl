# LingCrawl Native Addon (`@lingcrawl/lingcrawl-rs`)

Rust native addon for LingCrawl, built with [napi-rs](https://napi.rs/). Provides high-performance HTML-to-markdown conversion, PDF parsing, URL crawling, and engine selection used by the core API.

## Modules

| Module | Purpose |
|--------|---------|
| `html` | HTML to markdown conversion |
| `pdf` | PDF document parsing |
| `crawler` | URL crawling utilities |
| `engpicker` | Scraping engine selection logic |
| `document` | Document type detection and conversion |
| `logging` | Native logging bridge |

## Build

### Prerequisites

- [Rust](https://www.rust-lang.org/tools/install) (latest stable)
- [Node.js](https://nodejs.org/) >= 18
- [pnpm](https://pnpm.io/) 9+

### Build commands

```bash
cd apps/api/native

# Release build
pnpm build

# Debug build
pnpm build:debug
```

The output binary is `lingcrawl-rs.[darwin|win32|linux].node` in the project root.

## Supported platforms

- `x86_64-pc-windows-msvc`
- `x86_64-apple-darwin`
- `x86_64-unknown-linux-gnu`
- `aarch64-apple-darwin`

## Development

```bash
# Format code
pnpm format

# Lint
pnpm lint
```

## Integration

This addon is consumed internally by the LingCrawl API (`apps/api`). It is built and installed as part of the main `pnpm install` step in the monorepo root.
