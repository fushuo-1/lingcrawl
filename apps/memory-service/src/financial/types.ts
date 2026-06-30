/* ------------------------------------------------------------------ */
/*  Financial Memory Types — issue #99                                 */
/* ------------------------------------------------------------------ */

export type EntityType = "opinion" | "strategy" | "position" | "lesson";

export type Direction = "bullish" | "bearish" | "neutral";

export type TimeHorizon = "short" | "medium" | "long";

export type AssetClass = "stock" | "etf" | "bond" | "crypto" | "mixed";

export type StrategyStatus = "draft" | "active" | "paused" | "retired";

export type PositionStatus = "holding" | "watching" | "closed";

export type LessonCategory = "mistake" | "principle" | "framework" | "insight";

/* ------------------------------------------------------------------ */
/*  FinancialMemory — 完整实体                                         */
/* ------------------------------------------------------------------ */

export interface FinancialMemory {
  id: string;
  entityType: EntityType;

  /* ---- opinion / position shared ---- */
  ticker?: string;
  market?: string;
  direction?: Direction;
  timeHorizon?: TimeHorizon;
  confidence?: number;
  source?: string;

  /* ---- strategy ---- */
  name?: string;
  assetClass?: AssetClass;
  strategyStatus?: StrategyStatus;

  /* ---- position ---- */
  positionStatus?: PositionStatus;
  quantity?: number;

  /* ---- lesson ---- */
  title?: string;
  lessonCategory?: LessonCategory;

  /* ---- common ---- */
  tags: string[];
  notePath?: string;
  createdAt: number;
  updatedAt: number;
}

/* ------------------------------------------------------------------ */
/*  Input / Output                                                      */
/* ------------------------------------------------------------------ */

export interface CreateFinancialMemoryInput {
  entityType: EntityType;
  id?: string;

  /* opinion / position */
  ticker?: string;
  market?: string;
  direction?: Direction;
  timeHorizon?: TimeHorizon;
  confidence?: number;
  source?: string;

  /* strategy */
  name?: string;
  assetClass?: AssetClass;
  strategyStatus?: StrategyStatus;

  /* position */
  positionStatus?: PositionStatus;
  quantity?: number;

  /* lesson */
  title?: string;
  lessonCategory?: LessonCategory;

  tags?: string[];
  notePath?: string;
}

export interface UpdateFinancialMemoryInput {
  /* 允许更新所有字段（除了 id 和 entity_type 不可变） */
  ticker?: string;
  market?: string;
  direction?: Direction;
  timeHorizon?: TimeHorizon;
  confidence?: number;
  source?: string;
  name?: string;
  assetClass?: AssetClass;
  strategyStatus?: StrategyStatus;
  positionStatus?: PositionStatus;
  quantity?: number;
  title?: string;
  lessonCategory?: LessonCategory;
  tags?: string[];
  notePath?: string;
}

export interface SearchFilters {
  entityTypes?: EntityType[];
  ticker?: string;
  market?: string;
  direction?: Direction;
  tags?: string[];
  query?: string;
}

export interface SearchOptions {
  sortBy?: "updated_desc" | "created_desc" | "relevance";
  limit?: number;
  offset?: number;
}

export interface SearchResult {
  total: number;
  count: number;
  memories: FinancialMemory[];
  relevanceScores?: Record<string, number>;
}
