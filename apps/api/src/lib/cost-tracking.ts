// Stub: CostTracking - simplified for self-hosted mode
export class CostTracking {
  private costs: Record<string, number> = {};

  track(key: string, cost: number) {
    this.costs[key] = (this.costs[key] ?? 0) + cost;
  }

  toJSON() {
    return { ...this.costs };
  }
}
