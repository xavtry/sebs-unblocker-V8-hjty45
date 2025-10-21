/**
 * iframeHandler.js
 *
 * Utilities to handle iframe content safely
 * - Rewrite iframe src attributes
 * - Remove unsafe iframes
 * - Preload iframe content optionally
 */

const { logWarn, logInfo } = (()=>{ try{ return require('./logger'); } catch { return {logWarn:()=>{},logInfo:()=>{}}}; })();
const { safeResolve } = (()=>{ try{ return require('./rewrite'); } catch { return {safeResolve:(u,b)=>u}; }})();

/**
 * sanitizeIframeTag(tagHtml, baseUrl, rewriteFn)
 * - Takes raw iframe HTML and returns safe iframe HTML
 */
function sanitizeIframeTag(tagHtml, baseUrl, rewriteFn) {
  try {
    // extract src
    const srcMatch = tagHtml.match(/\bsrc\s*=\s*(['"])([^'"]+)\1/i);
    if (!srcMatch) return '';
    const abs = safeResolve(srcMatch[2], baseUrl);
    const newSrc = rewriteFn(abs);

    // rebuild iframe with only allowed attributes
    return `<iframe src="${newSrc}" width="100%" height="100%" frameborder="0" allowfullscreen></iframe>`;
  } catch (e) {
    logWarn('sanitizeIframeTag failed: '+e.message);
    return '';
  }
}

/**
 * sanitizeIframes(html, baseUrl, rewriteFn)
 * - Processes all <iframe> tags in html
 */
function sanitizeIframes(html, baseUrl, rewriteFn) {
  if (!html) return '';
  try {
    return html.replace(/<iframe[^>]*>/gi, (match)=>{
      return sanitizeIframeTag(match, baseUrl, rewriteFn);
    });
  } catch (e) {
    logWarn('sanitizeIframes failed: '+e.message);
    return html;
  }
}

/**
 * extractIframeUrls(html, baseUrl)
 * - returns array of absolute URLs from all iframes
 */
function extractIframeUrls(html, baseUrl) {
  const urls = [];
  if (!html) return urls;
  try {
    const re = /<iframe[^>]*src=(['"])([^'"]+)\1/gi;
    let m;
    while((m = re.exec(html)) !== null) {
      try {
        urls.push(safeResolve(m[2], baseUrl));
      } catch {}
    }
  } catch (e) { logWarn('extractIframeUrls failed'); }
  return urls;
}

/**
 * preloadIframeContent(urls, fetcherFn)
 * - fetches iframe content for caching or security analysis
 */
async function preloadIframeContent(urls, fetcherFn) {
  if (!urls || urls.length === 0) return [];
  const results = [];
  for (const u of urls) {
    try {
      const content = await fetcherFn(u);
      results.push({ url: u, content });
    } catch (e) {
      logWarn('preloadIframeContent failed for '+u);
    }
  }
  return results;
}

/**
 * iframeSafeWrapper(html, baseUrl, rewriteFn, fetcherFn)
 * - full iframe handling pipeline: sanitize, extract, preload
 */
async function iframeSafeWrapper(html, baseUrl, rewriteFn, fetcherFn) {
  const safeHtml = sanitizeIframes(html, baseUrl, rewriteFn);
  const urls = extractIframeUrls(safeHtml, baseUrl);
  const preloaded = await preloadIframeContent(urls, fetcherFn);
  return { safeHtml, preloaded };
}

module.exports = {
  sanitizeIframeTag,
  sanitizeIframes,
  extractIframeUrls,
  preloadIframeContent,
  iframeSafeWrapper
};

