/**
 * sanitize.js
 *
 * Cleans and validates URLs, headers, and payloads to prevent injection attacks.
 * Provides helper methods:
 * - sanitizeURL()
 * - sanitizeHeaders()
 * - sanitizeHTML()
 * - sanitizeQueryParams()
 * - sanitizeFilename()
 */

const { URL } = require('url');
const xss = require('xss'); // safe to require if installed; otherwise fallback

function sanitizeURL(input) {
  try {
    if (!input || typeof input !== 'string') return null;
    let raw = input.trim();
    if (!/^https?:\/\//i.test(raw)) raw = 'https://' + raw;

    const parsed = new URL(raw);
    const hostname = parsed.hostname.toLowerCase();

    // Reject private/local IPs
    const badHosts = ['localhost', '127.', '::1', '0.0.0.0'];
    if (badHosts.some((h) => hostname.startsWith(h))) return null;

    // Remove dangerous query keys
    parsed.searchParams.forEach((v, k) => {
      if (/(<|>|script|javascript:)/i.test(v)) parsed.searchParams.delete(k);
    });

    return parsed.toString();
  } catch {
    return null;
  }
}

function sanitizeHeaders(headers) {
  const clean = {};
  for (const [k, v] of Object.entries(headers || {})) {
    const key = k.toLowerCase();
    if (key.startsWith('proxy-') || key.startsWith('x-forwarded')) continue;
    if (/(cookie|authorization|set-cookie)/i.test(key)) continue;
    const safeVal = String(v).replace(/[^\w\-\/\.;,= ]/g, '');
    clean[key] = safeVal;
  }
  return clean;
}

function sanitizeHTML(html) {
  try {
    if (!html || typeof html !== 'string') return '';
    if (xss) return xss(html);
    // fallback
    return html
      .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
      .replace(/on\w+="[^"]*"/gi, '');
  } catch {
    return '';
  }
}

function sanitizeQueryParams(queryObj) {
  const clean = {};
  for (const [key, val] of Object.entries(queryObj || {})) {
    const safeKey = key.replace(/[^\w\-_.]/g, '');
    let safeVal = String(val).trim();
    safeVal = safeVal.replace(/[^\w\-_.:@/?&=%]/g, '');
    clean[safeKey] = safeVal;
  }
  return clean;
}

function sanitizeFilename(name) {
  return String(name || '')
    .replace(/[^a-zA-Z0-9_\-.]/g, '_')
    .slice(0, 255);
}

function stripDangerousHeaders(respHeaders) {
  const blacklist = ['content-security-policy', 'x-frame-options', 'x-xss-protection', 'referrer-policy'];
  const safe = {};
  for (const [k, v] of Object.entries(respHeaders || {})) {
    if (blacklist.includes(k.toLowerCase())) continue;
    safe[k] = v;
  }
  return safe;
}

function sanitizeBody(body) {
  try {
    if (!body) return '';
    if (Buffer.isBuffer(body)) return body;
    let str = String(body);
    if (str.length > 10_000_000) str = str.slice(0, 10_000_000);
    return str.replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '');
  } catch {
    return '';
  }
}

module.exports = {
  sanitizeURL,
  sanitizeHeaders,
  sanitizeHTML,
  sanitizeQueryParams,
  sanitizeFilename,
  stripDangerousHeaders,
  sanitizeBody
};

