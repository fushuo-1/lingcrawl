"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fire_engine_search = fire_engine_search;
exports.fireEngineMap = fireEngineMap;
const config_1 = require("../config");
const logger_1 = require("../lib/logger");
const retry_utils_1 = require("../lib/retry-utils");
const useFireEngine = config_1.config.FIRE_ENGINE_BETA_URL !== "" &&
    config_1.config.FIRE_ENGINE_BETA_URL !== undefined;
function hasResults(results) {
    return Array.isArray(results) && results.length > 0;
}
async function fire_engine_search(q, options, abort) {
    if (!useFireEngine) {
        return [];
    }
    const payload = {
        query: q,
        lang: options.lang,
        country: options.country,
        location: options.location,
        tbs: options.tbs,
        numResults: options.numResults,
        page: options.page ?? 1,
    };
    const url = `${config_1.config.FIRE_ENGINE_BETA_URL}/search`;
    const data = JSON.stringify(payload);
    const result = await (0, retry_utils_1.executeWithRetry)(() => (0, retry_utils_1.attemptRequest)(url, data, abort), hasResults, abort);
    return result ?? [];
}
async function fireEngineMap(q, options, abort) {
    if (!useFireEngine) {
        logger_1.logger.warn("(v1/map Beta) Results might differ from cloud offering currently.");
        return [];
    }
    const payload = {
        query: q,
        lang: options.lang,
        country: options.country,
        location: options.location,
        tbs: options.tbs,
        numResults: options.numResults,
        page: options.page ?? 1,
    };
    const url = `${config_1.config.FIRE_ENGINE_BETA_URL}/map`;
    const data = JSON.stringify(payload);
    const result = await (0, retry_utils_1.executeWithRetry)(() => (0, retry_utils_1.attemptRequest)(url, data, abort), hasResults, abort);
    return result ?? [];
}
//# sourceMappingURL=fireEngine.js.map