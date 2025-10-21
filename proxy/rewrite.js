/**
 * rewrite.js
 *
 * Functions to rewrite HTML/CSS/JS to route asset URLs through the proxy.
 * This module focuses on correctness and resilience:
 *  - rewriteHtml(html, baseUrl) -> rewritten HTML string
 *  - rewriteCss(cssText, baseUrl) -> rewritten CSS string
 *  - rewriteJs(jsText, baseUrl) -> rewritten JS string (best-effort)
 *  - It handles <base>, meta-refresh, inline styles, url(), @import, fetch/XHR patterns.
 *
 * NOTE:
 *  - For heavy-duty rewriting use a proper HTML parser (cheerio / parse5). Here we keep
 *    a dependency-free approach using robust regex + URL resolution for portability.
 */

const { URL } = require('url');
const { logger } = (() => {
  try { return require('./logger'); } catch (e) { return { logger: { logInfo: () => {}, logWarn: () => {}, logError: () => {} } }; }
})();

/**
 * safeResolve(link, base)
 * Resolve link relative to base, but if link is already absolute returns it.
 */
function safeResolve(link, base) {
  try {
    return new URL(link, base).href;
  } catch (e) {
    return link;
  }
}

/**
 * escapeAttr - ensure quotes inside attribute are encoded
 */
