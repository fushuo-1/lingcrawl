import express, { Request, Response } from 'express';
import { chromium, Browser, BrowserContext, Route, Request as PlaywrightRequest, Page } from 'playwright';
import dotenv from 'dotenv';
import { getError } from './helpers/get_error';
import { lookup } from 'dns/promises';
import IPAddr from 'ipaddr.js';

dotenv.config();

const app = express();
const port = process.env.PORT || 3003;

app.use(express.json());

const BLOCK_MEDIA = (process.env.BLOCK_MEDIA || 'False').toUpperCase() === 'TRUE';
const MAX_CONCURRENT_PAGES = Math.max(1, Number.parseInt(process.env.MAX_CONCURRENT_PAGES ?? '10', 10) || 10);
const ALLOW_LOCAL_NETWORK = (process.env.ALLOW_LOCAL_NETWORK || 'False').toUpperCase() === 'TRUE';
const DNS_CACHE_TTL_MS = 30_000;

const PROXY_SERVER = process.env.PROXY_SERVER || null;
const PROXY_USERNAME = process.env.PROXY_USERNAME || null;
const PROXY_PASSWORD = process.env.PROXY_PASSWORD || null;
const dnsLookupCache = new Map<string, { addresses: string[]; expiresAt: number }>();

class InsecureConnectionError extends Error {
  constructor(public readonly blockedUrl: string, reason: string) {
    super(`Blocked insecure target URL "${blockedUrl}": ${reason}`);
    this.name = 'InsecureConnectionError';
  }
}

const normalizeHostname = (hostname: string): string => hostname.toLowerCase().replace(/\.$/, '');

const isHttpProtocol = (protocol: string): boolean => protocol === 'http:' || protocol === 'https:';

const isIPPrivate = (address: string): boolean => {
  if (!IPAddr.isValid(address)) return false;
  const parsedAddress = IPAddr.parse(address);
  return parsedAddress.range() !== 'unicast';
};

const isLocalHostname = (hostname: string): boolean =>
  hostname === 'localhost' || hostname.endsWith('.localhost');

const lookupWithCache = async (hostname: string): Promise<string[]> => {
  const cached = dnsLookupCache.get(hostname);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.addresses;
  }

  const resolvedAddresses = await lookup(hostname, { all: true, verbatim: true });
  const uniqueAddresses = [...new Set(resolvedAddresses.map(x => x.address))];
  dnsLookupCache.set(hostname, {
    addresses: uniqueAddresses,
    expiresAt: Date.now() + DNS_CACHE_TTL_MS,
  });
  return uniqueAddresses;
};

const assertSafeTargetUrl = async (urlString: string): Promise<void> => {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(urlString);
  } catch {
    throw new InsecureConnectionError(urlString, 'URL is invalid');
  }

  if (!isHttpProtocol(parsedUrl.protocol)) {
    throw new InsecureConnectionError(urlString, `unsupported protocol "${parsedUrl.protocol}"`);
  }

  if (ALLOW_LOCAL_NETWORK) {
    return;
  }

  const hostname = normalizeHostname(parsedUrl.hostname);
  if (!hostname) {
    throw new InsecureConnectionError(urlString, 'hostname is missing');
  }

  if (isLocalHostname(hostname)) {
    throw new InsecureConnectionError(urlString, 'localhost targets are not allowed');
  }

  if (IPAddr.isValid(hostname)) {
    if (isIPPrivate(hostname)) {
      throw new InsecureConnectionError(urlString, `private IP "${hostname}" is not allowed`);
    }
    return;
  }

  let resolvedAddresses: string[];
  try {
    resolvedAddresses = await lookupWithCache(hostname);
  } catch {
    throw new InsecureConnectionError(
      urlString,
      `DNS lookup failed for "${hostname}", cannot verify target is safe`,
    );
  }

  if (resolvedAddresses.length === 0) {
    throw new InsecureConnectionError(
      urlString,
      `hostname "${hostname}" did not resolve to any IP address`,
    );
  }

  if (resolvedAddresses.some(address => isIPPrivate(address))) {
    throw new InsecureConnectionError(urlString, `hostname "${hostname}" resolves to a private IP`);
  }
};

type ContextSecurityState = {
  blockedNavigationRequestUrl: string | null;
};
class Semaphore {
  private permits: number;
  private queue: (() => void)[] = [];

  constructor(permits: number) {
    this.permits = permits;
  }

