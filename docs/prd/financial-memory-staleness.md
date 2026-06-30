# PRD: 金融记忆过时检测与两阶段归档

> Implements ADR-0008.

## Problem Statement

金融记忆（观点、策略、持仓、教训）写入后永久存在于活跃目录中，系统无法感知"哪些记忆已经过时"。两个核心问题：

1. **过时不可见**——3 个月前的 opinion 和昨天的 opinion 在搜索结果中没有显式区别。Agent 无法快速判断某条记忆是否仍值得参考。
2. **老文件积累**——已平仓的持仓、已过时的观点与活跃记忆混在 `投资/` 目录下，随使用时间增长越来越臃肿。

用户希望系统能按 entity_type 自动检测过时记忆，分阶段降权和归档，保持活跃目录整洁。

## Solution

引入**按 entity_type 区分的过时阈值 + 两阶段归档**：
- Stage 1（软归档）：frontmatter 标记 `stale: true` + 搜索降权
- Stage 2（硬归档）：文件移到 `投资/_archived/YYYY-MM/` + 搜索默认排除

新增 `kb_staleness` MCP 工具作为扫描和触发入口，读写分离设计。

## User Stories

### 扫描与检测

1. As an AI Agent, I want to call `kb_staleness({ action: "scan" })` to get a list of all financial memories with their staleness status (active/stale/archived), so that I can review which memories need attention
2. As an AI Agent, I want the scan result to include `days_stale` and `stage` for each memory, so that I can assess urgency without manual calculation
3. As an AI Agent, I want `lesson` type memories to be excluded from staleness detection, so that investment lessons are never flagged as stale

### Stage 1：软归档

4. As an AI Agent, I want to call `kb_staleness({ action: "archive", paths: [...] })` to soft-archive stale memories, so that their frontmatter gets `stale: true` and search ranking is reduced
5. As an AI Agent, I want soft-archived memories to receive a ×0.5 score penalty in relevance-sorted search results, so that stale memories rank lower but are still findable
6. As an AI Agent, I want `kb_write` with `overwrite: true` on a stale memory to automatically clear the `stale: true` flag and refresh `updated_at`, so that updating a memory restores it to active status

### Stage 2：硬归档

7. As an AI Agent, I want the archive action to move files to `投资/_archived/YYYY-MM/` when they exceed the Stage 2 threshold, so that the active directory stays clean
8. As an AI Agent, I want `kb_search` to exclude archived files by default, so that search results are not cluttered with outdated memories
9. As an AI Agent, I want `kb_search` to accept an `include_archived: true` parameter, so that I can still find archived memories when explicitly needed
10. As an AI Agent, I want archived files to have their `notes.path`, `financial_memories.note_path`, and `links.source_path` updated atomically, so that no dangling references remain after file move

### 评分协同

11. As a developer, I want the time decay half-life in `scoring.ts` to be per entity_type (position: 14d, opinion: 30d, strategy: 90d, lesson: no decay), so that the decay rate matches each type's expected lifecycle
12. As a developer, I want the `stale: true` penalty to be applied as an extra multiplier on top of the composite score, so that staleness and time decay are independent dimensions

### 工具接口

13. As a developer, I want `kb_staleness` to query `financial_memories.updated_at` directly via SQL (not read disk files), so that the scan operation is efficient
14. As a developer, I want the hard archive file move to happen within a single SQLite transaction (UPDATE notes.path + UPDATE financial_memories.note_path + UPDATE links.source_path), so that partial updates cannot leave the index in an inconsistent state
15. As a developer, I want `FinancialIndexStore` to gain a `scanStaleness()` method that returns staleness status for all financial memories, so that `kb_staleness` can delegate to it

## Implementation Decisions

### Module Changes

**New Modules:**

1. **`financial/staleness.ts`** — staleness threshold configuration and stage calculation
   - `STALENESS_THRESHOLDS` constant: `{ position: { soft: 14, hard: 28 }, opinion: { soft: 30, hard: 60 }, strategy: { soft: 90, hard: 180 } }`
   - `computeStaleness(entityType, updatedAt, now)` → `{ daysStale, stage: 'active' | 'stale' | 'archived' }`
   - Pure function, easily testable

2. **`mcp/tools/kb-staleness.ts`** — new MCP tool with two actions
   - `scan`: calls `FinancialIndexStore.scanStaleness()`, returns sorted list
   - `archive`: accepts `paths[]`, determines stage for each, executes Stage 1 (rewrite frontmatter) or Stage 2 (move file + update indexes)

3. **`financial/__tests__/unit/staleness.test.ts`** — unit tests for `computeStaleness`

4. **`mcp/__tests__/unit/kb-staleness.test.ts`** — integration tests for the tool

**Modified Modules:**

5. **`financial/financial-index-store.ts`** — add `scanStaleness()` method
   - SQL query: `SELECT note_path, entity_type, ticker, updated_at FROM financial_memories`
   - Returns raw rows; stage computation delegated to `staleness.ts`

6. **`financial/scoring.ts`** — per-entity-type time decay
   - `HALF_LIFE` map: `{ position: 14, opinion: 30, strategy: 90, lesson: Infinity }`
   - `computeTimeDecay` takes `entityType` parameter
   - Apply stale penalty: `finalScore = compositeScore * (isStale ? 0.5 : 1.0)`

