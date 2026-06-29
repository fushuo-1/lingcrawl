# ADR-0006: 金融记忆子系统（Financial Memory）

## 状态

已接受

## 背景

LingCrawl 的 `apps/memory-service` 在 ADR-0005 中被重写为通用 Markdown 知识库，适合记录调试经验、学习笔记等自由文本。但用户在长期通过 AI Agent 进行股票和金融投研时，产生了另一类数据：

- 对某只股票的观点（看多/看空、时间窗口、置信度、论据）
- 可复用的交易策略（规则、参数、回测记录、状态）
- 实际持仓跟踪（成本、数量、目标价、止损、仓位占比）
- 从盈亏中沉淀的教训（错误、原则、框架、洞察）

这些数据如果全部写成普通 Markdown 笔记，会丢失类型结构，导致无法按“实体类型 + ticker + 时间窗口 + 置信度”精准召回，也无法在 Agent 决策时做复合排序。

## 决策

在现有 Markdown 知识库旁，新增一套结构化金融记忆子系统。两套系统双轨并行，通过 `note_path` 弱引用关联。

### 架构定位

| 子系统 | 存储形式 | 适合记录 | 召回方式 |
|---|---|---|---|
| Markdown 知识库 | `.md` 文件 + SQLite FTS5 索引 | 自由表达、研究报告、复盘长文 | 全文搜索、目录浏览、双向链接 |
| 金融记忆 | SQLite `financial_memories` 表 | 结构化投研实体 | 类型/字段过滤 + 复合相关性打分 |

金融记忆不替代 Markdown 笔记；一篇深度研报仍用 `kb_write` 写成笔记，然后用 `fin_memory_link_note` 把其中的观点/策略/持仓/教训关联到结构化记忆。

### 实体类型（v1）

| 类型 | 含义 | 关键字段 |
|---|---|---|
| `opinion` | 对某个标的的观点 | `ticker`, `market`, `direction`, `time_horizon`, `confidence`, `thesis`, `risks`, `source` |
| `strategy` | 可复用的交易策略 | `name`, `asset_class`, `rules`, `parameters`, `backtests`, `strategy_status` |
| `position` | 实际持仓/观察仓 | `ticker`, `position_status`, `cost_basis`, `quantity`, `target_price`, `stop_loss`, `alert_conditions`, `position_size_percent` |
| `lesson` | 投研教训沉淀 | `title`, `lesson_category`, `scenario`, `lesson` |

### 表设计

采用单表 `financial_memories`，以 `entity_type` 作为类型判别列，差异字段允许 `NULL`：

- `id`：UUID 文本主键
- `entity_type`：`opinion` / `strategy` / `position` / `lesson`
- 各类专用列（见 schema.sql）
- 通用列：`tags`（JSON 数组）、`note_path`（关联 Markdown 笔记路径）、`created_at` / `updated_at`

选择单表而非多表，是因为四类实体共享“标签 + 时间戳 + 笔记关联”等通用列，且当前阶段查询需要跨类型搜索；多表会增加 JOIN 复杂度和索引维护成本。

### MCP 工具

新增 5 个金融记忆工具 + 1 个知识库删除工具：

| 工具 | 功能 |
|---|---|
| `fin_memory_write` | 创建或更新金融记忆；按 `entity_type` 校验必填字段 |
| `fin_memory_read` | 按 UUID 读取单个记忆 |
| `fin_memory_search` | 按类型、ticker、市场、方向、标签、文本查询；支持 `updated_desc` / `created_desc` / `relevance` 排序 |
| `fin_memory_delete` | 按 UUID 删除 |
| `fin_memory_link_note` | 关联/解除关联 Markdown 笔记路径 |
| `kb_delete` | 删除 Markdown 笔记，并清空关联的金融记忆 `note_path` |

### 复合相关性打分

`fin_memory_search` 的 `sort_by=relevance` 在应用层计算：