  async acquire(): Promise<void> {
    if (this.permits > 0) {
      this.permits--;
      return Promise.resolve();
    }

    return new Promise<void>((resolve) => {
      this.queue.push(resolve);
    });
  }

  release(): void {
    this.permits++;
    if (this.queue.length > 0) {
      const nextResolve = this.queue.shift();
      if (nextResolve) {
        this.permits--;
        nextResolve();
      }
    }
  }

  getAvailablePermits(): number {
    return this.permits;
  }

  getQueueLength(): number {
    return this.queue.length;
  }
}
const pageSemaphore = new Semaphore(MAX_CONCURRENT_PAGES);

// --- Stealth: anti-detection scripts injected before every page ---
// Enhanced stealth to bypass advanced anti-bot detection (e.g. Zhihu, Cloudflare)
const STEALTH_INIT_SCRIPT = `
  // Hide webdriver flag
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined });

  // Fake chrome runtime
  if (!window.chrome) {
    window.chrome = { runtime: {}, loadTimes: () => ({}), csi: () => ({}) };
  }

  // Fix permissions.query to not reveal automation
  const origQuery = window.navigator.permissions?.query?.bind(window.navigator.permissions);
  if (origQuery) {
    window.navigator.permissions.query = (params) => {
      if (params.name === 'notifications') {
        return Promise.resolve({ state: Notification.permission });
      }
      return origQuery(params);
    };
  }

  // Ensure plugins array looks populated (headless has 0 plugins)
  Object.defineProperty(navigator, 'plugins', {
    get: () => [1, 2, 3, 4, 5],
  });

  // Ensure languages look real
  Object.defineProperty(navigator, 'languages', {
    get: () => ['zh-CN', 'zh', 'en-US', 'en'],
  });

  // Hide automation-related properties
  delete navigator.__proto__.webdriver;

  // Override navigator.deviceMemory to look like a real desktop
  Object.defineProperty(navigator, 'deviceMemory', {
    get: () => 8,
  });

  // Override navigator.hardwareConcurrency
  Object.defineProperty(navigator, 'hardwareConcurrency', {
    get: () => 8,
  });

  // Ensure Notification.permission looks real
  if (window.Notification && !window.Notification.permission) {
    Object.defineProperty(window.Notification, 'permission', {
      get: () => 'default',
    });
  }

  // Override maxTouchPoints to look like a desktop
  Object.defineProperty(navigator, 'maxTouchPoints', {
    get: () => 0,
  });

  // Override screen properties to look like a real monitor
  Object.defineProperty(screen, 'width', { get: () => 1920 });
  Object.defineProperty(screen, 'height', { get: () => 1080 });
  Object.defineProperty(screen, 'availWidth', { get: () => 1920 });
  Object.defineProperty(screen, 'availHeight', { get: () => 1040 });
  Object.defineProperty(screen, 'colorDepth', { get: () => 24 });
  Object.defineProperty(screen, 'pixelDepth', { get: () => 24 });

  // Override window.outerWidth/Height
  Object.defineProperty(window, 'outerWidth', { get: () => 1920 });
  Object.defineProperty(window, 'outerHeight', { get: () => 1080 });
  Object.defineProperty(window, 'innerWidth', { get: () => 1280 });
  Object.defineProperty(window, 'innerHeight', { get: () => 800 });

  // Override window.devicePixelRatio
  Object.defineProperty(window, 'devicePixelRatio', { get: () => 1 });

  // Fake WebGL vendor and renderer to look like a real GPU
  const getParameter = WebGLRenderingContext.prototype.getParameter;
  WebGLRenderingContext.prototype.getParameter = function(parameter) {
    if (parameter === 37445) {
      return 'Intel Inc.';
    }
    if (parameter === 37446) {
      return 'Intel Iris Xe Graphics';
    }
    return getParameter.call(this, parameter);
  };

  // Override Canvas 2D getContext to add noise (anti-fingerprinting)
  const originalGetContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function(type, ...args) {
    const context = originalGetContext.call(this, type, ...args);
    if (context && (type === '2d' || type === 'webgl' || type === 'webgl2')) {
      // Add subtle noise to canvas operations to prevent fingerprinting
      const originalToDataURL = this.toDataURL;
      this.toDataURL = function(...toDataURLArgs) {
        return originalToDataURL.apply(this, toDataURLArgs);
      };
    }
    return context;
  };

  // Override navigator.connection to look like a real network
  if (navigator.connection) {
    Object.defineProperty(navigator.connection, 'effectiveType', { get: () => '4g' });
    Object.defineProperty(navigator.connection, 'rtt', { get: () => 50 });
    Object.defineProperty(navigator.connection, 'downlink', { get: () => 10 });
  }

  // Ensure window.opener is null (not set by automation)
  Object.defineProperty(window, 'opener', { get: () => null });

  // Override window.chrome.loadTimes to return realistic data
  if (window.chrome && window.chrome.loadTimes) {
    const originalLoadTimes = window.chrome.loadTimes;
    window.chrome.loadTimes = function() {
      const result = originalLoadTimes.call(this);
      if (result) {
        return result;
      }
      return {
        connectionInfo: 'h2',
        npnNegotiatedProtocol: 'h2',
        navigationType: 'Other',
        wasFetchedViaSpdy: true,
        wasNpnNegotiated: true,
      };
    };
  }
`;

