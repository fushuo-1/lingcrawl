/**
 * Unit tests for FinancialIndexStore（issue #107）。
 *
 * 使用内存数据库 + schema.sql 验证 upsert / delete / search 和 CASCADE。
 * 直接读取 schema.sql 绕过 migrations.ts → config.ts 的 import.meta 依赖。
 */
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { FinancialIndexStore } from "../../financial-index-store.js";

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
let store: FinancialIndexStore;

beforeEach(() => {
  db = createTestDb();
  store = new FinancialIndexStore(db);
});

afterEach(() => {
  if (db.open) db.close();
});

/* ----- helper: 插入 notes 记录（外键依赖） ----- */

function insertNote(notePath: string): void {
  db.prepare(
    "INSERT INTO notes (path, title, content) VALUES (?, ?, ?)",
  ).run(notePath, `Title for ${notePath}`, "content");
}

/* ----- upsert + search 基础 ----- */

describe("FinancialIndexStore.upsert", () => {
  it("插入新记录后 search 能找到", () => {
    insertNote("投资/AAPL-观点.md");
    store.upsert("投资/AAPL-观点.md", {
      entityType: "opinion",
      ticker: "AAPL",
      market: "NASDAQ",
      direction: "bullish",
      confidence: 4,
      tags: ["tech"],
    });

    const results = store.search({ ticker: "AAPL" });
    expect(results).toHaveLength(1);
    expect(results[0].notePath).toBe("投资/AAPL-观点.md");
    expect(results[0].entityType).toBe("opinion");
    expect(results[0].direction).toBe("bullish");
    expect(results[0].confidence).toBe(4);
    expect(results[0].tags).toEqual(["tech"]);
  });

  it("更新已有记录（同 note_path）后字段已更新", () => {
    insertNote("投资/AAPL-观点.md");
    store.upsert("投资/AAPL-观点.md", {
      entityType: "opinion",
      ticker: "AAPL",
      direction: "bullish",
      confidence: 3,
    });

    store.upsert("投资/AAPL-观点.md", {
      entityType: "opinion",
      ticker: "AAPL",
      direction: "bearish",
      confidence: 1,
    });

    const results = store.search({ ticker: "AAPL" });
    expect(results).toHaveLength(1);
    expect(results[0].direction).toBe("bearish");
    expect(results[0].confidence).toBe(1);
  });
});

/* ----- delete ----- */

describe("FinancialIndexStore.delete", () => {
  it("删除已存在的记录返回 true，search 找不到", () => {
    insertNote("投资/TSLA-观点.md");
    store.upsert("投资/TSLA-观点.md", {
      entityType: "opinion",
      ticker: "TSLA",
      direction: "neutral",
    });

    expect(store.delete("投资/TSLA-观点.md")).toBe(true);
    expect(store.search({ ticker: "TSLA" })).toHaveLength(0);
  });

  it("删除不存在的记录返回 false", () => {
    expect(store.delete("不存在/路径.md")).toBe(false);
  });
});

/* ----- search 过滤 ----- */

describe("FinancialIndexStore.search", () => {
  beforeEach(() => {
    insertNote("投资/AAPL-多头.md");
    store.upsert("投资/AAPL-多头.md", {
      entityType: "opinion",
      ticker: "AAPL",
      market: "NASDAQ",
      direction: "bullish",
      confidence: 4,
      tags: ["tech"],
    });

    insertNote("投资/AAPL-空头.md");
    store.upsert("投资/AAPL-空头.md", {
      entityType: "opinion",
      ticker: "AAPL",
      market: "NASDAQ",
      direction: "bearish",
      confidence: 2,
      tags: ["tech", "china"],
    });

    insertNote("投资/BTC-观点.md");
    store.upsert("投资/BTC-观点.md", {
      entityType: "opinion",
      ticker: "BTC",
      market: "Crypto",
      direction: "bullish",
      confidence: 3,
      tags: ["crypto"],
    });

    insertNote("投资/RSI-策略.md");
    store.upsert("投资/RSI-策略.md", {
      entityType: "strategy",
      assetClass: "stock",
      strategyStatus: "active",
      tags: ["momentum"],
    });

    insertNote("投资/FOMO-教训.md");
    store.upsert("投资/FOMO-教训.md", {
      entityType: "lesson",
      lessonCategory: "mistake",
      tags: ["psychology"],
    });
  });

  it("按 entity_type 过滤", () => {
    const results = store.search({ entityTypes: ["opinion"] });
    expect(results).toHaveLength(3);
    expect(results.every((r) => r.entityType === "opinion")).toBe(true);
  });

  it("按 ticker 过滤", () => {
    const results = store.search({ ticker: "AAPL" });
    expect(results).toHaveLength(2);
  });

  it("按 direction 过滤", () => {
    const results = store.search({ direction: "bullish" });
    expect(results).toHaveLength(2);
  });

  it("按 tags 过滤（OR 逻辑）", () => {
    const results = store.search({ tags: ["tech"] });
    expect(results).toHaveLength(2);
  });

  it("组合过滤（entity_type + ticker）", () => {
    const results = store.search({
      entityTypes: ["opinion"],
      ticker: "AAPL",
      direction: "bullish",
    });
    expect(results).toHaveLength(1);
    expect(results[0].direction).toBe("bullish");
  });

  it("relevance 排序", () => {
    const results = store.search({ sortBy: "relevance" });
    // 5 条记录全部返回
    expect(results).toHaveLength(5);
    // strategy 权重最高，应排在前面
    expect(results[0].entityType).toBe("strategy");
  });
});

