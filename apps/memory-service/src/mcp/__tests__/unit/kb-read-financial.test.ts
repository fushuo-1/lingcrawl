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
  return fs.mkdtempSync(path.join(os.tmpdir(), "kb-read-fin-test-"));
}

describe("kb_read 金融记忆读取 (issue #109)", () => {
  let db: Database.Database;
  let tmpDir: string;
  let store: KnowledgeStore;

  beforeEach(() => {
    db = createTestDb();
    tmpDir = createTempDir();
    const fileManager = new FileManager(tmpDir);
    const indexStore = new IndexStore(db);
    const financialIndexStore = new FinancialIndexStore(db);
    store = new KnowledgeStore({ fileManager, indexStore, financialIndexStore });
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("读取 opinion 金融记忆 → frontmatter 包含 entity_type, ticker, direction 等", () => {
    const content = [
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

    store.writeNote({ content, path: "投资/AAPL-看多.md" });

    const result = store.readNote("投资/AAPL-看多.md");
    expect(result.frontmatter.entity_type).toBe("opinion");
    expect(result.frontmatter.ticker).toBe("AAPL");
    expect(result.frontmatter.direction).toBe("bullish");
    expect(result.frontmatter.time_horizon).toBe("long");
    expect(result.frontmatter.confidence).toBe(4);
    expect(result.body).toContain("# AAPL 看多观点");
  });

  it("读取 strategy 记录 → frontmatter 包含 name, asset_class, strategy_status", () => {
    const content = [
      "---",
      "tags: [投资]",
      "entity_type: strategy",
      "name: RSI策略",
      "asset_class: stock",
      "strategy_status: active",
      "---",
      "",
      "# RSI 策略",
      "",
      "策略详情...",
    ].join("\n");

    store.writeNote({ content, path: "投资/RSI-策略.md" });

    const result = store.readNote("投资/RSI-策略.md");
    expect(result.frontmatter.entity_type).toBe("strategy");
    expect(result.frontmatter.name).toBe("RSI策略");
    expect(result.frontmatter.asset_class).toBe("stock");
    expect(result.frontmatter.strategy_status).toBe("active");
  });

  it("读取不存在的路径 → 抛出 NoteNotFoundError", () => {
    expect(() => store.readNote("不存在/路径.md")).toThrow(NoteNotFoundError);
  });
});
