/**
 * cookies.js
 *
 * Utilities to manage cookies safely in the proxy
 * - Parsing and serializing cookies
 * - Filtering sensitive cookies
 * - Rewriting domains/paths
 * - Optional persistence/logging
 */

const fs = require('fs');
const path = require('path');
const { logInfo, logWarn } = (() => {
  try { return require('./logger'); } catch { return { logInfo: ()=>{}, logWarn: ()=>{} }; }
})();
const COOKIE_LOG_PATH = path.join(__dirname, '../logs/cookies.log');

/**
 * parseCookieHeader(header)
 * - Converts 'Cookie' header into object { key: value }
 */
function parseCookieHeader(header) {
  const result = {};
  if (!header || typeof header !== 'string') return result;
  header.split(';').forEach(pair => {
    const idx = pair.indexOf('=');
    if (idx > 0) {
      const key = pair.slice(0, idx).trim();
      const val = pair.slice(idx + 1).trim();
      result[key] = val;
    }
  });
  return result;
}

/**
 * serializeCookie(key, value, options)
 * - Converts key/value and options into a Set-Cookie string
 */
function serializeCookie(key, value, options = {}) {
  let cookieStr = `${key}=${value}`;
  if (options.domain) cookieStr += `; Domain=${options.domain}`;
  if (options.path) cookieStr += `; Path=${options.path}`;
  if (options.expires) cookieStr += `; Expires=${options.expires.toUTCString()}`;
  if (options.maxAge) cookieStr += `; Max-Age=${options.maxAge}`;
  if (options.httpOnly) cookieStr += '; HttpOnly';
  if (options.secure) cookieStr += '; Secure';
  if (options.sameSite) cookieStr += `; SameSite=${options.sameSite}`;
  return cookieStr;
}

/**
 * filterCookies(cookies, options)
 * - Remove unsafe or third-party cookies
 */
function filterCookies(cookies = {}, options = {}) {
  const { whitelist = [], blacklist = [] } = options;
  const filtered = {};
  Object.entries(cookies).forEach(([k,v])=>{
    if (blacklist.includes(k)) return;
    if (whitelist.length && !whitelist.includes(k)) return;
    filtered[k] = v;
  });
  return filtered;
}

/**
 * rewriteCookieDomains(cookies, domainMap)
 * - Rewrites domains according to proxy mapping
 */
function rewriteCookieDomains(cookies = {}, domainMap = {}) {
  const rewritten = {};
  Object.entries(cookies).forEach(([k,v])=>{
    const newDomain = domainMap[k] || null;
    rewritten[k] = newDomain ? `${v}; Domain=${newDomain}` : v;
  });
  return rewritten;
}

/**
 * logCookies(cookies)
 * - Writes cookie info to logs
 */
function logCookies(cookies = {}) {
  try {
    const timestamp = new Date().toISOString();
    const lines = Object.entries(cookies).map(([k,v])=>`${timestamp} | ${k}=${v}`);
    fs.appendFileSync(COOKIE_LOG_PATH, lines.join('\n')+'\n');
  } catch (e) {
    logWarn('logCookies failed: ' + e.message);
  }
}

/**
 * mergeCookies(target, source)
 * - merges two cookie objects, source overrides target
 */
function mergeCookies(target = {}, source = {}) {
  return Object.assign({}, target, source);
}

/**
 * cookieMiddleware(req, res, next)
 * - Express middleware to parse and rewrite cookies
 */
function cookieMiddleware(options = {}) {
  return (req, res, next) => {
    try {
      const cookies = parseCookieHeader(req.headers.cookie || '');
      const filtered = filterCookies(cookies, options);
      req.proxyCookies = filtered;
      // attach Set-Cookie helper
      res.setProxyCookie = (key, value, opts) => {
        const cookieStr = serializeCookie(key, value, opts);
        res.setHeader('Set-Cookie', cookieStr);
      };
    } catch (e) {
      logWarn('cookieMiddleware error: ' + e.message);
    }
    next();
  };
}

module.exports = {
  parseCookieHeader,
  serializeCookie,
  filterCookies,
  rewriteCookieDomains,
  logCookies,
  mergeCookies,
  cookieMiddleware
};

