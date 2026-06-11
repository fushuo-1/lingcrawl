# PRD: LingCrawl 重度裁剪 — AI Agent 数据采集服务

## Problem Statement

LingCrawl 目前是一个面向商业用户的全功能网页数据 API，包含认证、计费、AI Agent、Browser 会话等大量云版功能。对于自部署 + AI Agent 使用场景，这些功能是不必要的复杂度：代码库臃肿、依赖众多、理解和维护成本高。需要裁剪为轻量专注的数据采集服务，同时补充 Agent 实际需要的能力（GitHub 仓库读取、文本提取、内容摘要）。

## Solution

删除所有云版商业功能（认证、计费、Agent 端点、Browser、未使用的引擎、SDK、辅助应用），保留 5 个核心抓取端点，新增 4 个面向 Agent 的功能端点，保持基础设施（Redis、PostgreSQL、SearXNG、Playwright Service）不变。

## User Stories

1. As an AI Agent, I want to scrape a single URL and get its content as markdown, so that I can read and understand web pages
2. As an AI Agent, I want to scrape a single URL and get its content as HTML, so that I can process the raw page structure
3. As an AI Agent, I want to scrape a single URL and get a screenshot, so that I can visually understand page layout
4. As an AI Agent, I want to scrape a single URL and get all links on the page, so that I can discover where to navigate next
5. As an AI Agent, I want to batch scrape multiple URLs in parallel, so that I can efficiently gather data from many pages at once
6. As an AI Agent, I want to crawl an entire website starting from a URL, so that I can index all content on a site
7. As an AI Agent, I want to limit crawl depth and page count, so that I can control resource usage during crawling
8. As an AI Agent, I want to cancel a running crawl job, so that I can stop unnecessary work
9. As an AI Agent, I want to check the status of a crawl/batch job, so that I know when results are ready
10. As an AI Agent, I want to receive real-time crawl progress via WebSocket, so that I can process pages as they complete
11. As an AI Agent, I want to discover all URLs on a website without scraping content, so that I can plan my crawling strategy
12. As an AI Agent, I want to search the web via SearXNG, so that I can find relevant pages before scraping
13. As an AI Agent, I want to search and optionally scrape results in one call, so that I can get content directly from a query
14. As an AI Agent, I want to read a GitHub repository's directory tree, so that I can understand code structure
15. As an AI Agent, I want to read specific files from a GitHub repository, so that I can examine source code
16. As an AI Agent, I want to read a GitHub repository's README, so that I can quickly understand what a project does
17. As an AI Agent, I want to extract text from a URL using a prompt (without LLM), so that I can get full page content for my own processing
18. As an AI Agent, I want to extract structured data from a URL using a prompt + LLM, so that I can get specific information without parsing the full page
19. As an AI Agent, I want to get an AI-generated summary of a URL, so that I can quickly decide if a page is relevant
20. As an AI Agent, I want to extract all links from a URL with metadata (text, type), so that I can build a navigation graph
21. As a developer, I want the API to work without authentication, so that I can deploy and use it immediately in my internal network
22. As a developer, I want the API to handle PDF documents transparently, so that I can scrape pages that link to PDFs
23. As a developer, I want the API to render JavaScript-heavy pages via Playwright, so that I can scrape SPAs and dynamic content
24. As a developer, I want the Playwright service to run as a separate microservice, so that browser resources are isolated from the API
25. As a developer, I want the engine selection to be automatic (fetch → playwright → pdf), so that I don't need to specify which engine to use
26. As a developer, I want to configure forced engine mappings for specific domains, so that I can override default engine selection
27. As a developer, I want a clean codebase with no dead code, so that I can understand and maintain the project easily
28. As a developer, I want the project to start with `docker compose up -d`, so that setup is minimal
29. As an operator, I want the API to respect robots.txt, so that scraping is ethical by default
30. As an operator, I want the system to monitor CPU/RAM and reject jobs when overloaded, so that the service stays stable

## Implementation Decisions

### Phase 1: 删除云版代码

