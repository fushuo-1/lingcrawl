/**
 * 集成测试：kb_read 读取金融记忆（issue #109）
 *
 * 验证 KnowledgeStore.readNote 能正确读取金融记忆的 frontmatter 字段。
 * 使用内存数据库 + schema.sql 初始化。
 */
import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { FileManager } from "../../../kb/file-manager.js";
import { IndexStore } from "../../../kb/index-store.js";
import { KnowledgeStore } from "../../../kb/knowledge-store.js";
import { NoteNotFoundError } from "../../../kb/errors.js";
import { FinancialStore } from "../../../financial/financial-store.js";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  const schemaPath = path.resolve(process.cwd(), "src/db/schema.sql");
  const schema = fs.readFileSync(schemaPath, "utf-8");
  db.exec(schema);
  return db;
}

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "kb-read-fin-test-"));
}

describe("kb_read 金融记忆读取 (issue #109)", () => {
  let db: Database.Database;
  let tmpDir: string;
  let store: KnowledgeStore;
  let fileManager: FileManager;
  let indexStore: IndexStore;
  let financialStore: FinancialStore;

  beforeEach(() => {
    db = createTestDb();
    tmpDir = createTempDir();
    fileManager = new FileManager(tmpDir);
    indexStore = new IndexStore(db);
    financialStore = new FinancialStore(db);
    store = new KnowledgeStore({ fileManager, indexStore, financialStore });
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("读取 opinion 金融记忆 → frontmatter 包含金融字段", () => {
    // 写入带金融 frontmatter 的笔记
    const content = [
      "---",
      "tags: [投资, 灵鉴]",
      "created: 2025-06-01T00:00:00.000Z",
      "updated: 2025-06-01T00:00:00.000Z",
      "entity_type: opinion",
      "ticker: AAPL",
      "direction: bullish",
      "confidence: 4",
      "time_horizon: medium",
      "---",
      "",
      "# AAPL 看多",
      "",
      "Apple 季度营收超预期。",
    ].join("\n");

    const { path: notePath } = store.writeNote({
      content,
      path: "投资/AAPL-opinion.md",
    });

    // 创建对应的金融记忆记录
    financialStore.create({
      entityType: "opinion",
      ticker: "AAPL",
      direction: "bullish",
      confidence: 4,
      timeHorizon: "medium",
      thesis: "Apple 季度营收超预期",
      notePath,
    });

    // 通过 KnowledgeStore.readNote 读取
    const result = store.readNote(notePath);

    // frontmatter 应包含原始写入的金融字段
    expect(result.frontmatter.tags).toContain("投资");
    expect(result.frontmatter.tags).toContain("灵鉴");
    expect(result.frontmatter.created).toBeTruthy();
    expect(result.frontmatter.updated).toBeTruthy();

    // body 应包含笔记正文
    expect(result.body).toContain("# AAPL 看多");
    expect(result.body).toContain("Apple 季度营收超预期");

    // 确认 financial_memories 表中有对应记录
    const memories = financialStore.getByNotePath(notePath);
    expect(memories.length).toBe(1);
    expect(memories[0].entityType).toBe("opinion");
    expect(memories[0].ticker).toBe("AAPL");
    expect(memories[0].direction).toBe("bullish");
    expect(memories[0].confidence).toBe(4);
    expect(memories[0].timeHorizon).toBe("medium");
  });

  it("读取 strategy 记录 → frontmatter 包含 name, asset_class, strategy_status", () => {
    const content = [
      "---",
      "tags: [投资, 策略]",
      "created: 2025-05-15T00:00:00.000Z",
      "updated: 2025-05-15T00:00:00.000Z",
      "entity_type: strategy",
      "name: 动量突破策略",
      "asset_class: stock",
      "strategy_status: active",
      "---",
      "",
      "# 动量突破策略",
      "",
      "基于20日均线突破的趋势跟踪策略。",
    ].join("\n");

    const { path: notePath } = store.writeNote({
      content,
      path: "投资/动量突破策略.md",
    });

    financialStore.create({
      entityType: "strategy",
      name: "动量突破策略",
      assetClass: "stock",
      strategyStatus: "active",
      rules: "突破20日均线买入",
      notePath,
    });

    const result = store.readNote(notePath);

    expect(result.body).toContain("# 动量突破策略");
    expect(result.body).toContain("基于20日均线突破的趋势跟踪策略");

    // 确认 financial_memories 中的策略字段
    const memories = financialStore.getByNotePath(notePath);
    expect(memories.length).toBe(1);
    expect(memories[0].entityType).toBe("strategy");
    expect(memories[0].name).toBe("动量突破策略");
    expect(memories[0].assetClass).toBe("stock");
    expect(memories[0].strategyStatus).toBe("active");
  });

  it("读取不存在的路径 → 抛出 NoteNotFoundError", () => {
    expect(() => store.readNote("投资/不存在.md")).toThrow(NoteNotFoundError);
    expect(() => store.readNote("投资/不存在.md")).toThrow(/Note not found/);
  });
});
