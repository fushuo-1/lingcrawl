/**
 * Unit tests for `kb_staleness` MCP tool（issue #119 + #120）。
 *
 * 验证 scan 返回正确的 summary，archive 的软归档 / 硬归档 / 跳过逻辑。
 * 使用内存数据库 + schema.sql 初始化 + 临时目录。
 */
import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { FinancialIndexStore } from "../../../financial/financial-index-store.js";
import { IndexStore } from "../../../kb/index-store.js";
import { FileManager } from "../../../kb/file-manager.js";
import { KnowledgeStore } from "../../../kb/knowledge-store.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerKbStalenessTool } from "../../tools/kb-staleness.js";

/* ------------------------------------------------------------------ */
/*  helpers                                                            */
/* ------------------------------------------------------------------ */

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  const schemaPath = path.resolve(process.cwd(), "src/db/schema.sql");
  const schema = fs.readFileSync(schemaPath, "utf-8");
  db.exec(schema);
  return db;
}

/**
 * 构建金融笔记 frontmatter + body，通过 knowledgeStore.writeNote 写入。
 * updatedAt 由 frontmatter 的 `updated` 字段控制，可以回溯到过去。
 */
function writeFinancialNote(
  ks: KnowledgeStore,
  notePath: string,
  fm: Record<string, unknown>,
  body: string,
): void {
  const lines = ["---"];
  for (const [k, v] of Object.entries(fm)) {
    lines.push(`${k}: ${v}`);
  }
  lines.push("tags: [投资]");
  lines.push("---");
  lines.push("");
  lines.push(body);
  ks.writeNote({ content: lines.join("\n"), path: notePath });
}

/** 回写 updated_at 到 financial_memories 表，模拟"老旧"记忆 */
function backdateFinancialRow(
  db: Database.Database,
  notePath: string,
  updatedTs: number,
): void {
  db.prepare("UPDATE financial_memories SET updated_at = ? WHERE note_path = ?").run(
    updatedTs,
    notePath,
  );
}

interface ToolResult {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}

async function callTool(
  client: Client,
  name: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  return (await client.callTool({ name, arguments: args })) as ToolResult;
}

function parseText(r: ToolResult): unknown {
  return JSON.parse(r.content[0].text);
}

/* ------------------------------------------------------------------ */
/*  setup / teardown                                                   */
/* ------------------------------------------------------------------ */

let db: Database.Database;
let knowledgeStore: KnowledgeStore;
let tmpDir: string;
let client: Client;

beforeEach(async () => {
  db = createTestDb();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kb-staleness-test-"));
  const fileManager = new FileManager(tmpDir);
  const indexStore = new IndexStore(db);
  const financialIndexStore = new FinancialIndexStore(db);
  knowledgeStore = new KnowledgeStore({
    fileManager,
    indexStore,
    financialIndexStore,
  });

  // 创建 MCP server，只注册 kb_staleness 工具
  const { McpServer: McpServerClass } = await import(
    "@modelcontextprotocol/sdk/server/mcp.js"
  );
  const server = new McpServerClass(
    { name: "test", version: "0.0.1" },
    { capabilities: { tools: {}, resources: {} } },
  );
  registerKbStalenessTool(server, knowledgeStore, financialIndexStore);

  client = new Client(
    { name: "test-client", version: "0.0.1" },
    { capabilities: {} },
  );
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([
    client.connect(clientTransport),
    server.connect(serverTransport),
  ]);
});

