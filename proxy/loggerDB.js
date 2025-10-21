/**
 * loggerDB.js
 *
 * Stores logs into a persistent database
 * - Tracks proxy requests, errors, and warnings
 * - Optional file or in-memory storage
 * - Supports query by IP, URL, and timestamp
 */

const fs = require('fs');
const path = require('path');

const LOG_DB_PATH = path.join(__dirname,'../logs/proxy.log');
let inMemoryLogs = [];

/**
 * addLog(type, data)
 */
function addLog(type, data = {}) {
  try {
    const timestamp = new Date().toISOString();
    const entry = { timestamp, type, ...data };
    inMemoryLogs.push(entry);

    // persist to file
    fs.appendFileSync(LOG_DB_PATH, JSON.stringify(entry)+'\n');
  } catch (e) {
    console.error('loggerDB addLog error:', e.message);
  }
}

/**
 * queryLogs(filter = {})
 */
function queryLogs(filter = {}) {
  return inMemoryLogs.filter(entry => {
    for (let key in filter) {
      if (entry[key] !== filter[key]) return false;
    }
    return true;
  });
}

/**
 * clearLogs()
 */
function clearLogs() {
  inMemoryLogs = [];
  try {
    fs.writeFileSync(LOG_DB_PATH, '');
  } catch(e) {
    console.error('clearLogs error:', e.message);
  }
}

/**
 * logRequest(req)
 */
function logRequest(req) {
  const data = {
    ip: req.ip,
    method: req.method,
    url: req.url,
    headers: req.headers
  };
  addLog('request', data);
}

/**
 * logError(err)
 */
function logError(err) {
  addLog('error', { message: err.message, stack: err.stack });
}

module.exports = {
  addLog,
  queryLogs,
  clearLogs,
  logRequest,
  logError
};

