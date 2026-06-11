# ADR-0003: 引入有状态 Memory Service（AI Agent 长期记忆 + 对话历史）

## 状态

已接受

## 背景

LingCrawl 一直保持"无状态数据采集 API"的定位（见 ADR-0001），所有持久化状态都委托给外部基础设施（PostgreSQL + RabbitMQ + Redis）。任何 LLM agent 想要接入 LingCrawl 都必须在客户端自行维护记忆、跨会话同步对话历史——这对"在 Claude Code / Codex / Zed 等 host 里直接调用"的轻量场景是摩擦。

Nous Research 的 Hermes Agent 展示了一种简洁的方案：把 agent 的"长期记忆"和"对话历史"抽成独立进程，通过 MCP 协议暴露给任何 host。配置上是 SQLite + FTS5 单文件，部署复杂度接近零，但能为 agent 提供跨会话的事实库 + 用户画像 + 检索接口。

本次 v0.1 + v0.2 完成了 LingCrawl 项目内首个有状态、有持久化数据的服务（`apps/memory-service`）。本 ADR 记录"为什么要引入它"和"对架构边界的影响"。

## 决策

新增独立 app `apps/memory-service/`，与 `apps/api` 同级，定位为"AI Agent 长期记忆 + 对话历史检索"：

### 能力边界

| 能力 | 实现 | 优先级 |
|------|------|--------|
| 记忆条目（agent 笔记 / 用户画像）CRUD + 容量管理 | `MemoryStore`（SQLite `memory_entries` 表，字符上限 2200/1375） | v0.1 |
| 重复检测 + 子串 replace/remove + prompt-injection 扫描 | `MemoryStore` 扩展 + `security.ts` 独立模块 | v0.1 |
| 对话历史（session + exchanges）写入 + FTS5 全文检索 | `SessionStore` + SQLite FTS5 虚拟表 + 3 trigger | v0.1 |
| Markdown frozen snapshot 注入 LLM context | `SnapshotRenderer` → MCP resources `memory://notes` + `memory://user` | v0.1 |
| MCP 协议接入（8 个 tool + 2 个 resource） | `@modelcontextprotocol/sdk` v1.x + Streamable HTTP `/mcp` | v0.1 |
| CLI 工具（运维/调试） | Commander.js `lingcrawl-memory` bin | v0.1 |
| 后台 LLM 抽取（exchanges → 建议的 memory 候选） | `ExtractorWorker` + `LlmProvider` 抽象（OpenAI-compatible / Anthropic） | v0.2，默认 disabled |

### 架构边界

- **独立 app**：`apps/memory-service/` 与 `apps/api/` 同级，**不**嵌入 `apps/api/`
- **单文件 SQLite**：`~/.lingcrawl/memory.db`（v0.1 不引入 PostgreSQL / Redis 复用）
- **纯本地部署**：MVP 绑定 `127.0.0.1:3001`，**无**鉴权（loopback 信任）
- **MCP 唯一对外协议**：不单独暴露 REST（避免 API surface 膨胀）
- **EXTRACTOR_ENABLED 默认 false**：v0.2 后台 worker 装入代码但不实例化，需用户显式开启 + 配 LLM endpoint
- **schema 预留 `userId` 字段**：v0.1 单用户部署，schema 已有 `userId` 字段位置，**不**实现多用户逻辑；未来加多用户时只需把 API key 映射到 userId

### 复用 `apps/api` 的基础设施（不引入新依赖）

- TypeScript / Node.js / pnpm workspaces（与 `apps/api` 同栈）
- `@modelcontextprotocol/sdk` v1.x（已用于 `apps/api` MCP）
- Fastify 5.x（ADR-0002 迁移后的统一框架）
- Zod 4 schema（与 `apps/api` 一致）

### 复用模式

- 配置层：`configSchema` + `safeParse` + fail-fast（参照 `apps/api/src/config.ts`）
- 错误类型：每模块独立 `errors.ts`（参照 `apps/api` 错误体系）
- 测试：snips 端到端 + unit 单元测试（参照 `apps/api/__tests__/` 目录结构）
- MCP 挂载：Fastify 路由 + `StreamableHTTPServerTransport`（参照 `apps/api/src/mcp/transport.ts`）

## 理由

