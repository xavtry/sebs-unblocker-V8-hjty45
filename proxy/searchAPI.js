/**
 * searchAPI.js
 *
 * Simple search wrapper that fetches results from DuckDuckGo HTML endpoint (no API key).
 * - Provides search(query, opts) -> returns array of { title, url, description }
 * - Implements retries, timeouts, basic parsing via cheerio (if available) or regex fallback
 * - Uses resourceCache if available to reduce repeated requests
 *
 * NOTE: scraping search engines may be rate-limited; consider using a paid API (SerpAPI) for production.
 */

const fetch = require('node-fetch');
const { URL } = require('url');
const { getSearchMaxResults, getSearchTimeout } = require('./config');
const { logInfo, logWarn, logError } = (() => {
  try { return require('./logger'); } catch (e) { return { logInfo: ()=>{}, logWarn: ()=>{}, logError: ()=>{} }; }
})();

let cheerio = null;
try { cheerio = require('cheerio'); } catch (e) { cheerio = null; }

let resourceCache = null;
try { resourceCache = require('./resourceCache'); } catch (e) { resourceCache = null; }

const USER_AGENT = 'Seb-Unblocker-Search/1.0 (+https://example.invalid)';

async function fetchHtml(url, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'en-US,en;q=0.9' },
      redirect: 'follow',
      signal: controller.signal
    });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`Search fetch HTTP ${res.status}`);
    return await res.text();
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

/**
 * parseDuckDuckGoHtml(html, maxResults)
 * - Primary parser uses cheerio if available, otherwise falls back to regex parsing.
 */
function parseDuckDuckGoHtml(html, maxResults) {
  const results = [];

  if (!html) return results;
  if (cheerio) {
    try {
      const $ = cheerio.load(html);
      // DuckDuckGo's lite HTML uses .result__a and .result__snippet, but markup may vary
      $('.result').each((i, el) => {
        if (results.length >= maxResults) return;
        const titleEl = $(el).find('a.result__a, a[href].result__a').first();
        const snippetEl = $(el).find('.result__snippet, .result__snippet__text').first();
        const href = titleEl.attr('href') || titleEl.attr('data-href') || titleEl.attr('data-url') || '';
        const title = titleEl.text().trim() || 'Untitled';
        const description = snippetEl.text().trim() || '';
        if (href) results.push({ title, url: href, description });
      });
    } catch (e) {
      logWarn('cheerio parsing failed: ' + e.message);
    }
  }

  // fallback simple regex-based extraction if results are empty
  if (results.length === 0) {
    // Attempt to capture result anchors and adjacent snippet by simple regex
    const re = /<a[^>]*class=["'][^"']*result__a[^"']*["'][^>]*href=["']([^"']+)["'][^>]*>([^<]+)<\/a>[\s\S]*?(?:<a[^>]*class=["']result__snippet[^"']*["'][^>]*>([^<]+)<\/a>|<div[^>]*class=["']result__snippet[^"']*["'][^>]*>([^<]+)<\/div>)/gi;
    let m;
    while ((m = re.exec(html)) && results.length < maxResults) {
      const href = m[1];
      const title = m[2].replace(/<[^>]+>/g, '').trim();
      const desc = (m[3] || m[4] || '').replace(/<[^>]+>/g, '').trim();
      if (href) results.push({ title: title || href, url: href, description: desc });
    }
  }

  // Final safety: ensure every URL is absolute (DuckDuckGo returns absolute but be defensive)
  return results.slice(0, maxResults).map(r => {
    try {
      const u = new URL(r.url, 'https://duckduckgo.com');
      return { title: r.title, url: u.href, description: r.description || '' };
    } catch (e) {
      return { title: r.title, url: r.url, description: r.description || '' };
    }
  });
}

/**
 * buildDuckDuckGoUrl(query)
 */
function buildDuckDuckGoUrl(query) {
  const q = encodeURIComponent(String(query));
  return `https://duckduckgo.com/html/?q=${q}`;
}

/**
 * search(query, clientIp, opts)
 * - main entry point. returns an array of results
 * - supports caching via resourceCache if available
 */
async function search(query, clientIp = 'unknown', opts = {}) {
  if (!query || String(query).trim().length === 0) return [];
  const max = opts.max || getSearchMaxResults();
  const timeoutMs = opts.timeoutMs || getSearchTimeout();

  const cacheKey = `search::${query.toLowerCase().trim()}`;
  if (resourceCache && opts.useCache !== false) {
    try {
      const hit = await resourceCache.get(cacheKey);
      if (hit) {
        logInfo(`search cache hit for "${query}" (ip=${clientIp})`);
        return hit;
      }
    } catch (e) {
      logWarn('search cache get failed: ' + e.message);
    }
  }

  const url = buildDuckDuckGoUrl(query);
  let html;
  try {
    html = await fetchHtml(url, timeoutMs);
  } catch (err) {
    logWarn(`search fetch failed for "${query}": ${err.message}`);
    // fallback: return empty array rather than throwing
    return [];
  }

  const results = parseDuckDuckGoHtml(html, max);

  if (resourceCache && opts.useCache !== false) {
    try {
      await resourceCache.set(cacheKey, results, (opts.ttlMs || 60) * 1000);
    } catch (e) {
      logWarn('search cache set failed: ' + e.message);
    }
  }

  logInfo(`search completed for "${query}" -> ${results.length} results (ip=${clientIp})`);
  return results;
}

module.exports = { search, parseDuckDuckGoHtml, buildDuckDuckGoUrl };

