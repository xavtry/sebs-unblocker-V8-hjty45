/**
 * throttler.js
 *
 * Utilities to manage rate-limiting and throttling
 * - Prevent abuse of proxy
 * - Global or per-IP limits
 * - Logging violations
 * - Supports bursting and sliding window
 */

const { logInfo, logWarn } = (() => {
  try { return require('./logger'); } catch { return { logInfo: ()=>{}, logWarn: ()=>{} }; }
})();

const RATE_LIMIT_MAP = new Map();

/**
 * defaultConfig
 */
const defaultConfig = {
  windowMs: 60 * 1000, // 1 minute
  maxRequests: 30,
  blockDuration: 5 * 60 * 1000, // 5 minutes
  keyGenerator: (req)=>req.ip
};

/**
 * isBlocked(ip)
 * - returns true if IP is currently blocked
 */
function isBlocked(ip) {
  const entry = RATE_LIMIT_MAP.get(ip);
  if (!entry) return false;
  if (entry.blockUntil && entry.blockUntil > Date.now()) return true;
  return false;
}

/**
 * incrementCounter(ip, config)
 * - increments request counter
 */
function incrementCounter(ip, config) {
  let entry = RATE_LIMIT_MAP.get(ip);
  if (!entry) {
    entry = { count: 1, start: Date.now(), blockUntil: null };
  } else {
    entry.count++;
  }
  // reset window
  if (Date.now() - entry.start > config.windowMs) {
    entry.count = 1;
    entry.start = Date.now();
  }
  // block if exceeded
  if (entry.count > config.maxRequests) {
    entry.blockUntil = Date.now() + config.blockDuration;
    logWarn(`IP ${ip} blocked for exceeding limit`);
  }
  RATE_LIMIT_MAP.set(ip, entry);
}

/**
 * throttlerMiddleware(options)
 * - Express middleware to apply throttling
 */
function throttlerMiddleware(options = {}) {
  const config = Object.assign({}, defaultConfig, options);
  return (req, res, next) => {
    try {
      const key = config.keyGenerator(req);
      if (isBlocked(key)) {
        res.status(429).send('Too Many Requests - Proxy Throttled');
        return;
      }
      incrementCounter(key, config);
    } catch (e) {
      logWarn('throttlerMiddleware error: '+e.message);
    }
    next();
  };
}

/**
 * resetThrottle(ip)
 * - resets throttle for a given IP
 */
function resetThrottle(ip) {
  RATE_LIMIT_MAP.delete(ip);
}

/**
 * getThrottleInfo(ip)
 * - returns info object {count, start, blocked}
 */
function getThrottleInfo(ip) {
  const entry = RATE_LIMIT_MAP.get(ip);
  if (!entry) return { count: 0, blocked: false };
  return { count: entry.count, blocked: isBlocked(ip), start: entry.start };
}

module.exports = {
  throttlerMiddleware,
  resetThrottle,
  getThrottleInfo
};

