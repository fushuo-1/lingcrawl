"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fire_engine_search_v2 = fire_engine_search_v2;
const config_1 = require("../../config");
const logger_1 = require("../../lib/logger");
const retry_utils_1 = require("../../lib/retry-utils");
const useFireEngine = config_1.config.FIRE_ENGINE_BETA_URL !== "" &&
    config_1.config.FIRE_ENGINE_BETA_URL !== undefined;
function normalizeSearchTypes(type) {
    if (!type)
        return ["web"];
    return Array.isArray(type) ? type : [type];
}
/**
 * Checks if the response has at least one requested type with results.
 * This allows partial results to be returned when some sources have data
 * but others don't, instead of requiring all sources to have results.
 *
 * MOGERY: temp removed to fix bug
 */
// function hasAnyResults(
//   response: SearchV2Response,
//   requestedTypes: SearchResultType[],
// ): boolean {
//   if (!response || Object.keys(response).length === 0) return false;
//   return requestedTypes.some(type => {
//     const results = response[type];
//     return Array.isArray(results) && results.length > 0;
//   });
// }
async function fire_engine_search_v2(q, options, abort) {
    if (!useFireEngine) {
        logger_1.logger.warn("FIRE_ENGINE_BETA_URL is not configured, returning empty search results");
        return {};
    }
    const payload = {
        query: q,
        lang: options.lang,
        country: options.country,
        location: options.location,
        tbs: options.tbs,
        numResults: options.numResults,
        page: options.page ?? 1,
        type: options.type || "web",
        enterprise: options.enterprise,
    };
    const requestedTypes = normalizeSearchTypes(options.type);
    const url = `${config_1.config.FIRE_ENGINE_BETA_URL}/v2/search`;
    const data = JSON.stringify(payload);
    const result = await (0, retry_utils_1.executeWithRetry)(() => (0, retry_utils_1.attemptRequest)(url, data, abort), (response) => response !== null, abort);
    return result ?? {};
}
//# sourceMappingURL=fireEngine-v2.js.map