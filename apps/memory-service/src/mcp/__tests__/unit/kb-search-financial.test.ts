/**
 * Unit tests for `kb_search` 金融记忆结构化过滤（issue #110）。
 *
 * 验证 kb_search 工具在传入金融过滤参数（entity_type, ticker, direction, market）时：
 *  - 只返回金融索引中匹配的笔记
 *  - 与 FTS5 query 取交集
 *  - 无金融过滤参数时行为不变
 *
 * 使用内存数据库 + schema.sql 初始化（不 import migrations.ts）。
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
import { registerKbSearchTool } from "../../tools/kb-search.js";

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
let indexStore: IndexStore;
let financialIndexStore: FinancialIndexStore;
let knowledgeStore: KnowledgeStore;
let tmpDir: string;
let client: Client;
let server: McpServer;

beforeEach(async () => {
  db = createTestDb();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kb-search-fin-"));
  const fileManager = new FileManager(tmpDir);
  indexStore = new IndexStore(db);
  financialIndexStore = new FinancialIndexStore(db);
  knowledgeStore = new KnowledgeStore({
    fileManager,
    indexStore,
    financialIndexStore,
  });

  // 创建 MCP server，只注册 kb_search 工具
  const { McpServer: McpServerClass } = await import(
    "@modelcontextprotocol/sdk/server/mcp.js"
  );
  server = new McpServerClass(
    { name: "test", version: "0.0.1" },
    { capabilities: { tools: {}, resources: {} } },
  );
  registerKbSearchTool(server, indexStore, financialIndexStore);

  client = new Client(
    { name: "test-client", version: "0.0.1" },
    { capabilities: {} },
  );
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([
    client.connect(clientTransport),
    server.connect(serverTransport),
  ]);

  // 写入金融记忆
  writeFinancialNote("投资/AAPL-观点.md", {
    entity_type: "opinion",
    ticker: "AAPL",
    direction: "bullish",
    time_horizon: "medium",
    confidence: 4,
    thesis: "Apple is undervalued",
  }, "# AAPL 看多观点\n\nApple 估值偏低，值得投资。");

  writeFinancialNote("投资/TSLA-观点.md", {
    entity_type: "opinion",
    ticker: "TSLA",
    direction: "bearish",
    time_horizon: "short",
    confidence: 2,
    thesis: "Tesla is overvalued",
  }, "# TSLA 看空观点\n\nTesla 估值过高。");

  writeFinancialNote("投资/RSI-策略.md", {
    entity_type: "strategy",
    name: "RSI动量策略",
    asset_class: "stock",
    rules: "RSI < 30 买入, RSI > 70 卖出",
    strategy_status: "active",
  }, "# RSI 动量策略\n\n使用 RSI 指标进行交易。");

  writeFinancialNote("投资/FOMO-教训.md", {
    entity_type: "lesson",
    title: "不要追涨杀跌",
    lesson_category: "mistake",
    lesson: "在高位追入导致亏损 30%",
  }, "# 不要追涨杀跌\n\n教训：避免 FOMO 情绪。");

  // 写入普通笔记（非金融）
  knowledgeStore.writeNote({
    content: "---\ntags: [redis, 性能]\n---\n\n# Redis 缓存策略\n\nRedis 是高性能缓存方案。",
    path: "技术/Redis缓存.md",
  });

  knowledgeStore.writeNote({
    content: "---\ntags: [docker, devops]\n---\n\n# Docker 部署\n\nDocker compose 配置说明。",
    path: "技术/Docker部署.md",
  });
});

afterEach(() => {
  if (db.open) db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

/* ---- 辅助：写入金融笔记 ---- */

function writeFinancialNote(
  notePath: string,
  fm: Record<string, unknown>,
  body: string,
): void {
  const lines = ["---"];
  for (const [k, v] of Object.entries(fm)) {
    lines.push(`${k}: ${v}`);
  }
  lines.push("tags: [投资]");
  lines.push("created: 2025-01-01T00:00:00Z");
  lines.push("updated: 2025-06-01T00:00:00Z");
  lines.push("---");
  lines.push("");
  lines.push(body);
  knowledgeStore.writeNote({
    content: lines.join("\n"),
    path: notePath,
  });
}

/* ---- 辅助：调用 kb_search ---- */

async function callSearch(args: Record<string, unknown>): Promise<{
  success: boolean;
  query: string;
  count: number;
  hits: Array<{ path: string; title: string; tags: string[]; snippet: string; score: number }>;
}> {
  const result = (await client.callTool({
    name: "kb_search",
    arguments: args,
  })) as { content: Array<{ type: string; text: string }>; isError?: boolean };
  expect(result.isError).toBeFalsy();
  return JSON.parse(result.content[0].text);
}

/* ----- 按 entity_type 过滤 ----- */

describe("kb_search 金融过滤 — entity_type", () => {
  it("entity_type=opinion → 只返回 opinion 类型的金融记忆", async () => {
    // query 匹配所有金融笔记内容中含有的"投资"
    const body = await callSearch({
      query: "投资",
      entity_type: "opinion",
    });
    expect(body.count).toBe(2);
    const paths = body.hits.map((h) => h.path);
    expect(paths).toContain("投资/AAPL-观点.md");
    expect(paths).toContain("投资/TSLA-观点.md");
    // 不应包含 strategy 或 lesson
    expect(paths).not.toContain("投资/RSI-策略.md");
    expect(paths).not.toContain("投资/FOMO-教训.md");
  });

  it("entity_type=strategy → 只返回 strategy 类型", async () => {
    const body = await callSearch({
      query: "RSI",
      entity_type: "strategy",
    });
    expect(body.count).toBe(1);
    expect(body.hits[0].path).toBe("投资/RSI-策略.md");
  });
});

