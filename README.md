# **LingCrawl**

**面向 AI Agent 的网页数据采集 API — 轻量自部署版**

LingCrawl 是一个开源的网页数据采集 API 服务，专为 AI Agent 设计。提供 Scrape、Crawl、Map、Search、Extract、MCP 等核心能力，无需认证和计费，开箱即用。

---

## 功能概览

| 功能                   | 说明                                                             |
| ---------------------- | ---------------------------------------------------------------- |
| **Scrape**       | 单页抓取 — 抓取单个 URL，返回 markdown/HTML/截图/原始 HTML/链接 |
| **Batch Scrape** | 批量抓取 — 并行抓取多个 URL                                     |
| **Crawl**        | 全站爬取 — 从起始 URL 递归发现并抓取整个网站                    |
| **Map**          | 站点发现 — 发现网站所有 URL，不抓取内容                         |
| **Search**       | 网络搜索 — 通过 SearXNG 查询并可选抓取结果内容                  |
| **Extract**      | 文本提取 — 给 URL，返回页面全文内容                           |
| **GitHub Read**  | 仓库读取 — 返回仓库目录树和指定文件内容                         |
| **Links**        | 链接提取 — 返回页面中所有链接                                   |
| **MCP**          | MCP 协议接入 — 通过 Streamable HTTP 暴露工具给 AI Agent         |

### 抓取引擎

| 引擎                 | 说明                             |
| -------------------- | -------------------------------- |
| **fetch**      | 轻量 HTTP 请求，适合静态页面     |
| **playwright** | 无头浏览器渲染，处理 JS 动态页面 |
| **pdf**        | PDF 文档解析转 markdown          |

引擎选择遵循**瀑布流（Waterfall）**策略：依次尝试各引擎直到成功。

---

## 快速开始

### 环境要求

- Docker + Docker Compose
- （本地开发）Node.js 18+、pnpm 9+、Redis、PostgreSQL

### Docker Compose 一键启动

```bash
git clone https://github.com/lingcrawl/lingcrawl.git
cd lingcrawl
cp .env.example .env   # 按需编辑环境变量
docker compose up -d
```

启动所有服务：API + Worker、Redis、RabbitMQ、NuQ PostgreSQL、Playwright Service、SearXNG。

API 默认监听 `http://localhost:3002`。

### 本地开发

```bash
# 安装依赖
pnpm install

# 启动 API + Worker（自动拉起所有服务）
pnpm harness

# 或仅启动 API
pnpm start
```

### 配置

环境变量统一在根目录 `.env` 文件中配置（`apps/api/config.ts` 自动加载）。主要变量：

| 变量                            | 说明                                | 默认值                                                   |
| ------------------------------- | ----------------------------------- | -------------------------------------------------------- |
| `PORT`                        | API 端口                            | `3002`                                                 |
| `REDIS_URL`                   | Redis 地址                          | `redis://localhost:6379`                               |
| `NUQ_DATABASE_URL`            | NuQ PostgreSQL 地址                 | `postgres://postgres:postgres@localhost:5432/postgres` |
| `PLAYWRIGHT_MICROSERVICE_URL` | Playwright 微服务地址               | `http://localhost:3000/scrape`                         |
| `SEARXNG_ENDPOINT`            | SearXNG 搜索引擎地址                | —                                                       |
| `GITHUB_TOKEN`                | GitHub Token（GitHub Read 功能）    | —                                                       |
| `PROXY_SERVER`                | 代理服务器地址                      | —                                                       |

---

## API 接口

REST 接口挂载在 `/api` 路径下，MCP 端点在 `/mcp`。无需认证，Content-Type 为 `application/json`。

### Scrape — 单页抓取

```bash
curl -X POST http://localhost:3002/api/scrape \
  -H 'Content-Type: application/json' \
  -d '{"url": "https://example.com", "formats": ["markdown"]}'
```

### Batch Scrape — 批量抓取

```bash
curl -X POST http://localhost:3002/api/batch/scrape \
  -H 'Content-Type: application/json' \
  -d '{"urls": ["https://example.com", "https://example.org"], "formats": ["markdown"]}'
```

### Crawl — 全站爬取

