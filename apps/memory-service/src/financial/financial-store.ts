/**
 * FinancialStore — SQLite CRUD layer for financial memories (issue #99).
 *
 * Provides create, update, get, delete, and search for opinion / strategy /
 * position / lesson entities. All methods are synchronous (better-sqlite3).
 */
import crypto from "node:crypto";
import type Database from "better-sqlite3";
import { scoreAndSortMemories } from "./scoring.js";
import type {
  CreateFinancialMemoryInput,
  FinancialMemory,
  SearchFilters,
  SearchOptions,
  SearchResult,
  UpdateFinancialMemoryInput,
} from "./types.js";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

export function rowToFinancialMemory(row: Record<string, unknown>): FinancialMemory {
  return {
    id: row.id as string,
    entityType: row.entity_type as FinancialMemory["entityType"],
    ticker: row.ticker as string | undefined,
    market: row.market as string | undefined,
    direction: row.direction as FinancialMemory["direction"],
    timeHorizon: row.time_horizon as FinancialMemory["timeHorizon"],
    confidence: row.confidence as number | undefined,
    thesis: row.thesis as string | undefined,
    risks: row.risks as string | undefined,
    source: row.source as string | undefined,
    name: row.name as string | undefined,
    assetClass: row.asset_class as FinancialMemory["assetClass"],
    rules: row.rules as string | undefined,
    parameters: row.parameters as string | undefined,
    backtests: row.backtests as string | undefined,
    strategyStatus: row.strategy_status as FinancialMemory["strategyStatus"],
    positionStatus: row.position_status as FinancialMemory["positionStatus"],
    costBasis: row.cost_basis as number | undefined,
    quantity: row.quantity as number | undefined,
    targetPrice: row.target_price as number | undefined,
    stopLoss: row.stop_loss as number | undefined,
    alertConditions: row.alert_conditions as string | undefined,
    positionSizePercent: row.position_size_percent as number | undefined,
    title: row.title as string | undefined,
    lessonCategory: row.lesson_category as FinancialMemory["lessonCategory"],
    scenario: row.scenario as string | undefined,
    lesson: row.lesson as string | undefined,
    tags: JSON.parse((row.tags as string) || "[]") as string[],
    notePath: row.note_path ? (row.note_path as string) : undefined,
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number,
  };
}

/* ------------------------------------------------------------------ */
/*  FinancialStore                                                     */
/* ------------------------------------------------------------------ */

export class FinancialStore {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  /* ---- Create ---- */

  create(input: CreateFinancialMemoryInput): FinancialMemory {
    const id = input.id ?? crypto.randomUUID();
    const tags = JSON.stringify(input.tags ?? []);

    const sql = `
      INSERT INTO financial_memories (
        id, entity_type, ticker, market, direction, time_horizon, confidence,
        thesis, risks, source, name, asset_class, rules, parameters, backtests,
        strategy_status, position_status, cost_basis, quantity, target_price,
        stop_loss, alert_conditions, position_size_percent, title, lesson_category,
        scenario, lesson, tags, note_path, created_at, updated_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch(), unixepoch()
      )
    `;

    this.db.prepare(sql).run(
      id,
      input.entityType,
      input.ticker ?? null,
      input.market ?? null,
      input.direction ?? null,
      input.timeHorizon ?? null,
      input.confidence ?? null,
      input.thesis ?? null,
      input.risks ?? null,
      input.source ?? null,
      input.name ?? null,
      input.assetClass ?? null,
      input.rules ?? null,
      input.parameters ?? null,
      input.backtests ?? null,
      input.strategyStatus ?? null,
      input.positionStatus ?? null,
      input.costBasis ?? null,
      input.quantity ?? null,
      input.targetPrice ?? null,
      input.stopLoss ?? null,
      input.alertConditions ?? null,
      input.positionSizePercent ?? null,
      input.title ?? null,
      input.lessonCategory ?? null,
      input.scenario ?? null,
      input.lesson ?? null,
      tags,
      input.notePath ?? null,
    );

    const row = this.db
      .prepare("SELECT * FROM financial_memories WHERE id = ?")
      .get(id) as Record<string, unknown>;

    return rowToFinancialMemory(row);
  }

  /* ---- Update ---- */

  update(id: string, input: UpdateFinancialMemoryInput): FinancialMemory {
    const sets: string[] = [];
    const params: unknown[] = [];

    const add = (col: string, val: unknown) => {
      if (val !== undefined) {
        sets.push(`${col} = ?`);
        params.push(val === null ? null : val);
      }
    };

    add("ticker", input.ticker);
    add("market", input.market);
    add("direction", input.direction);
    add("time_horizon", input.timeHorizon);
    add("confidence", input.confidence);
    add("thesis", input.thesis);
    add("risks", input.risks);
    add("source", input.source);
    add("name", input.name);
    add("asset_class", input.assetClass);
    add("rules", input.rules);
    add("parameters", input.parameters);
    add("backtests", input.backtests);
    add("strategy_status", input.strategyStatus);
    add("position_status", input.positionStatus);
    add("cost_basis", input.costBasis);
    add("quantity", input.quantity);
    add("target_price", input.targetPrice);
    add("stop_loss", input.stopLoss);
    add("alert_conditions", input.alertConditions);
    add("position_size_percent", input.positionSizePercent);
    add("title", input.title);
    add("lesson_category", input.lessonCategory);
    add("scenario", input.scenario);
    add("lesson", input.lesson);
    add("note_path", input.notePath);

    if (input.tags !== undefined) {
      sets.push("tags = ?");
      params.push(JSON.stringify(input.tags));
    }

    if (sets.length === 0) {
      throw new Error("No fields to update");
    }

    sets.push("updated_at = unixepoch()");
    params.push(id);

    const sql = `UPDATE financial_memories SET ${sets.join(", ")} WHERE id = ?`;
    const info = this.db.prepare(sql).run(...params);

    if (info.changes === 0) {
      throw new Error(`Financial memory not found: ${id}`);
    }

    const row = this.db
      .prepare("SELECT * FROM financial_memories WHERE id = ?")
      .get(id) as Record<string, unknown>;

    return rowToFinancialMemory(row);
  }

