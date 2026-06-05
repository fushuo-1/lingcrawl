# LingCrawl

## 项目定位

LingCrawl 是一个轻量、自部署的网页数据采集 API 服务，专为 AI Agent 设计。提供 Scrape、Crawl、Map、Search、Extract、MCP 等核心能力，无需认证和计费，开箱即用。

## 核心概念

### 功能模块

- **Scrape（单页抓取）** — 抓取单个 URL，返回 markdown/HTML/截图/原始 HTML/链接列表
- **Batch Scrape（批量抓取）** — 并行抓取多个 URL
- **Crawl（全站爬取）** — 从起始 URL 递归发现并抓取整个网站
- **Map（站点发现）** — 发现网站所有 URL，不抓取内容
- **Search（网络搜索）** — 通过 SearXNG 搜索引擎查询并可选抓取结果内容
- **Extract（文本提取）** — 给 URL，返回页面全文内容
- **GitHub Read（仓库读取）** — 给 GitHub URL，返回仓库目录树和指定文件内容
- **Summary（内容摘要）** — 给 URL，用 AI 生成页面内容摘要
- **Link Extract（链接提取）** — 给 URL，返回页面中所有链接
- **MCP（MCP 协议接入）** — 通过 Streamable HTTP 在 `/mcp` endpoint 暴露 8 个工具（scrape、search、map、extract、links、github_read、crawl、read_pdf）给 AI Agent

### 抓取引擎

- **fetch** — 轻量 HTTP 请求，适合静态页面
- **playwright** — 无头浏览器渲染，处理 JS 动态页面
- **pdf** — PDF 文档解析转 markdown
- 引擎选择遵循瀑布流：依次尝试直到成功

### 基础设施

- **Redis** — 消息队列（BullMQ）、缓存
- **NuQ PostgreSQL** — 持久化任务队列
- **SearXNG** — 元搜索引擎，搜索后端
- **Playwright Service** — 独立浏览器渲染微服务（已启用）
- **Rust Native Addon** — 高性能 HTML 转换、链接提取、PDF 处理等核心运行时组件
- **Go Shared Lib** — HTML→Markdown 转换共享库
- **MCP SDK** — `@modelcontextprotocol/sdk` v1.x，Streamable HTTP 传输协议
