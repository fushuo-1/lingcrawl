# PRD: 移除 HTML→Markdown HTTP 微服务层，简化为两层降级策略

## Problem Statement

HTML→Markdown 转换当前有三层降级策略，但第一层（HTTP 微服务）从未部署——`apps/go-html-to-md-service` 目录为空，docker-compose 中也没有该服务。这段死代码增加了维护成本和理解复杂度，需要清理。

## Solution

移除 HTTP 微服务方案相关代码，将三层降级策略简化为两层：
1. Go 原生库 FFI（`USE_GO_MARKDOWN_PARSER=true`）
2. TurndownService（纯 JS 兜底，始终可用）

同时清理之前已确认未使用的 Job & Lock Management 配置残留。

## User Stories

1. As a 开发者，我希望代码库中不包含未部署服务的客户端代码，这样我不会误以为该功能可用
2. As a 开发者，我希望 HTML→Markdown 的降级逻辑清晰简单，这样调试转换问题时只需检查两层而非三层
3. As a 自部署用户，我希望 `.env.template` 中不出现不存在的服务配置项，这样不会浪费时间配置无效选项
4. As a 自部署用户，我希望 README 中的架构文档准确反映实际部署的服务，这样我能正确理解系统架构
5. As a 开发者，我希望 `config.ts` 中不定义未使用的环境变量 schema，这样配置文件保持精简
6. As a 开发者，我希望移除 `html-to-markdown-client.ts` 中对 `axios` 的依赖引用（如果该文件是唯一使用者），这样减少不必要的依赖

## Implementation Decisions

### 模块变更

**删除模块：**
- `html-to-markdown-client.ts` — 整个文件删除，这是 HTTP 微服务的唯一客户端

**修改模块：**
- `html-to-markdown.ts` — 移除 HTTP 服务层代码（import + fallback 块，约 25 行），保留 Go FFI 和 TurndownService 两层
- `config.ts` — 移除 `HTML_TO_MARKDOWN_SERVICE_URL` 配置项
- `.env.template` — 移除 `HTML_TO_MARKDOWN_SERVICE_URL` 行
- `README.md`（apps/api）— 更新目录树（删除 `html-to-markdown-client.ts` 条目）和降级策略文档（三层→两层）

### 降级策略变更

**Before（三层）：**
1. HTTP 微服务（`HTML_TO_MARKDOWN_SERVICE_URL`）→ 未部署
2. Go 原生库 FFI（`USE_GO_MARKDOWN_PARSER`）
3. TurndownService（JS 兜底）

**After（两层）：**
1. Go 原生库 FFI（`USE_GO_MARKDOWN_PARSER=true`）
2. TurndownService（JS 兜底，始终可用）

### 错误处理

Go FFI 层的错误处理逻辑保持不变：
- 找不到 `.so`/`.dll` 文件 → warn 日志，降级到 TurndownService
- 其他运行时错误 → Sentry 上报 + error 日志，降级到 TurndownService

## Testing Decisions

- 这是纯删除/简化操作，不改变外部行为
- 现有 E2E 测试（snips）覆盖 Scrape 功能，间接验证 HTML→Markdown 转换
- 无需新增测试，跑一遍现有 snips 确认无回归即可
- 验证标准：`USE_GO_MARKDOWN_PARSER` 未设置时，TurndownService 兜底正常工作

## Out of Scope

- 不修改 Go FFI 层（`GoMarkdownConverter` 类）
- 不修改 TurndownService 兜底层
- 不修改 `postProcessMarkdown`（Rust 后处理）
- 不清理 `axios` 依赖（可能在其他地方使用，需单独评估）

## Further Notes

本次 PRD 也包含之前会话中已确认删除的 Job & Lock Management 配置残留清理（`JOB_LOCK_EXTEND_INTERVAL`、`JOB_LOCK_EXTENSION_TIME`、`WORKER_LOCK_DURATION`、`WORKER_STALLED_CHECK_INTERVAL`），这些已在本次会话中完成，无需额外操作。
