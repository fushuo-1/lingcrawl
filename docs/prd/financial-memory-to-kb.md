# PRD: 金融记忆合并到知识库

> Supersedes ADR-0006. Implements ADR-0007.

## Problem Statement

金融记忆（观点、策略、持仓、教训）目前存在独立的 SQLite `financial_memories` 表中，通过 5 个独立的 `fin_memory_*` MCP 工具操作。这导致两个问题：

1. **搜索割裂**——Agent 需要区分"搜知识用 `kb_search`，搜金融用 `fin_memory_search`"，心智负担高。
2. **存储割裂**——同一份投研内容被拆成 .md 文件（正文）和 SQLite 表（结构化字段），需要额外的同步机制维护一致性。

用户希望金融记忆和知识库笔记一样以 .md 文件存储，统一搜索入口，减少工具数量。

## Solution

将金融记忆从独立 SQLite 存储改为**融入知识库的 Markdown 笔记 + 瘦身索引表**。去掉全部 5 个 `fin_memory_*` 工具，金融记忆的增删改查统一由增强后的 `kb_*` 工具完成。

## User Stories

1. As an AI Agent, I want to write a financial opinion via `kb_write` with structured frontmatter fields (entity_type, ticker, direction, confidence), so that the opinion is stored as a searchable .md file with validated metadata
2. As an AI Agent, I want to write a financial strategy via `kb_write`, so that the strategy rules, parameters, and backtests are stored in a readable Markdown file
3. As an AI Agent, I want to write a financial position via `kb_write`, so that position details (cost basis, quantity, target price, stop loss) are persisted as a structured note
4. As an AI Agent, I want to write a financial lesson via `kb_write`, so that the lesson scenario and content are stored alongside structured metadata
5. As an AI Agent, I want `kb_write` to automatically validate required fields based on `entity_type` when writing financial memories, so that incomplete records cannot be created
6. As an AI Agent, I want `kb_write` to automatically route financial memories to the `投资/` directory, so that they are organized alongside other knowledge-base notes
7. As an AI Agent, I want to search for financial memories via `kb_search` with structured filters (entity_type, ticker, direction, market), so that I can find specific financial data without switching tools
8. As an AI Agent, I want `kb_search` to return financial memories alongside regular KB notes, so that I have a unified search experience
9. As an AI Agent, I want to read a financial memory via `kb_read`, so that I can retrieve the full frontmatter and body of any financial note
10. As an AI Agent, I want to delete a financial memory via `kb_delete`, so that both the .md file and the financial index entry are removed atomically
11. As an AI Agent, I want to link financial notes to other KB notes via `[[wikilinks]]`, so that I can navigate between related research and financial data
12. As an AI Agent, I want `kb_link` to show backlinks to financial notes, so that I can see which research references a particular stock or strategy
13. As an AI Agent, I want `kb_sync` to detect renamed financial notes and update the financial index accordingly, so that the index stays consistent after external file edits
14. As a developer, I want the `financial_memories` index table to use `note_path` as the primary key with a foreign key to `notes(path)`, so that deletions cascade automatically without manual cleanup
15. As a developer, I want the `financial_memories` index table to store only short structured fields (entity_type, ticker, direction, confidence, etc.), so that long text (thesis, risks, rules, lesson) lives only in the .md file
16. As a developer, I want the composite scoring algorithm (time_decay, type_weight, confidence_or_size, match_quality) preserved as an optional sort mode in `kb_search`, so that financial memories can be ranked by relevance
17. As a developer, I want the 5 `fin_memory_*` MCP tool files and their tests deleted, so that the codebase accurately reflects the unified tool surface
18. As a developer, I want `FinancialIndexStore` to be a deep module with a stable interface (upsert, delete, search), so that it can be tested in isolation
19. As a developer, I want `PathResolver` to recognize `投资` as a category tag, so that financial memories are routed to `投资/<subcategory>/` directories
20. As a developer, I want the MCP server instructions updated to remove references to `fin_memory_*` tools, so that the Agent receives accurate tool guidance

## Implementation Decisions

### Module Changes

**New/Rewritten Modules:**

