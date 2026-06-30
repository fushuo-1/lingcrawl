# ADR-0008: 金融记忆过时检测与两阶段归档

## 状态

待确认

## 背景

ADR-0007 将金融记忆融入知识库，以 Markdown + 瘦身索引表的方式存储。但设计时没有考虑记忆的生命周期管理——所有记忆写入后永久存在于活跃目录中，系统无法感知"哪些记忆已经过时"。

运行后暴露了两个问题：

1. **过时不可见**——一个 3 个月前写的 `opinion` 和昨天写的在搜索结果中没有区别（仅靠 time decay 做软区分，没有显式标记）。Agent 无法快速判断某条记忆是否仍值得参考。
2. **老文件积累**——随着使用时间增长，`投资/` 目录下的文件越来越多。已平仓的持仓、已过时的观点与活跃记忆混在一起，没有清理机制。

## 决策

引入**按 entity_type 区分的过时阈值 + 两阶段归档**机制，并新增 `kb_staleness` MCP 工具作为触发入口。

### 过时阈值

| entity_type | Stage 1（软归档） | Stage 2（硬归档） |
|---|---|---|
| position | 14 天未更新 | 28 天未更新 |
| opinion | 30 天未更新 | 60 天未更新 |
| strategy | 90 天未更新 | 180 天未更新 |
| lesson | 永不过时 | 永不过时 |

阈值基于 `financial_memories.updated_at` 与当前时间的差值。`lesson` 类型不参与过时检测。

### Stage 1：软归档

**触发条件：** `updated_at` 距今超过 Stage 1 阈值。

**动作：**
- 在 frontmatter 中添加 `stale: true`
- 重写 .md 文件（保留其他字段不变）
- `updated_at` 不变（仍反映上次实际内容更新时间）

**搜索影响：**
- 在 relevance 排序中，`stale: true` 的记忆获得额外 **×0.5 惩罚乘数**，叠加在现有 time decay 之上
- `updated_desc` 和 `created_desc` 排序不受影响

### Stage 2：硬归档

**触发条件：** `updated_at` 距今超过 Stage 2 阈值（即 Stage 1 阈值的 2 倍）。

**动作：**
- 将 .md 文件从原路径（如 `投资/AAPL/看多苹果.md`）移动到 `投资/_archived/YYYY-MM/看多苹果.md`
- 时间桶按文件被归档时的年月分组
- 更新 `notes.path`（SQL UPDATE）
- 更新 `financial_memories.note_path`（SQL UPDATE）
- 更新 `links` 表中所有引用该路径的 `source_path` 条目
- 在 frontmatter 中添加 `archived: true`（保留 `stale: true`）

**搜索影响：**
- 默认从搜索结果中排除 `_archived/` 路径下的文件
- `kb_search` 新增 `include_archived: boolean` 参数，设为 `true` 时可搜索归档文件

### `kb_staleness` MCP 工具

读写分离设计，两个 action：

```
kb_staleness({ action: "scan" })
  → 返回金融记忆过时状态列表，不做任何修改
  → 结果包含: path, entity_type, ticker, updated_at, days_stale, stage (active/stale/archived)

kb_staleness({ action: "archive", paths: string[] })
  → 对指定路径执行归档操作
  → 自动判断应执行 Stage 1 还是 Stage 2
  → 返回处理结果
```

**scan 的实现：** 直接查询 `financial_memories` 表的 `updated_at` 字段，不需要读磁盘文件。按 entity_type 分组计算过时天数，返回状态列表。

**archive 的实现：**
- Stage 1：调用 `KnowledgeStore.writeNote` 以 `overwrite: true` 写入带 `stale: true` 的 frontmatter
- Stage 2：调用 `FileManager.move` 移动文件，然后通过 SQL 更新三张表的路径引用

### time decay 调整

将 `scoring.ts` 的 time decay 从统一 30 天半衰期改为**按 entity_type 区分**，与 Stage 1 阈值对齐：

| entity_type | 当前半衰期 | 新半衰期 |
|---|---|---|
| position | 30 天 | 14 天 |
| opinion | 30 天 | 30 天 |
| strategy | 30 天 | 90 天 |
| lesson | 30 天 | 不衰减（固定 1.0） |

复合评分公式保持不变：
```
score = time_decay × 0.30 + type_weight × 0.25 + confidence_or_size × 0.25 + match_quality × 0.20
```

