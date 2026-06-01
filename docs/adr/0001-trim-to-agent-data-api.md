# ADR-0001: 重度裁剪云版功能，定位 AI Agent 数据采集服务

## 状态

已接受

## 背景

LingCrawl 原本是一个面向商业用户的网页数据 API（lingcrawl.dev），包含认证、计费、AI Agent、Browser 会话等完整云版功能。现需要裁剪为轻量自部署版本，面向 AI Agent 使用场景。

## 决策

删除所有云版商业功能，保留核心抓取能力，新增 GitHub 仓库读取和 AI 提取功能。

### 保留

- 5 个核心 API 端点：Scrape、Batch Scrape、Crawl、Map、Search
- 3 个抓取引擎：fetch、playwright、pdf
- 基础设施：Redis、NuQ PostgreSQL、SearXNG、Playwright Service
- 原生模块：Rust Native Addon、Go Shared Lib

### 删除

- 认证/计费：Supabase、Stripe、积分系统、限流
- 云版端点：Agent、Browser、Agent Signup、x402
- 引擎：fire-engine、document、wikipedia、index
- SDK：全部（js、python、rust、java、go）
- 辅助应用：test-site、test-suite、ui/ingestion-ui

### 新增

- GitHub 仓库读取（文件列表 + 文件内容）
- URL 内容摘要（AI 生成）
- 文本提取（双模式：纯全文 / LLM 结构化提取）
- 链接提取

## 理由

1. 自部署场景不需要认证和计费系统
2. fire-engine 是云版专属基础设施，自部署无法使用
3. SDK 对 AI Agent 场景无用，Agent 直接走 HTTP
4. 核心抓取能力完整保留，新增功能增强 Agent 实用性

## 后果

- 无法回退到云版商业模式（计费代码已删除）
- 如需恢复 SDK，需要重新编写
