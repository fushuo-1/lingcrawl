import { InternalOptions } from "..";
import { ScrapeOptions } from "../../../controllers/types";

type UrlSpecificParams = {
  scrapeOptions: Partial<ScrapeOptions>;
  internalOptions: Partial<InternalOptions>;
};

// const docsParam: UrlSpecificParams = {
//     scrapeOptions: { waitFor: 2000 },
//     internalOptions: {},
// }

export const urlSpecificParams: Record<string, UrlSpecificParams> = {
  // "support.greenpay.me": docsParam,
  // "docs.pdw.co": docsParam,
  // "developers.notion.com": docsParam,
  // "docs2.hubitat.com": docsParam,
  // "rsseau.fr": docsParam,
  // "help.salesforce.com": docsParam,
  // "scrapethissite.com": {
  //     scrapeOptions: {},
  //     internalOptions: { forceEngine: "fetch" },
  // },
  // "eonhealth.com": {
  //     defaultScraper: "fire-engine",
  //     params: {
  //         fireEngineOptions: {
  //             mobileProxy: true,
  //             method: "get",
  //             engine: "request",
  //         },
  //     },
  // },
  "digikey.com": {
    scrapeOptions: {},
    internalOptions: { forceEngine: "fire-engine;tlsclient" },
  },
  "lorealparis.hu": {
    scrapeOptions: {},
    internalOptions: { forceEngine: "fire-engine;tlsclient" },
  },
  // Zhihu (知乎) — browser headers for fetch engine, minimal flags to keep fetch in fallback
  "zhihu.com": {
    scrapeOptions: {
      skipTlsVerification: true,
      headers: {
        "Accept-Language":
          "zh-CN,zh;q=0.9,en;q=0.8,en-GB;q=0.7,en-US;q=0.6",
        Referer: "https://www.zhihu.com/",
      },
    },
    internalOptions: {},
  },
  "zhuanlan.zhihu.com": {
    scrapeOptions: {
      skipTlsVerification: true,
      headers: {
        "Accept-Language":
          "zh-CN,zh;q=0.9,en;q=0.8,en-GB;q=0.7,en-US;q=0.6",
        Referer: "https://zhuanlan.zhihu.com/",
      },
    },
    internalOptions: {},
  },
};
