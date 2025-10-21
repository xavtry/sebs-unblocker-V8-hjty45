/**
 * logger.js
 *
 * Lightweight logger wrapper used by proxy modules.
 * - Writes structured logs to logs/proxy.log
 * - Exposes logInfo, logWarn, logError
 * - Supports optional external hook (loggerDB)
 * - Structured JSON lines for easier parsing
 *
 * Example:
 * const { logInfo } = require('./logger');
 * logInfo('Fetched page', { url, status });
 */

const fs = require('fs');
const path = require('path');
const util = require('util');

const LOG_DIR = path.join(__dirname, '..', 'logs');
const LOG_FILE = path.join(LOG_DIR, 'proxy.log');

// ensure existence
try { if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true }); } catch (e) {}

function timestamp() { return new Date().toISOString(); }

function safeStringify(obj) {
  try { return JSON.stringify(obj); } catch (e) { return util.inspect(obj, { depth: 2 }); }
}

function appendLine(line) {
  try {
    fs.appendFileSync(LOG_FILE, line + '\n', { encoding: 'utf8' });
  } catch (e) {
    // fallback to console if write fails
    console.error('logger.appendLine failed:', e);
    console.log(line);
  }
}

/**
 * Generic log function
 */
function writeLog(level, message, meta = {}) {
  const entry = {
    ts: timestamp(),
    level: level.toUpperCase(),
    message: typeof message === 'string' ? message : safeStringify(message),
    meta
  };
  const line = JSON.stringify(entry);
  appendLine(line);

  // also print to console for live debugging
  if (level === 'error') console.error(`[${entry.ts}] ${entry.level}: ${entry.message}`, meta);
  else console.log(`[${entry.ts}] ${entry.level}: ${entry.message}`);
}

/**
 * Convenience functions
 */
function logInfo(message, meta = {}) { writeLog('info', message, meta); }
function logWarn(message, meta = {}) { writeLog('warn', message, meta); }
function logError(message, meta = {}) { writeLog('error', message, meta); }

/**
 * Optional external logger DB hook - try to require loggerDB if available
 */
let loggerDB = null;
try { loggerDB = require('./loggerDB'); } catch (e) { loggerDB = null; }

function recordToDBIfAvailable(level, message, meta) {
  if (!loggerDB || !loggerDB.logToDB) return;
  try {
    loggerDB.logToDB({ level, message, meta, ts: timestamp() });
  } catch (e) {
    // ignore DB logging errors
  }
}

// wrap functions to also call loggerDB
function logInfoWithDB(message, meta = {}) { logInfo(message, meta); recordToDBIfAvailable('info', message, meta); }
function logWarnWithDB(message, meta = {}) { logWarn(message, meta); recordToDBIfAvailable('warn', message, meta); }
function logErrorWithDB(message, meta = {}) { logError(message, meta); recordToDBIfAvailable('error', message, meta); }

// Export the primary API
module.exports = {
  logInfo: logInfoWithDB,
  logWarn: logWarnWithDB,
  logError: logErrorWithDB,
  writeLog, // raw writer
  LOG_FILE,
  LOG_DIR
};