afterEach(() => {
  if (db.open) db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

/* ------------------------------------------------------------------ */
/*  registration                                                       */
/* ------------------------------------------------------------------ */

describe("kb_staleness — registration", () => {
  it("is registered in tools/list", async () => {
    const { tools } = await client.listTools();
    const tool = tools.find((t) => t.name === "kb_staleness");
    expect(tool).toBeDefined();
  });
});

/* ------------------------------------------------------------------ */
/*  scan                                                               */
/* ------------------------------------------------------------------ */

describe("kb_staleness — scan", () => {
  it("空知识库返回零计数", async () => {
    const result = await callTool(client, "kb_staleness", { action: "scan" });
    expect(result.isError).toBeFalsy();
    const body = parseText(result) as {
      success: boolean;
      summary: { active: number; stale: number; archived: number };
    };
    expect(body.success).toBe(true);
    expect(body.summary).toEqual({ active: 0, stale: 0, archived: 0 });
  });

  it("返回正确的 active/stale/archived 计数", async () => {
    const now = Math.floor(Date.now() / 1000);

    // 写入 3 条 opinion 记忆
    writeFinancialNote(knowledgeStore, "投资/active-opinion.md", {
      entity_type: "opinion",
      ticker: "AAPL",
      direction: "bullish",
      time_horizon: "medium",
      confidence: 4,
      thesis: "Active opinion",
      created: "2025-06-25T00:00:00Z",
      updated: "2025-06-25T00:00:00Z",
    }, "# Active opinion\n\nStill fresh.");

    writeFinancialNote(knowledgeStore, "投资/stale-opinion.md", {
      entity_type: "opinion",
      ticker: "TSLA",
      direction: "bearish",
      time_horizon: "short",
      confidence: 2,
      thesis: "Stale opinion",
      created: "2025-01-01T00:00:00Z",
      updated: "2025-01-01T00:00:00Z",
    }, "# Stale opinion\n\nGetting old.");

    writeFinancialNote(knowledgeStore, "投资/archived-opinion.md", {
      entity_type: "opinion",
      ticker: "GOOG",
      direction: "neutral",
      time_horizon: "long",
      confidence: 3,
      thesis: "Archived opinion",
      created: "2024-01-01T00:00:00Z",
      updated: "2024-01-01T00:00:00Z",
    }, "# Archived opinion\n\nVery old.");

    // 回写 updated_at 模拟不同过时程度
    // opinion: soft=30, hard=60
    // active: 5 天前 → active
    backdateFinancialRow(db, "投资/active-opinion.md", now - 5 * 86400);
    // stale: 45 天前 → stale
    backdateFinancialRow(db, "投资/stale-opinion.md", now - 45 * 86400);
    // archived: 90 天前 → archived
    backdateFinancialRow(db, "投资/archived-opinion.md", now - 90 * 86400);

    const result = await callTool(client, "kb_staleness", { action: "scan" });
    expect(result.isError).toBeFalsy();
    const body = parseText(result) as {
      success: boolean;
      items: Array<{ path: string; stage: string }>;
      summary: { active: number; stale: number; archived: number };
    };
    expect(body.success).toBe(true);
    expect(body.summary).toEqual({ active: 1, stale: 1, archived: 1 });
    expect(body.items).toHaveLength(3);

    const byPath = new Map(body.items.map((i) => [i.path, i.stage]));
    expect(byPath.get("投资/active-opinion.md")).toBe("active");
    expect(byPath.get("投资/stale-opinion.md")).toBe("stale");
    expect(byPath.get("投资/archived-opinion.md")).toBe("archived");
  });
});

/* ------------------------------------------------------------------ */
/*  archive — soft (stale)                                             */
/* ------------------------------------------------------------------ */

describe("kb_staleness — archive soft", () => {
  it("对 stale 记忆执行软归档，添加 stale: true 到 frontmatter", async () => {
    const now = Math.floor(Date.now() / 1000);

    writeFinancialNote(knowledgeStore, "投资/stale-soft.md", {
      entity_type: "opinion",
      ticker: "AAPL",
      direction: "bullish",
      time_horizon: "medium",
      confidence: 4,
      thesis: "Will be soft archived",
      created: "2025-01-01T00:00:00Z",
      updated: "2025-01-01T00:00:00Z",
    }, "# Soft archive target\n\nThis will get stale: true.");

    // 45 天前 → opinion stale (soft=30)
    backdateFinancialRow(db, "投资/stale-soft.md", now - 45 * 86400);

    const result = await callTool(client, "kb_staleness", {
      action: "archive",
      paths: ["投资/stale-soft.md"],
    });
    expect(result.isError).toBeFalsy();
    const body = parseText(result) as {
      success: boolean;
      results: Array<{ path: string; action: string }>;
    };
    expect(body.success).toBe(true);
    expect(body.results).toHaveLength(1);
    expect(body.results[0].action).toBe("soft_archived");

    // 验证 frontmatter 已添加 stale: true（frontmatter parser 返回字符串）
    const read = knowledgeStore.readNote("投资/stale-soft.md");
    expect(read.frontmatter.stale).toBe("true");
    // updated 会被 writeNote 刷新为当前时间（writeNote 行为）
    expect(read.frontmatter.updated).toBeDefined();
  });
});

/* ------------------------------------------------------------------ */
/*  archive — hard (archived)                                          */
/* ------------------------------------------------------------------ */

describe("kb_staleness — archive hard", () => {
  it("对 archived 记忆执行硬归档，移动到 _archived/YYYY-MM/", async () => {
    const now = Math.floor(Date.now() / 1000);

    writeFinancialNote(knowledgeStore, "投资/old-position.md", {
      entity_type: "position",
      ticker: "BTC",
      direction: "bullish",
      time_horizon: "long",
      confidence: 3,
      position_status: "holding",
      quantity: 0.5,
      thesis: "Very old position",
      created: "2024-01-01T00:00:00Z",
      updated: "2024-01-01T00:00:00Z",
    }, "# Old BTC Position\n\nHard archive candidate.");

    // position: hard=28, 60 天前 → archived
    backdateFinancialRow(db, "投资/old-position.md", now - 60 * 86400);

    const result = await callTool(client, "kb_staleness", {
      action: "archive",
      paths: ["投资/old-position.md"],
    });
    expect(result.isError).toBeFalsy();
    const body = parseText(result) as {
      success: boolean;
      results: Array<{ path: string; action: string }>;
    };
    expect(body.success).toBe(true);
    expect(body.results).toHaveLength(1);
    expect(body.results[0].action).toBe("hard_archived");

    // 旧路径应已删除
    expect(() => knowledgeStore.readNote("投资/old-position.md")).toThrow();

    // 新路径应存在，带 stale: true + archived: true
    // archivePath 使用 frontmatter.title → name → 路径段 作为文件名
    const nowDate = new Date();
    const ym = `${nowDate.getFullYear()}-${String(nowDate.getMonth() + 1).padStart(2, "0")}`;
    const expectedNewPath = `投资/_archived/${ym}/old-position.md`;
    const newRead = knowledgeStore.readNote(expectedNewPath);
    expect(newRead.frontmatter.stale).toBe("true");
    expect(newRead.frontmatter.archived).toBe("true");
  });
});

/* ------------------------------------------------------------------ */
/*  archive — skip active                                              */
/* ------------------------------------------------------------------ */

describe("kb_staleness — archive skip", () => {
  it("跳过 active 记忆", async () => {
    const now = Math.floor(Date.now() / 1000);

    writeFinancialNote(knowledgeStore, "投资/fresh.md", {
      entity_type: "opinion",
      ticker: "NVDA",
      direction: "bullish",
      time_horizon: "long",
      confidence: 5,
      thesis: "Still active",
      created: "2025-06-25T00:00:00Z",
      updated: "2025-06-25T00:00:00Z",
    }, "# Fresh opinion\n\nNot stale yet.");

    // 5 天前 → active (opinion soft=30)
    backdateFinancialRow(db, "投资/fresh.md", now - 5 * 86400);

    const result = await callTool(client, "kb_staleness", {
      action: "archive",
      paths: ["投资/fresh.md"],
    });
    expect(result.isError).toBeFalsy();
    const body = parseText(result) as {
      success: boolean;
      results: Array<{ path: string; action: string; reason?: string }>;
    };
    expect(body.results[0].action).toBe("skipped");
    expect(body.results[0].reason).toBe("not stale");
  });

  it("跳过 lesson 类型", async () => {
    writeFinancialNote(knowledgeStore, "投资/lesson.md", {
      entity_type: "lesson",
      title: "FOMO 教训",
      lesson_category: "mistake",
      lesson: "不要追涨杀跌",
      created: "2020-01-01T00:00:00Z",
      updated: "2020-01-01T00:00:00Z",
    }, "# FOMO 教训\n\n永不过时的教训。");

    const result = await callTool(client, "kb_staleness", {
      action: "archive",
      paths: ["投资/lesson.md"],
    });
    expect(result.isError).toBeFalsy();
    const body = parseText(result) as {
      success: boolean;
      results: Array<{ path: string; action: string; reason?: string }>;
    };
    expect(body.results[0].action).toBe("skipped");
    expect(body.results[0].reason).toBe("lesson never stale");
  });

  it("archive 空 paths 返回错误", async () => {
    const result = await callTool(client, "kb_staleness", {
      action: "archive",
      paths: [],
    });
    expect(result.isError).toBe(true);
  });

  it("archive 不传 paths 返回错误", async () => {
    const result = await callTool(client, "kb_staleness", {
      action: "archive",
    });
    expect(result.isError).toBe(true);
  });
});
