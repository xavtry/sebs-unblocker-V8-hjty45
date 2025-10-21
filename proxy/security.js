/**
 * security.js
 *
 * Enforces security rules to protect proxy server:
 * - IP restrictions
 * - Host allow/deny lists
 * - Rate limiting helper
 * - CSP injection for proxied pages
 */

const dns = require('dns').promises;
const net = require('net');
const { logWarn } = (() => {
  try { return require('./logger'); } catch { return { logWarn: () => {} }; }
})();

const allowedDomains = [
  'example.com',
  'wikipedia.org',
  'github.com'
];

const blockedSubnets = [
  '127.0.0.0/8',
  '10.0.0.0/8',
  '172.16.0.0/12',
  '192.168.0.0/16'
];

const clientRequests = new Map(); // ip -> timestamps

function ipInSubnet(ip, subnet) {
  const [block, mask] = subnet.split('/');
  const maskBits = parseInt(mask, 10);
  const ipBuf = net.isIP(ip) === 4 ? ipToInt(ip) : null;
  const blockBuf = net.isIP(block) === 4 ? ipToInt(block) : null;
  if (!ipBuf || !blockBuf) return false;
  const maskVal = ~(2 ** (32 - maskBits) - 1);
  return (ipBuf & maskVal) === (blockBuf & maskVal);
}

function ipToInt(ip) {
  return ip.split('.').reduce((acc, o) => (acc << 8) + parseInt(o, 10), 0);
}

async function checkHostAllowed(hostname) {
  if (!hostname) return false;
  const domain = hostname.toLowerCase();

  if (allowedDomains.some((d) => domain.endsWith(d))) return true;

  try {
    const addrs = await dns.lookup(domain, { all: true });
    for (const addr of addrs) {
      const ip = addr.address;
      if (blockedSubnets.some((sub) => ipInSubnet(ip, sub))) return false;
    }
  } catch {
    return false;
  }

  return true;
}

function enforceRateLimit(ip, limit = 100, perMs = 60_000) {
  const now = Date.now();
  if (!clientRequests.has(ip)) clientRequests.set(ip, []);
  const arr = clientRequests.get(ip).filter((t) => now - t < perMs);
  arr.push(now);
  clientRequests.set(ip, arr);
  if (arr.length > limit) {
    logWarn('Rate limit exceeded', { ip, count: arr.length });
    return false;
  }
  return true;
}

function addCSPHeaders(headers) {
  return {
    ...headers,
    'content-security-policy': "default-src * 'unsafe-inline' 'unsafe-eval' data: blob:;"
  };
}

function validateUserAgent(ua) {
  if (!ua || typeof ua !== 'string') return false;
  const bad = /(curl|wget|bot|crawler)/i;
  return !bad.test(ua);
}

module.exports = {
  checkHostAllowed,
  enforceRateLimit,
  addCSPHeaders,
  validateUserAgent
};