**要删除的控制器（`apps/api/src/controllers/`）：**
- `agent.ts`, `agent-cancel.ts`, `agent-signup.ts`, `agent-signup-confirm.ts`, `agent-status.ts`
- `browser.ts`
- `extract.ts`, `extract-status.ts`（将在 Phase 3 重新实现精简版）
- `auth.ts`
- `credit-usage.ts`, `credit-usage-historical.ts`, `token-usage.ts`, `token-usage-historical.ts`
- `concurrency-check.ts`, `queue-status.ts`
- `x402-search.ts`, `f-search.ts`
- `crawl-params-preview.ts`

**要删除的服务（`apps/api/src/services/`）：**
- `billing/` 整个目录（Stripe、积分扣减、批量计费）
- `autumn/` 整个目录
- `ledger/` 整个目录
- `notification/` 整个目录
- `subscription/` 整个目录
- `ab-test.ts`, `ab-test-comparison.ts`
- `agentLivecastWS.ts`, `agent-sponsor.ts`
- `sentry.ts`
- `extract-queue.ts`, `extract-worker.ts`（将在 Phase 3 重新实现）
- `indexing/` 整个目录
- `webhook/` 整个目录

**要删除的抓取引擎（`apps/api/src/scraper/scrapeURL/engines/`）：**
- `fire-engine/` 整个目录
- `document/` 整个目录
- `wikipedia/` 整个目录
- `index/` 整个目录

**要删除的 lib 模块：**
- `lib/extract/` 整个目录（将在 Phase 3 重新实现精简版）
- `lib/browser-sessions.ts`, `lib/browser-session-activity.ts`
- `lib/x402.ts`
- `lib/cost-tracking.ts`, `lib/scrape-billing.ts`
- `lib/search-index-client.ts`, `lib/search-query-builder.ts`

**要删除的 SDK 和辅助应用：**
- `apps/js-sdk/` 整个目录
- `apps/python-sdk/` 整个目录
- `apps/rust-sdk/` 整个目录
- `apps/java-sdk/` 整个目录
- `apps/go-sdk/` 整个目录（Git submodule）
- `apps/test-site/` 整个目录
- `apps/test-suite/` 整个目录
- `apps/ui/` 整个目录

**路由层修改（`apps/api/src/routes/api.ts`）：**
- 删除所有注释掉的云版端点代码
- 删除认证 middleware（`authMiddleware`、`checkCreditsMiddleware`）
- 保留并简化：`scrape`、`batch/scrape`、`crawl`、`map`、`search` 及其状态/取消/错误端点

**认证/计费 middleware 清理（`apps/api/src/routes/shared.ts`）：**
- `authMiddleware` — 删除或改为空操作
- `checkCreditsMiddleware` — 删除或改为空操作
- `blocklistMiddleware` — 保留（域名黑名单仍有用）
- `countryCheck` — 可选保留

### Phase 2: 清理依赖和配置

- 清理 `apps/api/package.json` 中删除模块的依赖引用
- 清理 `apps/api/.env.example` 中 Supabase/Stripe 相关环境变量
- 更新 `docker-compose.yml` 删除不需要的服务（如有）
- 更新 `CLAUDE.md` 反映新的项目结构
- 更新 `CONTEXT.md` 反映最终状态

### Phase 3: 新增功能

**3a. GitHub 仓库读取模块**

新增路由 `POST /v2/github/read`：
- 输入：`{ "url": "https://github.com/owner/repo", "path": "src/", "ref": "main" }`（path 和 ref 可选）
- 输出：目录树结构 + 指定路径的文件内容
- 通过 GitHub REST API（`api.github.com`）读取，不需要 clone
- 支持未认证请求（60 次/小时限制）和可选的 `GITHUB_TOKEN` 环境变量（5000 次/小时）

**3b. 文本提取模块（Extract 精简版）**

新增路由 `POST /v2/extract`：
- 输入：`{ "url": "...", "prompt": "提取所有价格信息", "schema": {...} }`
- 模式 A（免费）：不传 `schema`，直接返回页面全文 markdown
- 模式 B（LLM）：传 `schema` 或服务端检测到 LLM 配置，调用 OpenAI/Ollama 提取结构化数据
- LLM 依赖通过环境变量 `OPENAI_API_KEY` 或 `OLLAMA_BASE_URL` 检测，未配置则自动降级到模式 A

