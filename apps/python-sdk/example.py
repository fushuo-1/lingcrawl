#!/usr/bin/env python3
"""
Minimal examples for LingCrawl v2.
"""

import os
from dotenv import load_dotenv
from lingcrawl import LingCrawl
 

load_dotenv()

def main():
    api_key = os.getenv("LINGCRAWL_API_KEY")
    if not api_key:
        raise ValueError("LINGCRAWL_API_KEY is not set")
    
    api_url = os.getenv("LINGCRAWL_API_URL")
    if not api_url:
        raise ValueError("LINGCRAWL_API_URL is not set")

    lingcrawl = LingCrawl(api_key=api_key, api_url=api_url)

    # Scrape
    doc = lingcrawl.scrape("https://docs.lingcrawl.dev", formats=["markdown"])
    print("scrape:", doc.markdown)
    # doc.metadata_dict is a dict, doc.metadata_typed is a DocumentMetadata object
    print(doc.metadata_dict.get("source_url"))
    print('metadata_dict.get("title"):', doc.metadata_dict.get("title"))
    print("metadata_typed.title:", doc.metadata_typed.title)
    print("metadata.title", doc.metadata.title if doc.metadata else None)


    # Crawl (waits until terminal state)
    crawl_job = lingcrawl.crawl("https://docs.lingcrawl.dev", limit=3, poll_interval=1, timeout=120)
    print("crawl:", crawl_job.status, crawl_job.completed, "/", crawl_job.total)

    # Batch scrape
    batch = lingcrawl.batch_scrape([
        "https://docs.lingcrawl.dev",
        "https://lingcrawl.dev",
    ], formats=["markdown"], poll_interval=1, wait_timeout=120)
    print("batch:", batch.status, batch.completed, "/", batch.total)

    # Search
    search_response = lingcrawl.search(query="What is the capital of France?", limit=5)
    print("search web results:", len(getattr(search_response, "web", []) or []))

    # Map
    map_response = lingcrawl.map("https://lingcrawl.dev")
    print("map links:", len(getattr(map_response, "links", []) or []))

if __name__ == "__main__":
    main()
