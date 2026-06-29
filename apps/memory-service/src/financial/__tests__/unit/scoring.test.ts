/**
 * Unit tests for financial memory relevance scoring (issue #101).
 */
import { scoreMemory, scoreAndSortMemories } from "../../scoring.js";
import type { FinancialMemory } from "../../types.js";

function makeMemory(
  overrides: Partial<FinancialMemory> = {},
): FinancialMemory {
  return {
    id: "test-id",
    entityType: "opinion",
    tags: [],
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

describe("scoreMemory", () => {
  it("returns a relevance score between 0 and 1", () => {
    const memory = makeMemory({
      entityType: "opinion",
      confidence: 5,
      updatedAt: Math.floor(Date.now() / 1000),
    });
    const scored = scoreMemory(memory, undefined, Math.floor(Date.now() / 1000));
    expect(scored.relevanceScore).toBeGreaterThanOrEqual(0);
    expect(scored.relevanceScore).toBeLessThanOrEqual(1);
  });

  it("penalizes old memories via time decay", () => {
    const now = Math.floor(Date.now() / 1000);
    const fresh = makeMemory({ entityType: "opinion", updatedAt: now });
    const stale = makeMemory({
      entityType: "opinion",
      updatedAt: now - 60 * 24 * 3600, // 60 days ago
    });

    const freshScore = scoreMemory(fresh, undefined, now).relevanceScore;
    const staleScore = scoreMemory(stale, undefined, now).relevanceScore;
    expect(freshScore).toBeGreaterThan(staleScore);
  });

  it("gives higher type weight to strategies", () => {
    const now = Math.floor(Date.now() / 1000);
    const opinion = makeMemory({ entityType: "opinion", updatedAt: now });
    const strategy = makeMemory({ entityType: "strategy", updatedAt: now });

    const opinionScore = scoreMemory(opinion, undefined, now).relevanceScore;
    const strategyScore = scoreMemory(strategy, undefined, now).relevanceScore;
    expect(strategyScore).toBeGreaterThan(opinionScore);
  });

  it("boosts opinion score with higher confidence", () => {
    const now = Math.floor(Date.now() / 1000);
    const lowConfidence = makeMemory({
      entityType: "opinion",
      confidence: 1,
      updatedAt: now,
    });
    const highConfidence = makeMemory({
      entityType: "opinion",
      confidence: 5,
      updatedAt: now,
    });

    const lowScore = scoreMemory(lowConfidence, undefined, now).relevanceScore;
    const highScore = scoreMemory(highConfidence, undefined, now).relevanceScore;
    expect(highScore).toBeGreaterThan(lowScore);
  });

  it("computes match quality for query hits", () => {
    const now = Math.floor(Date.now() / 1000);
    const memory = makeMemory({
      entityType: "opinion",
      ticker: "AAPL",
      thesis: "Strong earnings growth",
      updatedAt: now,
    });

    const withQuery = scoreMemory(memory, "AAPL earnings", now).relevanceScore;
    const withoutQuery = scoreMemory(memory, undefined, now).relevanceScore;
    expect(withQuery).toBeGreaterThanOrEqual(withoutQuery);
  });
});

describe("scoreAndSortMemories", () => {
  it("sorts memories by relevance descending", () => {
    const now = Math.floor(Date.now() / 1000);
    const memories = [
      makeMemory({ id: "low", entityType: "lesson", lessonCategory: "insight", updatedAt: now }),
      makeMemory({ id: "high", entityType: "strategy", strategyStatus: "active", updatedAt: now }),
      makeMemory({ id: "mid", entityType: "opinion", confidence: 5, updatedAt: now }),
    ];

    const sorted = scoreAndSortMemories(memories, undefined, now);
    expect(sorted[0].memory.id).toBe("high");
    expect(sorted[1].memory.id).toBe("mid");
    expect(sorted[2].memory.id).toBe("low");
  });
});
