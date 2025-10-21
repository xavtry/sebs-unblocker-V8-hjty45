/**
 * htmlParser.js
 *
 * Utilities for safely parsing and extracting information from HTML.
 * - Uses cheerio if present (recommended), otherwise uses robust fallback techniques.
 * - Exposes:
 *    parseLinks(html, baseUrl) -> [{ href, text, rel, type }]
 *    extractText(html) -> plain text
 *    extractMeta(html) -> { title, description, charset, viewport }
 *    findIframes(html) -> [{src, attrs}]
 *    removeScripts(html) -> cleanedHtml
 *
 * The parser is defensive to avoid crashing on malformed HTML.
 */

let cheerio = null;
try { cheerio = require('cheerio'); } catch (e) { cheerio = null; }

const { safeResolve } = (() => {
  try { return require('./rewrite'); } catch (e) {
    return { safeResolve: (u, b) => {
      try { return new URL(u, b).href; } catch { return u; }
    }};
  }
})();

const { logWarn } = (() => {
  try { return require('./logger'); } catch (e) { return { logWarn: ()=>{} }; }
})();

/**
 * parseLinks(html, baseUrl)
 * - Finds <a> tags and returns normalized list
 */
function parseLinks(html, baseUrl) {
  const results = [];
  if (!html) return results;

  if (cheerio) {
    try {
      const $ = cheerio.load(html);
      $('a[href]').each((i, el) => {
        try {
          const href = $(el).attr('href');
          const text = $(el).text().trim();
          const rel = $(el).attr('rel') || '';
          const type = $(el).attr('type') || '';
          const resolved = safeResolve(href, baseUrl);
          results.push({ href: resolved, text, rel, type });
        } catch (e) { /* ignore individual parse errors */ }
      });
      return results;
    } catch (e) {
      logWarn('cheerio parseLinks failed: ' + e.message);
      // fallthrough to fallback
    }
  }

  // Basic regex fallback
  const re = /<a\s+[^>]*href=(['"]?)([^"'\s>]+)\1[^>]*>(.*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html))) {
    try {
      const rawHref = m[2];
      const text = (m[3] || '').replace(/<[^>]+>/g, '').trim();
      const resolved = safeResolve(rawHref, baseUrl);
      results.push({ href: resolved, text, rel: '', type: '' });
    } catch (e) { /* ignore */ }
  }
  return results;
}

/**
 * extractText(html)
 * - returns a safe plain-text representation
 */
function extractText(html) {
  if (!html) return '';
  if (cheerio) {
    try {
      const $ = cheerio.load(html);
      // remove script/style
      $('script,style,noscript').remove();
      return $('body').text().replace(/\s+/g, ' ').trim();
    } catch (e) { logWarn('cheerio extractText failed: ' + e.message); }
  }
  // fallback
  const stripped = html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
                      .replace(/<[^>]+>/g, ' ')
                      .replace(/\s+/g, ' ')
                      .trim();
  return stripped;
}

/**
 * extractMeta(html)
 * - returns { title, description, charset, viewport }
 */
function extractMeta(html) {
  const out = { title: '', description: '', charset: '', viewport: '' };
  if (!html) return out;

  if (cheerio) {
    try {
      const $ = cheerio.load(html);
      out.title = $('title').first().text().trim() || out.title;
      out.description = $('meta[name="description"]').attr('content') || out.description;
      out.charset = $('meta[charset]').attr('charset') || out.charset;
      out.viewport = $('meta[name="viewport"]').attr('content') || out.viewport;
      return out;
    } catch (e) { logWarn('cheerio extractMeta failed: ' + e.message); }
  }

  // fallback regex
  try {
    const t = html.match(/<title[^>]*>([^<]*)<\/title>/i);
    if (t) out.title = (t[1] || '').trim();
    const d = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i);
    if (d) out.description = (d[1] || '').trim();
    const c = html.match(/<meta[^>]*charset=["']?([^"'>\s]+)["']?/i);
    if (c) out.charset = (c[1] || '').trim();
    const v = html.match(/<meta[^>]*name=["']viewport["'][^>]*content=["']([^"']+)["']/i);
    if (v) out.viewport = (v[1] || '').trim();
  } catch (e) { /* ignore */ }
  return out;
}

/**
 * findIframes(html, baseUrl)
 * - returns array of { src, attrs }
 */
function findIframes(html, baseUrl) {
  const out = [];
  if (!html) return out;
  if (cheerio) {
    try {
      const $ = cheerio.load(html);
      $('iframe[src]').each((i, el) => {
        const src = $(el).attr('src');
        const resolved = safeResolve(src, baseUrl);
        const attrs = {};
        Object.keys(el.attribs || {}).forEach(k => attrs[k] = el.attribs[k]);
        out.push({ src: resolved, attrs });
      });
      return out;
    } catch (e) { logWarn('cheerio findIframes failed: ' + e.message); }
  }

  const re = /<iframe[^>]*src=(['"]?)([^"'\s>]+)\1[^>]*>/gi;
  let m;
  while ((m = re.exec(html))) {
    try {
      const raw = m[2];
      const resolved = safeResolve(raw, baseUrl);
      out.push({ src: resolved, attrs: {} });
    } catch (e) {}
  }
  return out;
}

/**
 * removeScripts(html)
 * - removes inline and external scripts for safe embedding
 */
function removeScripts(html) {
  if (!html) return '';
  try {
    // Remove <script>...</script> and JS event handlers
    let cleaned = html.replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '');
    cleaned = cleaned.replace(/\son\w+\s*=\s*(['"])[\s\S]*?\1/gi, '');
    return cleaned;
  } catch (e) {
    logWarn('removeScripts error: ' + e.message);
    return html;
  }
}

/**
 * rewriteRelativePaths(html, baseUrl, rewriteFn)
 * - finds src/href/url(...) and passes absolute URL to rewriteFn to get new value
 * - rewriteFn should accept (absoluteUrl, originalAttr, tagName) and return replacement string
 */
function rewriteRelativePaths(html, baseUrl, rewriteFn) {
  if (!html) return html;
  try {
    // href/src attributes
    return html.replace(/<(a|img|script|link|iframe|source|video|audio|embed|object)\b([^>]*)>/gi, (m, tag, attrs) => {
      let newAttrs = attrs.replace(/\b(href|src)\s*=\s*(['"])([^'"]+)\2/gi, (m2, attr, q, val) => {
        try {
          const abs = safeResolve(val, baseUrl);
          const replacement = rewriteFn(abs, attr, tag) || val;
          return `${attr}=${q}${replacement}${q}`;
        } catch (e) { return m2; }
      });

      // inline style url()
      newAttrs = newAttrs.replace(/style=(['"])(.*?)\1/gi, (m3, q, styleContent) => {
        const replaced = styleContent.replace(/url\(([^)]+)\)/gi, (um, u) => {
          try {
            const cleaned = u.replace(/['"]/g, '').trim();
            const abs = safeResolve(cleaned, baseUrl);
            return `url(${rewriteFn(abs, 'style-url', tag)})`;
          } catch (e) { return um; }
        });
        return `style=${q}${replaced}${q}`;
      });

      return `<${tag}${newAttrs}>`;
    });
  } catch (e) {
    logWarn('rewriteRelativePaths failed: ' + e.message);
    return html;
  }
}

module.exports = {
  parseLinks,
  extractText,
  extractMeta,
  findIframes,
  removeScripts,
  rewriteRelativePaths
};

