# LingCrawl — 裁剪版

## 项目定位

LingCrawl 是一个面向 AI Agent 的网页数据采集 API 服务。裁剪后专注于核心抓取能力，去除云版商业功能（认证、计费、Agent、Browser），保持轻量自部署。

## 核心概念

### 功能模块

- **Scrape（单页抓取）** — 抓取单个 URL，返回 markdown/HTML/截图/原始 HTML/链接列表
- **Batch Scrape（批量抓取）** — 并行抓取多个 URL
- **Crawl（全站爬取）** — 从起始 URL 递归发现并抓取整个网站
- **Map（站点发现）** — 发现网站所有 URL，不抓取内容
- **Search（网络搜索）** — 通过 SearXNG 搜索引擎查询并可选抓取结果内容
- **Extract（文本提取）** — 给 URL + prompt，两种模式：纯全文返回（免费）或 LLM 结构化提取（需配置 OpenAI/Ollama）
- **GitHub Read（仓库读取）** — 给 GitHub URL，返回仓库目录树和指定文件内容
- **Summary（内容摘要）** — 给 URL，用 AI 生成页面内容摘要
- **Link Extract（链接提取）** — 给 URL，返回页面中所有链接

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

### 已删除的组件

- **认证系统** — Supabase 认证、API Key 校验（完全开放，无需认证）
- **计费系统** — Stripe、积分扣减、订阅管理
- **云版端点** — Agent、Browser、Agent Signup、x402 支付
- **抓取引擎** — fire-engine（云版专属）、document（DOCX）、wikipedia、index
- **SDK** — js-sdk、python-sdk、rust-sdk、java-sdk、go-sdk（全部删除）
- **辅助应用** — test-site、test-suite、ui/ingestion-ui
