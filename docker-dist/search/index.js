"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.search = search;
const searxng_1 = require("./searxng");
async function search({ query, logger, advanced = false, num_results = 5, tbs = undefined, filter = undefined, lang = undefined, country = "us", location = undefined, proxy = undefined, sleep_interval = 0, timeout = 5000, type = undefined, enterprise = undefined, }) {
    try {
        logger.info("Using SearXNG search");
        return await (0, searxng_1.searxng_search)(query, {
            num_results,
            lang,
            tbs,
        });
    }
    catch (error) {
        logger.error(`Error in search function`, { error });
        return {};
    }
}
//# sourceMappingURL=index.js.map
