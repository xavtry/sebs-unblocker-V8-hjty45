/**
 * proxyMiddleware.js
 *
 * Main Express middleware for handling proxy requests
 * - Integrates fetcher, rewrite, validator, and throttler
 * - Handles errors and logging
 * - Supports caching, cookies, headers
 * - Works with iframe injection and JS rewriting
 */

const fetch = require('node-fetch');
const { validateUrl, isLocalAddress } = require('./validator');
const { rewriteHtml } = require('./rewrite');
const { parseCookieHeader, mergeCookies } = require('./cookies');
const { throttlerMiddleware } = require('./throttler');
const { logInfo, logWarn } = require('./logger');
const { errorPage } = require('./errorPage');
const url = require('url');

const defaultOptions = {
  throttle: true,
  cache: false,
  rewriteHtml: true,
  allowLocal: false
};

function proxyMiddleware(options = {}) {
  const config = Object.assign({}, defaultOptions, options);
  const throttleMw = config.throttle ? throttlerMiddleware() : (req,res,next)=>next();

  return async (req, res, next) => {
    try {
      throttleMw(req,res,()=>{});

      let targetUrl = req.query.url || req.body.url;
      if (!targetUrl) {
        res.status(400).send('Missing URL');
        return;
      }

      // validate URL
      const valid = validateUrl(targetUrl);
      if (!valid.valid) {
        res.status(400).send(errorPage(valid.reason));
        return;
      }

      const hostname = new URL(targetUrl).hostname;
      if (!config.allowLocal && isLocalAddress(hostname)) {
        res.status(403).send(errorPage('Local network access blocked'));
        return;
      }

      // Fetch target content
      const headers = {};
      if (req.headers.cookie) headers['Cookie'] = req.headers.cookie;
      const response = await fetch(targetUrl, { headers });

      // Clone response
      const contentType = response.headers.get('content-type') || '';
      let body = await response.text();

      // Rewrite HTML if needed
      if (config.rewriteHtml && contentType.includes('text/html')) {
        body = rewriteHtml(body, targetUrl);
      }

      // Forward cookies
      const setCookies = response.headers.raw()['set-cookie'] || [];
      setCookies.forEach(cookie => res.append('Set-Cookie', cookie));

      res.set('Content-Type', contentType);
      res.send(body);

    } catch (e) {
      logWarn('proxyMiddleware error: ' + e.message);
      res.status(500).send(errorPage('Proxy failed: '+e.message));
    }
  };
}

module.exports = {
  proxyMiddleware
};

