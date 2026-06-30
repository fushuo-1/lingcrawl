/**
 * 集成测试：kb_delete CASCADE 清理 + kb_sync 金融感知（issue #111）
 *
 * 验证 KnowledgeStore.deleteNote 能清理 financial_memories 表中的 note_path，
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
  return fs.mkdtempSync(path.join(os.tmpdir(), "kb-fin-test-"));
}

describe("KnowledgeStore 金融记忆 CASCADE 清理 (issue #111)", () => {
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

  it("写入金融笔记 → deleteNote → financial_memories 中对应记录的 note_path 清空", () => {
    const { path: notePath } = store.writeNote({
      content: "# TSLA 看空\n\n估值过高。",
      path: "投资/TSLA-opinion.md",
    });

    const memory = financialStore.create({
      entityType: "opinion",
      ticker: "TSLA",
      direction: "bearish",
      timeHorizon: "short",
      confidence: 3,
      thesis: "估值过高",
      notePath,
    });

    // 确认关联已建立
    expect(financialStore.getByNotePath(notePath).length).toBe(1);

    // 删除笔记
    store.deleteNote(notePath);

    // financial_memories 中记录仍存在，但 note_path 应被清空
    const after = financialStore.getById(memory.id);
    expect(after).not.toBeNull();
    expect(after!.notePath).toBeUndefined();

    // 通过旧路径查找应返回空
    expect(financialStore.getByNotePath(notePath).length).toBe(0);
  });

  it("写入金融笔记 → 模拟重命名 → financial_memories 路径已更新", () => {
    const { path: oldPath } = store.writeNote({
      content: "# NVDA 趋势\n\nAI 芯片需求强劲。",
      path: "投资/NVDA-trend.md",
    });

    const memory = financialStore.create({
      entityType: "opinion",
      ticker: "NVDA",
      direction: "bullish",
      timeHorizon: "long",
      confidence: 5,
      thesis: "AI 芯片需求强劲",
      notePath: oldPath,
    });

    // 模拟重命名：删除旧路径索引，写入新路径
    const content = fileManager.read(oldPath);
    const renameTarget = "投资/NVDA-重命名.md";
    fileManager.delete(oldPath);
    fileManager.write(renameTarget, content);

    // syncIndex 应检测到重命名并更新 financial_memories
    const result = store.syncIndex();
    expect(result.renamed).toBe(1);

    // 从磁盘获取实际路径（Windows 下 path.join 会产生反斜杠）
    const diskPaths = fileManager.listAllMarkdown().map((e) => e.relativePath);
    const newPath = diskPaths.find((p) => p.includes("NVDA-重命名"));
    expect(newPath).toBeDefined();

    // financial_memories 中路径已更新
    const after = financialStore.getById(memory.id);
    expect(after).not.toBeNull();
    expect(after!.notePath).toBe(newPath);

    // 旧路径已无记录
    expect(financialStore.getByNotePath(oldPath).length).toBe(0);
    // 新路径有记录
    expect(financialStore.getByNotePath(newPath!).length).toBe(1);
  });

  it("写入普通笔记 → deleteNote → financial_memories 不受影响", () => {
    const { path: notePath } = store.writeNote({
      content: "# 普通笔记\n\n没有任何金融关联。",
      tags: ["AI"],
    });

    // 确认 financial_memories 本来就没有记录
    expect(financialStore.getByNotePath(notePath).length).toBe(0);

    // 删除笔记不应报错
    const deleted = store.deleteNote(notePath);
    expect(deleted).toBe(true);

    // financial_memories 仍无记录
    expect(financialStore.getByNotePath(notePath).length).toBe(0);

    // 笔记已从磁盘和索引中移除
    expect(fileManager.exists(notePath)).toBe(false);
    expect(indexStore.getNoteMeta(notePath)).toBeNull();
  });
});
