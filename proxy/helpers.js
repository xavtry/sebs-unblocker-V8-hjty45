/**
 * helpers.js
 *
 * General-purpose utility functions for proxy features:
 * - randomString()
 * - delay(ms)
 * - parseJSON()
 * - safeBase64()
 * - timing utilities
 * - urlJoin() and ensureProtocol()
 * - color logging for dev mode
 */

const crypto = require('crypto');
const util = require('util');

function randomString(length = 16) {
  return crypto.randomBytes(Math.ceil(length / 2)).toString('hex').slice(0, length);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseJSON(str, fallback = {}) {
  try {
    return JSON.parse(str);
  } catch {
    return fallback;
  }
}

function safeBase64Encode(input) {
  return Buffer.from(String(input), 'utf8').toString('base64').replace(/=+$/, '');
}

function safeBase64Decode(input) {
  try {
    const clean = input.replace(/[^A-Za-z0-9+/]/g, '');
    return Buffer.from(clean, 'base64').toString('utf8');
  } catch {
    return '';
  }
}

function urlJoin(base, path) {
  if (!base.endsWith('/')) base += '/';
  if (path.startsWith('/')) path = path.slice(1);
  return base + path;
}

function ensureProtocol(url) {
  if (!/^https?:\/\//i.test(url)) return 'https://' + url;
  return url;
}

function prettyBytes(num) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (num >= 1024 && i < units.length - 1) {
    num /= 1024;
    i++;
  }
  return num.toFixed(1) + ' ' + units[i];
}

function timerStart() {
  return process.hrtime();
}

function timerEnd(start) {
  const diff = process.hrtime(start);
  const ms = diff[0] * 1e3 + diff[1] / 1e6;
  return Math.round(ms * 100) / 100;
}

function colorize(level, text) {
  const colors = {
    info: '\x1b[36m',
    warn: '\x1b[33m',
    error: '\x1b[31m',
    reset: '\x1b[0m'
  };
  return (colors[level] || '') + text + colors.reset;
}

function logDev(level, message, data) {
  if (process.env.NODE_ENV === 'production') return;
  console.log(colorize(level, `[${level.toUpperCase()}] ${message}`));
  if (data) console.log(util.inspect(data, { colors: true, depth: 3 }));
}

function chunkArray(arr, size) {
  const result = [];
  for (let i = 0; i < arr.length; i += size) {
    result.push(arr.slice(i, i + size));
  }
  return result;
}

function normalizeUrl(url) {
  try {
    const u = new URL(ensureProtocol(url));
    u.hash = '';
    return u.toString();
  } catch {
    return url;
  }
}

module.exports = {
  randomString,
  delay,
  parseJSON,
  safeBase64Encode,
  safeBase64Decode,
  urlJoin,
  ensureProtocol,
  prettyBytes,
  timerStart,
  timerEnd,
  colorize,
  logDev,
  chunkArray,
  normalizeUrl
};

