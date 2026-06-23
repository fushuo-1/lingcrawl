# 仓库规范

## 项目概述

LingCrawl 是一个自部署的网页数据采集 API，专为 AI Agent 设计。提供 Scrape、Crawl、Map、Search、Extract、MCP 等核心能力，无需认证和计费。

## 项目结构

单仓库（monorepo），核心应用：

```
apps/api/                     核心 API + Worker（TypeScript/Fastify）— 主要开发区域
  src/controllers/            请求处理器
  src/routes/                 API 路由定义（routes/api.ts）
  src/services/               业务逻辑、队列 Worker（services/worker/）、Redis、Webhook
  src/scraper/                抓取引擎（fetch、playwright、pdf）
  src/search/                 SearXNG 搜索集成
  src/lib/                    工具库（URL 处理、AI、错误处理、日志）
  src/mcp/                    MCP 协议工具定义
  src/__tests__/              所有测试（snips/、unit/、lib/）
apps/js-sdk/                  JavaScript SDK
apps/python-sdk/              Python SDK
apps/rust-sdk/                Rust SDK
apps/playwright-service-ts/   浏览器渲染微服务
apps/go-html-to-md-service/   HTML 转 Markdown 微服务
apps/nuq-postgres/            持久化任务队列（PostgreSQL + RabbitMQ）
docs/adr/                     架构决策记录
docs/agents/                  Agent 工作流文档（issue tracker、triage、domain）
```

## 领域术语表

| 术语                   | 含义                                                                      |
| ---------------------- | ------------------------------------------------------------------------- |
| **Scrape**       | 单页抓取 — 抓取单个 URL，返回 markdown/HTML/截图/原始 HTML/链接列表      |
| **Batch Scrape** | 批量抓取 — 并行抓取多个 URL                                              |
| **Crawl**        | 全站爬取 — 从起始 URL 递归发现并抓取整个网站                             |
| **Map**          | 站点发现 — 发现网站所有 URL，不抓取内容                                  |
| **Search**       | 网络搜索 — 通过 SearXNG 查询并可选抓取结果内容                           |
| **Extract**      | 文本提取 — 给 URL，返回页面全文内容                                      |
| **GitHub Read**  | 仓库读取 — 给 GitHub URL，返回仓库目录树和指定文件内容                   |
| **Links**        | 链接提取 — 给 URL，返回页面中所有链接                                    |
| **MCP**          | MCP 协议接入 — 通过 Streamable HTTP 在 /mcp 暴露工具给 AI Agent          |
| **Engine**       | 抓取引擎 — fetch（轻量 HTTP）、playwright（无头浏览器）、pdf（PDF 解析） |
| **Waterfall**    | 引擎选择策略 — 依次尝试各引擎直到成功                                    |
| **Snips**        | 端到端测试的项目内称呼                                                    |
| **Harness**      | 测试/开发启动器 — pnpm harness 自动拉起 API + Worker 后执行命令          |
| **NuQ**          | 持久化任务队列（PostgreSQL + RabbitMQ）                                   |

## 架构概览

### 请求流程

```
客户端 → Fastify API (index.ts) → 路由 (routes/api.ts) → 控制器 (controllers/) → 服务层 (services/)
                                                                                       ↓
                                                                    Worker (services/worker/) 处理异步任务
                                                                                       ↓
                                                                    抓取引擎 (scraper/scrapeURL/engines/)
```

### 抓取引擎

- **fetch** — 轻量 HTTP 请求，适合静态页面
- **playwright** — 无头浏览器渲染，处理 JS 动态页面
- **pdf** — PDF 文档解析转 markdown
- 引擎选择遵循瀑布流（waterfall）：依次尝试直到成功

### 基础设施

| 服务               | 用途                     | 端口         |
| ------------------ | ------------------------ | ------------ |
| Redis              | 缓存、速率限制、分布式锁 | 6379         |
| RabbitMQ           | NuQ 消息队列             | 5672 / 15672 |
| NuQ PostgreSQL     | 持久化任务队列           | 5432         |
| Playwright Service | 浏览器渲染微服务         | 3000         |
| SearXNG            | 元搜索引擎               | 内部端口     |