/* ----- CASCADE 删除 ----- */

describe("FinancialIndexStore — CASCADE", () => {
  it("删除 notes 记录后 financial_memories 自动清空", () => {
    insertNote("投资/AAPL-观点.md");
    store.upsert("投资/AAPL-观点.md", {
      entityType: "opinion",
      ticker: "AAPL",
      direction: "bullish",
    });

    expect(store.search({ ticker: "AAPL" })).toHaveLength(1);

    // 删除 notes 表中的父记录
    db.prepare("DELETE FROM notes WHERE path = ?").run("投资/AAPL-观点.md");

    // financial_memories 应被 CASCADE 删除
    expect(store.search({ ticker: "AAPL" })).toHaveLength(0);
  });
});

/* ----- scanStaleness ----- */

describe("FinancialIndexStore.scanStaleness", () => {
  it("空表返回空数组", () => {
    expect(store.scanStaleness()).toEqual([]);
  });

  it("根据 entity_type 和更新时间返回正确的 stage", () => {
    const now = Math.floor(Date.now() / 1000);

    insertNote("投资/active-opinion.md");
    db.prepare(
      "UPDATE financial_memories SET updated_at = ? WHERE note_path = ?",
    );
    store.upsert("投资/active-opinion.md", {
      entityType: "opinion",
      ticker: "AAPL",
      updatedAt: now - 10 * 86400, // 10 天前，opinion soft=30 → active
    });

    insertNote("投资/stale-position.md");
    store.upsert("投资/stale-position.md", {
      entityType: "position",
      ticker: "TSLA",
      updatedAt: now - 20 * 86400, // 20 天前，position soft=14 hard=28 → stale
    });

    insertNote("投资/archived-strategy.md");
    store.upsert("投资/archived-strategy.md", {
      entityType: "strategy",
      updatedAt: now - 200 * 86400, // 200 天前，strategy hard=180 → archived
    });

    const results = store.scanStaleness();
    expect(results).toHaveLength(3);

    const byPath = Object.fromEntries(results.map((r) => [r.notePath, r.stage]));
    expect(byPath["投资/active-opinion.md"]).toBe("active");
    expect(byPath["投资/stale-position.md"]).toBe("stale");
    expect(byPath["投资/archived-strategy.md"]).toBe("archived");
  });

  it("排序顺序: archived > stale > active，同 stage 内 daysStale 降序", () => {
    const now = Math.floor(Date.now() / 1000);

    insertNote("投资/active-recent.md");
    store.upsert("投资/active-recent.md", {
      entityType: "opinion",
      ticker: "A",
      updatedAt: now - 5 * 86400,
    });

    insertNote("投资/active-old.md");
    store.upsert("投资/active-old.md", {
      entityType: "opinion",
      ticker: "B",
      updatedAt: now - 20 * 86400,
    });

    insertNote("投资/stale-recent.md");
    store.upsert("投资/stale-recent.md", {
      entityType: "position",
      ticker: "C",
      updatedAt: now - 18 * 86400, // 18 天前，position soft=14 → stale
    });

    insertNote("投资/stale-old.md");
    store.upsert("投资/stale-old.md", {
      entityType: "position",
      ticker: "D",
      updatedAt: now - 25 * 86400, // 25 天前，position soft=14 hard=28 → stale
    });

    insertNote("投资/archived.md");
    store.upsert("投资/archived.md", {
      entityType: "strategy",
      updatedAt: now - 200 * 86400, // 200 天前，strategy hard=180 → archived
    });

    const results = store.scanStaleness();
    expect(results).toHaveLength(5);

    // stage 顺序: archived → stale → active
    expect(results[0].stage).toBe("archived");
    expect(results[1].stage).toBe("stale");
    expect(results[2].stage).toBe("stale");
    expect(results[3].stage).toBe("active");
    expect(results[4].stage).toBe("active");

    // stale 内部: daysStale 降序
    expect(results[1].daysStale).toBeGreaterThanOrEqual(results[2].daysStale);

    // active 内部: daysStale 降序
    expect(results[3].daysStale).toBeGreaterThanOrEqual(results[4].daysStale);
  });
});
