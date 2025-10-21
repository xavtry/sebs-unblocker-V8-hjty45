/**
 * puppeteerRender.js
 *
 * Render a remote page with Puppeteer to produce a fully-executed HTML snapshot.
 * Features:
 *  - Headless rendering of JavaScript-heavy pages
 *  - Optional request interception to route sub-resources via our /resource endpoint
 *  - Timeout / viewport control via config
 *  - Lightweight fallback when Puppeteer is unavailable (returns fetchText)
 *
 * Notes:
 *  - Puppeteer installation is optional. On low-memory hosts it may fail.
 *  - If puppeteer is not installed or fails to launch, code falls back gracefully.
 */

const { logger } = (() => {
  try { return require('./logger'); } catch (e) { return { logInfo: () => {}, logWarn: () => {}, logError: () => {} }; }
})();

const CONFIG = (() => {
  try { return require('./config'); } catch (e) { return { puppeteer: { headless: true, args: ['--no-sandbox'], defaultViewport: { width: 1280, height: 800 }, timeout: 20000 } }; }
})();

let puppeteer;
try {
  puppeteer = require('puppeteer');
} catch (e) {
  puppeteer = null;
  logger.logWarn('Puppeteer not installed. puppeteerRender will fallback to fetchText.');
}

const fetcher = require('./fetcher');
const { rewriteHtml } = require('./rewrite');

/**
 * renderWithPuppeteer(url, opts)
 * - Launches puppeteer, loads the page, waits for network idle, captures final HTML
 * - Optionally rewrites subresource URLs to go through our proxy/resource endpoints
 */
async function renderWithPuppeteer(url, opts = {}) {
  if (!url) throw new Error('Missing URL');

  // If puppeteer not available, fallback to fetcher.fetchText
  if (!puppeteer) {
    logger.logWarn('puppeteerRender fallback: using fetchText');
    const text = await fetcher.fetchText(url, { timeout: opts.timeout || CONFIG.puppeteer.timeout });
    // optionally run rewriteHtml to ensure links go through proxy
    try {
      return rewriteHtml(text, url, { proxyPath: '/proxy?url=', resourcePath: '/resource?url=' });
    } catch (e) { return text; }
  }

  const browserArgs = (CONFIG.puppeteer && CONFIG.puppeteer.args) || ['--no-sandbox', '--disable-setuid-sandbox'];
  const launchOptions = {
    headless: (CONFIG.puppeteer && CONFIG.puppeteer.headless) !== false,
    args: browserArgs,
    defaultViewport: (CONFIG.puppeteer && CONFIG.puppeteer.defaultViewport) || { width: 1280, height: 800 }
  };

  let browser;
  try {
    browser = await puppeteer.launch(launchOptions);
    const page = await browser.newPage();

    // Set a reasonable user agent
    try {
      await page.setUserAgent((CONFIG.puppeteer && CONFIG.puppeteer.userAgent) || 'Seb-Unblocker-Puppeteer/1.0');
    } catch (e) { /* ignore */ }

    // Set timeout navigation
    const navigationOptions = { waitUntil: 'networkidle2', timeout: opts.timeout || (CONFIG.puppeteer && CONFIG.puppeteer.timeout) || 20000 };

    // Intercept requests to optionally route through our resource endpoint
    try {
      await page.setRequestInterception(true);
      page.on('request', request => {
        const reqUrl = request.url();
        // allow data: and about: schemes
        if (reqUrl.startsWith('data:') || reqUrl.startsWith('about:')) return request.continue();

        // Optionally rewrite third-party resource URLs to our /resource endpoint so client loads via proxy
        // This prevents some CORS/content issues when serving the snapshot later.
        if (opts.rewriteResources) {
          const resourceUrl = `/resource?url=${encodeURIComponent(reqUrl)}`;
          // We cannot change the request url easily; instead we can allow it but later rewrite HTML/CSS/JS
          return request.continue();
        } else {
          return request.continue();
        }
      });
    } catch (e) {
      logger.logWarn('Puppeteer request interception setup failed: ' + e.message);
    }

    // Try to navigate
    await page.goto(url, navigationOptions);

    // Optional wait for specific selectors (if user provided)
    if (opts.waitForSelector) {
      try {
        await page.waitForSelector(opts.waitForSelector, { timeout: opts.waitForTimeout || 5000 });
      } catch (e) { /* ignore if not found */ }
    }

    // Evaluate final HTML
    const html = await page.evaluate(() => {
      // serialize document to string
      return "<!doctype html>\n" + document.documentElement.outerHTML;
    });

    // Close page / browser
    try { await page.close(); } catch (e) { /* ignore */ }
    try { await browser.close(); } catch (e) { /* ignore */ }

    // Run a rewrite pass so all assets point to our proxy/resource endpoints
    try {
      const rewritten = rewriteHtml(html, url, { proxyPath: '/proxy?url=', resourcePath: '/resource?url=' });
      return rewritten;
    } catch (e) {
      logger.logWarn('puppeteerRender rewrite failed: ' + e.message);
      return html;
    }
  } catch (err) {
    logger.logError('puppeteerRender error: ' + err.message);
    if (browser) try { await browser.close(); } catch (e) {}
    // fallback to fetchText
    try {
      const fallback = await fetcher.fetchText(url, { timeout: opts.timeout || 10000 });
      return fallback;
    } catch (e) {
      throw err;
    }
  }
}

module.exports = {
  renderWithPuppeteer,
  // alias for older name
  puppeteerRender: renderWithPuppeteer
};

