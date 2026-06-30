/**
 * Unit tests for kb_write 金融记忆写入（issue #108）。
 *
 * 验证 KnowledgeStore.writeNote 在 frontmatter 含 entity_type 时：
 *  - 校验必填字段
 *  - 同时写入 notes + financial_memories 两张表
 *  - overwrite=true 时更新 financial_memories
 *  - 无 entity_type 的普通笔记只写 notes 表
 *
 * 使用内存数据库 + schema.sql 初始化（不 import migrations.ts）。
 */
import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { FinancialIndexStore } from "../../../financial/financial-index-store.js";
import { IndexStore } from "../../../kb/index-store.js";
import { FileManager } from "../../../kb/file-manager.js";
import { KnowledgeStore } from "../../../kb/knowledge-store.js";
import { FinancialValidationError } from "../../../financial/errors.js";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  const schemaPath = path.resolve(process.cwd(), "src/db/schema.sql");
  const schema = fs.readFileSync(schemaPath, "utf-8");
  db.exec(schema);
  return db;
}

let db: Database.Database;
let store: KnowledgeStore;
let tmpDir: string;

beforeEach(() => {
  db = createTestDb();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kb-fin-test-"));
  const fileManager = new FileManager(tmpDir);
  const indexStore = new IndexStore(db);
  const financialIndexStore = new FinancialIndexStore(db);
  store = new KnowledgeStore({ fileManager, indexStore, financialIndexStore });
});

