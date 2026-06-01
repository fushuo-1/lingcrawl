package com.lingcrawl;

import com.lingcrawl.client.LingCrawlClient;
import com.lingcrawl.errors.LingCrawlException;
import com.lingcrawl.models.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;

import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Integration tests for the LingCrawl Java SDK.
 *
 * <p>These tests require a valid LINGCRAWL_API_KEY environment variable.
 * Run with: LINGCRAWL_API_KEY=fc-xxx ./gradlew test
 */
class LingCrawlClientTest {

    @Test
    void testBuilderRequiresApiKey() {
        assertThrows(LingCrawlException.class, () ->
                LingCrawlClient.builder().apiKey("").build()
        );
    }

    @Test
    void testBuilderAcceptsApiKey() {
        // Should not throw — just validates construction
        LingCrawlClient client = LingCrawlClient.builder()
                .apiKey("fc-test-key")
                .build();
        assertNotNull(client);
    }

    @Test
    void testScrapeOptionsBuilder() {
        ScrapeOptions options = ScrapeOptions.builder()
                .formats(List.of("markdown", "html"))
                .onlyMainContent(true)
                .timeout(30000)
                .mobile(false)
                .build();

        assertEquals(List.of("markdown", "html"), options.getFormats());
        assertTrue(options.getOnlyMainContent());
        assertEquals(30000, options.getTimeout());
        assertFalse(options.getMobile());
    }

    @Test
    void testCrawlOptionsBuilder() {
        CrawlOptions options = CrawlOptions.builder()
                .limit(100)
                .maxDiscoveryDepth(3)
                .sitemap("include")
                .excludePaths(List.of("/admin/*"))
                .build();

        assertEquals(100, options.getLimit());
        assertEquals(3, options.getMaxDiscoveryDepth());
        assertEquals("include", options.getSitemap());
        assertEquals(List.of("/admin/*"), options.getExcludePaths());
    }

    @Test
    void testAgentOptionsRequiresPrompt() {
        assertThrows(IllegalArgumentException.class, () ->
                AgentOptions.builder().build()
        );
    }

    @Test
    void testWebhookConfigRequiresUrl() {
        assertThrows(IllegalArgumentException.class, () ->
                WebhookConfig.builder().build()
        );
    }

    @Test
    void testScrapeOptionsToBuilder() {
        ScrapeOptions original = ScrapeOptions.builder()
                .formats(List.of("markdown"))
                .timeout(5000)
                .build();

        ScrapeOptions modified = original.toBuilder()
                .timeout(10000)
                .build();

        assertEquals(5000, original.getTimeout());
        assertEquals(10000, modified.getTimeout());
        assertEquals(List.of("markdown"), modified.getFormats());
    }

    @Test
    void testBrowserExecuteRequiresSessionId() {
        LingCrawlClient client = LingCrawlClient.builder()
                .apiKey("fc-test-key")
                .build();
        assertThrows(NullPointerException.class, () ->
                client.browserExecute(null, "echo test")
        );
    }

    @Test
    void testBrowserDeleteRequiresSessionId() {
        LingCrawlClient client = LingCrawlClient.builder()
                .apiKey("fc-test-key")
                .build();
        assertThrows(NullPointerException.class, () ->
                client.deleteBrowser(null)
        );
    }

    // ================================================================
    // E2E TESTS (require LINGCRAWL_API_KEY)
    // ================================================================

    @Test
    @EnabledIfEnvironmentVariable(named = "LINGCRAWL_API_KEY", matches = ".*\\S.*")
    void testScrapeE2E() {
        LingCrawlClient client = LingCrawlClient.fromEnv();
        Document doc = client.scrape("https://example.com",
                ScrapeOptions.builder()
                        .formats(List.of("markdown"))
                        .build());

        assertNotNull(doc);
        assertNotNull(doc.getMarkdown());
        assertFalse(doc.getMarkdown().isEmpty());
    }

    @Test
    @EnabledIfEnvironmentVariable(named = "LINGCRAWL_API_KEY", matches = ".*\\S.*")
    void testMapE2E() {
        LingCrawlClient client = LingCrawlClient.fromEnv();
        MapData data = client.map("https://example.com",
                MapOptions.builder()
                        .limit(10)
                        .build());

        assertNotNull(data);
        assertNotNull(data.getLinks());
    }

    @Test
    @EnabledIfEnvironmentVariable(named = "LINGCRAWL_API_KEY", matches = ".*\\S.*")
    void testCrawlE2E() {
        LingCrawlClient client = LingCrawlClient.fromEnv();
        CrawlJob job = client.crawl("https://example.com",
                CrawlOptions.builder()
                        .limit(3)
                        .build(),
                2, 60);

        assertNotNull(job);
        assertEquals("completed", job.getStatus());
        assertNotNull(job.getData());
        assertFalse(job.getData().isEmpty());
    }

    @Test
    @EnabledIfEnvironmentVariable(named = "LINGCRAWL_API_KEY", matches = ".*\\S.*")
    void testSearchE2E() {
        LingCrawlClient client = LingCrawlClient.fromEnv();
        SearchData data = client.search("lingcrawl web scraping",
                SearchOptions.builder()
                        .limit(5)
                        .build());

        assertNotNull(data);
    }

    @Test
    @EnabledIfEnvironmentVariable(named = "LINGCRAWL_API_KEY", matches = ".*\\S.*")
    void testConcurrencyE2E() {
        LingCrawlClient client = LingCrawlClient.fromEnv();
        ConcurrencyCheck check = client.getConcurrency();

        assertNotNull(check);
        assertTrue(check.getMaxConcurrency() > 0);
    }

    @Test
    @EnabledIfEnvironmentVariable(named = "LINGCRAWL_API_KEY", matches = ".*\\S.*")
    void testCreditUsageE2E() {
        LingCrawlClient client = LingCrawlClient.fromEnv();
        CreditUsage usage = client.getCreditUsage();

        assertNotNull(usage);
    }
}
