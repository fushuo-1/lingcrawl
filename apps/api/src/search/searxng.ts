import axios from "axios";
import { config } from "../config";
import { SearchV2Response, WebSearchResult, SearchQueryMeta } from "../lib/entities";
import { logger } from "../lib/logger";
import {
  processQuery,
  diversifyByDomain,
  filterByRelevance,
  type TimeRange,
} from "./query-processor";

interface SearchOptions {
  tbs?: string;
  filter?: string;
  lang?: string;
  country?: string;
  location?: string;
  num_results: number;
  page?: number;
}

export async function searxng_search(
  q: string,
  options: SearchOptions,
): Promise<SearchV2Response> {
  const resultsPerPage = 20;
  const requestedResults = Math.max(options.num_results, 0);
  const startPage = options.page ?? 1;

  // ─── Query preprocessing ───
  const processed = processQuery(q);

  const url = config.SEARXNG_ENDPOINT!;
  const cleanedUrl = url.endsWith("/") ? url.slice(0, -1) : url;
  const finalUrl = cleanedUrl + "/search";

  // Use caller-provided lang if set, otherwise use detected language
  const effectiveLang = options.lang && options.lang !== "en"
    ? options.lang
    : processed.lang;

  // Use caller-provided engines if SEARXNG_ENGINES is explicitly set,
  // otherwise use intelligent routing
  const effectiveEngines = config.SEARXNG_ENGINES
    ? config.SEARXNG_ENGINES
    : processed.engines;

  const fetchPage = async (page: number): Promise<WebSearchResult[]> => {
    const params: Record<string, string | number | undefined> = {
      q: processed.query,
      language: effectiveLang,
      engines: effectiveEngines,
      categories: config.SEARXNG_CATEGORIES ?? "",
      pageno: page,
      format: "json",
    };

    // Pass time_range for timely queries
    if (processed.timeRange) {
      params.time_range = processed.timeRange;
    }

    const response = await axios.get(finalUrl, {
      headers: {
        "Content-Type": "application/json",
      },
      params: params,
    });

    const data = response.data;

    if (data && Array.isArray(data.results)) {
      return data.results
        .filter((a: any) => a.score > 0)
        .sort((a: any, b: any) => b.score - a.score)
        .map((a: any) => ({
          url: a.url,
          title: a.title,
          description: a.content,
          source: a.engine ?? (Array.isArray(a.engines) ? a.engines[0] : undefined),
          publishedDate: a.publishedDate ?? undefined,
          engines: Array.isArray(a.engines) ? a.engines : undefined,
        }));
    }

    return [];
  };

  try {
    if (requestedResults === 0) {
      return {};
    }

    const pagesToFetch = Math.max(
      1,
      Math.ceil(requestedResults / resultsPerPage),
    );
    let webResults: WebSearchResult[] = [];

    for (let pageOffset = 0; pageOffset < pagesToFetch; pageOffset += 1) {
      const pageResults = await fetchPage(startPage + pageOffset);
      if (pageResults.length === 0) {
        break;
      }
      webResults = webResults.concat(pageResults);
      if (webResults.length >= requestedResults) {
        break;
      }
    }

    // Deduplicate by domain for diversity
    webResults = diversifyByDomain(webResults, 3);

    // Filter out results completely unrelated to the query
    webResults = filterByRelevance(webResults, processed.originalQuery);

    const queryMeta: SearchQueryMeta = {
      originalQuery: processed.originalQuery,
      queryType: processed.queryType,
      language: processed.language,
      engines: effectiveEngines,
      timeRange: processed.timeRange,
    };

    return webResults.length > 0
      ? {
          web: webResults.slice(0, requestedResults),
          queryMeta,
        }
      : { queryMeta };
  } catch (error) {
    logger.error(`There was an error searching for content`, { error });
    return {};
  }
}
