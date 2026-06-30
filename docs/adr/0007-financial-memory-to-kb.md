# ADR-0007: 金融记忆合并到知识库（Financial Memory → Markdown + Index）

## 状态

待确认

## 背景

ADR-0006 为投研数据（观点、策略、持仓、教训）设计了一套独立的结构化存储子系统：数据全部存在 SQLite `financial_memories` 表中，通过 5 个独立的 `fin_memory_*` MCP 工具操作，与 Markdown 知识库通过 `note_path` 弱引用关联。

运行后暴露了两个问题：

1. **搜索割裂**——金融记忆只能通过 `fin_memory_search` 检索，`kb_search` 无法触达。Agent 需要记住"搜知识库用 `kb_search`，搜金融数据用 `fin_memory_search`"，心智负担高。
2. **存储割裂**——同一类投研内容（如一份深度研报的结构化摘要）被拆成两个系统：正文在 .md 文件，结构化字段在 SQLite 表。维护两套数据的一致性（重命名、删除同步）增加了复杂度。

## 决策

将金融记忆从独立的 SQLite 存储，改为**融入知识库的 Markdown 笔记 + 瘦身索引表**。同时去掉所有 `fin_memory_*` 独立工具，金融记忆的增删改查统一由 `kb_*` 工具完成。

### 存储架构

| 层 | 职责 | 存储位置 |
|---|---|---|
| Markdown 文件 | 完整内容：frontmatter（结构化字段）+ 正文（长文本） | `投资/<subcategory>/<title>.md` |
| `notes` 表 | 笔记索引 + FTS5 全文搜索 | SQLite `memory.db` |
| `financial_memories` 表（瘦身版） | 结构化过滤索引（entity_type, ticker, direction 等短字段） | SQLite `memory.db` |

三层通过 `note_path`（即笔记的相对路径）关联。`notes` 表负责全文检索，`financial_memories` 表负责结构化过滤，两者 JOIN 实现组合查询。

### 目录结构

复用现有 `PathResolver` 逻辑，`投资` 作为新的一级分类标签：

```
知识库根目录/
├── 调试经验/
├── 技术知识/
├── AI/
├── 投资/                    ← 新增
│   ├── AAPL/               ← tags: ["投资", "AAPL"] → 二级目录
│   │   ├── AAPL看多观点.md
│   │   └── AAPL持仓记录.md
│   ├── 量化/               ← tags: ["投资", "量化"]
│   │   └── 趋势跟踪策略.md
│   └── 复盘/               ← tags: ["投资", "复盘"]
│       └── 追高教训.md
└── ...
```

`PathResolver` 中新增 `"投资": "投资"` 映射，无需其他改动。

### Frontmatter 格式

每种 `entity_type` 的 frontmatter 字段保持 ADR-0006 的定义，长文本字段从索引表移入正文 frontmatter：

#### opinion（观点）

```yaml
---
entity_type: opinion
ticker: AAPL
market: US
direction: bullish
time_horizon: long
confidence: 4
tags: [投资, AAPL]
created: 2025-06-30T10:00:00Z
---
# AAPL 看多观点
thesis: iPhone 销量超预期，服务收入持续增长
risks: 供应链依赖中国，估值偏高
source: 财报分析
```

#### strategy（策略）

```yaml
---
entity_type: strategy
name: 趋势跟踪
asset_class: stock
strategy_status: active
tags: [投资, 量化]
created: 2025-06-30T10:00:00Z
---
# 趋势跟踪策略
rules: 20日均线上穿60日均线买入，下穿卖出
parameters: {"lookback_short": 20, "lookback_long": 60}
backtests: {"annual_return": 0.15, "max_drawdown": -0.12}
```

#### position（持仓）

```yaml
---
entity_type: position
ticker: AAPL
position_status: holding
cost_basis: 185.5
quantity: 100
target_price: 220
stop_loss: 170
position_size_percent: 15
tags: [投资, AAPL]
created: 2025-06-30T10:00:00Z
---
# AAPL 持仓记录
alert_conditions: 跌破170清仓
```

#### lesson（教训）

