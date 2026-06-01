<h3 align="center">
  <a name="readme-top"></a>
  <img
    src="https://raw.githubusercontent.com/lingcrawl/lingcrawl/main/img/lingcrawl_logo.png"
    height="200"
  >
</h3>

<div align="center">
  <a href="https://github.com/lingcrawl/lingcrawl/blob/main/LICENSE">
    <img src="https://img.shields.io/github/license/lingcrawl/lingcrawl" alt="License">
  </a>
  <a href="https://pepy.tech/project/lingcrawl-py">
    <img src="https://static.pepy.tech/badge/lingcrawl-py" alt="Downloads">
  </a>
  <a href="https://GitHub.com/lingcrawl/lingcrawl/graphs/contributors">
    <img src="https://img.shields.io/github/contributors/lingcrawl/lingcrawl.svg" alt="GitHub Contributors">
  </a>
  <a href="https://lingcrawl.dev">
    <img src="https://img.shields.io/badge/Visit-lingcrawl.dev-orange" alt="Visit lingcrawl.dev">
  </a>
</div>

<div>
  <p align="center">
    <a href="https://twitter.com/lingcrawl">
      <img src="https://img.shields.io/badge/Follow%20on%20X-000000?style=for-the-badge&logo=x&logoColor=white" alt="Follow on X" />
    </a>
    <a href="https://www.linkedin.com/company/104100957">
      <img src="https://img.shields.io/badge/Follow%20on%20LinkedIn-0077B5?style=for-the-badge&logo=linkedin&logoColor=white" alt="Follow on LinkedIn" />
    </a>
    <a href="https://discord.gg/lingcrawl">
      <img src="https://img.shields.io/badge/Join%20our%20Discord-5865F2?style=for-the-badge&logo=discord&logoColor=white" alt="Join our Discord" />
    </a>
  </p>
</div>

---

# **🔥 LingCrawl**

**Turn websites into LLM-ready data.** 

