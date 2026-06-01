package com.lingcrawl.errors;

/**
 * Thrown when the API returns a 429 Too Many Requests response.
 */
public class RateLimitException extends LingCrawlException {

    public RateLimitException(String message) {
        super(message, 429);
    }

    public RateLimitException(String message, String errorCode, Object details) {
        super(message, 429, errorCode, details);
    }
}