```yaml
---
entity_type: position
lesson_category: mistake
tags: [投资, 复盘]
created: 2025-06-30T10:00:00Z
---
# 追高买入的教训
scenario: 2025年3月在AAPL财报后追高买入，当天冲高回落
lesson: 不要在重大事件后追高，等回调确认支撑再入场
```

### `financial_memories` 瘦身索引表

```sql
CREATE TABLE IF NOT EXISTS financial_memories (
  note_path       TEXT PRIMARY KEY,
  entity_type     TEXT NOT NULL CHECK(entity_type IN ('opinion','strategy','position','lesson')),
  ticker          TEXT,
  market          TEXT,
  direction       TEXT CHECK(direction IN ('bullish','bearish','neutral')),
  time_horizon    TEXT CHECK(time_horizon IN ('short','medium','long')),
  confidence      INTEGER CHECK(confidence BETWEEN 1 AND 5),
  asset_class     TEXT CHECK(asset_class IN ('stock','etf','bond','crypto','mixed')),
  strategy_status TEXT CHECK(strategy_status IN ('draft','active','paused','retired')),
  position_status TEXT CHECK(position_status IN ('holding','watching','closed')),
  cost_basis      REAL,
  quantity        REAL,
  target_price    REAL,
  stop_loss       REAL,
  position_size_percent REAL,
  lesson_category TEXT CHECK(lesson_category IN ('mistake','principle','framework','insight')),
  tags            TEXT NOT NULL DEFAULT '[]',
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  FOREIGN KEY (note_path) REFERENCES notes(path) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_fin_entity_type ON financial_memories(entity_type);
CREATE INDEX IF NOT EXISTS idx_fin_ticker      ON financial_memories(ticker);
```

与 ADR-0006 的区别：
- 主键从 UUID `id` 改为 `note_path`（与 `notes.path` 一致）
- 去掉所有长文本列：`thesis`, `risks`, `source`, `name`, `rules`, `parameters`, `backtests`, `alert_conditions`, `title`, `scenario`, `lesson`
- 去掉 `note_path` 列（改为主键）和 `idx_financial_memories_note_path` 索引（主键自带索引）
- 新增 `FOREIGN KEY ... REFERENCES notes(path) ON DELETE CASCADE`

### MCP 工具变更

| 原工具 | 变更 | 新归属 |
|---|---|---|
| `fin_memory_write` | **去掉**，逻辑合并到 `kb_write` | `kb_write` 内置金融校验 |
| `fin_memory_read` | **去掉**，直接用 `kb_read` | `kb_read` 原样支持 |
| `fin_memory_search` | **去掉**，逻辑合并到 `kb_search` | `kb_search` 新增结构化过滤 |
| `fin_memory_delete` | **去掉**，直接用 `kb_delete` | `kb_delete` 自动清理索引 |
| `fin_memory_link_note` | **去掉**，用 `[[wikilink]]` 替代 | `kb_link` 查询反向链接 |

净减少 4 个 MCP 工具（5 个去掉，`kb_search` 新增参数但不算新工具）。

### `kb_write` 增强

新增可选参数（不破坏现有调用）：

```
kb_write({content, tags?, path?, overwrite?})  ← 现有参数不变
```

金融记忆识别逻辑：
1. 解析 frontmatter，检查是否包含 `entity_type` 字段
2. 如果包含，根据 `entity_type` 校验必填字段（复用现有 `validators.ts`）
3. 写 .md 文件到 `投资/` 目录
4. upsert `notes` 表 + FTS5 索引
5. upsert `financial_memories` 瘦身索引
6. 提取 `[[wikilinks]]` 更新 `links` 表

Agent 调用方式不变——在 `content` 中写好 frontmatter + 正文，`tags` 中带 `"投资"` 即可。

### `kb_search` 增强

新增可选参数：

| 参数 | 类型 | 说明 |
|---|---|---|
| `entity_type` | `string` | 按金融记忆类型过滤 |
| `ticker` | `string` | 按标的代码精确过滤 |
| `direction` | `string` | 按观点方向过滤 |
| `market` | `string` | 按市场过滤 |