1. **`FinancialIndexStore`** (refactor of `financial/financial-store.ts`)
   - Interface: `upsert(notePath, fields)`, `delete(notePath)`, `search(filters) → results`
   - `upsert` does INSERT OR REPLACE keyed on `note_path`
   - `search` supports: `entityTypes[]`, `ticker`, `market`, `direction`, `tags[]`, `query` (LIKE on short fields), `sortBy` (updated_desc / created_desc / relevance), `limit`, `offset`
   - `search` returns slim index rows; caller reads .md file for long text fields if needed
   - Reuses existing `scoring.ts` for relevance sorting

2. **`schema.sql`** — rewrite `financial_memories` table:
   - Primary key: `note_path TEXT` (was `id TEXT`)
   - Foreign key: `FOREIGN KEY (note_path) REFERENCES notes(path) ON DELETE CASCADE`
   - Remove long text columns: `thesis`, `risks`, `source`, `name`, `rules`, `parameters`, `backtests`, `alert_conditions`, `title`, `scenario`, `lesson`
   - Keep: `entity_type`, `ticker`, `market`, `direction`, `time_horizon`, `confidence`, `asset_class`, `strategy_status`, `position_status`, `cost_basis`, `quantity`, `target_price`, `stop_loss`, `position_size_percent`, `lesson_category`, `tags`, `created_at`, `updated_at`
   - Keep indexes on `entity_type` and `ticker`; drop `note_path` index (PK covers it)

**Modified Modules:**

3. **`PathResolver`** — add `"投资": "投资"` to `CATEGORY_TAGS`

4. **`KnowledgeStore.writeNote`** — after parsing frontmatter, if `entity_type` is present:
   - Call `validateRequiredFields(entity_type, fields)` from `financial/validators.ts`
   - After writing .md + upserting `notes` table, call `financialIndexStore.upsert(notePath, slimFields)`
   - Financial fields are extracted from the parsed frontmatter (snake_case keys in YAML)

5. **`KnowledgeStore.deleteNote`** — remove the explicit `financialStore?.clearNotePath()` call (CASCADE handles it); remove `financialStore` dependency

6. **`KnowledgeStore.syncIndex`** — when detecting a renamed file that has `entity_type` in its frontmatter, call `financialIndexStore.upsert(newPath, ...)` after updating the note path; remove `financialStore?.updateNotePath()` and `financialStore?.clearNotePath()` calls

7. **`mcp/tools/kb-search.ts`** — add optional parameters:
   - `entity_type`: string (opinion/strategy/position/lesson)
   - `ticker`: string
   - `direction`: string (bullish/bearish/neutral)
   - `market`: string
   - When any financial filter is provided, query `FinancialIndexStore.search()` and join with FTS5 results; otherwise, existing behavior unchanged

8. **`mcp/tools/kb-write.ts`** — no schema changes needed (content already includes frontmatter); the financial detection and validation happens inside `KnowledgeStore.writeNote`

9. **`mcp/server.ts`** — remove all 5 `registerFinMemory*` imports and calls; update `instructions` string; pass `FinancialIndexStore` to `KnowledgeStore` instead of `FinancialStore`

**Deleted Modules:**

10. Delete `mcp/tools/fin-memory-write.ts`, `fin-memory-read.ts`, `fin-memory-search.ts`, `fin-memory-delete.ts`, `fin-memory-link-note.ts`
11. Delete corresponding test files in `mcp/__tests__/unit/fin-memory-*.test.ts`
12. Delete `financial/financial-store.ts` (replaced by `financial-index-store.ts`)
13. Delete `financial/__tests__/unit/financial-store.test.ts` (replaced by new tests)

**Preserved Modules (no changes):**

14. `financial/validators.ts` — reused as-is by `KnowledgeStore.writeNote`
15. `financial/scoring.ts` — reused as-is by `FinancialIndexStore.search`
16. `financial/types.ts` — minor updates to remove long text fields from the `FinancialMemory` type
17. `financial/errors.ts` — unchanged

### Frontmatter Format

Financial memories use standard YAML frontmatter with `entity_type` as the discriminator:

- **opinion**: entity_type, ticker, market, direction, time_horizon, confidence, tags
  - Body contains: thesis, risks, source (as key-value pairs or prose)
