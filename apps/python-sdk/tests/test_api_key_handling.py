import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from lingcrawl.v2.client import LingCrawlClient
from lingcrawl.v2.client_async import AsyncLingCrawlClient


@pytest.fixture(autouse=True)
def clear_lingcrawl_api_key_env(monkeypatch):
    monkeypatch.delenv("LINGCRAWL_API_KEY", raising=False)
    yield


def test_cloud_requires_api_key():
    with pytest.raises(ValueError):
        LingCrawlClient(api_url="https://api.lingcrawl.dev")


def test_self_host_allows_missing_api_key():
    client = LingCrawlClient(api_url="http://localhost:3000")
    assert client.http_client.api_key is None


def test_async_cloud_requires_api_key():
    with pytest.raises(ValueError):
        AsyncLingCrawlClient(api_url="https://api.lingcrawl.dev")


@pytest.mark.asyncio
async def test_async_self_host_allows_missing_api_key():
    client = AsyncLingCrawlClient(api_url="http://localhost:3000")
    try:
        assert client.http_client.api_key is None
        await client.async_http_client.close()
    finally:
        # Ensure the underlying HTTPX client is closed even if assertions fail
        if not client.async_http_client._client.is_closed:
            await client.async_http_client.close()
