import { configDotenv } from "dotenv";
import { config } from "../../config";
configDotenv();

import { TeamFlags } from "../../controllers/types";

// =========================================
// Configuration
// =========================================

export const TEST_API_URL = config.TEST_API_URL;
export const TEST_URL = TEST_API_URL; // backwards compat temp

const stripTrailingSlash = (url: string) => {
  if (url.length < 1) throw new Error("Invalid URL supplied");
  return url.endsWith("/") ? url.substring(0, url.length - 1) : url;
};

export const TEST_SUITE_WEBSITE = stripTrailingSlash(config.TEST_SUITE_WEBSITE);

export const TEST_SELF_HOST = !!config.TEST_SUITE_SELF_HOSTED;
export const TEST_PRODUCTION = !TEST_SELF_HOST;

// AI functionality removed — no LLM providers configured
export const HAS_AI = false;
export const HAS_FIRE_ENGINE = !!config.FIRE_ENGINE_BETA_URL;
export const HAS_PLAYWRIGHT = !!config.PLAYWRIGHT_MICROSERVICE_URL;
export const HAS_PROXY = !!config.PROXY_SERVER;

export const HAS_SEARCH = TEST_PRODUCTION || !!config.SEARXNG_ENDPOINT;

const isLocalUrl = (x: string) =>
  /^https?:\/\/(localhost|127\.0\.0\.1|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3})(:\d+)?([\/?#]|$)/i.test(
    x as string,
  );

// due to playwright / api using proxy, we don't want to run local tests while proxy is enabled or in production testing
export const ALLOW_TEST_SUITE_WEBSITE =
  !TEST_SELF_HOST || (isLocalUrl(TEST_SUITE_WEBSITE) && !HAS_PROXY);

// TODO: print the config that determines tests run

export const describeIf = (cond: boolean) => (cond ? describe : describe.skip);
export const concurrentIf = (cond: boolean) => (cond ? it.concurrent : it.skip);
export const testIf = (cond: boolean) => (cond ? test : test.skip);
export const itIf = (cond: boolean) => (cond ? it : it.skip);

export const createTestIdUrl = () =>
  `${TEST_SUITE_WEBSITE}?testId=${crypto.randomUUID()}`;

if (isLocalUrl(TEST_SUITE_WEBSITE)) {
  if (TEST_SELF_HOST) {
    config.ALLOW_LOCAL_NETWORK = true;
  } else {
    throw new Error(
      "TEST_SUITE_WEBSITE cannot be a local address while testing in production",
    );
  }
}

// Due to the limited resources of the CI runner, we need to set a longer timeout for the many many scrape tests
export const scrapeTimeout = 90000;
export const indexCooldown = 30000;

// =========================================
// idmux
// =========================================

export type IdmuxRequest = {
  name: string;

  concurrency?: number;
  credits?: number;
  tokens?: number;
  flags?: TeamFlags;
  teamId?: string;
};

export async function idmux(_req: IdmuxRequest): Promise<Identity> {
  return {
    apiKey: config.TEST_API_KEY!,
    teamId: config.TEST_TEAM_ID!,
  };
}

export type Identity = {
  apiKey: string;
  teamId: string;
};
