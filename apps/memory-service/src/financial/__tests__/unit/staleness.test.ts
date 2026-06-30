/**
 * Unit tests for staleness calculation (issue #114).
 */
import { computeStaleness, STALENESS_THRESHOLDS } from "../../staleness.js";

const DAY = 86400; // 秒

describe("computeStaleness", () => {
  /* ---- position ---- */
  describe("position", () => {
    const { soft, hard } = STALENESS_THRESHOLDS.position;

    it("returns active when updated 0 days ago", () => {
      const now = 1_000_000_000;
      const result = computeStaleness("position", now, now);
      expect(result).toEqual({ daysStale: 0, stage: "active" });
    });

    it("returns active one day before soft threshold", () => {
      const now = 1_000_000_000;
      const result = computeStaleness("position", now - (soft - 1) * DAY, now);
      expect(result).toEqual({ daysStale: soft - 1, stage: "active" });
    });

    it("returns stale at exactly soft threshold", () => {
      const now = 1_000_000_000;
      const result = computeStaleness("position", now - soft * DAY, now);
      expect(result).toEqual({ daysStale: soft, stage: "stale" });
    });

    it("returns stale one day before hard threshold", () => {
      const now = 1_000_000_000;
      const result = computeStaleness("position", now - (hard - 1) * DAY, now);
      expect(result).toEqual({ daysStale: hard - 1, stage: "stale" });
    });

    it("returns archived at exactly hard threshold", () => {
      const now = 1_000_000_000;
      const result = computeStaleness("position", now - hard * DAY, now);
      expect(result).toEqual({ daysStale: hard, stage: "archived" });
    });

    it("returns archived well past hard threshold", () => {
      const now = 1_000_000_000;
      const result = computeStaleness("position", now - (hard + 100) * DAY, now);
      expect(result.stage).toBe("archived");
      expect(result.daysStale).toBe(hard + 100);
    });
  });

  /* ---- opinion ---- */
  describe("opinion", () => {
    const { soft, hard } = STALENESS_THRESHOLDS.opinion;

    it("returns active just below soft threshold", () => {
      const now = 1_000_000_000;
      const result = computeStaleness("opinion", now - (soft - 1) * DAY, now);
      expect(result).toEqual({ daysStale: soft - 1, stage: "active" });
    });

    it("returns stale at soft threshold", () => {
      const now = 1_000_000_000;
      const result = computeStaleness("opinion", now - soft * DAY, now);
      expect(result).toEqual({ daysStale: soft, stage: "stale" });
    });

    it("returns archived at hard threshold", () => {
      const now = 1_000_000_000;
      const result = computeStaleness("opinion", now - hard * DAY, now);
      expect(result).toEqual({ daysStale: hard, stage: "archived" });
    });
  });

  /* ---- strategy ---- */
  describe("strategy", () => {
    const { soft, hard } = STALENESS_THRESHOLDS.strategy;

    it("returns active just below soft threshold", () => {
      const now = 1_000_000_000;
      const result = computeStaleness("strategy", now - (soft - 1) * DAY, now);
      expect(result).toEqual({ daysStale: soft - 1, stage: "active" });
    });

    it("returns stale at soft threshold", () => {
      const now = 1_000_000_000;
      const result = computeStaleness("strategy", now - soft * DAY, now);
      expect(result).toEqual({ daysStale: soft, stage: "stale" });
    });

    it("returns archived at hard threshold", () => {
      const now = 1_000_000_000;
      const result = computeStaleness("strategy", now - hard * DAY, now);
      expect(result).toEqual({ daysStale: hard, stage: "archived" });
    });
  });

  /* ---- lesson: 永不过时 ---- */
  describe("lesson", () => {
    it("always returns active regardless of age", () => {
      const now = 1_000_000_000;
      const result = computeStaleness("lesson", now - 1000 * DAY, now);
      expect(result.stage).toBe("active");
      expect(result.daysStale).toBe(1000);
    });
  });

  /* ---- unknown entity type: 永不过时 ---- */
  describe("unknown entity type", () => {
    it("returns active for unregistered type", () => {
      const now = 1_000_000_000;
      const result = computeStaleness("mystery", now - 500 * DAY, now);
      expect(result.stage).toBe("active");
    });
  });

  /* ---- daysStale 计算 ---- */
  describe("daysStale calculation", () => {
    it("floors fractional days", () => {
      const now = 1_000_000_000;
      // 1.5 天 → floor = 1
      const result = computeStaleness("position", now - Math.floor(1.5 * DAY), now);
      expect(result.daysStale).toBe(1);
    });

    it("returns 0 when now equals updatedAt", () => {
      const ts = 1_000_000_000;
      expect(computeStaleness("position", ts, ts).daysStale).toBe(0);
    });
  });
});