/* ----- 按 ticker 过滤 ----- */

describe("kb_search 金融过滤 — ticker", () => {
  it("ticker=AAPL → 只返回 AAPL 相关记忆", async () => {
    const body = await callSearch({
      query: "投资 OR 观点 OR AAPL OR 策略 OR 教训 OR Redis OR Docker",
      ticker: "AAPL",
    });
    expect(body.count).toBe(1);
    expect(body.hits[0].path).toBe("投资/AAPL-观点.md");
  });

  it("ticker=TSLA → 只返回 TSLA 相关记忆", async () => {
    const body = await callSearch({
      query: "投资 OR 观点 OR TSLA OR 策略 OR 教训 OR Redis OR Docker",
      ticker: "TSLA",
    });
    expect(body.count).toBe(1);
    expect(body.hits[0].path).toBe("投资/TSLA-观点.md");
  });
});

/* ----- entity_type + ticker 组合过滤 ----- */

describe("kb_search 金融过滤 — 组合", () => {
  it("entity_type=opinion + ticker=AAPL → 精确匹配单条", async () => {
    const body = await callSearch({
      query: "投资 OR 观点 OR AAPL OR 策略 OR 教训 OR Redis OR Docker",
      entity_type: "opinion",
      ticker: "AAPL",
    });
    expect(body.count).toBe(1);
    expect(body.hits[0].path).toBe("投资/AAPL-观点.md");
  });

  it("entity_type=opinion + direction=bearish → 只返回看空 opinion", async () => {
    const body = await callSearch({
      query: "投资 OR 观点 OR 策略 OR 教训 OR Redis OR Docker",
      entity_type: "opinion",
      direction: "bearish",
    });
    expect(body.count).toBe(1);
    expect(body.hits[0].path).toBe("投资/TSLA-观点.md");
  });
});

/* ----- 无金融过滤参数 → 行为不变 ----- */

describe("kb_search 无金融过滤", () => {
  it("无金融过滤参数 → 返回所有匹配的笔记（金融 + 非金融）", async () => {
    // "Redis" 匹配技术笔记，"RSI" 匹配策略笔记
    const body = await callSearch({
      query: "Redis OR RSI",
    });
    const paths = body.hits.map((h) => h.path);
    expect(paths).toContain("技术/Redis缓存.md");
    expect(paths).toContain("投资/RSI-策略.md");
  });
});

/* ----- 金融过滤 + FTS5 query 组合 ----- */

describe("kb_search 金融过滤 + FTS5 组合", () => {
  it("金融过滤 + FTS5 query 组合 → 两个条件同时满足", async () => {
    // query 匹配 "Apple"（AAPL 笔记内容中有），entity_type=opinion
    const body = await callSearch({
      query: "Apple",
      entity_type: "opinion",
    });
    // 只有 AAPL 笔记包含 "Apple" 且是 opinion
    expect(body.count).toBe(1);
    expect(body.hits[0].path).toBe("投资/AAPL-观点.md");
  });

  it("FTS5 query 匹配非金融笔记 + 金融过滤 → 交集为空", async () => {
    const body = await callSearch({
      query: "Docker",
      entity_type: "opinion",
    });
    // Docker 笔记不是 opinion 类型 → 交集为空
    expect(body.count).toBe(0);
  });

  it("direction=neutral → 匹配无 neutral 记录时返回空", async () => {
    const body = await callSearch({
      query: "投资 OR 观点 OR 策略 OR 教训 OR Redis OR Docker",
      direction: "neutral",
    });
    expect(body.count).toBe(0);
  });
});

/* ----- include_archived 过滤 ----- */

describe("kb_search include_archived 参数", () => {
  it("默认搜索排除 _archived/ 路径下的笔记", async () => {
    // 写入一条 _archived/ 路径的笔记
    knowledgeStore.writeNote({
      content: "---\ntags: [旧笔记]\n---\n\n# Old Archived Note\n\nThis is an archived note about archived content.",
      path: "tech/_archived/old-cache.md",
    });

    // 默认搜索不应返回归档笔记
    const body = await callSearch({ query: "archived" });
    const paths = body.hits.map((h) => h.path);
    expect(paths).not.toContain("tech/_archived/old-cache.md");
  });

  it("include_archived=true 包含 _archived/ 路径下的笔记", async () => {
    // 写入一条 _archived/ 路径的笔记
    knowledgeStore.writeNote({
      content: "---\ntags: [旧笔记]\n---\n\n# Old Archived Note\n\nThis is an archived note about archived content.",
      path: "tech/_archived/old-cache.md",
    });

    const body = await callSearch({ query: "archived", include_archived: true });
    const paths = body.hits.map((h) => h.path);
    expect(paths).toContain("tech/_archived/old-cache.md");
  });

  it("include_archived=false 行为与默认一致（排除归档笔记）", async () => {
    knowledgeStore.writeNote({
      content: "---\ntags: [旧笔记]\n---\n\n# Old Archived Note\n\nThis is an archived note about archived content.",
      path: "tech/_archived/old-cache.md",
    });

    const body = await callSearch({ query: "archived", include_archived: false });
    const paths = body.hits.map((h) => h.path);
    expect(paths).not.toContain("tech/_archived/old-cache.md");
  });
});
