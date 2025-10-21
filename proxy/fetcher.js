/**
 * fetcher.js
 *
 * Responsible for retrieving remote resources for the proxy.
 * Features:
 *  - streaming binary/text responses into Express res
 *  - automatic retry logic with exponential backoff
 *  - simple content sniffing (text/binary)
 *  - respects timeouts
 *  - integrates with resourceCache module if available
 *  - exposes helper fetchText and streamToResponse
 *
 * Notes:
 *  - Uses node-fetch v2 APIs (require('node-fetch'))
 *  - For heavy pages consider using puppeteerRender instead (see puppeteerRender.js)
 */

const fetch = require('node-fetch');
const { URL } = require('url');
const Stream = require('stream');
const AbortController = require('abort-controller');
const crypto = require('crypto');

let resourceCache;
try { resourceCache = require('./resourceCache'); } catch (e) { resourceCache = null; }

const DEFAULT_TIMEOUT = 15000; // 15s
const DEFAULT_RETRIES = 2;
const BACKOFF_BASE = 300; // ms

const { logger } = (() => {
  try { return require('./logger'); } catch (e) { return { logger: { logInfo: () => {}, logWarn: () => {}, logError: () => {} } }; }
})();

/**
 * Simple helper to detect if URL is valid
 */
function isValidUrl(u) {
  try { new URL(u); return true; } catch (e) { return false; }
}

/**
 * Sleep helper
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Generate a cache key (if cache is used)
 */
function cacheKeyFor(url, opts = {}) {
  const hash = crypto.createHash('sha256');
  hash.update(url + JSON.stringify(opts || {}));
  return hash.digest('hex');
}

/**
 * fetchText(url, opts)
 * Fetch a resource and return text.
 * - will try cache if resourceCache present
 * - will retry on transient errors
 */
async function fetchText(url, opts = {}) {
  if (!isValidUrl(url)) throw new Error('Invalid URL');

  const timeout = opts.timeout || DEFAULT_TIMEOUT;
  const retries = typeof opts.retries === 'number' ? opts.retries : DEFAULT_RETRIES;
  const useCache = !!(resourceCache && opts.useCache !== false);

  const key = cacheKeyFor(url, { mode: 'text' });

  if (useCache) {
    try {
      const cached = await resourceCache.get(key);
      if (cached) {
        logger.logInfo(`fetcher cache hit: ${url}`);
        return cached;
      }
    } catch (e) {
      logger.logWarn(`fetcher cache read failed: ${e.message}`);
    }
  }

  let attempt = 0;
  let lastErr;
  while (attempt <= retries) {
    attempt++;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const res = await fetch(url, { timeout, signal: controller.signal, redirect: 'follow', headers: opts.headers || {} });
      clearTimeout(timer);
      if (!res.ok) {
        const msg = `fetchText got ${res.status} ${res.statusText}`;
        if (res.status >= 500 && attempt <= retries) {
          lastErr = new Error(msg);
          await sleep(BACKOFF_BASE * attempt);
          continue;
        }
        throw new Error(msg);
      }
      const text = await res.text();
      if (useCache) {
        resourceCache.set(key, text, (opts.ttl || 60) * 1000).catch(() => {});
      }
      return text;
    } catch (err) {
      clearTimeout(timer);
      lastErr = err;
      logger.logWarn(`fetchText attempt ${attempt} failed for ${url}: ${err.message}`);
      if (attempt <= retries) await sleep(BACKOFF_BASE * attempt);
    }
  }
  throw lastErr;
}

/**
 * streamToResponse(url, res, opts)
 * Streams a remote resource directly into an Express response.
 * - streams binary efficiently
 * - sets content-type and other headers when possible
 * - optionally pipes through cache
 */