afterEach(() => {
  if (db.open) db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

/* ---- 从 financial_memories 查询辅助 ---- */

function queryFinancial(notePath: string): Record<string, unknown> | undefined {
  const row = db
    .prepare("SELECT * FROM financial_memories WHERE note_path = ?")
    .get(notePath) as Record<string, unknown> | undefined;
  return row;
}

/* ----- opinion: 完整写入 ----- */

describe("kb_write 金融记忆 — opinion", () => {
  it("写入带 entity_type: opinion + 必填字段 → notes 和 financial_memories 都有记录", () => {
    const content = [
      "---",
      "tags: [投资]",
      "created: 2025-01-01T00:00:00Z",
      "updated: 2025-01-01T00:00:00Z",
      "entity_type: opinion",
      "ticker: AAPL",
      "direction: bullish",
      "time_horizon: medium",
      "confidence: 4",
      "thesis: Apple is undervalued",
      "---",
      "",
      "# AAPL 看多观点",
      "",
      "详细分析...",
    ].join("\n");

    const result = store.writeNote({
      content,
      path: "投资/AAPL-看多.md",
    });

    expect(result.path).toBe("投资/AAPL-看多.md");

    // notes 表有记录
    const noteRow = db
      .prepare("SELECT * FROM notes WHERE path = ?")
      .get("投资/AAPL-看多.md") as Record<string, unknown> | undefined;
    expect(noteRow).toBeDefined();

    // financial_memories 表有记录
    const finRow = queryFinancial("投资/AAPL-看多.md");
    expect(finRow).toBeDefined();
    expect(finRow!.entity_type).toBe("opinion");
    expect(finRow!.ticker).toBe("AAPL");
    expect(finRow!.direction).toBe("bullish");
    expect(finRow!.time_horizon).toBe("medium");
    expect(finRow!.confidence).toBe(4);
  });
});

/* ----- opinion: 缺 ticker 校验失败 ----- */

describe("kb_write 金融记忆 — 校验", () => {
  it("写入带 entity_type: opinion 但缺 ticker → 返回校验错误", () => {
    const content = [
      "---",
      "tags: [投资]",
      "created: 2025-01-01T00:00:00Z",
      "updated: 2025-01-01T00:00:00Z",
      "entity_type: opinion",
      "direction: bullish",
      "time_horizon: medium",
      "confidence: 4",
      "thesis: missing ticker",
      "---",
      "",
      "# 缺少 ticker 的观点",
    ].join("\n");

    expect(() =>
      store.writeNote({
        content,
        path: "投资/bad-opinion.md",
      }),
    ).toThrow(FinancialValidationError);
  });
});

/* ----- strategy ----- */

describe("kb_write 金融记忆 — strategy", () => {
  it("写入 strategy + 必填字段 → financial_memories 中 strategy_status 正确", () => {
    const content = [
      "---",
      "tags: [投资]",
      "created: 2025-02-01T00:00:00Z",
      "updated: 2025-02-01T00:00:00Z",
      "entity_type: strategy",
      "name: RSI动量策略",
      "asset_class: stock",
      "rules: RSI < 30 买入, RSI > 70 卖出",
      "strategy_status: active",
      "---",
      "",
      "# RSI 动量策略",
      "",
      "策略详情...",
    ].join("\n");

    const result = store.writeNote({
      content,
      path: "投资/RSI-动量策略.md",
    });

    const finRow = queryFinancial("投资/RSI-动量策略.md");
    expect(finRow).toBeDefined();
    expect(finRow!.entity_type).toBe("strategy");
    expect(finRow!.strategy_status).toBe("active");
    expect(finRow!.asset_class).toBe("stock");
  });
});

/* ----- position ----- */

describe("kb_write 金融记忆 — position", () => {
  it("写入 position + 必填字段 → financial_memories 中 cost_basis/quantity 正确", () => {
    const content = [
      "---",
      "tags: [投资]",
      "created: 2025-03-01T00:00:00Z",
      "updated: 2025-03-01T00:00:00Z",
      "entity_type: position",
      "ticker: TSLA",
      "position_status: holding",
      "quantity: 100",
      "cost_basis: 180.5",
      "target_price: 250",
      "stop_loss: 150",
      "---",
      "",
      "# TSLA 持仓",
      "",
      "持仓记录...",
    ].join("\n");

    const result = store.writeNote({
      content,
      path: "投资/TSLA-持仓.md",
    });

    const finRow = queryFinancial("投资/TSLA-持仓.md");
    expect(finRow).toBeDefined();
    expect(finRow!.entity_type).toBe("position");
    expect(finRow!.cost_basis).toBe(180.5);
    expect(finRow!.quantity).toBe(100);
    expect(finRow!.target_price).toBe(250);
    expect(finRow!.stop_loss).toBe(150);
    expect(finRow!.position_status).toBe("holding");
  });
});

/* ----- lesson ----- */

describe("kb_write 金融记忆 — lesson", () => {
  it("写入 lesson + 必填字段 → financial_memories 中 lesson_category 正确", () => {
    const content = [
      "---",
      "tags: [投资]",
      "created: 2025-04-01T00:00:00Z",
      "updated: 2025-04-01T00:00:00Z",
      "entity_type: lesson",
      "title: 不要追涨杀跌",
      "lesson_category: mistake",
      "lesson: 在高位追入导致亏损 30%",
      "---",
      "",
      "# 不要追涨杀跌",
      "",
      "教训详情...",
    ].join("\n");

    const result = store.writeNote({
      content,
      path: "投资/追涨杀跌教训.md",
    });

    const finRow = queryFinancial("投资/追涨杀跌教训.md");
    expect(finRow).toBeDefined();
    expect(finRow!.entity_type).toBe("lesson");
    expect(finRow!.lesson_category).toBe("mistake");
  });
});

/* ----- overwrite 更新金融记忆 ----- */

describe("kb_write 金融记忆 — overwrite", () => {
  it("overwrite=true 更新金融记忆 → financial_memories 记录也被更新", () => {
    const content1 = [
      "---",
      "tags: [投资]",
      "created: 2025-05-01T00:00:00Z",
      "updated: 2025-05-01T00:00:00Z",
      "entity_type: opinion",
      "ticker: NVDA",
      "direction: bullish",
      "time_horizon: long",
      "confidence: 5",
      "thesis: AI 芯片龙头",
      "---",
      "",
      "# NVDA 看多",
    ].join("\n");

    store.writeNote({
      content: content1,
      path: "投资/NVDA-观点.md",
    });

    const finRow1 = queryFinancial("投资/NVDA-观点.md");
    expect(finRow1!.direction).toBe("bullish");
    expect(finRow1!.confidence).toBe(5);

    // 更新内容：改为 bearish
    const content2 = [
      "---",
      "tags: [投资]",
      "created: 2025-05-01T00:00:00Z",
      "updated: 2025-06-01T00:00:00Z",
      "entity_type: opinion",
      "ticker: NVDA",
      "direction: bearish",
      "time_horizon: short",
      "confidence: 2",
      "thesis: 估值过高",
      "---",
      "",
      "# NVDA 看空",
    ].join("\n");

    store.writeNote({
      content: content2,
      path: "投资/NVDA-观点.md",
      overwrite: true,
    });

    const finRow2 = queryFinancial("投资/NVDA-观点.md");
    expect(finRow2!.direction).toBe("bearish");
    expect(finRow2!.confidence).toBe(2);
    expect(finRow2!.time_horizon).toBe("short");
  });
});

/* ----- overwrite 清除 stale/archived 标记 (#118) ----- */

describe("kb_write — overwrite 清除 stale/archived", () => {
  it("覆写 stale 记忆 → stale 标记被清除", () => {
    // 直接写磁盘模拟已有 stale 记忆（writeNote 不会保留 stale 字段）
    const staleContent = [
      "---",
      "tags: [投资]",
      "created: 2025-01-01T00:00:00Z",
      "updated: 2025-01-01T00:00:00Z",
      "stale: true",
      "---",
      "",
      "# 过时笔记",
      "",
      "旧内容",
    ].join("\n");

    const notePath = "投资/过时笔记.md";
    // 手动写入磁盘 + 索引，模拟历史 stale 文件
    tmpDir; // 触发 FileManager 写入
    const fs2 = require("node:fs");
    const path2 = require("node:path");
    fs2.mkdirSync(path2.join(tmpDir, "投资"), { recursive: true });
    fs2.writeFileSync(path2.join(tmpDir, notePath), staleContent, "utf-8");

    // 覆写，新内容无 stale
    const freshContent = [
      "---",
      "tags: [投资]",
      "created: 2025-01-01T00:00:00Z",
      "updated: 2025-06-01T00:00:00Z",
      "---",
      "",
      "# 过时笔记",
      "",
      "新内容",
    ].join("\n");

    store.writeNote({ content: freshContent, path: notePath, overwrite: true });

    const after = store.readNote(notePath);
    expect(after.frontmatter.stale).toBeUndefined();
    expect(after.frontmatter.archived).toBeUndefined();
    expect(after.frontmatter.created).toBe("2025-01-01T00:00:00Z");
    expect(after.body).toContain("新内容");
  });

  it("覆写 archived 记忆 → archived 标记被清除", () => {
    // 直接写磁盘模拟已有 archived 记忆
    const archivedContent = [
      "---",
      "tags: [投资]",
      "created: 2025-02-01T00:00:00Z",
      "updated: 2025-02-01T00:00:00Z",
      "archived: true",
      "---",
      "",
      "# 归档笔记",
      "",
      "旧内容",
    ].join("\n");

    const notePath = "投资/归档笔记.md";
    const fs2 = require("node:fs");
    const path2 = require("node:path");
    fs2.mkdirSync(path2.join(tmpDir, "投资"), { recursive: true });
    fs2.writeFileSync(path2.join(tmpDir, notePath), archivedContent, "utf-8");

    const freshContent = [
      "---",
      "tags: [投资]",
      "created: 2025-02-01T00:00:00Z",
      "updated: 2025-06-01T00:00:00Z",
      "---",
      "",
      "# 归档笔记",
      "",
      "更新后内容",
    ].join("\n");

    store.writeNote({ content: freshContent, path: notePath, overwrite: true });

    const after = store.readNote(notePath);
    expect(after.frontmatter.archived).toBeUndefined();
    expect(after.frontmatter.stale).toBeUndefined();
  });

  it("覆写非 stale 记忆 → 不会凭空添加 stale 标记", () => {
    const content = [
      "---",
      "tags: [AI]",
      "created: 2025-03-01T00:00:00Z",
      "updated: 2025-03-01T00:00:00Z",
      "---",
      "",
      "# 正常笔记",
      "",
      "内容",
    ].join("\n");

    const notePath = "AI/正常笔记.md";
    store.writeNote({ content, path: notePath });
    store.writeNote({ content, path: notePath, overwrite: true });

    const after = store.readNote(notePath);
    expect(after.frontmatter.stale).toBeUndefined();
    expect(after.frontmatter.archived).toBeUndefined();
  });

  it("新文件（非覆写）→ 不触发 stale 清除逻辑", () => {
    const content = [
      "---",
      "tags: [AI]",
      "created: 2025-04-01T00:00:00Z",
      "updated: 2025-04-01T00:00:00Z",
      "---",
      "",
      "# 全新笔记",
      "",
      "内容",
    ].join("\n");

    const result = store.writeNote({ content, path: "AI/全新笔记.md" });
    const after = store.readNote(result.path);
    expect(after.frontmatter.stale).toBeUndefined();
    expect(after.frontmatter.archived).toBeUndefined();
  });
});

/* ----- 无 entity_type 的普通笔记 ----- */

describe("kb_write 普通笔记", () => {
  it("无 entity_type 的普通笔记 → 只写 notes 表，不写 financial_memories", () => {
    const content = [
      "---",
      "tags: [AI]",
      "created: 2025-01-01T00:00:00Z",
      "updated: 2025-01-01T00:00:00Z",
      "---",
      "",
      "# 普通笔记",
      "",
      "这是一条普通笔记。",
    ].join("\n");

    const result = store.writeNote({
      content,
      path: "AI/普通笔记.md",
    });

    // notes 表有记录
    const noteRow = db
      .prepare("SELECT * FROM notes WHERE path = ?")
      .get("AI/普通笔记.md") as Record<string, unknown> | undefined;
    expect(noteRow).toBeDefined();

    // financial_memories 表无记录
    const finRow = queryFinancial("AI/普通笔记.md");
    expect(finRow).toBeUndefined();
  });
});
