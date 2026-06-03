/**
 * Query preprocessing for SearXNG search.
 * Handles language detection, keyword extraction, time range detection,
 * query type classification, and engine routing.
 */

// ─── Language Detection ───

export type QueryLanguage = "zh" | "en" | "mixed";

export function detectQueryLanguage(query: string): QueryLanguage {
  const chineseChars = (query.match(/[一-鿿]/g) || []).length;
  const japaneseChars = (query.match(/[ぁ-ゟ゠-ヿ]/g) || []).length;
  // If has hiragana/katakana, it's Japanese — use mixed engines
  if (japaneseChars > 0) return "mixed";
  const ratio = chineseChars / query.length;
  if (ratio > 0.3) return "zh";
  if (ratio < 0.05) return "en";
  return "mixed";
}

// ─── Keyword Extraction ───

const ZH_FILLERS =
  /[的了吗呢吧啊哦哈呀嘛么诶嗯哪哎唉哇喔额呵吧嗒吧唧]/g;

// Common Chinese words that are not useful as search keywords
const ZH_STOP_WORDS = /^(如何|为什么|为啥|怎么|怎样|是什么|哪些|哪个|什么|可以|能够|应该|需要|比较|哪个好|怎么样|是不是|有没有|哪里|哪儿|多久|多少|几个|是否)$/;

const EN_STOP_WORDS = new Set([
  "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "could",
  "should", "may", "might", "shall", "can", "need", "must",
  "how", "to", "do", "does", "what", "which", "who", "whom", "when",
  "where", "why", "for", "and", "or", "but", "in", "on", "at", "of",
  "with", "by", "from", "as", "into", "through", "during", "before",
  "after", "above", "below", "between", "out", "off", "over", "under",
  "again", "further", "then", "once",
  "best", "good", "better", "great", "top", "most", "more", "very",
  "really", "some", "any", "each", "every", "all", "both", "few",
  "its", "it's", "my", "your", "his", "her", "our", "their",
  "i", "me", "you", "he", "she", "it", "we", "they", "this", "that",
  "these", "those", "not", "no", "nor", "so", "if", "just", "about",
]);

export function extractKeywords(query: string, lang: QueryLanguage): string {
  if (lang === "zh" || lang === "mixed") {
    // Remove Chinese filler characters, then remove stop words
    return query
      .replace(ZH_FILLERS, "")
      .split(/\s+/)
      .filter((w) => !ZH_STOP_WORDS.test(w))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
  }
  // English: remove stop words
  return query
    .split(/\s+/)
    .filter((w) => !EN_STOP_WORDS.has(w.toLowerCase()))
    .join(" ");
}

// ─── Time Range Detection ───

export type TimeRange = "day" | "month" | "year" | undefined;

export function detectTimeRange(query: string): TimeRange {
  if (/今日|今天|today|latest|最新|当前|current|实时/i.test(query)) {
    return "day";
  }
  if (/最近|recent|本周|this week|本月|this month/i.test(query)) {
    return "month";
  }
  if (/今年|this year|年度/i.test(query)) {
    return "year";
  }
  return undefined;
}

// ─── Query Type Detection ───

export type QueryType = "troubleshoot" | "comparison" | "factual" | "general";

export function detectQueryType(query: string): QueryType {
  if (
    /fix|error|issue|bug|problem|troubleshoot|debug|报错|解决|修复|排查|异常|失败|cannot|can't|unable/i.test(
      query,
    )
  ) {
    return "troubleshoot";
  }
  if (/vs|versus|compare|对比|比较|difference|区别|哪个好|选哪个/i.test(query)) {
    return "comparison";
  }
  if (/what is|是什么|define|定义|概念|含义|meaning/i.test(query)) {
    return "factual";
  }
  return "general";
}

// ─── Engine Routing ───

const ZH_ENGINES = "baidu,sogou,360search,bing";
const EN_ENGINES = "google,bing,duckduckgo,brave";
const MIXED_ENGINES = "baidu,sogou,360search,bing,google,duckduckgo,brave";

export function selectEngines(lang: QueryLanguage): string {
  switch (lang) {
    case "zh":
      return ZH_ENGINES;
    case "en":
      return EN_ENGINES;
    case "mixed":
      return MIXED_ENGINES;
  }
}

// ─── Query Rewriting ───

const TROUBLESHOOT_SITES =
  "site:stackoverflow.com OR site:github.com OR site:segmentfault.com OR site:juejin.cn OR site:csdn.net OR site:zhihu.com OR site:v2ex.com";

const COMPARISON_SUFFIX = " comparison review vs";

export function rewriteQuery(
  query: string,
  queryType: QueryType,
): string {
  switch (queryType) {
    case "troubleshoot":
      return `${query} ${TROUBLESHOOT_SITES}`;
    case "comparison":
      return `${query}${COMPARISON_SUFFIX}`;
    default:
      return query;
  }
}

// ─── Domain Diversity ───

export function diversifyByDomain<T extends { url: string }>(
  results: T[],
  maxPerDomain: number = 3,
): T[] {
  const domainCounts = new Map<string, number>();
  return results.filter((r) => {
    try {
      const domain = new URL(r.url).hostname;
      const count = domainCounts.get(domain) || 0;
      if (count >= maxPerDomain) return false;
      domainCounts.set(domain, count + 1);
      return true;
    } catch {
      return true;
    }
  });
}

// ─── Pipeline Entry Point ───

export interface ProcessedQuery {
  query: string;
  originalQuery: string;
  language: QueryLanguage;
  timeRange: TimeRange;
  queryType: QueryType;
  engines: string;
  lang: string;
}

export function processQuery(rawQuery: string): ProcessedQuery {
  const language = detectQueryLanguage(rawQuery);
  const timeRange = detectTimeRange(rawQuery);
  const queryType = detectQueryType(rawQuery);

  // Extract keywords first, then rewrite based on query type
  const keywords = extractKeywords(rawQuery, language);
  const query = rewriteQuery(keywords, queryType);

  return {
    query,
    originalQuery: rawQuery,
    language,
    timeRange,
    queryType,
    engines: selectEngines(language),
    lang: language === "zh" ? "zh" : language === "en" ? "en" : "auto",
  };
}
