/**
 * Composite relevance scoring for financial memories (issue #101).
 *
 * Formula:
 *   score = time_decay * 0.30 + type_weight * 0.25 + confidence_or_size * 0.25 + match_quality * 0.20
 *
 * All sub-scores are normalized to [0, 1].
 */
import type { FinancialMemory } from "./types.js";

const WEIGHTS = {
  timeDecay: 0.3,
  typeWeight: 0.25,
  confidenceOrSize: 0.25,
  matchQuality: 0.2,
};

const TYPE_WEIGHTS: Record<FinancialMemory["entityType"], number> = {
  strategy: 1.0,
  position: 0.95,
  opinion: 0.9,
  lesson: 0.85,
};

function daysSinceUpdate(memory: FinancialMemory, nowSeconds: number): number {
  const seconds = nowSeconds - memory.updatedAt;
  return Math.max(0, seconds / 86400);
}

function computeTimeDecay(memory: FinancialMemory, nowSeconds: number): number {
  const days = daysSinceUpdate(memory, nowSeconds);
  return Math.exp(-Math.LN2 * (days / 30));
}

function computeConfidenceOrSize(memory: FinancialMemory): number {
  switch (memory.entityType) {
    case "opinion": {
      return memory.confidence ? memory.confidence / 5 : 0;
    }
    case "position": {
      const statusMultiplier: Record<string, number> = {
        holding: 1.0,
        watching: 0.8,
        closed: 0.5,
      };
      return memory.positionStatus
        ? statusMultiplier[memory.positionStatus] ?? 0.3
        : 0.3;
    }
    case "strategy": {
      const statusMap: Record<string, number> = {
        active: 1.0,
        paused: 0.6,
        draft: 0.4,
        retired: 0.3,
      };
      return memory.strategyStatus ? statusMap[memory.strategyStatus] ?? 0.2 : 0.2;
    }
    case "lesson": {
      const categoryMap: Record<string, number> = {
        mistake: 1.0,
        principle: 0.9,
        framework: 0.85,
        insight: 0.8,
      };
      return memory.lessonCategory ? categoryMap[memory.lessonCategory] ?? 0.7 : 0.7;
    }
    default:
      return 0.5;
  }
}

function tokenize(query: string): string[] {
  return query
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

function searchableText(memory: FinancialMemory): string {
  const parts = [
    memory.ticker ?? "",
    memory.name ?? "",
    memory.title ?? "",
    ...memory.tags,
  ];
  return parts.join(" ").toLowerCase();
}

function computeMatchQuality(
  memory: FinancialMemory,
  query?: string,
): number {
  if (!query || query.trim().length === 0) {
    return 1.0;
  }

  const tokens = tokenize(query);
  if (tokens.length === 0) {
    return 1.0;
  }

  const text = searchableText(memory);
  let hits = 0;
  for (const token of tokens) {
    if (text.includes(token)) {
      hits++;
    }
  }
  return hits / tokens.length;
}

export interface ScoredMemory {
  memory: FinancialMemory;
  relevanceScore: number;
}

export function scoreMemory(
  memory: FinancialMemory,
  query: string | undefined,
  nowSeconds: number,
): ScoredMemory {
  const timeDecay = computeTimeDecay(memory, nowSeconds);
  const typeWeight = TYPE_WEIGHTS[memory.entityType] ?? 0.5;
  const confidenceOrSize = computeConfidenceOrSize(memory);
  const matchQuality = computeMatchQuality(memory, query);

  const relevanceScore =
    timeDecay * WEIGHTS.timeDecay +
    typeWeight * WEIGHTS.typeWeight +
    confidenceOrSize * WEIGHTS.confidenceOrSize +
    matchQuality * WEIGHTS.matchQuality;

  return { memory, relevanceScore };
}

export function scoreAndSortMemories(
  memories: FinancialMemory[],
  query: string | undefined,
  nowSeconds: number,
): ScoredMemory[] {
  const scored = memories.map((m) => scoreMemory(m, query, nowSeconds));
  scored.sort((a, b) => b.relevanceScore - a.relevanceScore);
  return scored;
}
