"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getItemsToScrape = getItemsToScrape;
exports.scrapeSearchResults = scrapeSearchResults;
exports.calculateScrapeCredits = calculateScrapeCredits;
exports.mergeScrapedContent = mergeScrapedContent;
const uuid_1 = require("uuid");
const cost_tracking_1 = require("../lib/cost-tracking");
const job_priority_1 = require("../lib/job-priority");
const blocklist_1 = require("../scraper/WebScraper/utils/blocklist");
const scrape_worker_1 = require("../services/worker/scrape-worker");
async function scrapeSearchResultDirect(searchResult, options, logger, flags, jobPriority) {
    const jobId = (0, uuid_1.v7)();
    const zeroDataRetention = flags?.forceZDR || (options.zeroDataRetention ?? false);
    logger.debug("Starting direct scrape for search result", {
        scrapeId: jobId,
        url: searchResult.url,
        teamId: options.teamId,
        origin: options.origin,
        zeroDataRetention,
    });
    try {
        const job = {
            id: jobId,
            status: "active",
            createdAt: new Date(),
            priority: jobPriority,
            data: {
                url: searchResult.url,
                mode: "single_urls",
                team_id: options.teamId,
                scrapeOptions: {
                    ...options.scrapeOptions,
                    maxAge: 3 * 24 * 60 * 60 * 1000, // 3 days
                },
                internalOptions: {
                    teamId: options.teamId,
                    bypassBilling: options.bypassBilling ?? true,
                    zeroDataRetention,
                    teamFlags: flags,
                },
                skipNuq: true,
                origin: options.origin,
                is_scrape: false,
                startTime: Date.now(),
                zeroDataRetention,
                apiKeyId: options.apiKeyId,
                requestId: options.requestId,
                billing: options.billing,
            },
        };
        const doc = await (0, scrape_worker_1.processJobInternal)(job);
        logger.debug("Direct scrape completed for search result", {
            scrapeId: jobId,
            url: searchResult.url,
        });
        const document = {
            title: searchResult.title,
            description: searchResult.description,
            url: searchResult.url,
            ...doc,
            metadata: doc?.metadata ?? {
                statusCode: 200,
                proxyUsed: "basic",
            },
        };
        return {
            document,
            costTracking: new cost_tracking_1.CostTracking().toJSON(),
        };
    }
    catch (error) {
        logger.error(`Error in scrapeSearchResultDirect: ${error}`, {
            url: searchResult.url,
            teamId: options.teamId,
            scrapeId: jobId,
        });
        const document = {
            title: searchResult.title,
            description: searchResult.description,
            url: searchResult.url,
            metadata: {
                statusCode: 500,
                error: error.message,
                proxyUsed: "basic",
            },
        };
        return {
            document,
            costTracking: new cost_tracking_1.CostTracking().toJSON(),
        };
    }
}
function getItemsToScrape(searchResponse, flags) {
    const items = [];
    if (searchResponse.web) {
        for (const item of searchResponse.web) {
            if (!(0, blocklist_1.isUrlBlocked)(item.url, flags)) {
                items.push({
                    item,
                    type: "web",
                    scrapeInput: {
                        url: item.url,
                        title: item.title,
                        description: item.description,
                    },
                });
            }
        }
    }
    if (searchResponse.news) {
        for (const item of searchResponse.news) {
            if (item.url && !(0, blocklist_1.isUrlBlocked)(item.url, flags)) {
                items.push({
                    item,
                    type: "news",
                    scrapeInput: {
                        url: item.url,
                        title: item.title || "",
                        description: item.snippet || "",
                    },
                });
            }
        }
    }
    if (searchResponse.images) {
        for (const item of searchResponse.images) {
            if (item.url && !(0, blocklist_1.isUrlBlocked)(item.url, flags)) {
                items.push({
                    item,
                    type: "image",
                    scrapeInput: {
                        url: item.url,
                        title: item.title || "",
                        description: "",
                    },
                });
            }
        }
    }
    return items;
}
async function scrapeSearchResults(items, options, logger, flags) {
    if (items.length === 0) {
        return [];
    }
    const jobPriority = await (0, job_priority_1.getJobPriority)({
        team_id: options.teamId,
        basePriority: 10,
    });
    logger.info(`Starting ${items.length} concurrent scrapes for search results`);
    const results = await Promise.all(items.map(item => scrapeSearchResultDirect(item, options, logger, flags, jobPriority)));
    logger.info(`Completed ${results.length} concurrent scrapes for search results`);
    return results;
}
function calculateScrapeCredits(docs) {
    return docs.reduce((total, { document }) => total + (document.metadata?.creditsUsed ?? 0), 0);
}
function mergeScrapedContent(searchResponse, items, docs) {
    const resultsMap = new Map();
    items.forEach((item, index) => {
        resultsMap.set(item.scrapeInput.url, docs[index].document);
    });
    if (searchResponse.web?.length) {
        searchResponse.web = searchResponse.web.map(item => ({
            ...item,
            ...resultsMap.get(item.url),
        }));
    }
    if (searchResponse.news?.length) {
        searchResponse.news = searchResponse.news.map(item => ({
            ...item,
            ...(item.url ? resultsMap.get(item.url) : {}),
        }));
    }
    if (searchResponse.images?.length) {
        searchResponse.images = searchResponse.images.map(item => ({
            ...item,
            ...(item.url ? resultsMap.get(item.url) : {}),
        }));
    }
}
//# sourceMappingURL=scrape.js.map