  /* ---- Get ---- */

  getById(id: string): FinancialMemory | null {
    const row = this.db
      .prepare("SELECT * FROM financial_memories WHERE id = ?")
      .get(id) as Record<string, unknown> | undefined;

    return row ? rowToFinancialMemory(row) : null;
  }

  /* ---- Delete ---- */

  delete(id: string): boolean {
    const info = this.db
      .prepare("DELETE FROM financial_memories WHERE id = ?")
      .run(id);
    return info.changes > 0;
  }

  /* ---- Note link ---- */

  linkNote(id: string, notePath: string | null): FinancialMemory {
    const info = this.db
      .prepare("UPDATE financial_memories SET note_path = ?, updated_at = unixepoch() WHERE id = ?")
      .run(notePath, id);

    if (info.changes === 0) {
      throw new Error(`Financial memory not found: ${id}`);
    }

    const row = this.db
      .prepare("SELECT * FROM financial_memories WHERE id = ?")
      .get(id) as Record<string, unknown>;

    return rowToFinancialMemory(row);
  }

  getByNotePath(notePath: string): FinancialMemory[] {
    const rows = this.db
      .prepare("SELECT * FROM financial_memories WHERE note_path = ?")
      .all(notePath) as Record<string, unknown>[];
    return rows.map(rowToFinancialMemory);
  }

  updateNotePath(oldPath: string, newPath: string): number {
    const info = this.db
      .prepare("UPDATE financial_memories SET note_path = ?, updated_at = unixepoch() WHERE note_path = ?")
      .run(newPath, oldPath);
    return info.changes;
  }

  clearNotePath(notePath: string): number {
    const info = this.db
      .prepare("UPDATE financial_memories SET note_path = NULL, updated_at = unixepoch() WHERE note_path = ?")
      .run(notePath);
    return info.changes;
  }

  /* ---- Search ---- */

  search(filters: SearchFilters = {}, options: SearchOptions = {}): SearchResult {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filters.entityTypes?.length) {
      const placeholders = filters.entityTypes.map(() => "?").join(", ");
      conditions.push(`entity_type IN (${placeholders})`);
      params.push(...filters.entityTypes);
    }

    if (filters.ticker) {
      conditions.push("ticker = ?");
      params.push(filters.ticker);
    }

    if (filters.market) {
      conditions.push("market = ?");
      params.push(filters.market);
    }

    if (filters.direction) {
      conditions.push("direction = ?");
      params.push(filters.direction);
    }

    if (filters.tags?.length) {
      const tagConds = filters.tags.map(() => "tags LIKE ?");
      conditions.push(`(${tagConds.join(" OR ")})`);
      for (const t of filters.tags) {
        params.push(`%"${t}"%`);
      }
    }

    if (filters.query) {
      conditions.push("(ticker LIKE ? OR thesis LIKE ? OR title LIKE ? OR name LIKE ?)");
      const like = `%${filters.query}%`;
      params.push(like, like, like, like);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    // Count total
    const countSql = `SELECT COUNT(*) as total FROM financial_memories ${where}`;
    const totalRow = this.db.prepare(countSql).get(...params) as { total: number };
    const total = totalRow.total;

    // Fetch results
    const limit = options.limit ?? 20;
    const offset = options.offset ?? 0;

    let orderBy = "updated_at DESC";
    if (options.sortBy === "created_desc") {
      orderBy = "created_at DESC";
    }

    const sql = `
      SELECT * FROM financial_memories
      ${where}
      ORDER BY ${orderBy}
      LIMIT ? OFFSET ?
    `;
    const rows = this.db
      .prepare(sql)
      .all(...params, limit, offset) as Record<string, unknown>[];

    const memories = rows.map(rowToFinancialMemory);

    if (options.sortBy === "relevance") {
      const nowSeconds = Math.floor(Date.now() / 1000);
      const scored = scoreAndSortMemories(memories, filters.query, nowSeconds);
      const relevanceScores: Record<string, number> = {};
      for (const s of scored) {
        relevanceScores[s.memory.id] = s.relevanceScore;
      }
      return {
        total,
        count: scored.length,
        memories: scored.map((s) => s.memory),
        relevanceScores,
      };
    }

    return {
      total,
      count: memories.length,
      memories,
    };
  }
}