// Real Chrome UA (stable channel, kept up-to-date)
const CHROME_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36";

// Mobile User-Agent for sites with weaker mobile anti-bot
const MOBILE_USER_AGENT =
  "Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36";

const AD_SERVING_DOMAINS = [
  'doubleclick.net',
  'adservice.google.com',
  'googlesyndication.com',
  'googletagservices.com',
  'googletagmanager.com',
  'google-analytics.com',
  'adsystem.com',
  'adservice.com',
  'adnxs.com',
  'ads-twitter.com',
  'facebook.net',
  'fbcdn.net',
  'amazon-adsystem.com'
];

interface UrlModel {
  url: string;
  wait_after_load?: number;
  timeout?: number;
  headers?: { [key: string]: string };
  check_selector?: string;
  skip_tls_verification?: boolean;
  mobile?: boolean;
}

let browser: Browser;

const initializeBrowser = async () => {
  browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--disable-gpu',
      '--disable-blink-features=AutomationControlled',
      '--disable-features=IsolateOrigins,site-per-process',
      '--disable-site-isolation-trials',
      '--disable-web-security',
      '--disable-features=ChromeWhatsNewUI',
      '--no-default-browser-check',
      '--disable-component-update',
      '--disable-background-networking',
    ]
  });
};

const createContext = async (skipTlsVerification: boolean = false, mobile: boolean = false): Promise<{ context: BrowserContext; securityState: ContextSecurityState }> => {
  const viewport = mobile ? { width: 390, height: 844 } : { width: 1280, height: 800 };
  const securityState: ContextSecurityState = {
    blockedNavigationRequestUrl: null,
  };

  const contextOptions: any = {
    userAgent: mobile ? MOBILE_USER_AGENT : CHROME_USER_AGENT,
    viewport,
    ignoreHTTPSErrors: skipTlsVerification,
    locale: 'zh-CN',
  };

  if (PROXY_SERVER && PROXY_USERNAME && PROXY_PASSWORD) {
    contextOptions.proxy = {
      server: PROXY_SERVER,
      username: PROXY_USERNAME,
      password: PROXY_PASSWORD,
    };
  } else if (PROXY_SERVER) {
    contextOptions.proxy = {
      server: PROXY_SERVER,
    };
  }

  const newContext = await browser.newContext(contextOptions);

  // Inject stealth scripts to bypass basic browser detection
  await newContext.addInitScript(STEALTH_INIT_SCRIPT);

  if (BLOCK_MEDIA) {
    await newContext.route('**/*.{png,jpg,jpeg,gif,svg,mp3,mp4,avi,flac,ogg,wav,webm}', async (route: Route, request: PlaywrightRequest) => {
      await route.abort();
    });
  }

  // Intercept all requests to avoid loading ads
  await newContext.route('**/*', async (route: Route, request: PlaywrightRequest) => {
    const requestUrlString = request.url();
    try {
      await assertSafeTargetUrl(requestUrlString);
    } catch (error) {
      if (error instanceof InsecureConnectionError) {
        if (request.isNavigationRequest()) {
          securityState.blockedNavigationRequestUrl = requestUrlString;
        }
        console.warn(`Blocked request: ${requestUrlString}`);
        return route.abort('blockedbyclient');
      }
      throw error;
    }

    const requestUrl = new URL(requestUrlString);
    const hostname = normalizeHostname(requestUrl.hostname);

    if (AD_SERVING_DOMAINS.some(domain => hostname.includes(domain))) {
      console.log(hostname);
      return route.abort();
    }
    return route.continue();
  });
  
  return { context: newContext, securityState };
};

const shutdownBrowser = async () => {
  if (browser) {
    await browser.close();
  }
};

