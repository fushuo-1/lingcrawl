# LingCrawl — AI Agent 网页数据采集 API

## 项目概述

LingCrawl 是一个轻量、自部署的网页数据采集 API 服务，专为 AI Agent 设计。提供 Scrape、Crawl、Map、Search、Extract、MCP 等核心能力，无需认证和计费，开箱即用。

## 项目结构

单仓库（monorepo），核心应用：

- `apps/api` — 核心 API + Worker（TypeScript/Express，主要开发区域）
- `apps/playwright-service-ts` — 独立浏览器渲染微服务（Playwright）
- `apps/go-html-to-md-service` — Go 实现的 HTML→Markdown 转换微服务
- `apps/nuq-postgres` — NuQ 持久化任务队列的 PostgreSQL 初始化
- `apps/redis` — Redis 容器配置

## 领域术语表

| 术语 | 含义 |
|------|------|
| **Scrape** | 单页抓取 — 抓取单个 URL，返回 markdown/HTML/截图/原始 HTML/链接列表 |
| **Batch Scrape** | 批量抓取 — 并行抓取多个 URL |
| **Crawl** | 全站爬取 — 从起始 URL 递归发现并抓取整个网站 |
| **Map** | 站点发现 — 发现网站所有 URL，不抓取内容 |
| **Search** | 网络搜索 — 通过 SearXNG 搜索引擎查询并可选抓取结果内容 |
| **Extract** | 文本提取 — 给 URL，返回页面全文内容 |
| **GitHub Read** | 仓库读取 — 给 GitHub URL，返回仓库目录树和指定文件内容 |
| **Links** | 链接提取 — 给 URL，返回页面中所有链接 |
| **MCP** | MCP 协议接入 — 通过 Streamable HTTP 在 `/mcp` 暴露工具给 AI Agent |
| **Engine** | 抓取引擎 — fetch（轻量 HTTP）、playwright（无头浏览器）、pdf（PDF 解析） |
| **Waterfall** | 引擎选择策略 — 依次尝试各引擎直到成功 |
| **Snips** | 端到端测试的项目内称呼 |
| **Harness** | 测试/开发启动器 — `pnpm harness` 自动拉起 API + Worker 后执行命令 |
| **NuQ** | 持久化任务队列（PostgreSQL + RabbitMQ） |

## 启动项目

```bash
docker compose up -d
```

启动所有服务：api、redis、rabbitmq、nuq-postgres、playwright-service、searxng。

配置文件：
- 环境变量：根目录 `.env`（单一来源，`apps/api/config.ts` 会自动加载）
- SearXNG：`apps/api/searxng-settings.yml`
- Docker Compose：`docker-compose.yaml`（根目录）

## 架构概览

### 请求流程

```
客户端 → Express API (index.ts) → 路由 (routes/api.ts) → 控制器 (controllers/) → 服务层 (services/)
                                                                                       ↓
                                                                    Worker (services/worker/) 处理异步任务
                                                                                       ↓
                                                                    抓取引擎 (scraper/scrapeURL/engines/)
```

### API 路由 (`routes/api.ts`)

| 方法 | 路径 | 控制器 | 说明 |
|------|------|--------|------|
| POST | `/api/search` | search | 网络搜索 |
| POST | `/api/scrape` | scrape | 单页抓取 |
| GET | `/api/scrape/:jobId` | scrape-status | 抓取状态查询 |
| POST | `/api/batch/scrape` | batch-scrape | 批量抓取 |
| GET | `/api/batch/scrape/:jobId` | crawl-status | 批量状态查询 |
| DELETE | `/api/batch/scrape/:jobId` | crawl-cancel | 取消批量 |
| GET | `/api/batch/scrape/:jobId/errors` | crawl-errors | 批量错误查询 |
| POST | `/api/map` | map | 站点发现 |
| POST | `/api/crawl` | crawl | 全站爬取 |
| GET | `/api/crawl/:jobId` | crawl-status | 爬取状态查询 |
| DELETE | `/api/crawl/:jobId` | crawl-cancel | 取消爬取 |
| WS | `/api/crawl/:jobId` | crawl-status-ws | WebSocket 实时状态 |
| GET | `/api/crawl/:jobId/errors` | crawl-errors | 爬取错误查询 |
| POST | `/api/github/read` | github-read | GitHub 仓库读取 |
| POST | `/api/links` | links | 链接提取 |
| POST | `/api/extract` | extract | 文本/LLM 提取 |
| ALL | `/mcp` | mcp | MCP 协议接入（Streamable HTTP） |

### 抓取引擎 (`scraper/scrapeURL/engines/`)

- **fetch** — 轻量 HTTP 请求，适合静态页面（`engines/fetch/`）
- **playwright** — 无头浏览器渲染，处理 JS 动态页面（`engines/playwright/`）
- **pdf** — PDF 文档解析转 markdown（`engines/pdf/`）
- 引擎选择遵循瀑布流（waterfall）：依次尝试直到成功

### Worker 系统 (`services/worker/`)

- `nuq-worker.ts` — 主任务 Worker，从 NuQ (PostgreSQL + RabbitMQ) 消费任务
- `nuq-prefetch-worker.ts` — 预取 Worker
- `nuq-reconciler-worker.ts` — 协调 Worker
- `scrape-worker.ts` — 抓取任务处理逻辑
- `crawl-logic.ts` — 爬取递归逻辑

