
/**
 * server.js
 * Seb-Unblocker V8 - Main server
 *
 * Notes:
 *  - Designed to run as a full Node server (Replit / VPS / Render)
 *  - Uses modular proxy helpers under ./proxy/
 *  - Includes static serving of public/, basic logging to logs/proxy.log,
 *    search endpoint, proxy endpoints (/proxy and /resource), and error handling.
 */

const express = require('express');
const path = require('path');
const fs = require('fs');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const { promisify } = require('util');

const appendFile = promisify(fs.appendFile);
const stat = promisify(fs.stat);

const CONFIG = require('./proxy/config'); // will be implemented; default safe values expected
// We will implement these modules in the next batches:
const { proxyHandler } = require('./proxy/proxyMiddleware'); // central handler
const { initWebSocketServer } = require('./proxy/websocketHandler'); // ws server
const { generateErrorPage } = require('./proxy/errorPage'); // error pages
const { logger } = require('./proxy/logger'); // logger module (writes to logs/proxy.log)

const app = express();
const http = require('http').createServer(app);
const PORT = process.env.PORT || 3000;

// ensure logs directory exists
const LOG_DIR = path.join(__dirname, 'logs');
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

// small helper to write to file-backed log (and console)
async function writeLog(level, msg) {
  const line = `[${new Date().toISOString()}] [${level.toUpperCase()}] ${msg}\n`;
  try {
    await appendFile(path.join(LOG_DIR, 'proxy.log'), line);
  } catch (err) {
    console.error('Failed to append to proxy.log:', err);
  }
  if (level === 'error') console.error(line);
  else console.log(line);
}

// ------------------ SECURITY ------------------
app.use(helmet());
app.use(cookieParser());
app.disable('x-powered-by');

// ------------------ RATE LIMIT ------------------
const limiter = rateLimit({
  windowMs: CONFIG.security?.rateLimitWindow || 60 * 1000,
  max: CONFIG.security?.maxRequestsPerWindow || 60,
  handler: (req, res) => {
    writeLog('warn', `Rate limit hit: ${req.ip} ${req.originalUrl}`);
    res.status(429).send('Too many requests - try again later');
  }
});
app.use(limiter);

// ------------------ STATIC FILES ------------------
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

// root -> index.html
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ------------------ SEARCH API ------------------
// Minimal wrapper to proxy/search module (to be implemented)
app.get('/search', async (req, res) => {
  try {
    const q = req.query.q;
    if (!q) return res.status(400).json({ error: 'Missing query' });

    // lazy load search module to avoid startup dependency order issues
    const { search } = require('./proxy/searchAPI');
    const results = await search(q, req.ip);
    res.json(results);
  } catch (err) {
    await writeLog('error', `Search error: ${err.message}`);
    res.status(500).json({ error: 'Search failed' });
  }
});

// ------------------ RESOURCE ENDPOINT ------------------
// Serve raw assets proxied (images, css, js) -- resource route will stream binary
app.get('/resource', async (req, res) => {
  const target = req.query.url;
  if (!target) return res.status(400).send('No url');
  try {
    // proxy/fetcher will implement streamToResponse
    const fetcher = require('./proxy/fetcher');
    await fetcher.streamToResponse(target, res, { incomingReq: req });
  } catch (err) {
    await writeLog('error', `Resource fetch error for ${target}: ${err.message}`);
    res.status(502).send(generateErrorPage({ url: target, status: 502, message: 'Failed to load resource' }));
  }
});

// ------------------ MAIN PROXY ------------------
// All proxied pages should hit /proxy?url=<encodedUrl>
app.get('/proxy', async (req, res) => {
  const target = req.query.url;
  if (!target) return res.status(400).send('No url');

  try {
    // central orchestration middleware handles validation, caching, rewriting, and response
    await proxyHandler(req, res);
  } catch (err) {
    await writeLog('error', `Proxy handler error for ${target}: ${err.message}`);
    // gracefully return an error page
    try {
      res.status(500).send(generateErrorPage({ url: target, status: 500, message: 'Proxy failed' }));
    } catch (e) {
      res.status(500).send('Proxy failed');
    }
  }
});

// ------------------ LOG DOWNLOAD (admin convenience) ------------------
app.get('/admin/logs/proxy.log', async (req, res) => {
  try {
    const file = path.join(LOG_DIR, 'proxy.log');
    if (!fs.existsSync(file)) return res.status(404).send('Log not found');
    res.setHeader('Content-Type', 'text/plain');
    res.sendFile(file);
  } catch (err) {
    await writeLog('error', `Log read error: ${err.message}`);
    res.status(500).send('Unable to read log');
  }
});

// ------------------ HEALTH CHECK ------------------
app.get('/_health', (req, res) => res.json({ ok: true, uptime: process.uptime() }));

// ------------------ ERROR HANDLER ------------------
app.use(async (err, req, res, next) => {
  await writeLog('error', `Unhandled error: ${err.message}`);
  res.status(500).send(generateErrorPage({ status: 500, message: 'Internal server error' }));
});

// ------------------ WEBSOCKET INIT ------------------
try {
  initWebSocketServer(http); // sets up ws server on same http stack
  writeLog('info', 'WebSocket server initialized');
} catch (e) {
  writeLog('warn', 'WebSocket server init failed: ' + e.message);
}

// ------------------ START ------------------
http.listen(PORT, () => {
  writeLog('info', `Seb-Unblocker V8 listening on port ${PORT}`);
  console.log(`Server running: http://localhost:${PORT}`);
});