Stage 1 的 `stale: true` 惩罚作为额外乘数应用在最终 score 上：`final_score = score × (stale ? 0.5 : 1.0)`。

### `kb_write` 联动

当 `kb_write` 覆写（`overwrite: true`）一条 `stale: true` 的记忆时：
- `updated_at` 被刷新为当前时间
- 自动清除 `stale: true` 标记
- 记忆回归 active 状态

### `kb_search` 增强

新增可选参数：

| 参数 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `include_archived` | `boolean` | `false` | 是否包含 `_archived/` 路径下的文件 |

当 `include_archived: false`（默认）时，搜索查询自动排除 `path LIKE '%/_archived/%'` 的笔记。

## 理由

1. **显式优于隐式**——time decay 只在排序时起作用，Agent 无法直接感知"这条记忆过时了"。`stale: true` frontmatter 标记让过时状态可读、可查、可操作。
2. **两阶段渐进**——软归档可逆（更新内容即恢复），硬归档不可逆但不删除。给 Agent 和用户充足的缓冲时间。
3. **按类型区分阈值**——position 对时效性要求最高（市场变化快），lesson 永不过时（经验教训不贬值）。统一阈值无法反映这种差异。
4. **MCP 工具触发**——不需要引入后台 worker 或 cron，保持 memory-service 的轻量架构。Agent 在合适时机调用即可。
5. **硬归档即终点**——不引入自动删除，避免数据丢失风险。归档文件在 `_archived/` 中永久保留，需要时仍可手动检索。

## 后果

### 正面

- Agent 可以通过 `stale: true` frontmatter 或 `kb_staleness scan` 快速识别过时记忆
- `投资/` 目录保持整洁，只有活跃记忆可见
- 硬归档文件不参与默认搜索，减少噪音
- `kb_write` 覆写自动清除 stale 标记，维护成本低

### 风险

| 风险 | 缓解措施 |
|---|---|
| 硬归档移动文件需更新三张表引用 | `notes.path` UPDATE + `financial_memories.note_path` UPDATE + `links.source_path` UPDATE，同一事务内完成 |
| wikilink 断链 | `links` 表中的 `target_title` 是按标题匹配而非路径，不受移动影响；`source_path` 需要更新 |
| 归档时间桶文件名冲突 | `_archived/YYYY-MM/` 目录下复用 `FileManager` 的碰撞检测（追加 `-2`、`-3` 后缀） |
| Agent 忘记调用 `kb_staleness` | MCP server instructions 中增加提示；未来可考虑启动时自动 scan |
| lesson 永不过时但可能确实不再相关 | lesson 的 type_weight 已经最低（0.85），且可手动删除 |

### 不可逆性

**部分可逆。** Stage 1（软归档）完全可逆——更新记忆内容即自动清除 `stale: true`。Stage 2（硬归档）需要手动将文件从 `_archived/` 移回原位并更新索引，虽然可行但不自动。

## 替代方案

### 搜索时惰性检测

每次 `kb_search` 返回结果时顺便检查过时状态。

- 否决理由：不被搜索到的记忆永远不会被检测到；每次搜索有额外 I/O 开销；职责不清晰

### 启动时 + `kb_sync` 时批量扫描

memory-service 启动时和 `kb_sync` 调用时自动处理过时记忆。

- 否决理由：`kb_sync` 的职责扩大（从"同步索引"变成"同步索引+归档"），违反单一职责；启动时处理可能拖慢服务启动

### 固定统一阈值（不按 entity_type 区分）

所有类型使用同一个过时阈值（如 30 天）。

- 否决理由：position 和 lesson 的时效性需求完全不同，统一阈值会导致要么 position 太晚归档、要么 lesson 被误归档

### 硬归档后自动删除

超过更长时间后自动从 `_archived/` 删除。

- 否决理由：数据丢失风险高；归档文件不占搜索资源，磁盘占用可忽略；保留历史数据有复盘价值

## 参考

- ADR-0007 — 金融记忆合并到知识库（本 ADR 在其基础上增加生命周期管理）
- ADR-0005 — 重写 Memory Service 为通用知识库
- `apps/memory-service/src/financial/scoring.ts` — 现有 time decay 实现
- `apps/memory-service/src/financial/financial-index-store.ts` — 瘦身索引表 CRUD
- `apps/memory-service/src/kb/knowledge-store.ts` — 知识库核心编排层