7. **`kb/knowledge-store.ts`** — `writeNote` stale flag clearing
   - When `overwrite: true` and existing file has `stale: true` in frontmatter: remove `stale: true`, refresh `updated_at`
   - New method: `moveNote(oldPath, newPath)` for hard archive file moves
   - `moveNote` updates `notes.path`, `financial_memories.note_path`, `links.source_path` in a single transaction

8. **`mcp/tools/kb-search.ts`** — add `include_archived` parameter
   - Default `false`: add `AND path NOT LIKE '%/_archived/%'` to query
   - `true`: no path exclusion filter

9. **`mcp/server.ts`** — register `kb_staleness` tool; update instructions string

10. **`kb/file-manager.ts`** — add `move(oldPath, newPath)` method
    - Creates target directory if needed
    - Uses `fs.rename` (same volume) or copy+delete (cross volume)
    - Returns new absolute path

**Preserved Modules (no changes):**

11. `financial/validators.ts` — unchanged
12. `financial/types.ts` — unchanged
13. `financial/errors.ts` — unchanged

### Staleness Thresholds

| entity_type | Stage 1 (soft) | Stage 2 (hard) | Half-life (time decay) |
|---|---|---|---|
| position | 14 天 | 28 天 | 14 天 |
| opinion | 30 天 | 60 天 | 30 天 |
| strategy | 90 天 | 180 天 | 90 天 |
| lesson | ∞ | ∞ | ∞ (no decay) |

### Hard Archive Directory Structure

```
投资/
├── AAPL/
│   └── 看多苹果.md              ← active
├── TSLA/
│   └── 特斯拉持仓.md            ← stale (Stage 1)
└── _archived/
    ├── 2026-05/
    │   └── 旧观点.md             ← hard archived
    └── 2026-06/
        └── 过期策略.md           ← hard archived
```

归档时间桶使用文件被归档时的年月（`YYYY-MM`），不是文件创建时间。

### `kb_staleness` Tool Schema

```json
{
  "name": "kb_staleness",
  "description": "扫描金融记忆过时状态，或对指定记忆执行归档操作",
  "parameters": {
    "action": "scan | archive",
    "paths": "string[] (仅 archive 时必填)"
  }
}
```

### `kb_search` New Parameter

```json
{
  "include_archived": {
    "type": "boolean",
    "default": false,
    "description": "是否包含 _archived/ 路径下的文件"
  }
}
```

## Testing Decisions

### What makes a good test

- 使用 in-memory SQLite (`:memory:`) 隔离
- mock 文件系统操作（`FileManager.move`）验证路径更新
- 时间相关测试用固定的 `now` 参数，不用 `Date.now()`

### Modules to test

1. **`staleness.ts`** (`financial/__tests__/unit/staleness.test.ts`)
   - 各 entity_type 的 active → stale 边界
   - 各 entity_type 的 stale → archived 边界
   - lesson 永远返回 active
   - 已标记 `stale: true` 但未超过 Stage 2 阈值仍返回 stale

2. **`FinancialIndexStore.scanStaleness`** (`financial/__tests__/unit/financial-index-store.test.ts`)
   - 返回所有金融记忆的过时状态
   - 空表返回空数组
   - 正确计算 daysStale

3. **`kb_staleness` tool** (`mcp/__tests__/unit/kb-staleness.test.ts`)
   - scan 返回正确列表
   - archive Stage 1: frontmatter 添加 `stale: true`
   - archive Stage 2: 文件移动 + 三表路径更新
   - archive 对 lesson 类型的路径不做操作
   - 空 paths 数组返回空结果

4. **`kb_write` stale clearing** (`mcp/__tests__/unit/kb-write-financial.test.ts` — 新增用例)
   - overwrite stale 记忆后 `stale: true` 被清除
   - `updated_at` 被刷新

5. **`kb_search` include_archived** (`mcp/__tests__/unit/kb-search-financial.test.ts` — 新增用例)
   - 默认排除 `_archived/` 路径
   - `include_archived: true` 包含归档文件

6. **`scoring.ts` per-entity decay** (`financial/__tests__/unit/scoring.test.ts` — 修改用例)
   - 不同 entity_type 在相同天数下有不同的 time_decay 值
   - stale × 0.5 惩罚正确叠加

### Prior art

- `financial/__tests__/unit/scoring.test.ts` — 现有评分测试（需修改）
- `financial/__tests__/unit/financial-index-store.test.ts` — 现有索引测试（需新增用例）
- `mcp/__tests__/unit/kb-write-financial.test.ts` — 现有写入测试（需新增用例）
- `mcp/__tests__/unit/kb-search-financial.test.ts` — 现有搜索测试（需新增用例）

## Out of Scope

- **实时行情接入** — 不接入价格数据源，过时检测仅基于 `updated_at` 时间戳
- **自动删除** — 硬归档即终点，不引入第三阶段的永久删除
- **后台 worker / cron** — 不引入定时任务，过时检测由 Agent 通过 `kb_staleness` 工具主动触发
- **批量硬归档的事务回滚** — 单个文件归档失败不影响其他文件（best effort）
- **归档文件的自动恢复** — 硬归档后需手动操作恢复（未来可按需添加 `kb_unarchive`）
