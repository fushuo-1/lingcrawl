# ADR-0002: Express 4.22 → Fastify 5.x 框架迁移

## 状态

已接受

## 背景

LingCrawl 当前基于 Express 4.22（约 22,500 行 TypeScript 代码），代码库耦合极浅 — 整个仓库中仅 8 个文件有 Express 依赖，且大部分是 worker health 端点（每个 14-18 行）。95%+ 业务代码完全框架无关。

随着项目演进（AI Agent 工具、MCP 协议、大批量并发任务），需要更好的性能和更现代的 TypeScript 集成。Express 4.22 在以下方面存在局限：

1. **TypeScript 集成弱** — `(req, res, next)` 签名需大量自定义类型补丁
2. **中间件链冗长** — 链式错误处理需要手写 `wrap()` 包裹器
3. **WebSocket 支持碎片化** — `express-ws` 与主包分离
4. **性能瓶颈** — 单线程同步请求处理，C10K 场景下开销明显
5. **JSON Schema 校验零原生支持** — 需要外部库

## 决策

迁移到 **Fastify 5.x**，搭配以下官方插件：

- `@fastify/cors` — CORS 处理
- `@fastify/websocket` — WebSocket 支持（替代 `express-ws`）
- `@fastify/formbody` — form-urlencoded 解析
- `fastify-plugin` — 插件封装

### 迁移范围

- **重写**：`src/index.ts`、`src/routes/api.ts`、`src/routes/shared.ts`、`src/mcp/transport.ts`
- **签名迁移**：16 个控制器从 `(req, res)` 改为 `(request, reply)`
- **合并错误处理**：3 个链式 error handler → 1 个 `setErrorHandler`
- **删除**：`controllers/error-wrapper.ts`（Fastify 原生替代）
- **Worker health 端点**：4 个 Express 端点 → Node.js 原生 `http.createServer`
- **依赖变更**：移除 `express` / `express-ws` / `cors` / `body-parser` / `response-time`，新增上述 Fastify 插件

### 业务逻辑零变更

- NuQ 队列、爬虫引擎、搜索引擎、MCP 工具、Redis 服务均保持原样
- harness.ts 已确认零 Express 依赖，无需变更

## 理由

1. **性能** — Fastify 比 Express 快约 2-3 倍（路由查找用 `find-my-way` radix tree）
2. **TypeScript 一等公民** — 原生类型推断，无需 `@types/express` 补丁
3. **插件架构** — 官方生态（cors/websocket/formbody）替代第三方碎片化中间件
4. **MCP 兼容性** — MCP SDK 的 `StreamableHTTPServerTransport` 接受 raw HTTP，`request.raw` / `reply.raw` 透传无障碍
5. **统一错误处理** — `setErrorHandler` 一处接管所有 async/sync 错误，消除 `wrap()` 样板
6. **生命周期钩子** — `onRequest`/`onResponse` 替代 `res.json` monkey-patch

## 后果

### 正面

- 删除约 200 行 Express 样板代码（wrap、中间件链、错误处理）
- 控制器类型安全提升（`request.body` / `request.params` 自动推断）
- WebSocket 路由声明式（`{ websocket: true }`）
- 为未来知识库 / Agent 功能预留扩展点（Fastify 插件易于组合）

### 风险

| 风险 | 缓解措施 |
|------|----------|
| WebSocket 行为差异 | 优先迁移 WS 并写专项 snips 测试 |
| MCP transport 不兼容 | MCP SDK 的 `handleRequest` 接受 raw HTTP，不依赖 Express |
| 错误序列化回归 | 保留 `error-serde` 测试，工厂函数向后兼容 |
| `res.json` monkey-patch 替代 | `onResponse` hook 替代，Prometheus 指标验证 |
| 控制器 `req.body` 时序 | Fastify 在 preHandler 前解析 body，验证 content-type |
| 第三方中间件兼容 | 4 个 worker health 端点改用 Node.js 原生 `http` |

### 迁移策略

- 分 9 个垂直切片（Slice 1-9）逐步执行
- 每个切片完成后跑 `pnpm harness jest __tests__/snips/` 验证
- 允许 lingcrawl-rs 构建环境错误（已在 ADR-0001 范围外）

## 替代方案

### NestJS

- 优点：DI 容器、装饰器范式、企业级结构
- 否决原因：学习曲线陡峭，依赖注入对小型 API 服务过度工程化；当前架构（控制器 + 服务 + Worker）已足够清晰

### Hono

- 优点：极轻量（~13KB）、边缘运行时支持、TypeScript-first
- 否决原因：MCP 生态尚不成熟；Node.js 长连接场景（WebSocket 状态流）非主要优势

### Elysia

- 优点：Bun 原生、性能优秀、端到端类型安全
- 否决原因：基于 Bun，团队当前使用 Node.js 20 LTS；切换运行时超出本次重构范围

### 保持 Express

- 优点：零迁移成本
- 否决理由：无法解决核心痛点（TS 集成、性能、MCP 兼容性），且代码库已确认 Express 耦合极浅，迁移成本可控
