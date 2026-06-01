package com.lingcrawl.errors;

/**
 * Thrown when the API returns a 401 Unauthorized response.
 */
public class AuthenticationException extends LingCrawlException {

    public AuthenticationException(String message) {
        super(message, 401);
    }

    public AuthenticationException(String message, String errorCode, Object details) {
        super(message, 401, errorCode, details);
    }
}
