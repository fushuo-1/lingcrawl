/**
 * Staleness calculation for financial memories (issue #114).
 *
 * 根据实体类型和更新时间，判断记忆处于 active / stale / archived 哪个阶段。
 * lesson 类型永不过时。
 */

/* ------------------------------------------------------------------ */
/*  Thresholds (unit: days)                                            */
/* ------------------------------------------------------------------ */

export const STALENESS_THRESHOLDS: Record<string, { soft: number; hard: number }> = {
  position: { soft: 14, hard: 28 },
  opinion:  { soft: 30, hard: 60 },
  strategy: { soft: 90, hard: 180 },
};

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export type StalenessStage = "active" | "stale" | "archived";

export interface StalenessResult {
  daysStale: number;
  stage: StalenessStage;
}

/* ------------------------------------------------------------------ */
/*  Core function                                                      */
/* ------------------------------------------------------------------ */

/**
 * 计算实体的过时阶段。
 *
 * @param entityType   实体类型（lesson 或未知类型始终返回 active）
 * @param updatedAtSeconds  updatedAt (unix seconds)
 * @param nowSeconds        当前时间 (unix seconds)
 */
export function computeStaleness(
  entityType: string,
  updatedAtSeconds: number,
  nowSeconds: number,
): StalenessResult {
  const daysStale = Math.floor((nowSeconds - updatedAtSeconds) / 86400);

  const thresholds = STALENESS_THRESHOLDS[entityType];
  // lesson 和未知类型永不过时
  if (!thresholds) {
    return { daysStale, stage: "active" };
  }

  if (daysStale >= thresholds.hard) {
    return { daysStale, stage: "archived" };
  }
  if (daysStale >= thresholds.soft) {
    return { daysStale, stage: "stale" };
  }
  return { daysStale, stage: "active" };
}