查询流程：
1. FTS5 MATCH 全文检索（`notes_fts`）
2. 当传入金融过滤参数时，LEFT JOIN `financial_memories` 并添加 WHERE 条件
3. BM25 排序（可选：保留 relevance 打分作为额外排序选项）

不传金融过滤参数时，行为与现在完全一致。

### `kb_delete` 增强

无新增参数。删除笔记时，`FOREIGN KEY ON DELETE CASCADE` 自动清理 `financial_memories` 索引条目。需要确保 `PRAGMA foreign_keys = ON`（已在 `client.ts` 中设置）。

### 复合相关性打分

保留 `scoring.ts` 的打分算法，作为 `kb_search` 在金融记忆场景下的可选排序方式。具体集成方式在实施阶段确定。

### 工具注册变更

`mcp/server.ts` 中：
- 删除 `registerFinMemoryWriteTool`、`registerFinMemoryReadTool`、`registerFinMemorySearchTool`、`registerFinMemoryDeleteTool`、`registerFinMemoryLinkNoteTool`
- 更新 `registerKbWriteTool`、`registerKbSearchTool`、`registerKbDeleteTool`

## 理由

1. **搜索统一**——Agent 只需记住一个搜索入口 `kb_search`，不需要区分"这是知识还是金融数据"
2. **存储统一**——投研内容本身就是 Markdown 笔记，和调试经验、技术知识没有本质区别，只是多了结构化元数据
3. **简化同步**——金融记忆就是笔记本身，不存在两套数据的一致性问题；删除笔记通过外键级联自动清理索引
4. **减少工具数量**——从 12 个工具减到 8 个，降低 Agent 的工具选择负担
5. **保留结构化查询**——瘦身索引表保证 ticker、direction、confidence 等字段的精确过滤和数值比较能力不丢失

## 后果

### 正面

- Agent 搜索体验统一，不再需要判断"用哪个搜索工具"
- 金融记忆天然支持 `kb_link` 的双向链接和断链检测
- `kb_sync` 的重命名检测自动覆盖金融记忆（它们就是普通笔记）
- 减少 4 个 MCP 工具，简化工具注册和维护

### 风险

| 风险 | 缓解措施 |
|---|---|
| 结构化过滤性能：JOIN 两张表比单表查询慢 | 金融记忆规模小（百/千级），JOIN 成本可忽略；索引覆盖关键过滤字段 |
| `kb_write` 职责增加 | 金融校验逻辑独立为函数，`kb_write` 只是多一个调用分支 |
| Frontmatter 中长文本字段的解析 | 复用现有 `FrontmatterParser`，仅需确认多行值的支持 |
| ADR-0006 中否决了 Markdown 方案 | 当时否决的理由是"无法保证字段完整性和结构化查询"；本次通过瘦身索引表解决了这两个问题 |

### 不可逆性

**部分可逆**。工具接口变更（去掉 `fin_memory_*` 工具）需要更新所有调用方；数据格式从纯 SQLite 行改为 .md 文件 + 索引。若有旧数据需要迁移，需编写一次性脚本。本次变更不涉及现有数据（全新开始）。

## 替代方案

### 保留 `fin_memory_*` 工具，底层改为 .md 文件

- 否决理由：两套工具增加 Agent 的工具选择负担；金融记忆本质是笔记，没有理由用不同的工具操作

### 完全去掉 `financial_memories` 索引表，全靠 frontmatter 过滤

- 否决理由：每次结构化过滤都需要读取所有 .md 文件的 frontmatter，性能不可接受；保留索引表可利用 SQLite 的 B-tree 索引做高效过滤

### 金融记忆放在独立目录（不融入 KB）

- 否决理由：需要维护两套目录扫描和索引逻辑；且金融笔记和其他笔记的边界模糊（一篇研报既有结构化数据也有自由分析）

## 参考

- ADR-0006 — 原金融记忆子系统设计（本 ADR 将其取代）
- ADR-0005 — 重写 Memory Service 为通用知识库
- 实现位置：`apps/memory-service/src/financial/`（将重构）和 `apps/memory-service/src/mcp/tools/`（将精简）
