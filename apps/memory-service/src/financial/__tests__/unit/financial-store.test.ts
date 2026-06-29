/**
 * Unit tests for FinancialStore (issue #99).
 *
 * Uses in-memory SQLite + applySchema to verify CRUD and search.
 */
import Database from "better-sqlite3";
import { applySchema } from "../../../db/migrations.js";
import { FinancialStore } from "../../financial-store.js";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  applySchema(db);
  return db;
}

let db: Database.Database;
let store: FinancialStore;

beforeEach(() => {
  db = createTestDb();
  store = new FinancialStore(db);
});

afterEach(() => {
  if (db.open) db.close();
});

/* ----- create ----- */

describe("FinancialStore.create", () => {
  it("creates an opinion with auto-generated id", () => {
    const memory = store.create({
      entityType: "opinion",
      ticker: "AAPL",
      direction: "bullish",
      timeHorizon: "medium",
      confidence: 4,
      thesis: "Strong earnings growth",
    });

    expect(memory.id).toBeDefined();
    expect(memory.entityType).toBe("opinion");
    expect(memory.ticker).toBe("AAPL");
    expect(memory.direction).toBe("bullish");
    expect(memory.confidence).toBe(4);
    expect(memory.tags).toEqual([]);
    expect(memory.createdAt).toBeGreaterThan(0);
    expect(memory.updatedAt).toBeGreaterThan(0);
  });

  it("creates an opinion with explicit id", () => {
    const memory = store.create({
      id: "test-id-123",
      entityType: "opinion",
      ticker: "BTC",
      direction: "bearish",
      timeHorizon: "short",
      confidence: 2,
      thesis: "Regulatory headwinds",
    });

    expect(memory.id).toBe("test-id-123");
  });

  it("creates an opinion with tags", () => {
    const memory = store.create({
      entityType: "opinion",
      ticker: "TSLA",
      direction: "neutral",
      timeHorizon: "long",
      confidence: 3,
      thesis: "Mixed signals",
      tags: ["ev", "musk"],
    });

    expect(memory.tags).toEqual(["ev", "musk"]);
  });

  it("creates a strategy entity", () => {
    const memory = store.create({
      entityType: "strategy",
      name: "RSI Momentum",
      assetClass: "stock",
      rules: "Buy when RSI > 70, sell when RSI < 30",
      strategyStatus: "draft",
    });

    expect(memory.entityType).toBe("strategy");
    expect(memory.name).toBe("RSI Momentum");
    expect(memory.assetClass).toBe("stock");
  });

  it("creates a position entity", () => {
    const memory = store.create({
      entityType: "position",
      ticker: "NVDA",
      positionStatus: "holding",
      quantity: 50,
      costBasis: 450.0,
      targetPrice: 600.0,
      stopLoss: 400.0,
    });

    expect(memory.entityType).toBe("position");
    expect(memory.quantity).toBe(50);
    expect(memory.costBasis).toBe(450.0);
  });

  it("creates a lesson entity", () => {
    const memory = store.create({
      entityType: "lesson",
      title: "Don't chase pumps",
      lessonCategory: "mistake",
      lesson: "Chasing pumps leads to losses",
      scenario: "2021 crypto bull run",
    });

    expect(memory.entityType).toBe("lesson");
    expect(memory.title).toBe("Don't chase pumps");
    expect(memory.lessonCategory).toBe("mistake");
  });
});

/* ----- getById ----- */

describe("FinancialStore.getById", () => {
  it("returns null for non-existent id", () => {
    expect(store.getById("nonexistent")).toBeNull();
  });

  it("retrieves a created memory", () => {
    const created = store.create({
      entityType: "opinion",
      ticker: "MSFT",
      direction: "bullish",
      timeHorizon: "medium",
      confidence: 5,
      thesis: "AI leadership",
    });

    const retrieved = store.getById(created.id);
    expect(retrieved).not.toBeNull();
    expect(retrieved!.ticker).toBe("MSFT");
    expect(retrieved!.thesis).toBe("AI leadership");
  });
});

/* ----- update ----- */

describe("FinancialStore.update", () => {
  it("updates thesis and confidence", () => {
    const created = store.create({
      entityType: "opinion",
      ticker: "GOOGL",
      direction: "bullish",
      timeHorizon: "long",
      confidence: 3,
      thesis: "Original thesis",
    });

    const updated = store.update(created.id, {
      thesis: "Updated thesis",
      confidence: 5,
    });

    expect(updated.thesis).toBe("Updated thesis");
    expect(updated.confidence).toBe(5);
    expect(updated.ticker).toBe("GOOGL"); // unchanged
    expect(updated.updatedAt).toBeGreaterThanOrEqual(created.updatedAt);
  });

  it("updates tags", () => {
    const created = store.create({
      entityType: "opinion",
      ticker: "AMZN",
      direction: "neutral",
      timeHorizon: "medium",
      confidence: 3,
      thesis: "Cloud growth",
      tags: ["cloud"],
    });

    const updated = store.update(created.id, { tags: ["cloud", "aws"] });
    expect(updated.tags).toEqual(["cloud", "aws"]);
  });

  it("throws for non-existent id", () => {
    expect(() => store.update("nonexistent", { thesis: "x" })).toThrow(
      /not found/,
    );
  });

  it("throws when no fields provided", () => {
    const created = store.create({
      entityType: "opinion",
      ticker: "META",
      direction: "bullish",
      timeHorizon: "short",
      confidence: 4,
      thesis: "Metaverse",
    });

    expect(() => store.update(created.id, {})).toThrow(/No fields to update/);
  });
});