async function streamToResponse(url, res, opts = {}) {
  if (!isValidUrl(url)) {
    res.status(400).send('Invalid URL');
    return;
  }

  const timeout = opts.timeout || DEFAULT_TIMEOUT;
  const retries = typeof opts.retries === 'number' ? opts.retries : DEFAULT_RETRIES;

  // If cache has full response body and headers, return that
  const key = cacheKeyFor(url, { mode: 'stream' });
  if (resourceCache && opts.useCache !== false) {
    try {
      const cached = await resourceCache.get(key);
      if (cached && cached.body) {
        logger.logInfo(`streamToResponse cache hit: ${url}`);
        if (cached.headers) {
          for (const [k, v] of Object.entries(cached.headers)) res.setHeader(k, v);
        }
        // write body as buffer or string
        if (Buffer.isBuffer(cached.body)) res.end(cached.body);
        else res.end(Buffer.from(cached.body, 'utf8'));
        return;
      }
    } catch (e) {
      logger.logWarn('streamToResponse cache read failed: ' + e.message);
    }
  }

  let attempt = 0;
  let lastErr;
  while (attempt <= retries) {
    attempt++;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const fetched = await fetch(url, { signal: controller.signal, redirect: 'follow', headers: opts.headers || {} });
      clearTimeout(timer);
      if (!fetched.ok) {
        const msg = `Failed to fetch ${url} - ${fetched.status}`;
        if (fetched.status >= 500 && attempt <= retries) {
          lastErr = new Error(msg);
          await sleep(BACKOFF_BASE * attempt);
          continue;
        }
        res.status(fetched.status).send(`Upstream error: ${fetched.status}`);
        return;
      }

      // Set headers (whitelist)
      const headerWhitelist = ['content-type', 'content-length', 'last-modified', 'etag', 'cache-control'];
      headerWhitelist.forEach(h => {
        const val = fetched.headers.get(h);
        if (val) res.setHeader(h, val);
      });

      // Stream the body
      const reader = fetched.body;

      // Optionally capture to cache while streaming
      if (resourceCache && opts.useCache !== false) {
        // accumulate small responses only (limit to avoid huge memory)
        const MAX_CAPTURE = (opts.maxCacheCaptureBytes || 1024 * 1024); // 1MB
        let captured = [];
        let capturedLen = 0;

        // pipe stream manually
        reader.on('data', chunk => {
          try {
            res.write(chunk);
            if (capturedLen + chunk.length <= MAX_CAPTURE) {
              captured.push(Buffer.from(chunk));
              capturedLen += chunk.length;
            } else {
              capturedLen = Number.MAX_SAFE_INTEGER; // mark as too large
            }
          } catch (e) {
            logger.logWarn('streamToResponse write error: ' + e.message);
          }
        });
        reader.on('end', async () => {
          res.end();
          // if captured, persist cache
          if (capturedLen > 0 && capturedLen < Number.MAX_SAFE_INTEGER) {
            try {
              const bodyBuf = Buffer.concat(captured, capturedLen);
              const headers = {};
              headerWhitelist.forEach(h => { const v = fetched.headers.get(h); if (v) headers[h] = v; });
              await resourceCache.set(key, { headers, body: bodyBuf }, (opts.ttl || 60) * 1000);
              logger.logInfo(`streamToResponse cached ${url} (${capturedLen} bytes)`);
            } catch (e) {
              logger.logWarn('streamToResponse cache write failed: ' + e.message);
            }
          }
        });
        reader.on('error', (err) => {
          logger.logError('streamToResponse stream error: ' + err.message);
          try { res.end(); } catch (e) {}
        });
      } else {
        // no caching: pipe directly
        reader.pipe(res);
      }
      return;
    } catch (err) {
      clearTimeout(timer);
      lastErr = err;
      logger.logWarn(`streamToResponse attempt ${attempt} failed for ${url}: ${err.message}`);
      if (attempt <= retries) await sleep(BACKOFF_BASE * attempt);
    }
  }
  logger.logError(`streamToResponse final failure for ${url}: ${lastErr?.message}`);
  res.status(502).send('Failed to fetch resource');
}

/**
 * convenience: fetchJson
 */
async function fetchJson(url, opts = {}) {
  const txt = await fetchText(url, opts);
  try { return JSON.parse(txt); } catch (e) { throw new Error('Invalid JSON from upstream'); }
}

module.exports = {
  fetchText,
  fetchJson,
  streamToResponse,
  isValidUrl
};

