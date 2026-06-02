import { SearchV2Response, SearchResultType } from "../lib/entities";
import { Logger } from "winston";
import { searxng_search } from "./searxng";

export async function search({
  query,
  logger,
  advanced = false,
  num_results = 5,
  tbs = undefined,
  filter = undefined,
  lang = undefined,
  country = "us",
  location = undefined,
  proxy = undefined,
  sleep_interval = 0,
  timeout = 5000,
  type = undefined,
  enterprise = undefined,
}: {
  query: string;
  logger: Logger;
  advanced?: boolean;
  num_results?: number;
  tbs?: string;
  filter?: string;
  lang?: string;
  country?: string;
  location?: string;
  proxy?: string;
  sleep_interval?: number;
  timeout?: number;
  type?: SearchResultType | SearchResultType[];
  enterprise?: ("default" | "anon" | "zdr")[];
}): Promise<SearchV2Response> {
  try {
    logger.info("Using SearXNG search");
    return await searxng_search(query, {
      num_results,
      lang,
      tbs,
    });
  } catch (error) {
    logger.error(`Error in search function`, { error });
    return {};
  }
}
