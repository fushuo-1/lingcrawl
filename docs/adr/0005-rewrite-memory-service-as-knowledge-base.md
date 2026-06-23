# ADR-0005: 重写 Memory Service 为通用知识库（Knowledge Base）

## 状态

已接受

## 背景

ADR-0003 引入的 Memory Service（`apps/memory-service`）定位为"AI Agent 速记本"——2200 字符上限的记忆条目 + 对话历史检索。实际使用中暴露了核心矛盾：用户需要记录的知识远超速记条目的容量——调试经验（问题描述 + 排查过程 + 解决方案）动辄几百上千字，且需要跨项目、跨领域长期积累和检索。

参考 Nous Research Hermes Agent 的 Memory 设计和 Obsidian 的知识管理理念（原子笔记 + 双向链接 + MOC 主题地图），决定将 Memory Service 重写为通用本地知识库，通过 MCP 协议暴露给 AI Agent。

## 决策

**全弃**现有 Memory Service 的业务层（MemoryStore、SessionStore、ExtractorWorker），**复用**基础设施层（Fastify、MCP 框架、SQLite 连接、Zod 配置），重写为通用知识库服务。

### 存储架构

**双层存储**：Markdown 文件（磁盘）+ SQLite 索引（数据库）。

| 层 | 内容 | 用途 |
|---|---|---|
| Markdown 文件 | 笔记正文（含 YAML frontmatter） | 人可读、可 git 管理、可编辑器直接打开 |
| SQLite 索引 | 文件元数据 + FTS5 全文索引 + 双向链接关系 | 毫秒级搜索、反向链接查询、目录浏览 |

默认数据目录：`~/.lingcrawl/knowledge/`，可通过环境变量 `KB_DATA_DIR` 配置。

### 笔记格式

```markdown
---
tags: [调试经验, Docker]
created: 2026-06-22T10:00:00Z
updated: 2026-06-22T10:00:00Z
---

# 笔记标题

正文内容，支持完整 Markdown。
双向链接用 [[目标笔记标题]] 语法。
```

- **标题**（一级标题）即笔记 ID，也是双向链接的目标标识
- **frontmatter** 包含 tags、created、updated
- **文件名**由标题生成（去除特殊字符），存放在对应分类目录下

### 目录分类

预设 8 个大类，Agent 在大类下自动创建子目录：

| 大类 | 定位 |
|---|---|
| `调试经验/` | Bug 排查、报错解决 |
| `技术知识/` | 语言、框架、工具用法 |
| `嵌入式/` | MCU、RTOS、驱动、通信协议 |
| `FPGA/` | HDL、时序、IP 核、综合 |
| `AI/` | 模型、训练、推理、Prompt 工程 |
| `项目/` | 按项目名分子目录 |
| `学习笔记/` | 课程、书籍、文章摘录 |
| `随想/` | 灵感、未分类碎片 |

分类策略：**混合模式**——大类由用户预设，子目录由 Agent 根据内容自动创建。

### SQLite Schema

```sql
-- 笔记元数据
CREATE TABLE IF NOT EXISTS notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  path TEXT NOT NULL UNIQUE,        -- 相对路径，如 "调试经验/Docker/构建后磁盘膨胀.md"
  title TEXT NOT NULL,              -- 一级标题
  tags TEXT NOT NULL DEFAULT '[]',  -- JSON 数组
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- FTS5 全文索引（标题 + 正文）
CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
  title, content,
  content='notes', content_rowid='id'
);

-- 双向链接关系
CREATE TABLE IF NOT EXISTS links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_path TEXT NOT NULL,        -- 来源笔记路径
  target_title TEXT NOT NULL,       -- 目标笔记标题（[[...]] 里的内容）
  UNIQUE(source_path, target_title)
);
```

FTS5 同步由触发器维护（参照现有 `exchanges_fts` 的模式）。

### MCP 工具

**v1 四个核心工具**：

| 工具 | 参数 | 功能 |
|---|---|---|
| `kb_write` | `content` (必填), `tags?`, `path?` | 创建/更新笔记；无 path 时按标题 + tags 自动归类到对应大类目录 |
| `kb_read` | `path` (必填) | 读取一篇笔记的完整内容 |
| `kb_search` | `query` (必填), `tags?`, `path?`, `limit?` | FTS5 关键词搜索，支持标签和目录过滤 |
| `kb_list` | `path?`, `tags?`, `depth?` | 列出目录树或按标签浏览 |

**v1 两个 MCP Resource**：

| Resource | 功能 |
|---|---|
| `kb://recent` | 最近修改的 N 篇笔记摘要（Agent 新会话时快速了解近期知识） |
| `kb://index` | 知识库完整目录树 + MOC 列表 |

**v2 后续工具**：`kb_link`（手动建链接）、`kb_tag`（改标签）、`kb_moc`（生成主题地图）、语义搜索（向量嵌入）。

### 双向链接机制

- `kb_write` 写入笔记后，扫描正文中的 `[[...]]` 语法，将 `(source_path, target_title)` 存入 `links` 表
- 反向链接查询：`SELECT * FROM links WHERE target_title = ?`
- 目标笔记不存在时标记为"断链"，未来创建该笔记时可提示