**3c. 内容摘要模块**

新增路由 `POST /v2/summary`：
- 输入：`{ "url": "..." }`
- 输出：`{ "success": true, "data": { "summary": "...", "title": "...", "sourceURL": "..." } }`
- 内部流程：先 Scrape 获取 markdown → 调用 LLM 生成摘要
- 需要 LLM 配置（`OPENAI_API_KEY` 或 `OLLAMA_BASE_URL`），未配置返回错误

**3d. 链接提取模块**

新增路由 `POST /v2/links`：
- 输入：`{ "url": "..." }`
- 输出：`{ "success": true, "data": { "links": [{ "url": "...", "text": "...", "type": "internal|external" }] } }`
- 内部流程：用 fetch 引擎抓取页面 → Rust native addon 提取链接 → 分类（内部/外部）

### Phase 4: 测试和验证

- 为每个保留的端点编写 E2E 测试（snips）
- 为每个新增端点编写 E2E 测试
- 验证 `docker compose up -d` 能正常启动所有服务
- 验证核心抓取流程：scrape → crawl → map → search → extract → summary → links → github/read

### 模块深度分析

以下是可以作为**深度模块**隔离测试的候选：

1. **GitHub 仓库读取模块** — 纯函数式设计，输入 URL + path，输出目录树/文件内容。可以 mock GitHub API 独立测试
2. **文本提取模块（Extract）** — 模式 A（全文返回）和模式 B（LLM 提取）可以分别测试。模式 A 不依赖外部服务
3. **链接提取模块** — 输入 HTML 字符串，输出链接列表。Rust native addon 已有 `extractLinks` 函数，TS 层只是包装
4. **内容摘要模块** — Scrape + LLM 两步，可以分别 mock 测试

## Testing Decisions

- **测试风格**：遵循项目约定，使用 E2E 测试（snips），不写单元测试除非逻辑复杂
- **测试工具**：`pnpm harness jest ...` 启动 API + Worker 后运行测试
- **超时设置**：使用 `scrapeTimeout` from `./lib`
- **测试门控**：需要 Playwright 的测试 gate with `!process.env.TEST_SUITE_SELF_HOSTED`；需要 AI 的测试 gate with `!process.env.TEST_SUITE_SELF_HOSTED || process.env.OPENAI_API_KEY || process.env.OLLAMA_BASE_URL`
- **优先测试模块**：GitHub 仓库读取、文本提取（双模式）、链接提取

## Out of Scope

- **云版功能恢复**：不保留 Agent、Browser、x402 支付等端点的代码
- **SDK 重写**：裁剪后不提供 SDK，Agent 直接走 HTTP
- **认证/鉴权**：完全开放，不实现任何认证机制
- **性能优化**：裁剪阶段不进行性能调优
- **文档站点**：不搭建独立的 API 文档站点
- **数据库迁移**：不修改 NuQ PostgreSQL schema
- **UI 界面**：不提供 Web 管理界面

## Further Notes

### 执行顺序建议

1. **Phase 1（删除）** 先执行，减少代码量后再做新增
2. **Phase 3a（GitHub Read）** 最独立，可以第一个实现
3. **Phase 3d（Link Extract）** 依赖现有 Rust native addon，实现简单
4. **Phase 3b（Extract）** 需要重新启用部分代码，中等复杂度
5. **Phase 3c（Summary）** 依赖 Extract + LLM，最后实现

### 风险

- 删除认证 middleware 后，所有端点对任何来源开放。内网部署需确保网络隔离
- Extract 模式的 LLM 集成需要测试 OpenAI 和 Ollama 两种后端的兼容性
- GitHub API 未认证请求有 60 次/小时限制，高频使用需要配置 `GITHUB_TOKEN`

### 参考文档

- 项目定位和术语：`CONTEXT.md`
- 架构决策记录：`docs/adr/0001-trim-to-agent-data-api.md`
- 引擎强制配置：`apps/api/src/scraper/WebScraper/utils/ENGINE_FORCING.md`
- 自部署指南：`SELF_HOST.md`
