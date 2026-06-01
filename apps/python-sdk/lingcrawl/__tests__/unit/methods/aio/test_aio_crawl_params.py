import pytest
from lingcrawl.types import CrawlParamsRequest
from lingcrawl.methods.aio import crawl as aio_crawl


@pytest.mark.asyncio
async def test_crawl_params_request_validation():
    with pytest.raises(ValueError):
        await aio_crawl.crawl_params_preview(None, CrawlParamsRequest(url="", prompt="x"))
    with pytest.raises(ValueError):
        await aio_crawl.crawl_params_preview(None, CrawlParamsRequest(url="https://x", prompt=""))

