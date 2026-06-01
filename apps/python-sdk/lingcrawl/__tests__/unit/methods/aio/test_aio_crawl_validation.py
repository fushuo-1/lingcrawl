from lingcrawl.types import CrawlRequest, ScrapeOptions
from lingcrawl.methods.aio.crawl import _prepare_crawl_request
import pytest


class TestAsyncCrawlValidation:
    def test_invalid_url(self):
        with pytest.raises(ValueError):
            _prepare_crawl_request(CrawlRequest(url=""))
        with pytest.raises(ValueError):
            _prepare_crawl_request(CrawlRequest(url="   "))