const isValidUrl = (urlString: string): boolean => {
  try {
    new URL(urlString);
    return true;
  } catch (_) {
    return false;
  }
};

const scrapePage = async (
  page: Page,
  url: string,
  waitUntil: 'load' | 'networkidle',
  waitAfterLoad: number,
  timeout: number,
  checkSelector: string | undefined,
  securityState: ContextSecurityState,
) => {
  console.log(`Navigating to ${url} with waitUntil: ${waitUntil} and timeout: ${timeout}ms`);
  let response;
  try {
    response = await page.goto(url, { waitUntil, timeout });
  } catch (error) {
    if (securityState.blockedNavigationRequestUrl) {
      throw new InsecureConnectionError(
        securityState.blockedNavigationRequestUrl,
        'navigation to private/internal resource is not allowed',
      );
    }
    throw error;
  }

  // Wait for any redirects to settle (anti-bot pages often redirect)
  await page.waitForTimeout(2000);

  // Re-check the current URL after potential redirects
  const currentUrl = page.url();
  if (currentUrl !== url && (currentUrl.includes('signin') || currentUrl.includes('login') || currentUrl.includes('captcha'))) {
    console.warn(`⚠️ Redirected to auth/captcha page: ${currentUrl}`);
  }

  if (waitAfterLoad > 0) {
    await page.waitForTimeout(waitAfterLoad);
  }

  if (checkSelector) {
    try {
      await page.waitForSelector(checkSelector, { timeout });
    } catch (error) {
      throw new Error('Required selector not found');
    }
  }

  // Detect PDF.js viewer and extract text from rendered pages
  let isPdfJs = false;
  try {
    isPdfJs = await page.evaluate(() =>
      !!document.querySelector('.pdfViewer') || !!document.querySelector('#viewer.pdfViewer')
    );
  } catch (e) {
    console.warn('page.evaluate failed for PDF detection, retrying...', e);
    // Wait a bit more and retry
    await page.waitForTimeout(1000);
    try {
      isPdfJs = await page.evaluate(() =>
        !!document.querySelector('.pdfViewer') || !!document.querySelector('#viewer.pdfViewer')
      );
    } catch (e2) {
      console.warn('PDF detection retry failed:', e2);
    }
  }

  let headers = null, content: string;
  let ct: string | undefined = undefined;

  if (isPdfJs) {
    // Wait for PDF.js text layers to render (up to 20s)
    try {
      await page.waitForFunction(() => {
        const textLayers = document.querySelectorAll('.textLayer');
        return textLayers.length > 0 &&
          Array.from(textLayers).some(tl => tl.textContent && tl.textContent.trim().length > 0);
      }, { timeout: 20000 });
    } catch {
      // Text layer never appeared — PDF may be image-based or still loading
    }

    // Extract text from each page's text layer
    content = await page.evaluate(() => {
      const pages = document.querySelectorAll('.page');
      if (pages.length === 0) {
        // Fallback: try to get any visible text
        return document.body.innerText || '';
      }
      const texts: string[] = [];
      pages.forEach((pageEl, i) => {
        const textLayer = pageEl.querySelector('.textLayer');
        if (textLayer && textLayer.textContent?.trim()) {
          texts.push(textLayer.textContent.trim());
        }
      });
      return texts.join('\n\n');
    });

    // If text layer extraction yielded nothing, fall back to innerText
    if (!content || content.trim().length === 0) {
      content = await page.evaluate(() => document.body.innerText || '');
    }

    // Wrap extracted text as simple HTML for downstream consumers
    content = `<html><body><pre>${content}</pre></body></html>`;
    ct = 'text/html';
  } else {
    content = await page.content();
    if (response) {
      headers = await response.allHeaders();
      ct = Object.entries(headers).find(([key]) => key.toLowerCase() === "content-type")?.[1];
      if (ct && (ct.toLowerCase().includes("application/json") || ct.toLowerCase().includes("text/plain"))) {
        content = (await response.body()).toString("utf8"); // TODO: determine real encoding
      }
    }
  }

  // Detect embedded PDF iframes and extract the URL for downstream PDF parsing
  let embeddedPdfUrl: string | undefined;
  try {
    embeddedPdfUrl = await page.evaluate(() => {
      const iframe = document.querySelector('iframe[src*=".pdf"]') as HTMLIFrameElement | null;
      if (iframe?.src) {
        // Strip hash params like #page=1&view=fitH
        return iframe.src.split('#')[0];
      }
      // Also check <embed> and <object> tags
      const embed = document.querySelector('embed[src*=".pdf"]') as HTMLEmbedElement | null;
      if (embed?.src) return embed.src.split('#')[0];
      const obj = document.querySelector('object[data*=".pdf"]') as HTMLObjectElement | null;
      if (obj?.data) return obj.data.split('#')[0];
      return undefined;
    });
    if (embeddedPdfUrl) {
      console.log(`📎 Detected embedded PDF: ${embeddedPdfUrl}`);
    }
  } catch {
    // Ignore errors in PDF detection
  }

  return {
    content,
    status: response ? response.status() : null,
    headers,
    contentType: ct,
    embeddedPdfUrl,
  };
};

