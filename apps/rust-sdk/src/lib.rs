//! LingCrawl Rust SDK
//!
//! This SDK provides access to the LingCrawl API for web scraping and crawling.
//!
//! # Quick Start
//!
//! ```no_run
//! use lingcrawl::Client;
//!
//! #[tokio::main]
//! async fn main() -> Result<(), Box<dyn std::error::Error>> {
//!     let client = Client::new("your-api-key")?;
//!     let document = client.scrape("https://example.com", None).await?;
//!     println!("{:?}", document.markdown);
//!     Ok(())
//! }
//! ```

use reqwest::{Client, Response};
use serde::de::DeserializeOwned;
use serde_json::Value;

pub mod agent;
pub mod batch_scrape;
pub mod client;
pub mod crawl;
pub mod document;
pub mod error;
pub mod extract;
pub mod map;
pub mod scrape;
pub mod search;
pub(crate) mod serde_helpers;
pub mod types;

// Re-export key types
pub use agent::*;
pub use batch_scrape::*;
pub use client::Client;
pub use crawl::*;
pub use error::LingCrawlError;
pub use map::*;
pub use scrape::*;
pub use search::*;
pub use types::*;

use error::LingCrawlAPIError;

#[derive(Clone, Debug)]
pub struct LingCrawlApp {
    api_key: Option<String>,
    api_url: String,
    client: Client,
}

pub(crate) const API_VERSION: &str = "/v2";
const CLOUD_API_URL: &str = "https://api.lingcrawl.dev";

impl LingCrawlApp {
    pub fn new(api_key: impl AsRef<str>) -> Result<Self, LingCrawlError> {
        LingCrawlApp::new_selfhosted(CLOUD_API_URL, Some(api_key))
    }

    pub fn new_selfhosted(
        api_url: impl AsRef<str>,
        api_key: Option<impl AsRef<str>>,
    ) -> Result<Self, LingCrawlError> {
        let url = api_url.as_ref().to_string();

        if url == CLOUD_API_URL && api_key.is_none() {
            return Err(LingCrawlError::APIError(
                "Configuration".to_string(),
                LingCrawlAPIError {
                    success: false,
                    error: "API key is required for cloud service".to_string(),
                    details: None,
                },
            ));
        }

        Ok(LingCrawlApp {
            api_key: api_key.map(|x| x.as_ref().to_string()),
            api_url: url,
            client: Client::new(),
        })
    }

    fn prepare_headers(&self, idempotency_key: Option<&String>) -> reqwest::header::HeaderMap {
        let mut headers = reqwest::header::HeaderMap::new();
        headers.insert("Content-Type", "application/json".parse().unwrap());
        if let Some(api_key) = self.api_key.as_ref() {
            headers.insert(
                "Authorization",
                format!("Bearer {}", api_key).parse().unwrap(),
            );
        }
        if let Some(key) = idempotency_key {
            headers.insert("x-idempotency-key", key.parse().unwrap());
        }
        headers
    }

    async fn handle_response<'a, T: DeserializeOwned>(
        &self,
        response: Response,
        action: impl AsRef<str>,
    ) -> Result<T, LingCrawlError> {
        let (is_success, status) = (response.status().is_success(), response.status());

        let response = response
            .text()
            .await
            .map_err(|e| LingCrawlError::ResponseParseErrorText(e))
            .and_then(|response_json| {
                serde_json::from_str::<Value>(&response_json)
                    .map_err(|e| LingCrawlError::ResponseParseError(e))
                    .inspect(|data| {
                        tracing::debug!("Response JSON: {:#?}", data);
                    })
            })
            .and_then(|response_value| {
                if action.as_ref().starts_with("crawl_")
                    || response_value["success"].as_bool().unwrap_or(false)
                {
                    Ok(serde_json::from_value::<T>(response_value)
                        .map_err(|e| LingCrawlError::ResponseParseError(e))?)
                } else {
                    Err(LingCrawlError::APIError(
                        action.as_ref().to_string(),
                        serde_json::from_value(response_value)
                            .map_err(|e| LingCrawlError::ResponseParseError(e))?,
                    ))
                }
            });

        match &response {
            Ok(_) => response,
            Err(LingCrawlError::ResponseParseError(_))
            | Err(LingCrawlError::ResponseParseErrorText(_)) => {
                if is_success {
                    response
                } else {
                    Err(LingCrawlError::HttpRequestFailed(
                        action.as_ref().to_string(),
                        status.as_u16(),
                        status.as_str().to_string(),
                    ))
                }
            }
            Err(_) => response,
        }
    }
}
