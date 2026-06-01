from lingcrawl.client import LingCrawl

# Initialize LingCrawl client
lingcrawl = LingCrawl(api_key="YOUR_API_KEY")

# =============================================================================
# SCRAPE EXAMPLES
# =============================================================================

# Basic scraping - Get markdown content
print("=== Basic Scrape (Markdown) ===")
# doc = lingcrawl.scrape("https://lingcrawl.dev", formats=["markdown"])
# print(doc.markdown)

# Scraping with location settings
print("\n=== Scrape with Location Settings ===")
# doc = lingcrawl.scrape('https://docs.lingcrawl.dev',
#     formats=['markdown'],
#     location={
#         'country': 'US',
#         'languages': ['en']
#     }
# )
# print(doc)

# Scraping with JSON extraction using Pydantic schema
print("\n=== Scrape with JSON Schema (Pydantic) ===")
# from pydantic import BaseModel
# 
# class JsonSchema(BaseModel):
#     company_mission: str
#     supports_sso: bool
#     is_open_source: bool
#     is_in_yc: bool
# 
# result = lingcrawl.scrape(
#     'https://lingcrawl.dev',
#     formats=[{
#       "type": "json",
#       "schema": JsonSchema
#     }],
#     only_main_content=False,
#     max_age=120000000
# )
# print(result)

# Scraping with JSON extraction using prompt
print("\n=== Scrape with JSON Prompt ===")
# result = lingcrawl.scrape(
#     'https://lingcrawl.dev',
#     formats=[{
#       "type": "json",
#       "prompt": "Extract the company mission from the page."
#     }],
#     only_main_content=False,
#     timeout=120000
# )
# print(result.json["companyMission"])

# Advanced scraping with multiple formats and options
print("\n=== Advanced Scrape (Multiple Formats + Options) ===")
# response = lingcrawl.scrape('https://docs.lingcrawl.dev',
#     formats=[
#         'markdown',
#         { 'type': 'json', 'schema': { 'type': 'object', 'properties': { 'title': { 'type': 'string' } } } }
#     ],
#     proxy='auto',
#     max_age=600000,
#     only_main_content=True
# )
# print(response)

# =============================================================================
# CRAWL EXAMPLES
# =============================================================================

# Basic crawling
print("\n=== Basic Crawl ===")
# docs = lingcrawl.crawl(url="https://docs.lingcrawl.dev", limit=10)  
# print(docs)

# =============================================================================
# BATCH SCRAPE EXAMPLES
# =============================================================================

# Batch scraping multiple URLs
print("\n=== Batch Scrape ===")
# from lingcrawl import LingCrawl
# 
# lingcrawl = LingCrawl(api_key="fc-YOUR-API-KEY")
# 
# job = lingcrawl.batch_scrape([
#     "https://lingcrawl.dev",
#     "https://docs.lingcrawl.dev",
# ], formats=["markdown"], poll_interval=2, wait_timeout=120)
# print(job)

# =============================================================================
# SEARCH EXAMPLES
# =============================================================================

# Search functionality
print("\n=== Search ===")
# search = lingcrawl.search(query="lingcrawl", sources=[{"type": "web"}], limit=5)
# print(search.web[0].title)

# =============================================================================
# MAP EXAMPLES
# =============================================================================

# Website mapping
print("\n=== Map Website ===")
# res = lingcrawl.map(url="https://lingcrawl.dev", limit=50, sitemap="include", search="price")
# print(res.links[0].url)
# print(res.links[1].url)
# print(res.links[2].url)
# print(res.links[3].url)

# =============================================================================
# EXTRACT EXAMPLES
# =============================================================================

# Data extraction with schema
print("\n=== Extract with Schema ===")
# schema = {
#     "type": "object",
#     "properties": {"title": {"type": "string"}},
#     "required": ["title"],
# }
# 
# res = lingcrawl.extract(
#     urls=["https://docs.lingcrawl.dev"],
#     prompt="Extract the page title",
#     schema=schema,
# )
# print(res.data["title"])