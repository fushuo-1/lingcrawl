use lingcrawl::LingCrawlApp;
use std::error::Error;
use std::time::Duration;

#[tokio::main]
async fn main() -> Result<(), Box<dyn Error>> {
    // Get API URL from environment
    let api_url = std::env::var("LINGCRAWL_API_URL")
        .expect("Please set the LINGCRAWL_API_URL environment variable");

    // Create the LingCrawlApp instance
    let lingcrawl = LingCrawlApp::new_selfhosted(api_url, None::<&str>)?;

    // Start a crawl job
    println!("Starting a crawl job...");
    let crawl_response = lingcrawl
        .crawl_url_async("https://example.com", None)
        .await?;
    println!("Crawl job started with ID: {}", crawl_response.id);

    // Wait for a moment to let the crawl job start
    println!("Waiting for a moment...");
    tokio::time::sleep(Duration::from_secs(2)).await;

    // Cancel the crawl job
    println!("Cancelling the crawl job...");
    let cancel_response = lingcrawl.cancel_crawl(&crawl_response.id).await?;

    println!("Cancellation result:");
    println!("  Status: {:?}", cancel_response.status);

    Ok(())
}
