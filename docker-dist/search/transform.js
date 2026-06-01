"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.transformToV1Response = transformToV1Response;
exports.filterDocumentsWithContent = filterDocumentsWithContent;
function transformToV1Response(searchResponse) {
    const documents = [];
    if (searchResponse.web && searchResponse.web.length > 0) {
        for (const item of searchResponse.web) {
            documents.push({
                ...item,
                url: item.url,
                title: item.title,
                description: item.description,
            });
        }
    }
    if (searchResponse.news && searchResponse.news.length > 0) {
        for (const item of searchResponse.news) {
            if (item.url) {
                documents.push({
                    ...item,
                    url: item.url,
                    title: item.title || "",
                    description: item.snippet || "",
                });
            }
        }
    }
    if (searchResponse.images && searchResponse.images.length > 0) {
        for (const item of searchResponse.images) {
            if (item.url) {
                documents.push({
                    ...item,
                    url: item.url,
                    title: item.title || "",
                    description: "",
                });
            }
        }
    }
    return documents;
}
function filterDocumentsWithContent(documents) {
    return documents.filter(doc => doc.serpResults || (doc.markdown && doc.markdown.trim().length > 0));
}
//# sourceMappingURL=transform.js.map