### MOC（主题地图）

按需生成，不自动触发。Agent 或用户调用 `kb_moc` 时，扫描指定目录下的所有笔记，生成索引页：

```markdown
# MOC - Docker

## 调试经验
- [[Docker 构建后磁盘膨胀]]
- [[Docker 容器网络不通]]

## 技术知识
- [[Docker 常用命令]]
```

### 基础设施复用

| 模块 | 来源 | 处理 |
|---|---|---|
| `index.ts` | Fastify 入口 + `/health` + `/mcp` | 复用，路径不变 |
| `config.ts` | Zod schema + fail-fast | 复用，替换配置项（移除 MEMORY_CHAR_LIMIT 等，新增 KB_DATA_DIR 等） |
| `db/client.ts` | better-sqlite3 + WAL + 单例 | 复用，改 schema 加载 |
| `mcp/server.ts` | McpServer 工厂 | 复用框架，替换工具注册 |
| `mcp/transport.ts` | StreamableHTTP 适配 | 复用，不变 |
| `cli/` | Commander CLI | 复用框架，换命令 |

### 删除的模块

| 模块 | 原因 |
|---|---|
| `memory/store.ts`, `memory/types.ts`, `memory/errors.ts`, `memory/snapshot.ts`, `memory/security.ts` | 被知识库 Store 替代 |
| `session/store.ts`, `session/types.ts`, `session/errors.ts` | 对话历史功能移除 |
| `extractor/` | LLM 抽取功能移除（v2 可能以新形式回归） |
| `mcp/tools/memory.ts`, `mcp/tools/session.ts`, `mcp/tools/user.ts` | 被新 kb_* 工具替代 |
| `mcp/resources.ts` | 被新 kb:// resource 替代 |
| `db/schema.sql` | 被新 schema 替代 |

## 理由

1. **2200 字符是根本性限制**——调试经验、学习笔记的体量远超速记条目，不是调大上限能解决的
2. **Markdown 文件是最佳知识载体**——人可读、可版本控制、可编辑器打开，不被单一工具锁定
3. **SQLite FTS5 已验证**——现有 SessionStore 的 FTS5 检索已证明对文本检索足够好
4. **双层存储兼顾人机**——文件层给人看，索引层给 Agent 搜
5. **双向链接 + MOC 是知识网络的核心**——让知识从"一堆散文件"变成"可关联的图谱"
6. **复用基础设施避免重写胶水代码**——Fastify + MCP 框架 + SQLite 连接都是成熟的

## 后果

### 正面

- 知识容量从 2200 字符扩展到无限（磁盘空间允许范围内）
- 调试经验、学习笔记、项目文档等可以完整记录，不再需要压缩
- FTS5 全文搜索 + 标签过滤 + 目录浏览，召回率远超原来的子串匹配
- 双向链接让相关知识自动关联，形成知识图谱
- Markdown 文件可 git 管理、可编辑器浏览，不依赖 MCP 才能访问
- 为 v2 语义搜索（向量嵌入）和 LLM 自动抽取预留扩展点

### 风险

| 风险 | 缓解措施 |
|---|---|
| 文件 + SQLite 双写一致性 | kb_write 用事务：先写文件 → 再更新 SQLite → 失败则回滚删除文件 |
| 文件名冲突 | path UNIQUE 约束 + 写入前检查；标题相同时自动追加数字后缀 |
| FTS5 索引膨胀 | 定期 `INSERT INTO notes_fts(notes_fts) VALUES('optimize')` |
| 知识库目录被外部修改 | v1 不监听文件变更；v2 可加 fs watcher 或 `kb_sync` 工具重建索引 |
| 现有 memory-service 用户丢失数据 | 现有数据量极小（速记条目 + 测试数据），可接受 |

### 不可逆性

**完全可逆**（从架构角度）。知识库是独立 app，不与 `apps/api` 耦合。但积累的知识数据是用户资产，迁移需谨慎。

## 替代方案

### 扩展现有 MemoryStore 而非重写

- 否决理由：MemoryStore 的"条目 + 字符上限"模型与"无限量 Markdown 笔记"是根本不同的数据模型，扩展比替换更复杂

### 用 PostgreSQL 替代文件 + SQLite

- 否决理由：本地部署哲学（ADR-0001）要求零外部依赖；Markdown 文件在磁盘上是人可读的，PostgreSQL 里的 blob 不是

### 复用 Obsidian 作为前端

- 否决理由：增加外部工具依赖，与自部署哲学冲突；用户明确表示不使用 Obsidian

### 纯文件存储（不加 SQLite 索引）

- 否决理由：文件多了之后遍历搜索不可接受；双向链接关系无法高效查询

## 参考

- ADR-0003 — 原 Memory Service 决策（被本 ADR 取代）
- Obsidian + Claude Code 知识库实践指南 — https://zhuanlan.zhihu.com/p/2029950530726924559
- Nous Research Hermes Agent Memory — https://hermes-agent.nousresearch.com/docs/user-guide/features/memory
- 实现位置：`apps/memory-service/`（重写）
