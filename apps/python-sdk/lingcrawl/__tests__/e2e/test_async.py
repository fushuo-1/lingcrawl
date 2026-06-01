import os
import asyncio
import pytest
from dotenv import load_dotenv

from lingcrawl import AsyncLingCrawl
from lingcrawl.types import Document


load_dotenv()

if not os.getenv("API_KEY"):
    raise ValueError("API_KEY is not set")

if not os.getenv("API_URL"):
    raise ValueError("API_URL is not set")


@pytest.mark.asyncio
async def test_async_scrape_minimal():
    client = AsyncLingCrawl(api_key=os.getenv("API_KEY"), api_url=os.getenv("API_URL"))
    doc = await client.scrape("https://docs.lingcrawl.dev")
    assert isinstance(doc, Document)
    # Accept any primary content or alternate outputs
    assert doc.markdown is not None and doc.markdown and len(doc.markdown) > 0


@pytest.mark.asyncio
async def test_async_crawl_start_and_status():
    client = AsyncLingCrawl(api_key=os.getenv("API_KEY"), api_url=os.getenv("API_URL"))
    start = await client.start_crawl("https://docs.lingcrawl.dev", limit=2)
    job_id = start.id

    # Poll status until terminal or timeout
    deadline = asyncio.get_event_loop().time() + 180
    status = await client.get_crawl_status(job_id)
    while status.status not in ("completed", "failed") and asyncio.get_event_loop().time() < deadline:
        await asyncio.sleep(2)
        status = await client.get_crawl_status(job_id)

    assert status.status in ("completed", "failed")


@pytest.mark.asyncio
async def test_async_batch_start_and_status():
    client = AsyncLingCrawl(api_key=os.getenv("API_KEY"), api_url=os.getenv("API_URL"))
    start = await client.start_batch_scrape([
        "https://docs.lingcrawl.dev",
        "https://lingcrawl.dev",
    ], formats=["markdown"], max_concurrency=1)
    job_id = start.id

    deadline = asyncio.get_event_loop().time() + 240
    status = await client.get_batch_scrape_status(job_id)
    while status.status not in ("completed", "failed", "cancelled") and asyncio.get_event_loop().time() < deadline:
        await asyncio.sleep(2)
        status = await client.get_batch_scrape_status(job_id)

    assert status.status in ("completed", "failed", "cancelled")


@pytest.mark.asyncio
async def test_async_usage_minimal():
    client = AsyncLingCrawl(api_key=os.getenv("API_KEY"), api_url=os.getenv("API_URL"))
    conc = await client.get_concurrency()
    assert hasattr(conc, "concurrency") and hasattr(conc, "max_concurrency")

    credits = await client.get_credit_usage()
    assert hasattr(credits, "remaining_credits")

    tokens = await client.get_token_usage()
    assert hasattr(tokens, "remaining_tokens")

