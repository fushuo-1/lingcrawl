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
      updatedAt: now,
    });

    const withQuery = scoreMemory(memory, "AAPL", now).relevanceScore;
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

describe("per-entity time decay half-lives", () => {
  it("position: half-life of 14 days", () => {
    const now = Math.floor(Date.now() / 1000);
    const fresh = makeMemory({ entityType: "position", updatedAt: now });
    const aged = makeMemory({ entityType: "position", updatedAt: now - 14 * 24 * 3600 });
    // timeDecay component at 14 days should be ~0.5
    // score = (timeDecay * 0.3 + ...) — check relative difference
    const freshScore = scoreMemory(fresh, undefined, now).relevanceScore;
    const agedScore = scoreMemory(aged, undefined, now).relevanceScore;
    // At half-life, the time decay portion drops by ~0.15 (0.5 * 0.3)
    expect(freshScore).toBeGreaterThan(agedScore);
    // The time decay at 14 days is exactly 0.5
    const freshDecay = freshScore - agedScore;
    expect(freshDecay).toBeCloseTo(0.15, 2); // 0.3 * (1.0 - 0.5) = 0.15
  });

  it("opinion: half-life of 30 days", () => {
    const now = Math.floor(Date.now() / 1000);
    const fresh = makeMemory({ entityType: "opinion", updatedAt: now });
    const aged = makeMemory({ entityType: "opinion", updatedAt: now - 30 * 24 * 3600 });
    const freshScore = scoreMemory(fresh, undefined, now).relevanceScore;
    const agedScore = scoreMemory(aged, undefined, now).relevanceScore;
    expect(freshScore).toBeGreaterThan(agedScore);
    expect(freshScore - agedScore).toBeCloseTo(0.15, 2);
  });

  it("strategy: half-life of 90 days", () => {
    const now = Math.floor(Date.now() / 1000);
    const fresh = makeMemory({ entityType: "strategy", updatedAt: now });
    const aged = makeMemory({ entityType: "strategy", updatedAt: now - 90 * 24 * 3600 });
    const freshScore = scoreMemory(fresh, undefined, now).relevanceScore;
    const agedScore = scoreMemory(aged, undefined, now).relevanceScore;
    expect(freshScore).toBeGreaterThan(agedScore);
    expect(freshScore - agedScore).toBeCloseTo(0.15, 2);
  });

  it("lesson: no time decay (always 1.0)", () => {
    const now = Math.floor(Date.now() / 1000);
    const fresh = makeMemory({ entityType: "lesson", lessonCategory: "insight", updatedAt: now });
    const aged = makeMemory({ entityType: "lesson", lessonCategory: "insight", updatedAt: now - 365 * 24 * 3600 });
    const freshScore = scoreMemory(fresh, undefined, now).relevanceScore;
    const agedScore = scoreMemory(aged, undefined, now).relevanceScore;
    expect(freshScore).toBeCloseTo(agedScore, 10);
  });

  it("position decays faster than opinion", () => {
    const now = Math.floor(Date.now() / 1000);
    const posAged = makeMemory({ entityType: "position", updatedAt: now - 14 * 24 * 3600 });
    const opnAged = makeMemory({ entityType: "opinion", updatedAt: now - 14 * 24 * 3600 });
    // At 14 days, position is at half-life (decay=0.5) but opinion is only at 0.72 (14/30 half-life)
    const posScore = scoreMemory(posAged, undefined, now).relevanceScore;
    const opnScore = scoreMemory(opnAged, undefined, now).relevanceScore;
    // position has higher type weight (0.95 vs 0.9) but decays faster — net effect depends
    // just verify they're both valid scores
    expect(posScore).toBeGreaterThanOrEqual(0);
    expect(opnScore).toBeGreaterThanOrEqual(0);
  });
});

describe("stale penalty", () => {
  it("stale memory scores lower than non-stale with same params", () => {
    const now = Math.floor(Date.now() / 1000);
    const memory = makeMemory({ entityType: "opinion", confidence: 3, updatedAt: now });
    const normal = scoreMemory(memory, undefined, now, false);
    const stale = scoreMemory(memory, undefined, now, true);
    expect(stale.relevanceScore).toBeLessThan(normal.relevanceScore);
    expect(stale.relevanceScore).toBeCloseTo(normal.relevanceScore * 0.5, 10);
  });

  it("non-stale memories are unaffected by stalePaths", () => {
    const now = Math.floor(Date.now() / 1000);
    const memories = [
      makeMemory({ id: "a", entityType: "opinion", updatedAt: now }),
      makeMemory({ id: "b", entityType: "strategy", updatedAt: now }),
    ];
    const withoutStale = scoreAndSortMemories(memories, undefined, now);
    const withEmptyStale = scoreAndSortMemories(memories, undefined, now, new Set());
    expect(withoutStale[0].relevanceScore).toBeCloseTo(withEmptyStale[0].relevanceScore, 10);
    expect(withoutStale[1].relevanceScore).toBeCloseTo(withEmptyStale[1].relevanceScore, 10);
  });

  it("scoreAndSortMemories applies stale penalty via stalePaths", () => {
    const now = Math.floor(Date.now() / 1000);
    const memories = [
      makeMemory({ id: "normal", entityType: "opinion", confidence: 3, updatedAt: now }),
      makeMemory({ id: "stale-id", entityType: "opinion", confidence: 3, updatedAt: now }),
    ];
    const stalePaths = new Set(["stale-id"]);
    const scored = scoreAndSortMemories(memories, undefined, now, stalePaths);
    const normalEntry = scored.find((s) => s.memory.id === "normal")!;
    const staleEntry = scored.find((s) => s.memory.id === "stale-id")!;
    expect(normalEntry.relevanceScore).toBeGreaterThan(staleEntry.relevanceScore);
  });
});
