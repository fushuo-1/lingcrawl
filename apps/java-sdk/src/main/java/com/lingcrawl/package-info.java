/**
 * LingCrawl Java SDK — a type-safe client for the LingCrawl v2 web scraping API.
 *
 * <p>Quick start:
 * <pre>{@code
 * import com.lingcrawl.client.LingCrawlClient;
 * import com.lingcrawl.models.*;
 *
 * LingCrawlClient client = LingCrawlClient.builder()
 *     .apiKey("fc-your-api-key")
 *     .build();
 *
 * Document doc = client.scrape("https://example.com",
 *     ScrapeOptions.builder()
 *         .formats(List.of("markdown"))
 *         .build());
 *
 * System.out.println(doc.getMarkdown());
 * }</pre>
 *
 * @see com.lingcrawl.client.LingCrawlClient
 */
package com.lingcrawl;
