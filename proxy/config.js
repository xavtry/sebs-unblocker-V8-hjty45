/**
 * config.js
 *
 * Central configuration for Seb-Unblocker V8.
 * - Provides default values and getters
 * - Allows runtime overrides via environment variables
 * - Small utility helpers for common config use-cases
 *
 * Keep configuration here so other modules import the same source of truth.
 */

const path = require('path');
const os = require('os');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const LOG_DIR = process.env.SEB_LOG_DIR || path.join(ROOT, 'logs');
const CACHE_DIR = process.env.SEB_CACHE_DIR || path.join(ROOT, 'cache');

const DEFAULTS = {
  server: {
    host: process.env.HOST || '0.0.0.0',
    port: parseInt(process.env.PORT || '3000', 10),
    trustProxy: process.env.TRUST_PROXY === '1' ? true : false
  },

  proxy: {
    proxyPath: '/proxy?url=',
    resourcePath: '/resource?url=',
    maxContentLength: 8 * 1024 * 1024, // 8MB
    timeout: parseInt(process.env.PROXY_TIMEOUT || '15000', 10), // ms
    allowDataSchemes: true,
    blockedHostnames: (process.env.BLOCKED_HOSTNAMES || 'localhost,127.0.0.1,::1,0.0.0.0').split(',').map(s=>s.trim()).filter(Boolean)
  },

  puppeteer: {
    enabled: process.env.PUPPETEER_ENABLED === '1' ? true : false,
    headless: process.env.PUPPETEER_HEADLESS !== 'false',
    args: (process.env.PUPPETEER_ARGS ? process.env.PUPPETEER_ARGS.split(' ') : ['--no-sandbox', '--disable-setuid-sandbox']),
    timeout: parseInt(process.env.PUPPETEER_TIMEOUT || '20000', 10)
  },

  caching: {
    enabled: process.env.CACHE_ENABLED !== '0',
    defaultTtlMs: parseInt(process.env.CACHE_TTL_MS || String(5 * 60 * 1000), 10),
    maxMemoryItems: parseInt(process.env.CACHE_MAX_ITEMS || '500', 10),
    persistDir: CACHE_DIR
  },

  security: {
    rateLimitWindowMs: parseInt(process.env.RATE_WINDOW_MS || String(60 * 1000), 10),
    rateLimitMax: parseInt(process.env.RATE_MAX || '120', 10),
    csp: process.env.CSP || "default-src 'self' 'unsafe-inline' data: blob:;",
    allowedProtocols: ['http:', 'https:']
  },

  logging: {
    level: process.env.LOG_LEVEL || 'info',
    dir: LOG_DIR,
    file: path.join(LOG_DIR, 'proxy.log'),
    jsonLines: true
  },

  search: {
    engine: process.env.SEARCH_ENGINE || 'duckduckgo',
    maxResults: parseInt(process.env.SEARCH_MAX_RESULTS || '10', 10),
    timeoutMs: parseInt(process.env.SEARCH_TIMEOUT_MS || '8000', 10)
  }
};

// Ensure critical folders exist
try {
  if (!fs.existsSync(DEFAULTS.logging.dir)) fs.mkdirSync(DEFAULTS.logging.dir, { recursive: true });
  if (!fs.existsSync(DEFAULTS.caching.persistDir)) fs.mkdirSync(DEFAULTS.caching.persistDir, { recursive: true });
} catch (e) {
  // If creation fails, keep going — modules should handle missing dirs gracefully
  // but log messages should notify the operator.
}

/**
 * Utility helpers
 */

function isBlockedHostname(hostname) {
  if (!hostname) return true;
  const lower = hostname.toLowerCase();
  return DEFAULTS.proxy.blockedHostnames.some(b => {
    if (!b) return false;
    // exact or prefix match for IP ranges like 127.
    return lower === b.toLowerCase() || lower.startsWith(b.toLowerCase());
  });
}

function resolveProxyUrl(target) {
  return `${DEFAULTS.proxy.proxyPath}${encodeURIComponent(target)}`;
}

function resolveResourceUrl(target) {
  return `${DEFAULTS.proxy.resourcePath}${encodeURIComponent(target)}`;
}

function getPort() {
  return DEFAULTS.server.port;
}

function getHost() {
  return DEFAULTS.server.host;
}

function getLogFile() {
  return DEFAULTS.logging.file;
}

function isPuppeteerEnabled() {
  return DEFAULTS.puppeteer.enabled;
}

function getSearchMaxResults() {
  return DEFAULTS.search.maxResults;
}

function getSearchTimeout() {
  return DEFAULTS.search.timeoutMs;
}

function getCacheDefaults() {
  return DEFAULTS.caching;
}

function getSecurity() {
  return DEFAULTS.security;
}

function getProxyDefaults() {
  return DEFAULTS.proxy;
}

function asJSON() {
  return JSON.parse(JSON.stringify(DEFAULTS));
}

module.exports = {
  DEFAULTS,
  isBlockedHostname,
  resolveProxyUrl,
  resolveResourceUrl,
  getPort,
  getHost,
  getLogFile,
  isPuppeteerEnabled,
  getSearchMaxResults,
  getSearchTimeout,
  getCacheDefaults,
  getSecurity,
  getProxyDefaults,
  asJSON
};