1. **本地 agent 的核心痛点**——Claude Code / Codex 等 host 在每个会话/项目里都要重写一遍用户偏好和项目约定，浪费 context window
2. **Hermes 已验证模式**——MEMORY.md / USER.md 双文件 + FTS5 session 检索的组合是实战设计
3. **零新增基础设施**——单文件 SQLite + 已有 SDK，部署复杂度接近零
4. **保持主项目无状态**——`apps/api/` 仍是无状态数据采集 API，memory service 独立部署、互不耦合
5. **MCP 是天然契合**——host 想要的就是 `tools/list` + `resources/read` + 工具调用，与 LingCrawl 现有 `/mcp` 模式一致

## 后果

### 正面

- 跨 MCP 客户端共享一份 memory、user profile、session history
- 跨会话"我记得上次聊过这个"能力（仅靠 FTS5 关键词检索即可达到 90% 召回率）
- 长期用户画像 + 项目知识沉淀
- 为未来加入语义检索、外部 memory provider 预留扩展点（`LlmProvider` 抽象、`userId` 字段预留）
- 主项目 `apps/api` 仍是无状态数据采集 API（不污染 ADR-0001 的设计边界）

### 风险

| 风险 | 缓解措施 |
|------|----------|
| 单文件 SQLite 数据丢失 | 文档明确 `~/.lingcrawl/` 是用户数据；`docker-compose` 已挂 volume；未来可加 backup 工具 |
| 记忆容量满后体验下降 | `add` 抛 `CapacityExceededError` 含现有 entries 列表 + usage，agent 可主动 consolidate |
| LLM 抽取噪声大 | 默认 `target=pending` + `minConfidence=0.7` + human review CLI `lingcrawl memory review` |
| 多客户端并发写 | SQLite WAL 模式 + `busy_timeout=5000`；E2E 并发测试覆盖 2 个 client × 20 个 add |
| prompt-injection 通过 memory 注入 system prompt | `security.ts` 5 个注入模式 + 5 个零宽字符 + 安全扫描先于容量检查（拒绝不消耗容量） |
| 多个 client 并发访问共享 `~/.lingcrawl/memory.db` | E2E 测试已验证（issue #78 concurrency.test.ts） |

### 不可逆性

**部分可逆**。记忆数据是用户私有资产，不会破坏主项目架构（独立 app 部署、互不耦合）。但：

- 用户长期积累的 memory entries 是**不可重建**的——这是本次决策的真正成本
- 缓解：schema 简洁（4 张表 + FTS5），如果未来需要迁移到 PostgreSQL，是标准 SQLite → PG 迁移路径

## 替代方案

### 把 memory 塞进 `apps/api`

- 否决理由：污染 LingCrawl 主项目"无状态 API"设计边界（ADR-0001 明确不包含认证/计费/agent 特定功能）；且 `apps/api` 已有 NuQ 任务队列 + Webhook 清理，状态已经收敛到"基础设施层"；新增状态会模糊定位

### 复用 `apps/nuq-postgres` 存 memory

- 否决理由：NuQ PostgreSQL 是任务队列专用，与 memory 数据语义不同（任务 = 短期、内存 = 长期）；混用会让 schema 边界变模糊；且本地部署（`docker compose up postgres`）增加启动复杂度
- 长期方向：若需要语义检索或多用户，可加一个 `memory-postgres` 微服务，与 `memory-service` 并存（参考 #65 PRD 中"Future"段）

### 不做 memory service，让用户用外部方案（Honcho / Mem0 / Hindsight）

- 否决理由：依赖第三方服务与 LingCrawl "自部署/无外部依赖"哲学冲突；外部服务增加首次使用门槛（注册、API key、计费）；本地优先 + 简单 SQLite 是 Hermes 已经验证的最少阻力路径
- 长期方向：可作为可选插件接入（参考 Hermes Agent 的 `Memory Providers` 设计）

### 复用 `apps/api` 的 Redis

- 否决理由：Redis 当前职责是"基础设施（cache / rate limit / 分布式锁）"，是短期数据存储；memory 是长期持久化；两者职责混淆；且本地部署不一定启动 Redis

## 参考

- Hermes Agent Persistent Memory: https://hermes-agent.nousresearch.com/docs/user-guide/features/memory
- ADR-0001 — 定位为 AI Agent 数据采集 API
- ADR-0002 — Fastify 5.x 迁移（统一框架基础）
- Issue #65 — Memory Service PRD
- Issue #66 — 本 ADR 的源 issue
- Issues #67–#81 — v0.1 + v0.2 实现切片
- 实现位置：`apps/memory-service/`