```bash
# 提交爬取任务
curl -X POST http://localhost:3002/api/crawl \
  -H 'Content-Type: application/json' \
  -d '{"url": "https://docs.example.com", "limit": 100}'

# 查询状态
curl http://localhost:3002/api/crawl/{jobId}

# 取消任务
curl -X DELETE http://localhost:3002/api/crawl/{jobId}
```

WebSocket 实时状态：`ws://localhost:3002/api/crawl/{jobId}`

### 错误查询

```bash
# 批量抓取错误
curl http://localhost:3002/api/batch/scrape/{jobId}/errors

# 爬取错误
curl http://localhost:3002/api/crawl/{jobId}/errors
```

### Map — 站点发现

```bash
curl -X POST http://localhost:3002/api/map \
  -H 'Content-Type: application/json' \
  -d '{"url": "https://example.com"}'
```

### Search — 网络搜索

```bash
curl -X POST http://localhost:3002/api/search \
  -H 'Content-Type: application/json' \
  -d '{"query": "web scraping", "limit": 5}'
```

### Extract — 文本提取

```bash
# 全文提取
curl -X POST http://localhost:3002/api/extract \
  -H 'Content-Type: application/json' \
  -d '{"url": "https://example.com"}'
```

### GitHub Read — 仓库读取

```bash
curl -X POST http://localhost:3002/api/github/read \
  -H 'Content-Type: application/json' \
  -d '{"url": "https://github.com/lingcrawl/lingcrawl"}'
```

### Links — 链接提取

```bash
curl -X POST http://localhost:3002/api/links \
  -H 'Content-Type: application/json' \
  -d '{"url": "https://example.com"}'
```

### MCP — AI Agent 接入

通过 Streamable HTTP 协议暴露 scrape、search、map、extract、links、github_read、crawl、read_pdf 共 8 个工具。

```bash
curl -X POST http://localhost:3002/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

---

## 项目结构

```
lingcrawl/
├── apps/
│   ├── api/                      # 核心 API + Worker（TypeScript/Express）
│   │   └── src/
│   │       ├── index.ts          # Express 应用入口
│   │       ├── config.ts         # 环境变量 schema（Zod）
│   │       ├── routes/           # API 路由
│   │       ├── controllers/      # 请求处理控制器
│   │       ├── services/         # 业务服务层（队列、Worker、Redis）
│   │       ├── scraper/          # 抓取核心（引擎、WebScraper、crawler）
│   │       ├── search/           # 搜索服务（SearXNG 集成）
│   │       ├── mcp/              # MCP 协议接入（Streamable HTTP）
│   │       └── lib/              # 工具库（URL、AI、错误处理、日志）
│   ├── playwright-service-ts/    # Playwright 浏览器渲染微服务
│   ├── go-html-to-md-service/    # Go HTML→Markdown 转换微服务
│   ├── nuq-postgres/             # NuQ PostgreSQL 初始化
│   └── redis/                    # Redis 容器配置
├── docker-compose.yaml           # Docker Compose 编排
├── .env                          # 环境变量（单一来源）
├── CLAUDE.md                     # AI 编码指南
└── CONTEXT.md                    # 项目领域上下文
```

---

## 架构概览

```
客户端 → Express API → 路由 → 控制器 → 服务层
  ↓                                        ↓
  MCP（/mcp）→ 8 个工具                  Worker（NuQ: PostgreSQL + RabbitMQ）处理异步任务
                                              ↓
                                  抓取引擎（fetch / playwright / pdf）瀑布流选择
```

### 基础设施

| 服务                         | 用途                     | 端口         |
| ---------------------------- | ------------------------ | ------------ |
| **Redis**              | 缓存、速率限制、分布式锁 | 6379         |
| **RabbitMQ**           | NuQ 消息队列             | 5672 / 15672 |
| **NuQ PostgreSQL**     | 持久化任务队列           | 5432         |
| **Playwright Service** | 浏览器渲染微服务         | 3000         |
| **SearXNG**            | 元搜索引擎               | 内部         |

---

## 开发

### 修改 API 的步骤

1. **先写端到端测试**（`__tests__/snips/`），断言成功条件
2. **写代码**实现功能
3. **跑测试**：`pnpm harness jest ...`
4. **提 PR**

### 测试

```bash
# 运行核心 E2E 测试
pnpm harness jest "src/__tests__/snips/.+\.test\.ts"

# 运行特定测试
pnpm harness jest scrape
```

## License

AGPL-3.0。详见 [LICENSE](LICENSE)。
