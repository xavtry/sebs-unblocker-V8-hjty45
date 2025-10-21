/**
 * jsParser.js
 *
 * Utilities for proxy-safe JavaScript handling
 * - Rewriting URLs embedded in scripts
 * - Removing unsafe calls (eval, document.write, etc.)
 * - Extracting URLs for caching or preloading
 */

const { logWarn } = (() => { try { return require('./logger'); } catch { return { logWarn: ()=>{} }; }})();
const { safeResolve } = (() => { try { return require('./rewrite'); } catch { return { safeResolve:(u,b)=>u }; }})();

const URL_REGEX = /(['"`])(https?:\/\/[^'"`]+)\1/gi;

/**
 * sanitizeJs(js)
 * - Remove unsafe calls and inline dangerous constructs
 */
function sanitizeJs(js) {
  if (!js) return '';
  try {
    return js.replace(/\beval\s*\(/gi, '')
             .replace(/\bdocument\.write\s*\(/gi, '')
             .replace(/\bnew\s+Function\s*\(/gi, '')
             .replace(/\bsetTimeout\s*\(\s*(['"`])/gi, 'setTimeout('); // prevent string eval
  } catch (e) {
    logWarn('sanitizeJs failed: ' + e.message);
    return js;
  }
}

/**
 * rewriteJsUrls(js, baseUrl, rewriteFn)
 */
function rewriteJsUrls(js, baseUrl, rewriteFn) {
  if (!js) return '';
  return js.replace(URL_REGEX, (match, q, url) => {
    try {
      const abs = safeResolve(url, baseUrl);
      return `${q}${rewriteFn(abs)}${q}`;
    } catch (e) {
      return match;
    }
  });
}

/**
 * extractUrls(js, baseUrl)
 * - returns array of URLs embedded in JS
 */
function extractUrls(js, baseUrl) {
  const urls = [];
  if (!js) return urls;
  let match;
  while ((match = URL_REGEX.exec(js)) !== null) {
    try {
      urls.push(safeResolve(match[2], baseUrl));
    } catch (e) {}
  }
  return urls;
}

/**
 * parseJs(js, baseUrl, rewriteFn)
 * - Main parser: rewrites URLs and sanitizes
 */
function parseJs(js, baseUrl, rewriteFn) {
  if (!js) return '';
  try {
    js = rewriteJsUrls(js, baseUrl, rewriteFn);
    js = sanitizeJs(js);
  } catch (e) {
    logWarn('parseJs failed: ' + e.message);
  }
  return js;
}

/**
 * analyzeJs(js)
 * - returns metadata: { containsEval, containsDocumentWrite, containsFunctionConstructor }
 */
function analyzeJs(js) {
  const meta = { containsEval:false, containsDocumentWrite:false, containsFunctionConstructor:false };
  if (!js) return meta;
  try {
    meta.containsEval = /\beval\s*\(/i.test(js);
    meta.containsDocumentWrite = /\bdocument\.write\s*\(/i.test(js);
    meta.containsFunctionConstructor = /\bnew\s+Function\s*\(/i.test(js);
  } catch (e) {}
  return meta;
}

module.exports = {
  sanitizeJs,
  rewriteJsUrls,
  extractUrls,
  parseJs,
  analyzeJs
};

