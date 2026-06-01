"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.executeSearch = executeSearch;
const v2_1 = require("./v2");
const search_query_builder_1 = require("../lib/search-query-builder");
const scrape_1 = require("./scrape");
async function executeSearch(options, context, logger) {
    const { query, limit, sources, categories, scrapeOptions } = options;
    const { teamId, origin, apiKeyId, flags, requestId, bypassBilling, zeroDataRetention, billing, } = context;
    const num_results_buffer = Math.floor(limit * 2);
    logger.info("Searching for results");
    const searchTypes = [...new Set(sources.map((s) => s.type))];
    const { query: searchQuery, categoryMap } = (0, search_query_builder_1.buildSearchQuery)(query, categories);
    const searchResponse = (await (0, v2_1.search)({
        query: searchQuery,
        logger,
        advanced: false,
        num_results: num_results_buffer,
        tbs: options.tbs,
        filter: options.filter,
        lang: options.lang,
        country: options.country,
        location: options.location,
        type: searchTypes,
        enterprise: options.enterprise,
    }));
    if (searchResponse.web && searchResponse.web.length > 0) {
        searchResponse.web = searchResponse.web.map(result => ({
            ...result,
            category: (0, search_query_builder_1.getCategoryFromUrl)(result.url, categoryMap),
        }));
    }
    if (searchResponse.news && searchResponse.news.length > 0) {
        searchResponse.news = searchResponse.news.map(result => ({
            ...result,
            category: result.url
                ? (0, search_query_builder_1.getCategoryFromUrl)(result.url, categoryMap)
                : undefined,
        }));
    }
    let totalResultsCount = 0;
    if (searchResponse.web && searchResponse.web.length > 0) {
        if (searchResponse.web.length > limit) {
            searchResponse.web = searchResponse.web.slice(0, limit);
        }
        totalResultsCount += searchResponse.web.length;
    }
    if (searchResponse.images && searchResponse.images.length > 0) {
        if (searchResponse.images.length > limit) {
            searchResponse.images = searchResponse.images.slice(0, limit);
        }
        totalResultsCount += searchResponse.images.length;
    }
    if (searchResponse.news && searchResponse.news.length > 0) {
        if (searchResponse.news.length > limit) {
            searchResponse.news = searchResponse.news.slice(0, limit);
        }
        totalResultsCount += searchResponse.news.length;
    }
    const isZDR = options.enterprise?.includes("zdr");
    const creditsPerTenResults = isZDR ? 10 : 2;
    const searchCredits = Math.ceil(totalResultsCount / 10) * creditsPerTenResults;
    let scrapeCredits = 0;
    const shouldScrape = scrapeOptions?.formats && scrapeOptions.formats.length > 0;
    if (shouldScrape && scrapeOptions) {
        const itemsToScrape = (0, scrape_1.getItemsToScrape)(searchResponse, flags);
        if (itemsToScrape.length > 0) {
            const scrapeOpts = {
                teamId,
                origin,
                timeout: options.timeout,
                scrapeOptions,
                bypassBilling: bypassBilling ?? false,
                apiKeyId,
                zeroDataRetention,
                requestId,
                billing,
            };
            const allDocsWithCostTracking = await (0, scrape_1.scrapeSearchResults)(itemsToScrape.map(i => i.scrapeInput), scrapeOpts, logger, flags);
            (0, scrape_1.mergeScrapedContent)(searchResponse, itemsToScrape, allDocsWithCostTracking);
            scrapeCredits = (0, scrape_1.calculateScrapeCredits)(allDocsWithCostTracking);
        }
    }
    return {
        response: searchResponse,
        totalResultsCount,
        searchCredits,
        scrapeCredits,
        totalCredits: searchCredits + scrapeCredits,
        shouldScrape: shouldScrape ?? false,
    };
}
//# sourceMappingURL=execute.js.map