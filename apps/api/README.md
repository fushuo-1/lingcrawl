# LingCrawl API

LingCrawl 的核心 API 和 Worker 服务。基于 Express + TypeScript 构建，提供网页抓取、搜索、爬虫、文档转换等能力。

## 目录

- [快速启动](#快速启动)
- [目录结构](#目录结构)
- [核心模块](#核心模块)
- [API 端点](#api-端点)
- [抓取引擎](#抓取引擎)
- [Worker 架构](#worker-架构)
- [原生模块](#原生模块)
- [配置说明](#配置说明)
- [测试](#测试)
- [Docker 构建](#docker-构建)
- [开发指南](#开发指南)

## 快速启动

```bash
# 在仓库根目录启动所有服务（API、Redis、RabbitMQ、PostgreSQL、Playwright、SearXNG）
docker compose up -d

# 本地开发模式（自动编译 + 热重载）
pnpm harness jest src/__tests__/snips/scrape.test.ts

# 仅启动 API 服务器
pnpm harness --start
```

## 目录结构

```
apps/api/
├── src/                                    # 源码主目录
│   ├── index.ts                            # Express 服务器入口
│   ├── config.ts                           # 环境变量配置（Zod schema 验证）
│   ├── harness.ts                          # 测试/开发 harness，管理所有子进程
│   ├── types.ts                            # 全局类型定义
│   │
│   ├── controllers/                        # 请求处理器（业务逻辑层）
│   │   ├── scrape.ts                       #   单页抓取
│   │   ├── scrape-status.ts                #   抓取状态查询
│   │   ├── batch-scrape.ts                 #   批量抓取
│   │   ├── crawl.ts                        #   网站爬虫
│   │   ├── crawl-status.ts                 #   爬虫状态查询
│   │   ├── crawl-status-ws.ts              #   爬虫状态 WebSocket 推送
│   │   ├── crawl-cancel.ts                 #   爬虫取消
│   │   ├── crawl-errors.ts                 #   爬虫错误查询
│   │   ├── search.ts                       #   搜索
│   │   ├── map.ts                          #   站点地图
│   │   ├── extract.ts                      #   数据提取（全文/LLM 双模式）
│   │   ├── links.ts                        #   链接提取
│   │   ├── github-read.ts                  #   GitHub 仓库读取
│   │   ├── auth.ts                         #   认证中间件
│   │   ├── error-wrapper.ts                #   统一错误处理包装器
│   │   ├── types.ts                        #   控制器类型定义
│   │   ├── types-shared.ts                 #   共享类型
│   │   └── __tests__/                      #   控制器测试
│   │       └── crawl.test.ts               #     爬虫控制器测试
│   │
│   ├── routes/                             # 路由定义
│   │   ├── api.ts                          #   API 路由（/api/*）
│   │   ├── admin.ts                        #   管理路由（Bull Board 队列监控）
│   │   └── shared.ts                       #   中间件（blocklist、idempotency、timing）
│   │
│   ├── scraper/                            # 抓取核心
│   │   ├── scrapeURL/                      #   URL 抓取引擎
│   │   │   ├── index.ts                    #     抓取主流程（重试、fallback、引擎选择）
│   │   │   ├── error.ts                    #     抓取错误定义
│   │   │   ├── retryTracker.ts             #     重试追踪器
│   │   │   ├── engines/                    #     抓取引擎实现
│   │   │   │   ├── index.ts                #       引擎注册表 + fallback 列表构建
│   │   │   │   ├── fetch/                  #       HTTP 直连引擎
│   │   │   │   │   └── index.ts            #         fetch 引擎入口
│   │   │   │   ├── playwright/             #       Playwright 浏览器引擎
│   │   │   │   │   └── index.ts            #         playwright 引擎入口
│   │   │   │   ├── pdf/                    #       PDF 解析引擎
│   │   │   │   │   ├── index.ts            #         pdf 引擎入口
│   │   │   │   │   ├── pdfParse.ts         #         PDF 解析逻辑
│   │   │   │   │   ├── pdfUtils.ts         #         PDF 工具函数
│   │   │   │   │   ├── runpodMU.ts         #         RunPod MU 集成
│   │   │   │   │   ├── shadowComparison.ts #         影子对比测试
│   │   │   │   │   ├── types.ts            #         PDF 类型定义
│   │   │   │   │   └── __tests__/          #         PDF 引擎测试
│   │   │   │   ├── index/                  #       索引引擎
│   │   │   │   │   └── index.ts            #         索引引擎入口
│   │   │   │   └── utils/                  #       引擎公共工具
│   │   │   │       ├── downloadFile.ts     #         文件下载
│   │   │   │       ├── safeFetch.ts        #         安全 fetch
│   │   │   │       └── specialtyHandler.ts #         特殊处理
│   │   │   ├── transformers/               #     结果转换器
│   │   │   │   ├── index.ts                #       转换器主入口（HTML→Markdown 等）
│   │   │   │   ├── diff.ts                 #       内容 diff
│   │   │   │   ├── performAttributes.ts    #       属性提取
│   │   │   │   ├── removeBase64Images.ts   #       移除 Base64 图片
│   │   │   │   ├── sendToSearchIndex.ts    #       发送到搜索索引
│   │   │   │   └── uploadScreenshot.ts     #       截图上传
│   │   │   ├── postprocessors/             #     后处理器
│   │   │   │   ├── index.ts                #       后处理器入口
│   │   │   │   └── youtube.ts              #       YouTube 转录处理
│   │   │   └── lib/                        #     抓取工具库
│   │   │       ├── fetch.ts                #       HTTP fetch 封装
│   │   │       ├── abortManager.ts         #       AbortController 管理
│   │   │       ├── cacheableLookup.ts      #       DNS 缓存
│   │   │       ├── extractAttributes.ts    #       HTML 属性提取
│   │   │       ├── extractImages.ts        #       图片提取
│   │   │       ├── extractLinks.ts         #       链接提取
│   │   │       ├── extractMetadata.ts      #       元数据提取
│   │   │       ├── removeUnwantedElements.ts #     移除无用元素
│   │   │       ├── rewriteUrl.ts           #       URL 重写
│   │   │       ├── smartScrape.ts          #       智能抓取
│   │   │       ├── urlSpecificParams.ts    #       URL 特定参数
│   │   │       ├── mock.ts                 #       Mock 数据
│   │   │       └── __tests__/              #       工具库测试
│   │   ├── crawler/                        #   爬虫逻辑
│   │   │   └── sitemap.ts                  #     Sitemap 解析
│   │   └── WebScraper/                     #   Web 爬虫
│   │       ├── crawler.ts                  #     爬虫核心（URL 发现、深度控制）
│   │       ├── sitemap.ts                  #     Sitemap 处理
│   │       └── utils/                      #     工具
│   │           ├── blocklist.ts            #       域名黑名单
│   │           ├── engine-forcing.ts       #       引擎强制指定
│   │           ├── maxDepthUtils.ts        #       最大深度工具
│   │           └── __tests__/              #       工具测试
│   │
│   ├── search/                             # 搜索服务
│   │   ├── index.ts                        #   搜索入口
│   │   ├── execute.ts                      #   搜索执行
│   │   ├── searxng.ts                      #   SearXNG 集成
│   │   ├── fireEngine.ts                   #   Fire Engine 集成
│   │   ├── scrape.ts                       #   搜索结果抓取
│   │   ├── scrape.test.ts                  #   搜索抓取测试
│   │   └── transform.ts                    #   搜索结果转换
│   │
│   ├── services/                           # 基础设施服务
│   │   ├── redis.ts                        #   Redis 连接管理
│   │   ├── queue-service.ts                #   BullMQ 队列服务
│   │   ├── queue-jobs.ts                   #   队列任务管理
│   │   ├── queue-worker.ts                 #   队列 Worker（旧版）
│   │   ├── job-factory.ts                  #   任务工厂
│   │   ├── rate-limiter.ts                 #   速率限制器
│   │   ├── rate-limiter.test.ts            #   速率限制器测试
│   │   ├── redlock.ts                      #   分布式锁（Redis）
│   │   ├── system-monitor.ts               #   系统资源监控
│   │   ├── extract-worker.ts               #   提取 Worker
│   │   ├── ab-test.ts                      #   A/B 测试
│   │   ├── index.ts                        #   服务入口
│   │   ├── idempotency/                    #   幂等性保障
│   │   │   ├── create.ts                   #     幂等键创建
│   │   │   └── validate.ts                 #     幂等键验证
│   │   ├── logging/                        #   日志服务
│   │   │   └── log_job.ts                  #     任务日志
│   │   ├── notification/                   #   通知服务
│   │   │   ├── email_notification.ts       #     邮件通知
│   │   │   └── notification-check.ts       #     通知检查
│   │   └── worker/                         #   NUQ Worker 系统
│   │       ├── nuq.ts                      #     NUQ 核心（PostgreSQL + RabbitMQ）
│   │       ├── nuq-worker.ts               #     NUQ Worker 进程
│   │       ├── nuq-prefetch-worker.ts      #     预取 Worker
│   │       ├── nuq-reconciler-worker.ts    #     协调 Worker
│   │       ├── scrape-worker.ts            #     抓取 Worker 逻辑
│   │       ├── crawl-logic.ts              #     爬虫 Worker 逻辑
│   │       ├── team-semaphore.ts           #     团队并发控制
│   │       └── redis.ts                    #     Worker Redis 连接
│   │
│   ├── lib/                                # 公共工具库
│   │   ├── html-to-markdown.ts             #   HTML→Markdown（Go 原生 / Turndown fallback）
│   │   ├── generic-ai.ts                   #   AI 模型调用封装（OpenAI/Ollama）
│   │   ├── entities.ts                     #   实体定义
│   │   ├── format-utils.ts                 #   格式工具
│   │   ├── error.ts                        #   错误处理
│   │   ├── custom-error.ts                 #   自定义错误
│   │   ├── error-serde.ts                  #   错误序列化
│   │   ├── logger.ts                       #   Winston 日志
│   │   ├── deployment.ts                   #   部署环境检测
│   │   ├── crawl-redis.ts                  #   爬虫 Redis 操作
│   │   ├── crawl-redis.test.ts             #   爬虫 Redis 测试
│   │   ├── canonical-url.ts                #   规范 URL 处理
│   │   ├── canonical-url.test.ts           #   规范 URL 测试
│   │   ├── url-utils.ts                    #   URL 工具
│   │   ├── strings.ts                      #   字符串工具
│   │   ├── validateUrl.ts                  #   URL 验证
│   │   ├── validateUrl.test.ts             #   URL 验证测试
│   │   ├── validate-country.ts             #   国家代码验证
│   │   ├── map-utils.ts                    #   站点地图工具
│   │   ├── map-cosine.ts                   #   余弦相似度（Map 搜索排序）
│   │   ├── search-query-builder.ts         #   搜索查询构建
│   │   ├── robots-txt.ts                   #   robots.txt 解析
│   │   ├── gcs-jobs.ts                     #   GCS 任务存储
│   │   ├── gcs-pdf-cache.ts                #   PDF 缓存
│   │   ├── http-metrics.ts                 #   HTTP 指标
│   │   ├── job-metrics.ts                  #   任务指标
│   │   ├── job-priority.ts                 #   任务优先级
│   │   ├── native-logging.ts               #   原生日志桥接（Rust→Winston）
│   │   ├── otel-tracer.ts                  #   OpenTelemetry 追踪
│   │   ├── permu-refactor.test.ts          #   排列重构测试
│   │   ├── branding/                       #   品牌提取
│   │   │   ├── processor.ts                #     品牌处理器
│   │   │   ├── transformer.ts              #     品牌数据转换
│   │   │   ├── logo-selector.ts            #     Logo 选择器
│   │   │   ├── merge.ts                    #     品牌数据合并
│   │   │   ├── llm.ts                      #     LLM 品牌提取
│   │   │   ├── prompt.ts                   #     品牌提取 Prompt
│   │   │   ├── schema.ts                   #     品牌 Schema 定义
│   │   │   ├── types.ts                    #     品牌类型定义
│   │   │   └── extractHeaderHtmlChunk.ts   #     Header HTML 块提取
│   │   └── __tests__/                      #   工具库测试
│   │       ├── html-to-markdown.test.ts    #     HTML→Markdown 测试
│   │       ├── html-transformer.test.ts    #     HTML 转换器测试
│   │       ├── job-priority.test.ts        #     任务优先级测试
│   │       ├── url-utils.test.ts           #     URL 工具测试
│   │       └── branding/                   #     品牌测试
│   │           └── processor-color.test.ts #       颜色处理器测试
│   │
│   ├── main/                               # 主要业务入口
│   │   └── runWebScraper.ts                #   Web 爬虫执行器
│   │
│   ├── types/                              # 类型声明
│   │   ├── branding.ts                     #   品牌类型
│   │   └── parse-diff.d.ts                 #   第三方类型声明
│   │
│   └── utils/                              # 工具
│       └── integration.ts                  #   集成工具
│   └── __tests__/                          # 测试
│       ├── snips/                          #   端到端测试（E2E，推荐）
│       │   ├── lib.ts                      #     测试工具库
│       │   ├── scrape.test.ts              #     单页抓取测试
│       │   ├── scrape-branding.test.ts     #     品牌抓取测试
│       │   ├── scrape-cache.test.ts        #     抓取缓存测试
│       │   ├── scrape-formats.test.ts      #     抓取格式测试
│       │   ├── scrape-query.test.ts        #     抓取查询测试
│       │   ├── scrape-skip-tls.test.ts     #     TLS 跳过测试
│       │   ├── scrape-viewport.test.ts     #     视口测试
│       │   ├── batch-scrape.test.ts        #     批量抓取测试
│       │   ├── crawl.test.ts               #     爬虫测试
│       │   ├── crawl-prompt.test.ts        #     爬虫 Prompt 测试
│       │   ├── search.test.ts              #     搜索测试
│       │   ├── map.test.ts                 #     Map 测试
│       │   ├── concurrency.test.ts         #     并发测试
│       │   ├── document-converter.test.ts  #     文档转换测试
│       │   ├── lingcrawl-core.test.ts      #     核心功能测试
│       │   ├── lingcrawl-new.test.ts       #     新功能测试
│       │   ├── parsers.test.ts             #     解析器测试
│       │   ├── types-validation.test.ts    #     类型验证测试
│       │   ├── zdr.test.ts                 #     ZDR 测试
│       │   └── ...                         #     更多测试文件
│       ├── unit/                           #   单元测试
│       │   ├── error-wrapper.test.ts       #     错误包装器测试
│       │   └── job-factory.test.ts         #     任务工厂测试
│       ├── e2e_noAuth/                     #   无认证 E2E 测试
│       ├── e2e_withAuth/                   #   带认证 E2E 测试
│       ├── e2e_extract/                    #   提取 E2E 测试
│       ├── e2e_map/                        #   Map E2E 测试
│       ├── e2e_full_withAuth/              #   完整带认证 E2E 测试
│       └── lib/                            #   库测试
│           ├── search-query-builder.test.ts #     搜索查询构建测试
│           └── branding/                   #     品牌库测试
│
├── native/                                 # Rust 原生模块（@lingcrawl/lingcrawl-rs）
│   ├── src/                                #   Rust 源码
│   │   ├── lib.rs                          #     模块入口
│   │   ├── html.rs                         #     HTML 处理
│   │   ├── pdf.rs                          #     PDF 解析
│   │   ├── crawler.rs                      #     爬虫工具
│   │   ├── engpicker.rs                    #     引擎选择器
│   │   ├── logging.rs                      #     日志
│   │   ├── utils.rs                        #     工具函数
│   │   └── document/                       #     文档转换
│   │       ├── mod.rs                      #       模块入口
│   │       ├── model/                      #       数据模型
│   │       ├── providers/                  #       文档提供者（doc/docx/odt/rtf/xlsx）
│   │       └── renderers/                  #       渲染器（HTML 输出）
│   ├── Cargo.toml                          #   Rust 依赖配置
│   └── build.rs                            #   napi-rs 构建脚本
│
├── sharedLibs/                             # Go 共享库
│   └── go-html-to-md/                      #   HTML→Markdown 转换库
│       ├── html-to-markdown.go             #     Go 源码
│       ├── go.mod                          #     Go 依赖配置
│       └── README.md                       #     构建说明
│
├── Dockerfile                              # Docker 多阶段构建文件
├── tsconfig.json                           # TypeScript 编译配置
├── jest.config.ts                          # Jest 测试配置
├── knip.config.ts                          # 未使用代码检测配置
├── package.json                            # 依赖和脚本定义
├── pnpm-lock.yaml                          # 依赖锁文件
├── pnpm-workspace.yaml                     # pnpm 工作区配置
├── searxng-settings.yml                    # SearXNG 搜索引擎配置
├── audit-ci.jsonc                          # 依赖安全审计配置
├── .gitignore                              # Git 忽略规则
└── .dockerignore                           # Docker 忽略规则
```

## 核心模块

### 1. 控制器层 (`src/controllers/`)

每个控制器对应一个 API 端点，负责：
- 请求参数验证（Zod schema）
- 业务逻辑编排
- 响应格式化

使用 `withErrorHandler`（`error-wrapper.ts`）包装器统一处理错误。

### 2. 抓取引擎 (`src/scraper/scrapeURL/engines/`)

采用**引擎注册表**模式，每个引擎实现 `EngineDescriptor` 接口：

```typescript
interface EngineDescriptor {
  name: Engine;                          // 引擎名称
  handler: (meta: Meta) => Promise<EngineScrapeResult>;  // 处理函数
  maxReasonableTime: (meta: Meta) => number;              // 超时阈值
  features: { [F in FeatureFlag]: boolean };              // 支持的特性
  quality: number;                       // 质量评分
}
```

引擎选择流程：
1. 根据请求的 featureFlags 计算每个引擎的支持分数
2. 过滤出分数超过阈值的引擎
3. 按质量评分排序
4. 依次尝试，失败则 fallback 到下一个

### 3. Worker 系统 (`src/services/worker/`)

**NUQ (Next-gen Unified Queue)** — 基于 PostgreSQL + RabbitMQ 的任务队列系统：

| Worker | 职责 |
|---|---|
| `nuq-worker` | 核心任务执行 Worker |
| `nuq-prefetch-worker` | 任务预取 Worker（减少延迟） |
| `nuq-reconciler-worker` | 任务协调 Worker（处理失败/超时） |
| `scrape-worker` | 抓取任务具体逻辑 |
| `crawl-logic` | 爬虫任务具体逻辑 |
| `extract-worker` | AI 提取任务 Worker |

### 4. 搜索服务 (`src/search/`)

支持多搜索引擎后端：
- **SearXNG** — 自部署元搜索引擎（默认，支持百度、搜狗、360、夸克、Google、Bing、DuckDuckGo、Brave）
- **Fire Engine** — 云端搜索服务（可选）

### 5. 品牌提取 (`src/lib/branding/`)

从网页中提取品牌信息（Logo、颜色、名称等）：

| 文件 | 职责 |
|---|---|
| `processor.ts` | 品牌处理器主入口 |
| `transformer.ts` | 品牌数据格式转换 |
| `logo-selector.ts` | Logo 图片选择算法 |
| `merge.ts` | 多来源品牌数据合并 |
| `llm.ts` | LLM 辅助品牌提取 |
| `prompt.ts` | LLM Prompt 模板 |
| `schema.ts` | 品牌数据 JSON Schema |
| `types.ts` | TypeScript 类型定义 |
| `extractHeaderHtmlChunk.ts` | Header 区域 HTML 提取 |

## API 端点

所有 API 端点在 `/api` 路径下：

| 方法 | 路径 | 功能 |
|---|---|---|
| `POST` | `/api/scrape` | 单页抓取 |
| `GET` | `/api/scrape/:jobId` | 抓取状态查询 |
| `POST` | `/api/batch/scrape` | 批量抓取 |
| `GET` | `/api/batch/scrape/:jobId` | 批量抓取状态 |
| `DELETE` | `/api/batch/scrape/:jobId` | 取消批量抓取 |
| `GET` | `/api/batch/scrape/:jobId/errors` | 批量抓取错误 |
| `POST` | `/api/crawl` | 网站爬虫 |
| `GET` | `/api/crawl/:jobId` | 爬虫状态 |
| `DELETE` | `/api/crawl/:jobId` | 取消爬虫 |
| `WS` | `/api/crawl/:jobId` | 爬虫状态 WebSocket |
| `GET` | `/api/crawl/:jobId/errors` | 爬虫错误 |
| `POST` | `/api/search` | 搜索 |
| `POST` | `/api/map` | 站点地图 |
| `POST` | `/api/extract` | 数据提取（全文/LLM） |
| `POST` | `/api/links` | 链接提取 |
| `POST` | `/api/github/read` | GitHub 仓库读取 |

其他端点：

| 路径 | 功能 |
|---|---|
| `/` | API 信息 |
| `/e2e-test` | 健康检查 |
| `/health/liveness` | 存活探针 |
| `/health/readiness` | 就绪探针 |
| `/is-production` | 环境检测 |
| `/admin/:key/queues` | Bull Board 队列监控面板 |

## 抓取引擎

### 内置引擎

| 引擎 | 用途 | 特性 |
|---|---|---|
| `fetch` | HTTP 直连抓取 | 轻量、快速，适合静态页面 |
| `playwright` | 浏览器渲染 | 支持 JS 渲染、截图、actions |
| `pdf` | PDF 解析 | 提取 PDF 文本和元数据 |
| `index` | 索引查询 | 从已索引数据中查询 |

### 特性标志 (Feature Flags)

引擎选择基于请求的特性标志：

| 标志 | 说明 |
|---|---|
| `actions` | 页面交互操作 |
| `waitFor` | 等待元素出现 |
| `screenshot` | 截图 |
| `screenshot@fullScreen` | 全屏截图 |
| `pdf` | PDF 处理 |
| `document` | 文档处理（doc/docx/odt/rtf/xlsx） |
| `atsv` | ATS 视图 |
| `location` | 地理位置 |
| `mobile` | 移动端模拟 |
| `skipTlsVerification` | 跳过 TLS 验证 |
| `useFastMode` | 快速模式 |
| `stealthProxy` | 隐身代理 |
| `branding` | 品牌提取 |
| `disableAdblock` | 禁用广告拦截 |

## Worker 架构

```
                    ┌─────────────┐
                    │   Express   │
                    │   API 服务   │
                    └──────┬──────┘
                           │ 创建任务
                    ┌──────▼──────┐
                    │ PostgreSQL  │
                    │  + RabbitMQ │
                    │  (NUQ 队列)  │
                    └──────┬──────┘
                           │ 分发任务
              ┌────────────┼────────────┐
              ▼            ▼            ▼
        ┌──────────┐ ┌──────────┐ ┌──────────┐
        │  scrape  │ │  crawl   │ │ extract  │
        │  worker  │ │  worker  │ │  worker  │
        └──────────┘ └──────────┘ └──────────┘
              │            │            │
              ▼            ▼            ▼
        ┌──────────────────────────────────┐
        │       Redis（状态/缓存/锁）        │
        └──────────────────────────────────┘
```

## 原生模块

### Rust 模块 (`@lingcrawl/lingcrawl-rs`)

位于 `native/` 目录，通过 napi-rs 编译为 Node.js 原生模块。提供高性能的：

- **HTML 处理** — `postProcessMarkdown`、元素清理、链接/图片/属性/元数据提取
- **PDF 解析** — PDF 内容和元数据提取
- **文档转换** — doc、docx、odt、rtf、xlsx → HTML
- **爬虫工具** — Sitemap 解析、robots.txt 解析、URL 排列
- **搜索引擎选择** — 智能引擎 picker

### Go 共享库 (`sharedLibs/go-html-to-md`)

HTML → GitHub Flavored Markdown 转换，通过 koffi (FFI) 调用。

两层降级策略：
1. Go 原生库（`USE_GO_MARKDOWN_PARSER=true`）
2. TurndownService（纯 JS 兜底）

## 配置说明

所有配置通过环境变量管理，定义在 `src/config.ts`，使用 Zod 进行类型安全验证。

配置加载优先级：
1. `.env.local`（本地覆盖，不提交）
2. 仓库根目录 `.env`（统一配置源）

### 核心配置

```bash
# 必填
PORT=3002                     # API 服务端口
HOST=0.0.0.0                  # 监听地址
REDIS_URL=redis://redis:6379  # Redis 地址

# 抓取引擎
PLAYWRIGHT_MICROSERVICE_URL=http://playwright-service:3000/scrape  # Playwright 服务

# 搜索引擎
SEARXNG_ENDPOINT=http://searxng:8080   # SearXNG 地址
SEARXNG_ENGINES=baidu,sogou,360search,quark,bing,google,duckduckgo,brave
SEARXNG_CATEGORIES=general

# AI（可选）
OPENAI_API_KEY=               # OpenAI API Key
OLLAMA_BASE_URL=              # Ollama 本地模型地址

# 代理（可选）
PROXY_SERVER=
PROXY_USERNAME=
PROXY_PASSWORD=

# 功能开关
USE_GO_MARKDOWN_PARSER=true   # 启用 Go Markdown 解析器
TEST_SUITE_SELF_HOSTED=true   # 自部署测试套件
```

完整配置项见 `src/config.ts`。

## 测试

### 测试类型

| 类型 | 目录 | 说明 |
|---|---|---|
| **Snips (E2E)** | `src/__tests__/snips/` | 端到端测试，优先使用 |
| **Unit** | `src/__tests__/unit/` | 单元测试 |
| **E2E 无认证** | `src/__tests__/e2e_noAuth/` | 无需认证的端到端测试 |
| **E2E 带认证** | `src/__tests__/e2e_withAuth/` | 需要认证的端到端测试 |
| **E2E 提取** | `src/__tests__/e2e_extract/` | 提取功能测试 |
| **E2E 地图** | `src/__tests__/e2e_map/` | Map 功能测试 |

### 运行测试

```bash
# 运行指定测试（推荐，harness 会自动启动 API 和 Worker）
pnpm harness jest src/__tests__/snips/scrape.test.ts

# 运行所有 snips 测试
pnpm test:snips

# 运行单元测试
pnpm test
```

### 测试门控

```typescript
// 需要 Fire Engine 的测试
if (!process.env.TEST_SUITE_SELF_HOSTED) { /* ... */ }

// 需要 AI 的测试
if (!process.env.TEST_SUITE_SELF_HOSTED || process.env.OPENAI_API_KEY || process.env.OLLAMA_BASE_URL) { /* ... */ }
```

## Docker 构建

```bash
# 在仓库根目录构建
docker compose build

# 或单独构建 API 镜像
docker build -t lingcrawl-api apps/api/
```

### 多阶段构建

1. **go-build** — 编译 Go 共享库（`libhtml-to-markdown.so`）
2. **build** — 安装依赖、编译 TypeScript、编译 Rust 原生模块
3. **runtime** — 最小运行时镜像

启动命令：`node dist/src/harness.js --start-docker`

## 开发指南

### 开发流程

1. 先写端到端测试（snips）
2. 写代码实现功能
3. 用 `pnpm harness jest ...` 跑测试
4. 提 PR 让 CI 验证

### 常用命令

```bash
# 开发模式（热重载）
pnpm dev

# 编译
pnpm build

# 代码格式化
pnpm format

# 未使用代码检测
pnpm knip

# 运行特定 Worker
pnpm nuq-worker
pnpm extract-worker
```

### 代码规范

- 使用 `withErrorHandler` 包装控制器
- 使用 Zod 进行参数验证
- 使用 Winston 记录日志
- 匹配现有代码风格，不额外改进无关代码