```
score = time_decay * 0.30 + type_weight * 0.25 + confidence_or_size * 0.25 + match_quality * 0.20
```

| 分项 | 说明 |
|---|---|
| `time_decay` | 按 30 天半衰期指数衰减 |
| `type_weight` | `strategy=1.0`, `position=0.95`, `opinion=0.9`, `lesson=0.85` |
| `confidence_or_size` | 观点按 `confidence/5`；策略按状态；持仓按仓位占比加成；教训按类别 |
| `match_quality` | 查询词在 ticker / thesis / name / title / lesson / scenario / tags 中的命中比例 |

SQL 先按过滤条件缩小范围，再对结果集打分排序，避免全表打分。

### 笔记关联同步策略

`note_path` 是弱引用，不建立外键约束（Markdown 文件可能在外部被删除/重命名）。通过事件同步保持一致：

- `kb_delete` 删除笔记时，清空所有 `note_path` 指向该路径的金融记忆
- `kb_sync` 检测到笔记重命名（内容相同但路径变化）时，更新 `financial_memories.note_path`
- `kb_sync` 检测到笔记被外部删除时，清空对应 `note_path`

重命名检测基于“索引中不存在的路径 + 磁盘上新增的路径 + 内容哈希相同”这一保守策略；如果用户复制粘贴出一份内容相同的新文件，可能被误判为重命名，但这是可接受的保守行为。

## 理由

1. **结构化数据更适合投研召回**——ticker、方向、时间窗口、置信度等字段无法通过全文搜索高效表达
2. **双轨并行保留表达自由度**——深度分析仍用 Markdown，关键实体抽成记忆，互相关联
3. **单表设计降低初期复杂度**——共享列多、跨类型查询是主要场景；未来若某类实体字段爆炸，可再拆表
4. **复合打分让 Agent 优先看到“当前最重要”的记忆**——而不是只看更新时间
5. **MCP 工具显式调用**——不依赖自动抽取，避免 LLM 在不合适的时候写入记忆

## 后果

### 正面

- 股票/策略/持仓/教训四类投研数据可被精确检索和排序
- 结构化记忆与 Markdown 研报通过 `note_path` 双向可达
- 笔记删除/重命名不会留下失效关联
- 为后续“按 portfolio 汇总风险敞口”“策略绩效跟踪”等功能打下基础

### 风险

| 风险 | 缓解措施 |
|---|---|
| 单表 NULL 占比高 | SQLite 稀疏列成本低；应用层封装隐藏复杂性 |
| 重命名检测误判复制文件 | 保守策略，宁可误更新也不漏关联；用户可用 `fin_memory_link_note` 手动修正 |
| 复合打分公式主观 | 权重可调整；当前公式覆盖时间、类型、置信度、匹配质量四个维度 |
| JSON 字段（parameters/backtests/alert_conditions）类型脆弱 | MCP 层以字符串传输，parse 失败返回友好错误 |

### 不可逆性

**部分可逆**。金融记忆数据是用户私有资产，schema 可迁移；但若是删除则不可重建。若未来改为多表或加入 PostgreSQL，需要一次数据迁移。

## 替代方案

### 把金融记忆也写成 Markdown 笔记，通过标签区分

- 否决理由：无法保证字段完整性，也无法做数值范围过滤和复合打分

### 为每种实体建独立表

- 否决理由：当前四类实体共享标签/时间戳/笔记关联，且跨类型搜索是主场景；多表增加 JOIN 复杂度而没有明显收益

### 自动从对话中抽取金融记忆

- 否决理由：v1 采用显式 MCP 工具调用，避免 LLM 在不合适的时候写入记忆；自动抽取可作为未来可选增强

## 参考

- ADR-0005 — 重写 Memory Service 为通用知识库
- Issue #99 — 金融记忆数据层
- Issue #100 — 金融记忆 MCP 工具
- Issue #101 — 复合相关性打分
- Issue #102 — 笔记删除/重命名与金融记忆同步
- 实现位置：`apps/memory-service/`