### 不属于本项目范围

不要添加以下内容：

- 认证/计费系统（Supabase、Stripe、API Key）
- 云版专属端点（Agent、Browser、Agent Signup）
- 抓取引擎：fire-engine、document（DOCX）、wikipedia、index
- 辅助应用：test-site、test-suite、ui/ingestion-ui

## 构建、测试与开发命令

```bash
docker compose up -d                # 启动所有服务
pnpm harness jest <test-path>       # 启动 API + Worker 后运行指定测试
pnpm harness jest --watch           # 监听模式
pnpm build                          # 编译 TypeScript（apps/api）
```

不要手动用 `pnpm start` 启动 API 来跑测试，`pnpm harness` 管理完整服务栈。

## 开发流程

1. 先写端到端测试（snips），断言成功条件：1 个 happy path + 1+ failure path
2. 实现功能代码
3. 跑测试：`pnpm harness jest src/__tests__/snips/your-test.test.ts`
4. 推送到分支，开 PR 让 CI 验证

E2E（snips）始终优先于单元测试。抓取测试统一使用 `./lib` 导出的 `scrapeTimeout`。本地只跑相关测试，完整测试交给 CI。

## 编码风格

- TypeScript，strict null checks，ES2022 目标，NodeNext 模块解析
- Prettier 格式化（`pnpm format`）
- 匹配现有代码风格，不做推测性实现（YAGNI）
- 只清理自己引入的代码，不动预先存在的问题

## 测试规范

- **框架**：Jest + ts-jest（ESM preset）
- **首选**：端到端测试（snips/），优于单元测试
- **测试目录**：snips/（E2E）、unit/（单元）、lib/（工具库）
- **测试分组**：fire-engine 测试 gate `!process.env.TEST_SUITE_SELF_HOSTED`；AI 测试额外需要 `OPENAI_API_KEY` 或 `OLLAMA_BASE_URL`
- **输出**：test-results/junit.xml

## 提交与 PR 规范

- 约定式提交：`feat(scope):`、`fix(scope):`、`docs(scope):`、`test(scope):`
- 每次提交聚焦一个逻辑变更
- PR 需描述变更、关联 issue、附测试证据

## Karpathy AI 编码指南

### 1. 编码前思考

不要假设，不要隐藏困惑。不确定时询问，存在歧义时摆出选项让用户选择。

### 2. 简洁优先

用最少的代码解决问题。不添加需求之外的功能（YAGNI），不为一次性代码创建抽象层。

### 3. 精准修改

只碰必须碰的。不要顺便改进相邻代码，不要重构没坏的东西，匹配现有风格。

### 4. 目标驱动执行

将模糊指令转化为可验证的目标，多步骤任务列出简短计划，每步附带验证标准。

## 关键文件速查

| 文件              | 职责                                       |
| ----------------- | ------------------------------------------ |
| src/index.ts      | Fastify 应用入口，注册路由和中间件         |
| src/harness.ts    | 开发/测试启动器，拉起所有服务              |
| src/config.ts     | 环境变量 schema（Zod），所有配置的单一来源 |
| src/routes/api.ts | API 路由注册                               |
| src/controllers/  | 请求处理控制器                             |
| src/services/     | 业务服务层（队列、Worker、Redis、Webhook） |
| src/scraper/      | 抓取核心（scrapeURL 引擎、crawler）        |
| src/lib/          | 工具库（URL 处理、AI、错误处理、日志）     |

## Agent 专属指引

- 修改前先阅读 CONTEXT.md 和 docs/adr/ 了解领域上下文
- 使用 gh CLI 管理 GitHub Issues（详见 docs/agents/issue-tracker.md）
- Triage 标签：needs-triage、needs-info、ready-for-agent、ready-for-human、wontfix
- 不确定时先问，不要默默猜测
- 每次回答末尾添加 ok

## Agent skills

### Issue tracker

GitHub Issues via `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Five canonical labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.
