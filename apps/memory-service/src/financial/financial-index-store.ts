/**
 * FinancialIndexStore — 瘦身索引表 CRUD（issue #107）。
 *
 * 只操作 financial_memories 短字段，长文本存储在 Markdown 笔记中。
 * 替代原 FinancialStore 的索引层。
 */
import type Database from "better-sqlite3";
import { scoreAndSortMemories } from "./scoring.js";
import type { FinancialMemory } from "./types.js";

/* ------------------------------------------------------------------ */
/*  类型定义                                                            */
/* ------------------------------------------------------------------ */

export interface FinancialSlimFields {
  entityType: string;
  ticker?: string;
  market?: string;
  direction?: string;
  timeHorizon?: string;
  confidence?: number;
  assetClass?: string;
  strategyStatus?: string;
  positionStatus?: string;
  costBasis?: number;
  quantity?: number;
  targetPrice?: number;
  stopLoss?: number;
  positionSizePercent?: number;
  lessonCategory?: string;
  tags?: string[];
  createdAt?: number;
  updatedAt?: number;
}

export interface SearchFilters {
  entityTypes?: string[];
  ticker?: string;
  market?: string;
  direction?: string;
  tags?: string[];
  query?: string;
  sortBy?: "updated_desc" | "created_desc" | "relevance";
  limit?: number;
  offset?: number;
}

export interface SearchResultItem {
  notePath: string;
  entityType: string;
  ticker?: string;
  market?: string;
  direction?: string;
  timeHorizon?: string;
  confidence?: number;
  assetClass?: string;
  strategyStatus?: string;
  positionStatus?: string;
  costBasis?: number;
  quantity?: number;
  targetPrice?: number;
  stopLoss?: number;
  positionSizePercent?: number;
  lessonCategory?: string;
  tags: string[];
  createdAt: number;
  updatedAt: number;
}

/* ------------------------------------------------------------------ */
/*  行 → 对象                                                           */
/* ------------------------------------------------------------------ */

function rowToResult(row: Record<string, unknown>): SearchResultItem {
  return {
    notePath: row.note_path as string,
    entityType: row.entity_type as string,
    ticker: row.ticker as string | undefined,
    market: row.market as string | undefined,
    direction: row.direction as string | undefined,
    timeHorizon: row.time_horizon as string | undefined,
    confidence: row.confidence as number | undefined,
    assetClass: row.asset_class as string | undefined,
    strategyStatus: row.strategy_status as string | undefined,
    positionStatus: row.position_status as string | undefined,
    costBasis: row.cost_basis as number | undefined,
    quantity: row.quantity as number | undefined,
    targetPrice: row.target_price as number | undefined,
    stopLoss: row.stop_loss as number | undefined,
    positionSizePercent: row.position_size_percent as number | undefined,
    lessonCategory: row.lesson_category as string | undefined,
    tags: JSON.parse((row.tags as string) || "[]") as string[],
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number,
  };
}

/* ------------------------------------------------------------------ */
/*  FinancialIndexStore                                                 */
/* ------------------------------------------------------------------ */

export class FinancialIndexStore {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  /* ---- Upsert ---- */

  upsert(notePath: string, fields: FinancialSlimFields): void {
    const tags = JSON.stringify(fields.tags ?? []);

    const sql = `
      INSERT OR REPLACE INTO financial_memories (
        note_path, entity_type, ticker, market, direction, time_horizon,
        confidence, asset_class, strategy_status, position_status,
        cost_basis, quantity, target_price, stop_loss, position_size_percent,
        lesson_category, tags, created_at, updated_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      )
    `;

    const now = Math.floor(Date.now() / 1000);

    this.db.prepare(sql).run(
      notePath,
      fields.entityType,
      fields.ticker ?? null,
      fields.market ?? null,
      fields.direction ?? null,
      fields.timeHorizon ?? null,
      fields.confidence ?? null,
      fields.assetClass ?? null,
      fields.strategyStatus ?? null,
      fields.positionStatus ?? null,
      fields.costBasis ?? null,
      fields.quantity ?? null,
      fields.targetPrice ?? null,
      fields.stopLoss ?? null,
      fields.positionSizePercent ?? null,
      fields.lessonCategory ?? null,
      tags,
      fields.createdAt ?? now,
      fields.updatedAt ?? now,
    );
  }

  /* ---- Delete ---- */

  delete(notePath: string): boolean {
    const info = this.db
      .prepare("DELETE FROM financial_memories WHERE note_path = ?")
      .run(notePath);
    return info.changes > 0;
  }

  /* ---- Search ---- */

  search(filters: SearchFilters = {}): SearchResultItem[] {
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
      conditions.push("(ticker LIKE ? OR lesson_category LIKE ?)");
      const like = `%${filters.query}%`;
      params.push(like, like);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const limit = filters.limit ?? 20;
    const offset = filters.offset ?? 0;

    let orderBy = "updated_at DESC";
    if (filters.sortBy === "created_desc") {
      orderBy = "created_at DESC";
    }

    // relevance 排序：先取所有匹配行，再用 scoring.ts 打分排序后截取
    if (filters.sortBy === "relevance") {
      const sql = `SELECT * FROM financial_memories ${where} ORDER BY updated_at DESC`;
      const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
      const items = rows.map(rowToResult);

      // 构建兼容 FinancialMemory 的对象给 scoring 使用
      const compatItems: FinancialMemory[] = items.map((item) => ({
        id: item.notePath,
        entityType: item.entityType as FinancialMemory["entityType"],
        ticker: item.ticker,
        market: item.market,
        direction: item.direction as FinancialMemory["direction"],
        timeHorizon: item.timeHorizon as FinancialMemory["timeHorizon"],
        confidence: item.confidence,
        assetClass: item.assetClass as FinancialMemory["assetClass"],
        strategyStatus: item.strategyStatus as FinancialMemory["strategyStatus"],
        positionStatus: item.positionStatus as FinancialMemory["positionStatus"],
        costBasis: item.costBasis,
        quantity: item.quantity,
        targetPrice: item.targetPrice,
        stopLoss: item.stopLoss,
        positionSizePercent: item.positionSizePercent,
        lessonCategory: item.lessonCategory as FinancialMemory["lessonCategory"],
        tags: item.tags,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
      }));

      const nowSeconds = Math.floor(Date.now() / 1000);
      const scored = scoreAndSortMemories(compatItems, filters.query, nowSeconds);

      // 按评分截取，映射回 SearchResultItem
      return scored.slice(offset, offset + limit).map((s) => {
        const idx = compatItems.indexOf(s.memory);
        return items[idx];
      });
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

    return rows.map(rowToResult);
  }
}
