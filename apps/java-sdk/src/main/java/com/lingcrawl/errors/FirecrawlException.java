package com.lingcrawl.errors;

/**
 * Base exception for all LingCrawl SDK errors.
 */
public class LingCrawlException extends RuntimeException {

    private final int statusCode;
    private final String errorCode;
    private final Object details;

    public LingCrawlException(String message) {
        this(message, 0, null, null);
    }

    public LingCrawlException(String message, int statusCode) {
        this(message, statusCode, null, null);
    }

    public LingCrawlException(String message, int statusCode, String errorCode, Object details) {
        super(message);
        this.statusCode = statusCode;
        this.errorCode = errorCode;
        this.details = details;
    }

    public LingCrawlException(String message, Throwable cause) {
        super(message, cause);
        this.statusCode = 0;
        this.errorCode = null;
        this.details = null;
    }

    /** HTTP status code (0 if not an HTTP error). */
    public int getStatusCode() { return statusCode; }

    /** Error code from the API response, if any. */
    public String getErrorCode() { return errorCode; }

    /** Additional error details from the API response, if any. */
    public Object getDetails() { return details; }
}