[**LingCrawl**](https://lingcrawl.dev/?ref=github) is an API that scrapes, crawls, and extracts structured data from any website, powering AI agents and apps with real-time context from the web.

Looking for our MCP? Check out the repo [here](https://github.com/lingcrawl/lingcrawl-mcp-server).

*This repository is in development, and we're still integrating custom modules into the mono repo. It's not fully ready for self-hosted deployment yet, but you can run it locally.*

_Pst. Hey, you, join our stargazers :)_

<a href="https://github.com/lingcrawl/lingcrawl">
  <img src="https://img.shields.io/github/stars/lingcrawl/lingcrawl.svg?style=social&label=Star&maxAge=2592000" alt="GitHub stars">
</a>

---

## Why LingCrawl?

- **LLM-ready output**: Clean markdown, structured JSON, screenshots, HTML, and more
- **Industry-leading reliability**: >80% coverage on [benchmark evaluations](https://www.lingcrawl.dev/blog/the-worlds-best-web-data-api-v25), outperforming every other provider tested
- **Handles the hard stuff**: Proxies, JavaScript rendering, and dynamic content that breaks other scrapers
- **Customization**: Exclude tags, crawl behind auth walls, max depth, and more
- **Media parsing**: Automatic text extraction from PDFs, DOCX, and images
- **Actions**: Click, scroll, input, wait, and more before extracting
- **Batch processing**: Scrape thousands of URLs asynchronously
- **Change tracking**: Monitor website content changes over time

---

## Quick Start

Sign up at [lingcrawl.dev](https://lingcrawl.dev) to get your API key and start extracting data in seconds. Try the [playground](https://lingcrawl.dev/playground) to test it out.

### Make Your First API Request
```bash
curl -X POST 'https://api.lingcrawl.dev/v2/scrape' \
  -H 'Authorization: Bearer fc-YOUR_API_KEY' \
  -H 'Content-Type: application/json' \
  -d '{"url": "https://example.com"}'
```

Response:
```json
{
  "success": true,
  "data": {
    "markdown": "# Example Domain\n\nThis domain is for use in illustrative examples...",
    "metadata": {
      "title": "Example Domain",
      "sourceURL": "https://example.com"
    }
  }
}
```

### Install the LingCrawl Skill & CLI

The LingCrawl Skill is an easy way for AI agents such as [Claude Code](https://claude.ai/code), [Antigravity](https://antigravity.google) and [OpenCode](https://opencode.ai) to use LingCrawl through the CLI.

Install and configure the skill for all detected AI coding agents:
```bash
npx -y lingcrawl-cli@latest init --all --browser
```

After installing, restart your agent for it to discover the new skill.

You can also install the CLI globally:
```bash
npm install -g lingcrawl-cli
```

Authenticate with your API key:
```bash
# Interactive login (opens browser)
lingcrawl login --browser

# Or login with API key directly
lingcrawl login --api-key fc-YOUR_API_KEY

# Or set via environment variable
export LINGCRAWL_API_KEY=fc-YOUR_API_KEY
```

Try a quick scrape:
```bash
lingcrawl https://example.com --only-main-content
```

See the full [Skill + CLI documentation](https://docs.lingcrawl.dev/sdks/cli) for all available commands including search, map, crawl, agent, and browser automation.

---

## Feature Overview

| Feature | Description |
|---------|-------------|
| [**Scrape**](#scraping) | Convert any URL to markdown, HTML, screenshots, or structured JSON |
| [**Search**](#search) | Search the web and get full page content from results |
| [**Browse**](#browse) | Let agents safely interact with the web |
| [**Map**](#map) | Discover all URLs on a website instantly |
| [**Crawl**](#crawling) | Scrape all URLs of a website with a single request |
| [**Agent**](#agent) | Automated data gathering, just describe what you need |
---

## Scrape

Convert any URL to clean markdown, HTML, or structured data.
```bash
curl -X POST 'https://api.lingcrawl.dev/v2/scrape' \
  -H 'Authorization: Bearer fc-YOUR_API_KEY' \
  -H 'Content-Type: application/json' \
  -d '{
    "url": "https://docs.lingcrawl.dev",
    "formats": ["markdown", "html"]
  }'
```

Response:
```json
{
  "success": true,
  "data": {
    "markdown": "# LingCrawl Docs\n\nTurn websites into LLM-ready data...",
    "html": "<!DOCTYPE html><html>...",
    "metadata": {
      "title": "Quickstart | LingCrawl",
      "description": "LingCrawl allows you to turn entire websites into LLM-ready markdown",
      "sourceURL": "https://docs.lingcrawl.dev",
      "statusCode": 200
    }
  }
}
```

### Extract Structured Data (JSON Mode)

Extract structured data using a schema:
```python
from lingcrawl import LingCrawl
from pydantic import BaseModel

app = LingCrawl(api_key="fc-YOUR_API_KEY")

class CompanyInfo(BaseModel):
    company_mission: str
    is_open_source: bool
    is_in_yc: bool

result = app.scrape(
    'https://lingcrawl.dev',
    formats=[{"type": "json", "schema": CompanyInfo.model_json_schema()}]
)

print(result.json)
```
```json
{"company_mission": "Turn websites into LLM-ready data", "is_open_source": true, "is_in_yc": true}
```

Or extract with just a prompt (no schema):
```python
result = app.scrape(
    'https://lingcrawl.dev',
    formats=[{"type": "json", "prompt": "Extract the company mission"}]
)
```

### Scrape Formats

Available formats: `markdown`, `html`, `rawHtml`, `screenshot`, `links`, `json`, `branding`

**Get a screenshot**
```python
doc = app.scrape("https://lingcrawl.dev", formats=["screenshot"])
print(doc.screenshot)  # Base64 encoded image
```

**Extract brand identity (colors, fonts, typography)**
```python
doc = app.scrape("https://lingcrawl.dev", formats=["branding"])
print(doc.branding)  # {"colors": {...}, "fonts": [...], "typography": {...}}
```

### Actions (Interact Before Scraping)

Click, type, scroll, and more before extracting:
```python
doc = app.scrape(
    url="https://example.com/login",
    formats=["markdown"],
    actions=[
        {"type": "write", "text": "user@example.com"},
        {"type": "press", "key": "Tab"},
        {"type": "write", "text": "password"},
        {"type": "click", "selector": 'button[type="submit"]'},
        {"type": "wait", "milliseconds": 2000},
        {"type": "screenshot"}
    ]
)
```

---

## Search

Search the web and optionally scrape the results.
```bash
curl -X POST 'https://api.lingcrawl.dev/v2/search' \
  -H 'Authorization: Bearer fc-YOUR_API_KEY' \
  -H 'Content-Type: application/json' \
  -d '{
    "query": "lingcrawl web scraping",
    "limit": 5
  }'
```

Response:
```json
{
  "success": true,
  "data": {
    "web": [
      {
        "url": "https://www.lingcrawl.dev/",
        "title": "LingCrawl - The Web Data API for AI",
        "description": "The web crawling, scraping, and search API for AI.",
        "position": 1
      }
    ],
    "images": [...],
    "news": [...]
  }
}
```

### Search with Content Scraping

Get the full content of search results:
```python
from lingcrawl import LingCrawl

lingcrawl = LingCrawl(api_key="fc-YOUR_API_KEY")

results = lingcrawl.search(
    "lingcrawl web scraping",
    limit=3,
    scrape_options={
        "formats": ["markdown", "links"]
    }
)
```

---

## Browse

Give your agents a secure browser environment. Let them run code safely to gather data and take action on the web.
```bash
curl -X POST 'https://api.lingcrawl.dev/v2/browser' \
  -H 'Authorization: Bearer fc-YOUR_API_KEY' \
  -H 'Content-Type: application/json'
```

Response:
```json
{
  "success": true,
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "cdpUrl": "wss://cdp-proxy.lingcrawl.dev/cdp/550e8400-e29b-41d4-a716-446655440000",
  "liveViewUrl": "https://liveview.lingcrawl.dev/550e8400-e29b-41d4-a716-446655440000"
}
```

### Execute Code in the Browser

Run Playwright code, Python, or bash commands remotely:
```javascript
import LingCrawl from '@lingcrawl/lingcrawl-js';

const lingcrawl = new LingCrawl({ apiKey: "fc-YOUR_API_KEY" });

// 1. Launch a session
const session = await lingcrawl.browser();

// 2. Execute code
const result = await lingcrawl.browserExecute(session.id, {
  code: `
    await page.goto("https://news.ycombinator.com");
    const title = await page.title();
    console.log(title);
  `,
  language: "node",
});
console.log(result.result); // "Hacker News"

// 3. Close
await lingcrawl.deleteBrowser(session.id);
```

### Persistent Sessions

Save and reuse browser state (cookies, localStorage) across sessions:
```javascript
const session = await lingcrawl.browser({
  ttl: 600,
  profile: {
    name: "my-profile",
    saveChanges: true,
  },
});
```

### agent-browser (Bash Mode)

Instead of writing Playwright code, agents can send simple bash commands via [agent-browser](https://github.com/vercel-labs/agent-browser):
```bash
lingcrawl browser "open https://example.com"
lingcrawl browser "snapshot"
lingcrawl browser "click @e5"
```

---

## Agent

**The easiest way to get data from the web.** Describe what you need, and our AI agent searches, navigates, and extracts it. No URLs required.

Agent is the evolution of our `/extract` endpoint: faster, more reliable, and doesn't require you to know the URLs upfront.
```bash
curl -X POST 'https://api.lingcrawl.dev/v2/agent' \
  -H 'Authorization: Bearer fc-YOUR_API_KEY' \
  -H 'Content-Type: application/json' \
  -d '{
    "prompt": "Find the pricing plans for Notion"
  }'
```

Response:
```json
{
  "success": true,
  "data": {
    "result": "Notion offers the following pricing plans:\n\n1. Free - $0/month...\n2. Plus - $10/seat/month...\n3. Business - $18/seat/month...",
    "sources": ["https://www.notion.so/pricing"]
  }
}
```

### Agent with Structured Output

Use a schema to get structured data:
```python
from lingcrawl import LingCrawl
from pydantic import BaseModel, Field
from typing import List, Optional

app = LingCrawl(api_key="fc-YOUR_API_KEY")

class Founder(BaseModel):
    name: str = Field(description="Full name of the founder")
    role: Optional[str] = Field(None, description="Role or position")

class FoundersSchema(BaseModel):
    founders: List[Founder] = Field(description="List of founders")

result = app.agent(
    prompt="Find the founders of LingCrawl",
    schema=FoundersSchema
)

print(result.data)
```
```json
{
  "founders": [
    {"name": "Eric Ciarla", "role": "Co-founder"},
    {"name": "Nicolas Camara", "role": "Co-founder"},
    {"name": "Caleb Peffer", "role": "Co-founder"}
  ]
}
```

### Agent with URLs (Optional)

Focus the agent on specific pages:
```python
result = app.agent(
    urls=["https://docs.lingcrawl.dev", "https://lingcrawl.dev/pricing"],
    prompt="Compare the features and pricing information"
)
```

### Model Selection

Choose between two models based on your needs:

| Model | Cost | Best For |
|-------|------|----------|
| `spark-1-mini` (default) | 60% cheaper | Most tasks |
| `spark-1-pro` | Standard | Complex research, critical extraction |
```python
result = app.agent(
    prompt="Compare enterprise features across LingCrawl, Apify, and ScrapingBee",
    model="spark-1-pro"
)
```

**When to use Pro:**
- Comparing data across multiple websites
- Extracting from sites with complex navigation or auth
- Research tasks where the agent needs to explore multiple paths
- Critical data where accuracy is paramount

Learn more about Spark models in our [Agent documentation](https://docs.lingcrawl.dev/features/agent).

### Using LingCrawl with AI agents

Install the LingCrawl skill to let AI agents like Claude Code, Codex, and OpenCode use LingCrawl automatically:
```bash
npx skills add lingcrawl/cli
```

Restart your agent after installing. See the [Skill + CLI docs](https://docs.lingcrawl.dev/sdks/cli) for full setup.

---

## Crawling

Crawl an entire website and get content from all pages.
```bash
curl -X POST 'https://api.lingcrawl.dev/v2/crawl' \
  -H 'Authorization: Bearer fc-YOUR_API_KEY' \
  -H 'Content-Type: application/json' \
  -d '{
    "url": "https://docs.lingcrawl.dev",
    "limit": 100,
    "scrapeOptions": {
      "formats": ["markdown"]
    }
  }'
```

Returns a job ID:
```json
{
  "success": true,
  "id": "123-456-789",
  "url": "https://api.lingcrawl.dev/v2/crawl/123-456-789"
}
```

### Check Crawl Status
```bash
curl -X GET 'https://api.lingcrawl.dev/v2/crawl/123-456-789' \
  -H 'Authorization: Bearer fc-YOUR_API_KEY'
```
```json
{
  "status": "completed",
  "total": 50,
  "completed": 50,
  "creditsUsed": 50,
  "data": [
    {
      "markdown": "# Page Title\n\nContent...",
      "metadata": {"title": "Page Title", "sourceURL": "https://..."}
    }
  ]
}
```

**Note:** The [SDKs](#sdks) handle polling automatically for a better developer experience.

---

## Map

Discover all URLs on a website instantly.
```bash
curl -X POST 'https://api.lingcrawl.dev/v2/map' \
  -H 'Authorization: Bearer fc-YOUR_API_KEY' \
  -H 'Content-Type: application/json' \
  -d '{"url": "https://lingcrawl.dev"}'
```

Response:
```json
{
  "success": true,
  "links": [
    {"url": "https://lingcrawl.dev", "title": "LingCrawl", "description": "Turn websites into LLM-ready data"},
    {"url": "https://lingcrawl.dev/pricing", "title": "Pricing", "description": "LingCrawl pricing plans"},
    {"url": "https://lingcrawl.dev/blog", "title": "Blog", "description": "LingCrawl blog"}
  ]
}
```

### Map with Search

Find specific URLs within a site:
```python
from lingcrawl import LingCrawl

app = LingCrawl(api_key="fc-YOUR_API_KEY")

result = app.map("https://lingcrawl.dev", search="pricing")
# Returns URLs ordered by relevance to "pricing"
```

---

## Batch Scraping

Scrape multiple URLs at once:
```python
from lingcrawl import LingCrawl

app = LingCrawl(api_key="fc-YOUR_API_KEY")

job = app.batch_scrape([
    "https://lingcrawl.dev",
    "https://docs.lingcrawl.dev",
    "https://lingcrawl.dev/pricing"
], formats=["markdown"])

for doc in job.data:
    print(doc.metadata.source_url)
```

---

## SDKs

Our SDKs provide a convenient way to interact with all LingCrawl features and automatically handle polling for async operations like crawling and batch scraping.

### Python

Install the SDK:
```bash
pip install lingcrawl-py
```
```python
from lingcrawl import LingCrawl

app = LingCrawl(api_key="fc-YOUR_API_KEY")

# Scrape a single URL
doc = app.scrape("https://lingcrawl.dev", formats=["markdown"])
print(doc.markdown)

# Use the Agent for autonomous data gathering
result = app.agent(prompt="Find the founders of Stripe")
print(result.data)

# Crawl a website (automatically waits for completion)
docs = app.crawl("https://docs.lingcrawl.dev", limit=50)
for doc in docs.data:
    print(doc.metadata.source_url, doc.markdown[:100])

# Search the web
results = app.search("best web scraping tools 2024", limit=10)
print(results)
```

### Node.js

Install the SDK:
```bash
npm install @lingcrawl/lingcrawl-js
```
```javascript
import LingCrawl from '@lingcrawl/lingcrawl-js';

const app = new LingCrawl({ apiKey: 'fc-YOUR_API_KEY' });

// Scrape a single URL
const doc = await app.scrape('https://lingcrawl.dev', { formats: ['markdown'] });
console.log(doc.markdown);

// Use the Agent for autonomous data gathering
const result = await app.agent({ prompt: 'Find the founders of Stripe' });
console.log(result.data);

// Crawl a website (automatically waits for completion)
const docs = await app.crawl('https://docs.lingcrawl.dev', { limit: 50 });
docs.data.forEach(doc => {
    console.log(doc.metadata.sourceURL, doc.markdown.substring(0, 100));
});

// Search the web
const results = await app.search('best web scraping tools 2024', { limit: 10 });
results.data.web.forEach(result => {
    console.log(`${result.title}: ${result.url}`);
});
```

### Java

Add the dependency ([Gradle/Maven](https://docs.lingcrawl.dev/sdks/java#installation)):
```groovy
repositories {
    mavenCentral()
    maven { url 'https://jitpack.io' }
}

dependencies {
    implementation 'com.github.lingcrawl:lingcrawl-java-sdk:2.0'
}
```
```java
import dev.lingcrawl.client.LingCrawlClient;
import dev.lingcrawl.model.*;

LingCrawlClient client = new LingCrawlClient(
    System.getenv("LINGCRAWL_API_KEY"), null, null
);

// Scrape a single URL
ScrapeParams scrapeParams = new ScrapeParams();
scrapeParams.setFormats(new String[]{"markdown"});
LingCrawlDocument doc = client.scrapeURL("https://lingcrawl.dev", scrapeParams);
System.out.println(doc.getMarkdown());

// Use the Agent for autonomous data gathering
AgentParams agentParams = new AgentParams("Find the founders of Stripe");
AgentResponse start = client.createAgent(agentParams);
AgentStatusResponse result = client.getAgentStatus(start.getId());
System.out.println(result.getData());

// Crawl a website (polls until completion)
CrawlParams crawlParams = new CrawlParams();
crawlParams.setLimit(50);
CrawlStatusResponse job = client.crawlURL("https://docs.lingcrawl.dev", crawlParams, null, 10);
for (LingCrawlDocument page : job.getData()) {
    System.out.println(page.getMetadata().get("sourceURL"));
}

// Search the web
SearchParams searchParams = new SearchParams("best web scraping tools 2024");
searchParams.setLimit(10);
SearchResponse results = client.search(searchParams);
for (SearchResult r : results.getResults()) {
    System.out.println(r.getTitle() + ": " + r.getUrl());
}
```

### Community SDKs

- [Go SDK](https://github.com/mendableai/lingcrawl-go)
- [Rust SDK](https://docs.lingcrawl.dev/sdks/rust)

---

## Integrations

**Agents & AI Tools**
- [LingCrawl Skill](https://docs.lingcrawl.dev/sdks/cli)
- [LingCrawl MCP](https://github.com/mendableai/lingcrawl-mcp-server)

**Platforms**
- [Lovable](https://docs.lovable.dev/integrations/lingcrawl)
- [Zapier](https://zapier.com/apps/lingcrawl/integrations)
- [n8n](https://n8n.io/integrations/lingcrawl/)

[View all integrations →](https://www.lingcrawl.dev/integrations)

**Missing your favorite tool?** [Open an issue](https://github.com/mendableai/lingcrawl/issues) and let us know!

---

## Resources

- [Documentation](https://docs.lingcrawl.dev)
- [API Reference](https://docs.lingcrawl.dev/api-reference/introduction)
- [Playground](https://lingcrawl.dev/playground)
- [Changelog](https://lingcrawl.dev/changelog)

---

## Open Source vs Cloud

LingCrawl is open source under the AGPL-3.0 license. The cloud version at [lingcrawl.dev](https://lingcrawl.dev) includes additional features:

![Open Source vs Cloud](https://raw.githubusercontent.com/lingcrawl/lingcrawl/main/img/open-source-cloud-comparison.png)

To run locally, see the [Contributing Guide](https://github.com/lingcrawl/lingcrawl/blob/main/CONTRIBUTING.md). To self-host, see [Self-Hosting Guide](https://docs.lingcrawl.dev/contributing/self-host).

---

## Contributing

We love contributions! Please read our [Contributing Guide](https://github.com/lingcrawl/lingcrawl/blob/main/CONTRIBUTING.md) before submitting a pull request.

### Contributors

<a href="https://github.com/lingcrawl/lingcrawl/graphs/contributors">
  <img alt="contributors" src="https://contrib.rocks/image?repo=lingcrawl/lingcrawl"/>
</a>

---

## License

This project is primarily licensed under the GNU Affero General Public License v3.0 (AGPL-3.0). The SDKs and some UI components are licensed under the MIT License. See the LICENSE files in specific directories for details.

---

**It is the sole responsibility of end users to respect websites' policies when scraping.** Users are advised to adhere to applicable privacy policies and terms of use. By default, LingCrawl respects robots.txt directives. By using LingCrawl, you agree to comply with these conditions.

<p align="right" style="font-size: 14px; color: #555; margin-top: 20px;">
  <a href="#readme-top" style="text-decoration: none; color: #007bff; font-weight: bold;">
    ↑ Back to Top ↑
  </a>
</p>
