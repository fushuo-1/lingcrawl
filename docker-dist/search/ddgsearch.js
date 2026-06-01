"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.ddgSearch = ddgSearch;
const undici = __importStar(require("undici"));
const config_1 = require("../../config");
const jsdom_1 = require("jsdom");
const logger_1 = require("../../lib/logger");
const safeFetch_1 = require("../../scraper/scrapeURL/engines/utils/safeFetch");
class DDGAntiBotError extends Error {
    constructor() {
        super("Blocked by DuckDuckGo Anti-Bot measures");
    }
}
const USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:120.0) Gecko/20100101 Firefox/120.0",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:120.0) Gecko/20100101 Firefox/120.0",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
];
function cleanUrl(href) {
    if (href.includes("uddg=")) {
        const url = new URL(href, "https://duckduckgo.com");
        const uddg = url.searchParams.get("uddg");
        return uddg ? decodeURIComponent(uddg) : href;
    }
    return href;
}
function extractResults(document, seenUrls) {
    const anomalyModal = document.querySelector(".anomaly-modal__modal");
    if (anomalyModal) {
        throw new DDGAntiBotError();
    }
    const results = [];
    const blocks = Array.from(document.querySelectorAll(".result.web-result"));
    for (const block of blocks) {
        const titleLink = block.querySelector(".result__a");
        const snippet = block.querySelector(".result__snippet");
        if (!titleLink || !snippet)
            continue;
        const rawUrl = titleLink.href?.trim();
        const title = titleLink.textContent?.trim();
        const description = snippet.textContent?.trim();
        if (rawUrl && title && description) {
            const url = cleanUrl(rawUrl);
            if (!seenUrls.has(url)) {
                seenUrls.add(url);
                results.push({ url, title, description });
            }
        }
    }
    return results;
}
function getNextPageData(document) {
    const nextButton = document.querySelector('input[type="submit"][class="btn btn--alt"][value="Next"]');
    if (!nextButton)
        return null;
    const nextForm = nextButton.closest("form");
    if (!nextForm)
        return null;
    const formData = new URLSearchParams();
    const inputs = Array.from(nextForm.querySelectorAll("input"));
    for (const input of inputs) {
        const name = input.getAttribute("name");
        const value = input.getAttribute("value");
        if (name && value !== null) {
            formData.set(name, value);
        }
    }
    return formData;
}
async function ddgSearch(term, num_results = 5, options = {}) {
    const { lang = "en", country = "us", location, tbs, timeout = 5000, } = options;
    try {
        const userAgent = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
        const params = new URLSearchParams({ q: term, kp: "1" });
        if (location) {
            params.set("kl", location);
        }
        else if (country && lang) {
            params.set("kl", `${country.toLowerCase()}-${lang.toLowerCase()}`);
        }
        if (tbs && (["d", "w", "m", "y"].includes(tbs) || tbs.includes(".."))) {
            params.set("df", tbs);
        }
        const results = [];
        const seenUrls = new Set();
        let isFirstPage = true;
        let nextPageData = params;
        let antiBotRetries = 0;
        while (results.length < num_results && nextPageData) {
            const abortController = new AbortController();
            const timeoutHandle = setTimeout(() => {
                if (abortController) {
                    abortController.abort();
                }
            }, timeout);
            try {
                let response;
                if (isFirstPage) {
                    response = await undici.fetch(`https://html.duckduckgo.com/html?${params.toString()}`, {
                        dispatcher: (0, safeFetch_1.getSecureDispatcher)(false),
                        redirect: "follow",
                        headers: {
                            "User-Agent": userAgent,
                            Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                            "Accept-Language": "en-US,en;q=0.5",
                            "Accept-Encoding": "gzip, deflate, br",
                            "Upgrade-Insecure-Requests": "1",
                        },
                        signal: abortController.signal,
                    });
                }
                else {
                    response = await undici.fetch(`https://html.duckduckgo.com/html`, {
                        method: "POST",
                        body: nextPageData.toString(),
                        dispatcher: (0, safeFetch_1.getSecureDispatcher)(false),
                        redirect: "follow",
                        headers: {
                            "User-Agent": userAgent,
                            Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                            "Accept-Language": "en-US,en;q=0.5",
                            "Accept-Encoding": "gzip, deflate, br",
                            "Upgrade-Insecure-Requests": "1",
                        },
                        signal: abortController.signal,
                    });
                }
                const buf = Buffer.from(await response.arrayBuffer());
                const dom = new jsdom_1.JSDOM(buf.toString("utf8"));
                const doc = dom.window.document;
                const newResults = extractResults(doc, seenUrls);
                isFirstPage = false;
                antiBotRetries = 0;
                results.push(...newResults);
                if (newResults.length === 0)
                    break;
                nextPageData = getNextPageData(doc);
            }
            catch (error) {
                if (error instanceof DDGAntiBotError) {
                    if (antiBotRetries++ > 3) {
                        throw error;
                    }
                    logger_1.logger.warn("DuckDuckGo: Encountered anti-bot measures, retrying...", {
                        attempt: antiBotRetries,
                        term,
                    });
                }
                else {
                    throw error;
                }
            }
            finally {
                if (timeoutHandle)
                    clearTimeout(timeoutHandle);
            }
            await new Promise(r => setTimeout(r, 1000));
        }
        if (results.length === 0) {
            logger_1.logger.warn("DuckDuckGo: No results found", { term });
            return {};
        }
        return { web: results.slice(0, num_results) };
    }
    catch (error) {
        if (error instanceof DDGAntiBotError) {
            if (config_1.config.TEST_SUITE_SELF_HOSTED) {
                logger_1.logger.warn("DuckDuckGo: Blocked by anti-bot measures, returning dummy page for test suite...", { term });
                return {
                    web: [
                        {
                            url: "https://example.com",
                            title: "DDG Anti-Bot Test Page",
                            description: "DDG Anti-Bot triggered, returning dummy page for test suite",
                            position: 1,
                            category: "web",
                            html: "<html><body><h1>Hello, World!</h1></body></html>",
                            rawHtml: "<html><head><title>Hello!</title></head><body><h1>Hello, World!</h1></body></html>",
                            links: [],
                        },
                    ],
                };
            }
            logger_1.logger.error("DuckDuckGo: Blocked by anti-bot measures", { term });
            throw new Error("DuckDuckGo: Blocked by anti-bot measures.");
        }
        if (error.response?.status === 429) {
            logger_1.logger.warn("DuckDuckGo: Too many requests, try again later.", {
                status: error.response.status,
                statusText: error.response.statusText,
            });
            throw new Error("DuckDuckGo: Too many requests, try again later.");
        }
        logger_1.logger.error("DuckDuckGo search error", { error: error.message, term });
        throw error;
    }
}
//# sourceMappingURL=ddgsearch.js.map