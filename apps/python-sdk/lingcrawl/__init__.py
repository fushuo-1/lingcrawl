"""
LingCrawl Python SDK
"""

import logging
import os

from .client import LingCrawlClient
from .client_async import AsyncLingCrawlClient
from .watcher import Watcher
from .watcher_async import AsyncWatcher

__version__ = "4.19.0"

logger: logging.Logger = logging.getLogger("lingcrawl")


def _configure_logger() -> None:
    try:
        formatter = logging.Formatter(
            "[%(asctime)s - %(name)s:%(lineno)d - %(levelname)s] %(message)s",
            datefmt="%Y-%m-%d %H:%M:%S",
        )
        console_handler = logging.StreamHandler()
        console_handler.setFormatter(formatter)
        logger.addHandler(console_handler)
    except Exception as e:
        logger.error("Failed to configure logging: %s", e)


def setup_logging() -> None:
    if logger.hasHandlers():
        return
    if not (env := os.getenv("LINGCRAWL_LOGGING_LEVEL", "").upper()):
        logger.addHandler(logging.NullHandler())
        return
    _configure_logger()
    levels = {"DEBUG": logging.DEBUG, "INFO": logging.INFO, "WARNING": logging.WARNING,
              "ERROR": logging.ERROR, "CRITICAL": logging.CRITICAL}
    logger.setLevel(levels.get(env, logging.INFO))
    if env not in levels:
        logger.warning("Unknown logging level: %s, defaulting to INFO", env)

setup_logging()

# Aliases
LingCrawl = LingCrawlClient
AsyncLingCrawl = AsyncLingCrawlClient
LingCrawlApp = LingCrawlClient
AsyncLingCrawlApp = AsyncLingCrawlClient

__all__ = [
    'LingCrawlClient',
    'AsyncLingCrawlClient',
    'LingCrawl',
    'AsyncLingCrawl',
    'LingCrawlApp',
    'AsyncLingCrawlApp',
    'Watcher',
    'AsyncWatcher',
]