### 基础设施

| 服务 | 用途 | 端口 |
|------|------|------|
| **Redis** | 缓存、速率限制、分布式锁 | 6379 |
| **RabbitMQ** | NuQ 消息队列 | 5672 / 15672 (管理界面) |
| **NuQ PostgreSQL** | 持久化任务队列 | 5432 |
| **Playwright Service** | 浏览器渲染微服务 | 3000 |
| **SearXNG** | 元搜索引擎 | 内部端口 |

### 不属于本项目范围（不要添加）

- 认证/计费系统（Supabase、Stripe、API Key）
- 云版专属端点（Agent、Browser、Agent Signup）
- 抓取引擎：fire-engine、document（DOCX）、wikipedia、index
- SDK：js-sdk、python-sdk、rust-sdk、java-sdk、go-sdk
- 辅助应用：test-site、test-suite、ui/ingestion-ui

## 开发流程

### 修改 API 的步骤

1. **先写端到端测试**（snips），断言你的成功条件
   - 1 个 happy path（多个不同代码路径时鼓励多写）
   - 1+ 个 failure path
   - E2E（`snips`）始终优先于单元测试
   - 使用 `scrapeTimeout` from `./lib` 设置超时
2. **写代码**实现功能
3. **跑测试**：`pnpm harness jest ...`
   - `pnpm harness` 自动启动 API + Worker，不要手动 `pnpm start`
   - 只跑相关测试，完整测试留给 CI
4. **提 PR**，让 CI 验证

### 测试目录结构 (`__tests__/`)

| 目录 | 用途 |
|------|------|
| `snips/` | 核心 E2E 测试（首选） |
| `e2e_withAuth/` | 需认证的 E2E 测试 |
| `e2e_noAuth/` | 无需认证的 E2E 测试 |
| `e2e_full_withAuth/` | 完整流程 E2E 测试 |
| `e2e_extract/` | Extract 功能 E2E 测试 |
| `e2e_map/` | Map 功能 E2E 测试 |
| `lib/` | 库函数测试 |
| `unit/` | 单元测试 |

### 常见开发方向

- **新增抓取功能** — 新的页面解析方式、数据提取逻辑
- **扩展 API 端点** — 在 `controllers/` + `routes/api.ts` 中添加
- **修改 Worker 处理逻辑** — 调整任务队列和处理流程（`services/worker/`）
- **自部署/私有化配置** — 调整 `.env` 和 `config.ts`

### 关键文件速查

| 文件 | 职责 |
|------|------|
| `src/index.ts` | Express 应用入口，注册路由和中间件 |
| `src/harness.ts` | 开发/测试启动器，拉起所有服务 |
| `src/config.ts` | 环境变量 schema（Zod），所有配置的单一来源 |
| `src/routes/api.ts` | API 路由注册 |
| `src/routes/shared.ts` | 共享中间件（blocklist、idempotency、wrap） |
| `src/controllers/` | 请求处理控制器 |
| `src/services/` | 业务服务层（队列、Worker、Redis、Webhook） |
| `src/scraper/` | 抓取核心（scrapeURL 引擎、WebScraper 逻辑、crawler） |
| `src/search/` | 搜索服务（SearXNG 集成） |
| `src/lib/` | 工具库（URL 处理、AI、错误处理、日志等） |

---

## Karpathy AI 编码指南

四条核心原则用于减少 AI 编码中的常见错误。倾向于谨慎而非速度。

### 1. 编码前思考

不要假设。不要隐藏困惑。呈现权衡。

- **明确说明假设** — 不确定时询问，不要默默猜测然后执行。
- **呈现多种解释** — 存在歧义时把选项摆出来让用户选择。
- **适时提出异议** — 存在更简单方案时说出来。
- **困惑时停下来** — 指出不清楚的地方并请求澄清。

### 2. 简洁优先

用最少的代码解决问题。不做推测性实现。

- 不添加需求之外的功能（YAGNI）
- 不为一次性代码创建抽象层
- 不添加未要求的"灵活性"或"可配置性"
- 不为不可能发生的场景做错误处理
- 如果写了 200 行发现 50 行就能搞定，重写它

自检标准：资深工程师会觉得这过于复杂吗？如果是，简化。

### 3. 精准修改

只碰必须碰的。只清理自己造成的混乱。

- 不要"顺便改进"相邻的代码、注释或格式
- 不要重构没坏的东西
- 匹配现有代码风格，即使你偏好不同的写法
- 注意到无关的死代码时提一下，但不要删除它
- 删除因你的改动而变得无用的导入/变量/函数（你制造的混乱你清理）
- 不要删除预先存在的死代码，除非被要求

检验标准：每一行修改都应该能直接追溯到用户的请求。

### 4. 目标驱动执行

定义成功标准。循环验证直到达成。

- 将模糊指令转化为可验证的目标（例如"修复 bug" → "编写能重现 bug 的测试，然后让它通过"）
- 多步骤任务列出简短计划，每步附带验证标准
- 给目标而不是给指令，让 AI 能独立循环执行直到达成

---

## 回复规范

每次回答的最后都要添加 `ok`。

## Agent skills

### Issue tracker

GitHub Issues via `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Five canonical labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.