/* ----- delete ----- */

describe("FinancialStore.delete", () => {
  it("deletes an existing memory and returns true", () => {
    const created = store.create({
      entityType: "opinion",
      ticker: "NFLX",
      direction: "bearish",
      timeHorizon: "short",
      confidence: 2,
      thesis: "Subscriber loss",
    });

    expect(store.delete(created.id)).toBe(true);
    expect(store.getById(created.id)).toBeNull();
  });

  it("returns false for non-existent id", () => {
    expect(store.delete("nonexistent")).toBe(false);
  });
});

/* ----- search ----- */

describe("FinancialStore.search", () => {
  beforeEach(() => {
    store.create({
      entityType: "opinion",
      ticker: "AAPL",
      direction: "bullish",
      timeHorizon: "medium",
      confidence: 4,
      thesis: "Strong earnings growth",
      market: "NASDAQ",
      tags: ["tech"],
    });
    store.create({
      entityType: "opinion",
      ticker: "AAPL",
      direction: "bearish",
      timeHorizon: "short",
      confidence: 2,
      thesis: "Supply chain issues",
      market: "NASDAQ",
      tags: ["tech", "china"],
    });
    store.create({
      entityType: "opinion",
      ticker: "BTC",
      direction: "bullish",
      timeHorizon: "long",
      confidence: 3,
      thesis: "Halving cycle",
      market: "Crypto",
      tags: ["crypto"],
    });
    store.create({
      entityType: "strategy",
      name: "RSI Momentum",
      assetClass: "stock",
      rules: "Buy RSI > 70",
      strategyStatus: "active",
      tags: ["momentum"],
    });
    store.create({
      entityType: "lesson",
      title: "Don't FOMO",
      lessonCategory: "mistake",
      lesson: "FOMO leads to losses",
      tags: ["psychology"],
    });
  });

  it("returns all memories with empty filters", () => {
    const result = store.search();
    expect(result.total).toBe(5);
    expect(result.count).toBe(5);
    expect(result.memories.length).toBe(5);
  });

  it("filters by entity_type", () => {
    const result = store.search({ entityTypes: ["opinion"] });
    expect(result.total).toBe(3);
    expect(result.memories.every((m) => m.entityType === "opinion")).toBe(true);
  });

  it("filters by multiple entity_types", () => {
    const result = store.search({ entityTypes: ["opinion", "strategy"] });
    expect(result.total).toBe(4);
  });

  it("filters by ticker", () => {
    const result = store.search({ ticker: "AAPL" });
    expect(result.total).toBe(2);
  });

  it("filters by direction", () => {
    const result = store.search({ direction: "bullish" });
    expect(result.total).toBe(2);
  });

  it("filters by market", () => {
    const result = store.search({ market: "Crypto" });
    expect(result.total).toBe(1);
    expect(result.memories[0].ticker).toBe("BTC");
  });

  it("filters by tags", () => {
    const result = store.search({ tags: ["tech"] });
    expect(result.total).toBe(2);
  });

  it("filters by free-text query", () => {
    const result = store.search({ query: "earnings" });
    expect(result.total).toBe(1);
    expect(result.memories[0].ticker).toBe("AAPL");
  });

  it("combines multiple filters", () => {
    const result = store.search({
      entityTypes: ["opinion"],
      ticker: "AAPL",
      direction: "bullish",
    });
    expect(result.total).toBe(1);
    expect(result.memories[0].direction).toBe("bullish");
  });

  it("respects limit", () => {
    const result = store.search({}, { limit: 2 });
    expect(result.count).toBe(2);
    expect(result.total).toBe(5);
  });

  it("respects offset", () => {
    const result = store.search({}, { limit: 2, offset: 4 });
    expect(result.count).toBe(1);
    expect(result.total).toBe(5);
  });

  it("sorts by updated_desc by default", () => {
    const result = store.search({}, { limit: 3 });
    // Later created items should have higher updated_at
    expect(result.memories[0].updatedAt).toBeGreaterThanOrEqual(
      result.memories[1].updatedAt,
    );
  });

  it("sorts by created_desc when requested", () => {
    const result = store.search({}, { sortBy: "created_desc" });
    expect(result.memories[0].createdAt).toBeGreaterThanOrEqual(
      result.memories[1].createdAt,
    );
  });
});