app.get('/health', async (req: Request, res: Response) => {
  try {
    if (!browser) {
      await initializeBrowser();
    }
    
    const { context: testContext } = await createContext();
    const testPage = await testContext.newPage();
    await testPage.close();
    await testContext.close();
    
    res.status(200).json({ 
      status: 'healthy',
      maxConcurrentPages: MAX_CONCURRENT_PAGES,
      activePages: MAX_CONCURRENT_PAGES - pageSemaphore.getAvailablePermits()
    });
  } catch (error) {
    console.error('Health check failed:', error);
    res.status(503).json({ 
      status: 'unhealthy', 
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    });
  }
});

app.post('/scrape', async (req: Request, res: Response) => {
  const { url, wait_after_load = 0, timeout = 15000, headers, check_selector, skip_tls_verification = false, mobile = false }: UrlModel = req.body;

  console.log(`================= Scrape Request =================`);
  console.log(`URL: ${url}`);
  console.log(`Wait After Load: ${wait_after_load}`);
  console.log(`Timeout: ${timeout}`);
  console.log(`Headers: ${headers ? JSON.stringify(headers) : 'None'}`);
  console.log(`Check Selector: ${check_selector ? check_selector : 'None'}`);
  console.log(`Skip TLS Verification: ${skip_tls_verification}`);
  console.log(`Mobile Mode: ${mobile}`);
  console.log(`==================================================`);

  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }

  if (!isValidUrl(url)) {
    return res.status(400).json({ error: 'Invalid URL' });
  }

  try {
    await assertSafeTargetUrl(url);
  } catch (error) {
    if (error instanceof InsecureConnectionError) {
      return res.json({
        content: '',
        pageStatusCode: 403,
        pageError: error.message,
      });
    }
    throw error;
  }

  if (!PROXY_SERVER) {
    console.warn('⚠️ WARNING: No proxy server provided. Your IP address may be blocked.');
  }

  if (!browser) {
    await initializeBrowser();
  }

  await pageSemaphore.acquire();
  
  let requestContext: BrowserContext | null = null;
  let securityState: ContextSecurityState | null = null;
  let page: Page | null = null;

  try {
    const contextBundle = await createContext(skip_tls_verification, mobile);
    requestContext = contextBundle.context;
    securityState = contextBundle.securityState;
    page = await requestContext.newPage();

    if (headers) {
      await page.setExtraHTTPHeaders(headers);
    }

    const result = await scrapePage(
      page,
      url,
      'load',
      wait_after_load,
      timeout,
      check_selector,
      securityState,
    );
    const pageError = result.status !== 200 ? getError(result.status) : undefined;

    if (!pageError) {
      console.log(`✅ Scrape successful!`);
    } else {
      console.log(`🚨 Scrape failed with status code: ${result.status} ${pageError}`);
    }

    res.json({
      content: result.content,
      pageStatusCode: result.status,
      contentType: result.contentType,
      ...(result.embeddedPdfUrl && { embeddedPdfUrl: result.embeddedPdfUrl }),
      ...(pageError && { pageError })
    });

  } catch (error) {
    if (error instanceof InsecureConnectionError) {
      return res.json({
        content: '',
        pageStatusCode: 403,
        pageError: error.message,
      });
    }
    console.error('Scrape error:', error);
    res.status(500).json({ error: 'An error occurred while fetching the page.' });
  } finally {
    if (page) await page.close();
    if (requestContext) await requestContext.close();
    pageSemaphore.release();
  }
});

app.listen(port, () => {
  initializeBrowser().then(() => {
    console.log(`Server is running on port ${port}`);
  });
});

if (require.main === module) {
  process.on('SIGINT', () => {
    shutdownBrowser().then(() => {
      console.log('Browser closed');
      process.exit(0);
    });
  });
}