- **strategy**: entity_type, name, asset_class, strategy_status, tags
  - Body contains: rules, parameters, backtests
- **position**: entity_type, ticker, position_status, cost_basis, quantity, target_price, stop_loss, position_size_percent, tags
  - Body contains: alert_conditions
- **lesson**: entity_type, lesson_category, tags
  - Body contains: scenario, lesson

### Directory Routing

Tags `["投资", "AAPL"]` route to `投资/AAPL/<title>.md` via PathResolver.
Tags `["投资", "量化"]` route to `投资/量化/<title>.md`.
No subcategory tag → `投资/<title>.md`.

### Search Integration

When `kb_search` receives financial filter parameters:
1. Execute FTS5 MATCH as before (on `notes_fts`)
2. INNER JOIN `financial_memories` ON `notes.path = financial_memories.note_path`
3. Add WHERE clauses for each provided filter
4. BM25 rank for default sort; optional `sort_by: relevance` uses the existing composite scoring algorithm

When no financial filters are provided, behavior is identical to current `kb_search`.

## Testing Decisions

### What makes a good test

- Test external behavior (inputs → outputs), not implementation details
- Use in-memory SQLite (`:memory:`) for isolation
- Each test creates its own `FinancialIndexStore` / `KnowledgeStore` instance
- Verify side effects: after `kb_write` with financial frontmatter, both `notes` table and `financial_memories` table should contain the entry

### Modules to test

1. **`FinancialIndexStore`** (`financial/__tests__/unit/financial-index-store.test.ts`)
   - `upsert` — inserts new entry, updates existing entry (same note_path)
   - `delete` — removes entry, returns correct boolean
   - `search` — filters by entity_type, ticker, direction, market, tags
   - `search` with relevance sorting — verifies composite scoring integration
   - CASCADE: deleting from `notes` table auto-deletes from `financial_memories`

2. **`kb_write` financial path** (`mcp/__tests__/unit/kb-write-financial.test.ts`)
   - Writing content with `entity_type: opinion` in frontmatter creates entry in both `notes` and `financial_memories`
   - Missing required fields for the entity_type returns validation error
   - Tags containing "投资" route file to `投资/` directory
   - Overwrite mode updates the financial index entry

3. **`kb_search` structured filtering** (`mcp/__tests__/unit/kb-search-financial.test.ts`)
   - Search with `entity_type` filter returns only matching types
   - Search with `ticker` filter returns only matching tickers
   - Search with combined filters (entity_type + ticker) works correctly
   - Search without financial filters returns all notes (financial and non-financial)
   - Relevance scoring produces expected order

### Prior art

- `financial/__tests__/unit/financial-store.test.ts` — current financial store tests (will be replaced)
- `kb/__tests__/unit/knowledge-store.test.ts` — KnowledgeStore tests (pattern for integration tests)
- `mcp/__tests__/unit/kb-search.test.ts` — current kb_search tests (pattern for tool-level tests)
- `__tests__/unit/db/schema.test.ts` — schema constraint tests

## Out of Scope

- **Data migration** — no existing financial data to migrate; fresh start
- **`fin_memory_link_note` replacement** — wikilinks handle this natively; no new tool needed
- **Composite scoring UI/toggle** — scoring is preserved as an internal sort option, not exposed as a user-facing feature
- **Performance optimization** — JOIN performance is acceptable at expected data volumes (hundreds to low thousands of records)
- **Frontmatter multi-line value support** — current FrontmatterParser handles single-line values; long text (thesis, rules, lesson) is written as body prose, not multi-line YAML

## Further Notes

- This PRD supersedes ADR-0006. ADR-0007 (`docs/adr/0007-financial-memory-to-kb.md`) documents the architectural decision.
- The `financial/` directory is preserved but significantly refactored; only `validators.ts`, `scoring.ts`, `types.ts`, and `errors.ts` survive intact.
- `KnowledgeStore` loses its `financialStore` dependency (CASCADE handles cleanup); it gains `financialIndexStore` dependency for write-time indexing.
- Net MCP tool count: 12 → 8 (remove 5 financial tools, add 0 new tools; `kb_write` and `kb_search` gain optional parameters but are not new tools).
