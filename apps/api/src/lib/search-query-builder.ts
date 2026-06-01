// Stub: search query builder simplified for self-hosted mode
export type CategoryOption = string;

export function buildSearchQuery(
  query: string,
  categories?: CategoryOption[],
): { query: string; categoryMap: Map<string, string> } {
  return { query, categoryMap: new Map() };
}

export function getCategoryFromUrl(
  url: string,
  categoryMap: Map<string, string>,
): string | undefined {
  return categoryMap.get(url);
}
