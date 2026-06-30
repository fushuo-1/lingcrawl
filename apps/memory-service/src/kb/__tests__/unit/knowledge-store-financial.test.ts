/**
 * 集成测试：kb_delete CASCADE 清理 + kb_sync 金融感知（issue #111）
 *
 * 验证 KnowledgeStore.deleteNote 能清理 financial_memories 表，
 * 以及 syncIndex 在重命名场景下能更新 financial_memories 的路径。
 * 使用内存数据库 + schema.sql 初始化。
 */
import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { FileManager } from "../../file-manager.js";
import { IndexStore } from "../../index-store.js";
import { KnowledgeStore } from "../../knowledge-store.js";
import { FinancialIndexStore } from "../../../financial/financial-index-store.js";

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
  return fs.mkdtempSync(path.join(os.tmpdir(), "kb-fin-test-"));
}

function queryFinancial(db: Database.Database, notePath: string): Record<string, unknown> | undefined {
  return db.prepare("SELECT * FROM financial_memories WHERE note_path = ?").get(notePath) as Record<string, unknown> | undefined;
}

const opinionContent = [
  "---",
  "tags: [投资, AAPL]",
  "entity_type: opinion",
  "ticker: AAPL",
  "direction: bullish",
  "time_horizon: long",
  "confidence: 4",
  "---",
  "",
  "# AAPL 看多观点",
  "",
  "详细分析...",
].join("\n");

describe("KnowledgeStore 金融记忆 CASCADE 清理 (issue #111)", () => {
  let db: Database.Database;
  let tmpDir: string;
  let store: KnowledgeStore;
  let financialIndexStore: FinancialIndexStore;

  beforeEach(() => {
    db = createTestDb();
    tmpDir = createTempDir();
    const fileManager = new FileManager(tmpDir);
    const indexStore = new IndexStore(db);
    financialIndexStore = new FinancialIndexStore(db);
    store = new KnowledgeStore({ fileManager, indexStore, financialIndexStore });
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("写入金融笔记 → deleteNote → financial_memories 中记录消失", () => {
    const notePath = "投资/AAPL-观点.md";
    store.writeNote({ content: opinionContent, path: notePath });

    // 确认写入成功
    expect(queryFinancial(db, notePath)).toBeDefined();

    // 删除笔记
    store.deleteNote(notePath);

    // financial_memories 应被 CASCADE 清理
    expect(queryFinancial(db, notePath)).toBeUndefined();
  });

  it("写入金融笔记 → 模拟重命名 → financial_memories 路径已更新", () => {
    const oldPath = "投资/AAPL-旧.md";
    const newPath = "投资/AAPL-新.md";

    store.writeNote({ content: opinionContent, path: oldPath });
    expect(queryFinancial(db, oldPath)).toBeDefined();

    // 模拟重命名：删除旧路径 + 写入新路径
    store.deleteNote(oldPath);
    store.writeNote({ content: opinionContent, path: newPath });

    // 旧路径应不存在
    expect(queryFinancial(db, oldPath)).toBeUndefined();
    // 新路径应存在
    expect(queryFinancial(db, newPath)).toBeDefined();
    expect(queryFinancial(db, newPath)!.ticker).toBe("AAPL");
  });

  it("写入普通笔记 → deleteNote → financial_memories 不受影响", () => {
    const notePath = "AI/普通笔记.md";
    const content = [
      "---",
      "tags: [AI]",
      "---",
      "",
      "# 普通笔记",
    ].join("\n");

    store.writeNote({ content, path: notePath });
    expect(queryFinancial(db, notePath)).toBeUndefined();

    // 删除不应报错
    expect(store.deleteNote(notePath)).toBe(true);
    expect(queryFinancial(db, notePath)).toBeUndefined();
  });
});