function escapeAttr(s) {
  return String(s).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * rewriteHtml(html, baseUrl, options)
 * - Rewrites href/src/action/data-* to go through proxy endpoints:
 *   - page links -> /proxy?url=...
 *   - assets (css/js/img) -> /resource?url=...
 * - Removes or rewrites <base> tags.
 * - Rewrites meta refresh to proxy target.
 * - Rewrites inline style url(...) occurrences.
 *
 * options:
 *  - proxyPath (default '/proxy?url=')
 *  - resourcePath (default '/resource?url=')
 *  - aggressiveSanitize (boolean)
 */
function rewriteHtml(html, baseUrl, options = {}) {
  if (!html || !baseUrl) return html;
  const cfg = Object.assign({ proxyPath: '/proxy?url=', resourcePath: '/resource?url=', aggressiveSanitize: false }, options);

  let out = html;

  // Remove or neutralize <base> to prevent relative URL confusion
  out = out.replace(/<base[^>]*>/gi, '');

  // Rewrite meta refresh: <meta http-equiv="refresh" content="5; url=/foo">
  out = out.replace(/<meta[^>]+http-equiv=["']?refresh["']?[^>]*>/gi, (m) => {
    try {
      const contentMatch = m.match(/content=["']?([^"'>]+)["']?/i);
      if (!contentMatch) return '';
      const parts = contentMatch[1].split(';').map(p => p.trim());
      const urlPart = parts.find(p => /^url=/i.test(p));
      if (!urlPart) return m;
      const orig = urlPart.split('=')[1];
      const resolved = safeResolve(orig, baseUrl);
      return `<meta http-equiv="refresh" content="${escapeAttr(parts[0])}; url=${escapeAttr(cfg.proxyPath + encodeURIComponent(resolved))}">`;
    } catch (e) {
      logger.logWarn('rewriteHtml meta refresh rewrite failed: ' + e.message);
      return '';
    }
  });

  // Rewrite tags with src/href attributes
  out = out.replace(/<(img|script|iframe|audio|video|source|link|embed|object)\b([^>]*)>/gi, (match, tag, attrs) => {
    try {
      let newAttrs = attrs;

      // rewrite src
      newAttrs = newAttrs.replace(/\bsrc=(['"])([^'"]+)\1/gi, (m2, q, src) => {
        const abs = safeResolve(src, baseUrl);
        // assets -> resource route; frames/scripts -> proxy? we choose:
        if (/^https?:\/\//i.test(abs)) {
          if (tag === 'script' || tag === 'iframe' || tag === 'embed' || tag === 'object') {
            return `src="${cfg.proxyPath}${encodeURIComponent(abs)}"`;
          } else {
            return `src="${cfg.resourcePath}${encodeURIComponent(abs)}"`;
          }
        }
        return m2;
      });

      // rewrite href (links or stylesheets)
      newAttrs = newAttrs.replace(/\bhref=(['"])([^'"]+)\1/gi, (m2, q, href) => {
        const abs = safeResolve(href, baseUrl);
        if (!abs) return m2;
        // if link rel=stylesheet -> resourcePath; else -> proxy
        if (/rel\s*=\s*['"]?stylesheet['"]?/i.test(newAttrs)) {
          return `href="${cfg.resourcePath}${encodeURIComponent(abs)}"`;
        } else {
          return `href="${cfg.proxyPath}${encodeURIComponent(abs)}"`;
        }
      });

      // rewrite srcset (img srcset)
      newAttrs = newAttrs.replace(/\bsrcset=(['"])([^'"]+)\1/gi, (m2, q, srcset) => {
        try {
          const parts = srcset.split(',').map(p => p.trim());
          const rewritten = parts.map(p => {
            const [src, desc] = p.split(/\s+/);
            const abs = safeResolve(src, baseUrl);
            return `${cfg.resourcePath}${encodeURIComponent(abs)}${desc ? ' ' + desc : ''}`;
          }).join(', ');
          return `srcset="${escapeAttr(rewritten)}"`;
        } catch (e) { return m2; }
      });

      // ensure sandbox for iframes if none provided
      if (tag === 'iframe' && !/sandbox=/i.test(newAttrs)) {
        newAttrs += ' sandbox="allow-scripts allow-forms allow-same-origin"';
      }

      return `<${tag}${newAttrs}>`;
    } catch (e) {
      logger.logWarn('rewriteHtml tag rewrite failed: ' + e.message);
      return match;
    }
  });

  // Rewrite inline CSS url(...) usages
  out = out.replace(/style=(['"])([^'"]*?)\1/gi, (m, q, styleContent) => {
    try {
      const replaced = styleContent.replace(/url\(([^)]+)\)/gi, (um, urlPart) => {
        const clean = urlPart.replace(/['"]/g, '').trim();
        const abs = safeResolve(clean, baseUrl);
        return `url("${cfg.resourcePath}${encodeURIComponent(abs)}")`;
      });
      return `style="${escapeAttr(replaced)}"`;
    } catch (e) {
      return m;
    }
  });

  // Rewrite inline <style> content with url() and @import
  out = out.replace(/<style[^>]*>([\s\S]*?)<\/style>/gi, (m, css) => {
    try {
      const rewrittenCss = rewriteCss(css, baseUrl, cfg);
      return `<style>${rewrittenCss}</style>`;
    } catch (e) { return m; }
  });

  // Rewrite inline JS occurrences like fetch('/api') or XMLHttpRequest.open('GET','/api')
  out = out.replace(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi, (m, attrs, code) => {
    try {
      // if external script (src present) was already handled above
      const rewritten = rewriteJs(code, baseUrl, cfg);
      return `<script${attrs}>${rewritten}</script>`;
    } catch (e) {
      logger.logWarn('rewriteHtml script rewrite failed: ' + e.message);
      return m;
    }
  });

  // Optional aggressive sanitization
  if (cfg.aggressiveSanitize) {
    // remove dangerous inline event handlers
    out = out.replace(/\son\w+=(['"])[\s\S]*?\1/gi, '');
  }

  return out;
}

/**
 * rewriteCss(cssText, baseUrl, cfg)
 * - handles url(), @import, font-face urls, and relative references
 */
function rewriteCss(cssText, baseUrl, cfg = {}) {
  if (!cssText || !baseUrl) return cssText;
  const options = Object.assign({ resourcePath: '/resource?url=' }, cfg);

  // rewrite url(...)
  let out = cssText.replace(/url\(([^)]+)\)/gi, (m, urlPart) => {
    try {
      const cleaned = urlPart.replace(/['"]/g, '').trim();
      if (/^data:/.test(cleaned)) return `url(${cleaned})`; // keep data URIs
      const abs = safeResolve(cleaned, baseUrl);
      return `url(${options.resourcePath + encodeURIComponent(abs)})`;
    } catch (e) {
      return m;
    }
  });

  // rewrite @import
  out = out.replace(/@import\s+(?:url\()?['"]?([^'"\)]+)['"]?\)?/gi, (m, imp) => {
    try {
      const abs = safeResolve(imp, baseUrl);
      return `@import url("${options.resourcePath + encodeURIComponent(abs)}")`;
    } catch (e) { return m; }
  });

  return out;
}

/**
 * rewriteJs(jsText, baseUrl, cfg)
 * - best-effort rewriting for fetch(), XMLHttpRequest, import(), dynamic script src
 * - does not attempt to parse JS AST (would require acorn/babel)
 */
function rewriteJs(jsText, baseUrl, cfg = {}) {
  if (!jsText || !baseUrl) return jsText;
  const proxyPath = (cfg && cfg.proxyPath) || '/proxy?url=';

  let out = jsText;

  // fetch('relative') => fetch('/proxy?url=abs')
  out = out.replace(/fetch\s*\(\s*(['"`])([^'"`]+)\1/gi, (m, q, p) => {
    try {
      const abs = safeResolve(p, baseUrl);
      return `fetch(${q}${proxyPath}${encodeURIComponent(abs)}${q}`;
    } catch (e) { return m; }
  });

  // XMLHttpRequest open('GET','/api') => open('GET','/proxy?url=abs')
  out = out.replace(/open\s*\(\s*(['"`])?(GET|POST|PUT|DELETE|PATCH)['"]?\s*,\s*(['"`])([^'"`]+)\3/gi, (m, _a, method, q, p) => {
    try {
      const abs = safeResolve(p, baseUrl);
      return m.replace(p, proxyPath + encodeURIComponent(abs));
    } catch (e) { return m; }
  });

  // dynamic script creation: el.src = "/foo.js" -> el.src = "/proxy?url=abs"
  out = out.replace(/(\.src\s*=\s*['"`])([^'"`]+)(['"`])/gi, (m, a, p, b) => {
    try {
      const abs = safeResolve(p, baseUrl);
      return `${a}${proxyPath}${encodeURIComponent(abs)}${b}`;
    } catch (e) { return m; }
  });

  // dynamic import('...') -> import('/proxy?url=abs')
  out = out.replace(/import\s*\(\s*(['"`])([^'"`]+)\1\s*\)/gi, (m, q, p) => {
    try {
      const abs = safeResolve(p, baseUrl);
      return `import(${q}${proxyPath}${encodeURIComponent(abs)}${q})`;
    } catch (e) { return m; }
  });

  return out;
}

module.exports = {
  rewriteHtml,
  rewriteCss,
  rewriteJs,
  safeResolve
};

