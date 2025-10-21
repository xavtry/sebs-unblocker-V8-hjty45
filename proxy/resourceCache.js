
/**
 * resourceCache.js
 *
 * Hybrid in-memory + disk-persisted cache for resources.
 * - LRU-style in-memory cache for hot items
 * - Optional disk persistence (simple file store)
 * - Async get/set/delete operations
 * - TTL support, size limits, and background cleanup
 *
 * Usage:
 * const cache = require('./resourceCache');
 * await cache.set(key, value, ttlMs);
 * const v = await cache.get(key);
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { promisify } = require('util');

const writeFile = promisify(fs.writeFile);
const readFile = promisify(fs.readFile);
const unlink = promisify(fs.unlink);
const mkdir = promisify(fs.mkdir);
const stat = promisify(fs.stat);

const CACHE_DIR = path.join(__dirname, '..', 'cache'); // persisted cache folder
const LOG_DIR = path.join(__dirname, '..', 'logs');

const DEFAULT_MAX_ITEMS = 500; // items in memory
const DEFAULT_MAX_BYTES = 50 * 1024 * 1024; // 50MB in-memory
const DEFAULT_SWEEP_INTERVAL = 60 * 1000; // 1 minute

// In-memory structures
const cacheMap = new Map(); // key -> { value, size, expiresAt }
let currentBytes = 0;

// Ensure folders exist
if (!fs.existsSync(CACHE_DIR)) {
  try { fs.mkdirSync(CACHE_DIR, { recursive: true }); } catch (e) {}
}
if (!fs.existsSync(LOG_DIR)) {
  try { fs.mkdirSync(LOG_DIR, { recursive: true }); } catch (e) {}
}

// Helpers
function now() { return Date.now(); }

function shaKey(k) {
  return crypto.createHash('sha256').update(String(k)).digest('hex');
}

function estimateSize(obj) {
  if (!obj) return 0;
  if (Buffer.isBuffer(obj)) return obj.length;
  if (typeof obj === 'string') return Buffer.byteLength(obj, 'utf8');
  try {
    return Buffer.byteLength(JSON.stringify(obj), 'utf8');
  } catch (e) {
    return 1024;
  }
}

/**
 * Move key to most-recently-used position
 */
function touchKey(key) {
  if (!cacheMap.has(key)) return;
  const entry = cacheMap.get(key);
  cacheMap.delete(key);
  cacheMap.set(key, entry);
}

/**
 * Evict items until below size / count limits
 */
function evictIfNeeded(maxItems = DEFAULT_MAX_ITEMS, maxBytes = DEFAULT_MAX_BYTES) {
  while ((cacheMap.size > maxItems || currentBytes > maxBytes) && cacheMap.size > 0) {
    // remove oldest (first) entry
    const firstKey = cacheMap.keys().next().value;
    const entry = cacheMap.get(firstKey);
    cacheMap.delete(firstKey);
    currentBytes -= entry.size || 0;
  }
}

/**
 * Persist an entry to disk (non-blocking)
 */
async function persistToDisk(key, data) {
  const filename = path.join(CACHE_DIR, shaKey(key) + '.json');
  const payload = {
    ts: now(),
    key,
    data
  };
  try {
    await writeFile(filename, JSON.stringify(payload), { encoding: 'utf8' });
  } catch (e) {
    // ignore disk write failures
  }
}

/**
 * Load persisted entry from disk
 */
async function loadFromDisk(key) {
  const filename = path.join(CACHE_DIR, shaKey(key) + '.json');
  try {
    const raw = await readFile(filename, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && parsed.data) return parsed.data;
    return null;
  } catch (e) {
    return null;
  }
}

/**
 * Remove persisted file
 */
async function removeFromDisk(key) {
  const filename = path.join(CACHE_DIR, shaKey(key) + '.json');
  try { await unlink(filename); } catch (e) {}
}

/**
 * Public API
 */

/**
 * get(key)
 * - returns cached value or null
 * - if not in memory but present on disk, load it into memory and return
 */
async function get(key) {
  if (!key) return null;
  // check in-memory
  if (cacheMap.has(key)) {
    const entry = cacheMap.get(key);
    if (entry.expiresAt && entry.expiresAt < now()) {
      // expired
      cacheMap.delete(key);
      currentBytes -= entry.size || 0;
      try { await removeFromDisk(key); } catch (e) {}
      return null;
    }
    touchKey(key);
    return entry.value;
  }

  // try disk
  const diskVal = await loadFromDisk(key);
  if (diskVal != null) {
    // bring into memory (but respect memory limits)
    const size = estimateSize(diskVal);
    cacheMap.set(key, { value: diskVal, size, expiresAt: null });
    currentBytes += size;
    evictIfNeeded();
    return diskVal;
  }

  return null;
}

/**
 * set(key, value, ttlMs)
 * - stores in memory and optionally persists to disk (if small)
 */
async function set(key, value, ttlMs = 60 * 1000) {
  if (!key) return false;
  const size = estimateSize(value);
  const expiresAt = ttlMs ? (now() + ttlMs) : null;

  // store in memory
  if (cacheMap.has(key)) {
    const prev = cacheMap.get(key);
    currentBytes -= prev.size || 0;
    cacheMap.delete(key);
  }
  cacheMap.set(key, { value, size, expiresAt });
  currentBytes += size;

  // evict if necessary
  evictIfNeeded();

  // persist small items to disk asynchronously (avoid huge files)
  const MAX_PERSIST_BYTES = 1024 * 1024; // 1MB
  if (size <= MAX_PERSIST_BYTES) {
    try {
      persistToDisk(key, { value, meta: { ttl: ttlMs, storedAt: now() } });
    } catch (e) {}
  }

  return true;
}

/**
 * del(key) - delete from memory and disk
 */
async function del(key) {
  if (!key) return false;
  if (cacheMap.has(key)) {
    const entry = cacheMap.get(key);
    currentBytes -= entry.size || 0;
    cacheMap.delete(key);
  }
  await removeFromDisk(key);
  return true;
}

/**
 * clear() - wipe entire cache (memory + disk)
 */
async function clear() {
  cacheMap.clear();
  currentBytes = 0;
  try {
    const files = fs.readdirSync(CACHE_DIR);
    for (const f of files) {
      const p = path.join(CACHE_DIR, f);
      try { fs.unlinkSync(p); } catch (e) {}
    }
  } catch (e) {}
}

/**
 * stats() - returns basic stats
 */
function stats() {
  return {
    items: cacheMap.size,
    bytes: currentBytes,
    persistedFiles: (() => {
      try { return fs.readdirSync(CACHE_DIR).length; } catch (e) { return 0; }
    })()
  };
}

/**
 * Background cleanup: remove expired items regularly
 */
setInterval(() => {
  const nowTs = now();
  for (const [k, entry] of cacheMap.entries()) {
    if (entry.expiresAt && entry.expiresAt < nowTs) {
      currentBytes -= entry.size || 0;
      cacheMap.delete(k);
    }
  }
  // also keep size constraints
  evictIfNeeded();
}, DEFAULT_SWEEP_INTERVAL);

// Export
module.exports = {
  get,
  set,
  del,
  clear,
  stats,
  // Expose internals for debug (not recommended in production)
  _internal: {
    cacheMap,
    CACHE_DIR
  }
};
