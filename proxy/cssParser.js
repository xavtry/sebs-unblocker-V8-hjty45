/**
 * cssParser.js
 *
 * Utilities to parse, rewrite, and sanitize CSS for the proxy.
 * - Rewrite URLs to go through proxy
 * - Remove unsafe rules
 * - Inline imports
 * - Support for caching
 */

const { logWarn, logInfo } = (() => {
  try { return require('./logger'); } catch { return { logWarn: ()=>{}, logInfo: ()=>{} }; }
})();
const { safeResolve } = (() => {
  try { return require('./rewrite'); } catch { return { safeResolve: (u,b)=>u }; }
})();
const { getProxyDefaults } = (() => {
  try { return require('./config'); } catch { return ()=>({}); }
})();
const fs = require('fs');
const path = require('path');

const URL_REGEX = /url\((['"]?)([^'")]+)\1\)/gi;
const IMPORT_REGEX = /@import\s+(?:url\()?['"]?([^'")]+)['"]?\)?;/gi;

/**
 * rewriteCssUrls(css, baseUrl, rewriteFn)
 * - Finds url(...) in CSS and rewrites with given rewrite function
 */
function rewriteCssUrls(css, baseUrl, rewriteFn) {
  if (!css) return '';
  return css.replace(URL_REGEX, (match, q, url) => {
    try {
      const abs = safeResolve(url, baseUrl);
      return `url(${rewriteFn(abs)})`;
    } catch (e) {
      logWarn('rewriteCssUrls failed for ' + url);
      return match;
    }
  });
}

/**
 * inlineImports(css, baseUrl, fetcherFn)
 * - fetches imported CSS and inlines it
 */
async function inlineImports(css, baseUrl, fetcherFn) {
  if (!css) return css;
  let match;
  while ((match = IMPORT_REGEX.exec(css)) !== null) {
    const importUrl = match[1];
    try {
      const abs = safeResolve(importUrl, baseUrl);
      const importedCss = await fetcherFn(abs);
      const cleaned = await inlineImports(importedCss, abs, fetcherFn); // recursive
      css = css.replace(match[0], cleaned);
    } catch (e) {
      logWarn('inlineImports failed for ' + importUrl);
      css = css.replace(match[0], '');
    }
  }
  return css;
}

/**
 * sanitizeCss(css)
 * - removes potentially unsafe rules (expression, javascript, etc.)
 */
function sanitizeCss(css) {
  if (!css) return '';
  return css.replace(/expression\s*\(.*?\)/gi, '')
            .replace(/javascript\s*:/gi, '')
            .replace(/behaviour\s*:/gi, '')
            .replace(/@import\s+/gi, ''); // optional, redundant if inlineImports used
}

/**
 * parseCss(css, baseUrl, rewriteFn, fetcherFn)
 * - Main entry: rewrites urls, inlines imports, sanitizes CSS
 */
async function parseCss(css, baseUrl, rewriteFn, fetcherFn) {
  if (!css) return '';
  let result = css;
  try {
    result = await inlineImports(result, baseUrl, fetcherFn);
    result = rewriteCssUrls(result, baseUrl, rewriteFn);
    result = sanitizeCss(result);
  } catch (e) {
    logWarn('parseCss failed: ' + e.message);
  }
  return result;
}

/**
 * extractUrls(css, baseUrl)
 * - returns array of absolute URLs referenced in CSS
 */
function extractUrls(css, baseUrl) {
  const urls = [];
  if (!css) return urls;
  let match;
  while ((match = URL_REGEX.exec(css)) !== null) {
    try {
      const abs = safeResolve(match[2], baseUrl);
      urls.push(abs);
    } catch (e) {}
  }
  return urls;
}

module.exports = {
  rewriteCssUrls,
  inlineImports,
  sanitizeCss,
  parseCss,
  extractUrls
};

