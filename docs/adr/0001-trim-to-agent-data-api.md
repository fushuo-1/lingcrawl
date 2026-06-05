# ADR-0001: 定位为独立的 AI Agent 数据采集 API 服务

## 状态

已接受

## 背景

LingCrawl 是一个独立的轻量级网页数据采集 API 服务，专为 AI Agent 设计。项目目标是提供开箱即用的自部署方案，无需认证和计费，让 AI Agent 能够直接通过 HTTP 调用完成网页抓取、爬取、搜索等数据采集任务。

## 决策

以 AI Agent 数据采集为核心定位，选择技术栈和功能边界。

### 核心功能

- 5 个 API 端点：Scrape、Batch Scrape、Crawl、Map、Search
- 3 个扩展端点：Extract（文本提取）、GitHub Read（仓库读取）、Links（链接提取）
- MCP 协议接入：通过 Streamable HTTP 在 `/mcp` 暴露 8 个工具给 AI Agent
- 3 个抓取引擎：fetch（轻量 HTTP）、playwright（无头浏览器）、pdf（PDF 解析）
- 引擎瀑布流选择：依次尝试直到成功

### 技术栈

- **API 层**：TypeScript / Express
- **任务队列**：NuQ（PostgreSQL + RabbitMQ）
- **缓存**：Redis
- **搜索引擎**：SearXNG
- **浏览器渲染**：Playwright Service（独立微服务）
- **容器化**：Docker Compose 一键部署

### 不包含

- 认证/计费系统 — 自部署场景不需要
- 多语言 SDK — AI Agent 直接走 HTTP
- 商业云版专属功能 — 超出自部署范围

## 理由

1. AI Agent 需要一个无认证、无计费摩擦的数据采集 API，现有商业方案门槛过高
2. 自部署确保数据隐私和可控性
3. 三个抓取引擎覆盖静态页面、动态页面和 PDF 文档，满足绝大多数采集场景
4. MCP 协议让 AI Agent 可以通过标准化工具接口直接调用
