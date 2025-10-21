
/**
 * errorPage.js
 *
 * Generates user-facing error HTML for proxy failures.
 * - generateErrorPage({status, url, message, details})
 * - expressMiddleware(err, req, res, next) helper
 *
 * The generated pages are simple and styled to match the app theme.
 */

const { logError } = (() => {
  try { return require('./logger'); } catch (e) { return { logError: () => {} }; }
})();

function sanitizeForHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function generateErrorPage({ status = 500, url = '', message = 'An error occurred', details = '' } = {}) {
  const title = sanitizeForHtml(`Proxy Error ${status}`);
  const safeUrl = sanitizeForHtml(url);
  const safeMsg = sanitizeForHtml(message);
  const safeDetails = sanitizeForHtml(details);

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>${title}</title>
  <style>
    body { background:#010a0a; color:#00ff7f; font-family: 'Segoe UI', sans-serif; display:flex; align-items:center; justify-content:center; height:100vh; margin:0; }
    .card { background:rgba(0,0,0,0.6); border:1px solid rgba(0,255,127,0.15); padding:28px; border-radius:12px; width:95%; max-width:720px; text-align:left; }
    h1 { margin:0 0 10px 0; font-size:28px; color:#00ff7f; text-shadow:0 0 6px rgba(0,255,127,0.2); }
    p { margin:10px 0; color:#bfffbf; }
    .meta { font-size:0.9rem; color:#99ffb2; margin-top:12px; }
    a.btn { display:inline-block; margin-top:14px; text-decoration:none; background:#00ff7f; color:#010a0a; padding:8px 12px; border-radius:8px; font-weight:700; }
    pre { background:rgba(0,0,0,0.3); padding:10px; border-radius:6px; overflow:auto; color:#00ff7f; font-size:0.85rem; }
  </style>
</head>
<body>
  <div class="card">
    <h1>${title}</h1>
    <p><strong>Message:</strong> ${safeMsg}</p>
    ${url ? `<p class="meta"><strong>URL:</strong> <code>${safeUrl}</code></p>` : ''}
    ${details ? `<details style="margin-top:10px;"><summary style="cursor:pointer;color:#00ff7f">Error details</summary><pre>${safeDetails}</pre></details>` : ''}
    <div style="margin-top:14px;">
      <a class="btn" href="/">Return Home</a>
      <a class="btn" href="/_health" style="background:transparent;border:1px solid #00ff7f;color:#00ff7f;margin-left:8px;">Health</a>
    </div>
  </div>
</body>
</html>`;

  // log server-side
  try { logError(`Error page generated: ${status} ${message} ${url}`, { details }); } catch (e) {}

  return html;
}

/**
 * Express-friendly middleware
 */
function expressErrorMiddleware(err, req, res, next) {
  try {
    const status = err && err.status ? err.status : 500;
    const msg = err && err.message ? err.message : 'Internal server error';
    const details = err && err.stack ? err.stack : '';
    const url = req && req.query && req.query.url ? req.query.url : (req && req.originalUrl ? req.originalUrl : '');
    const page = generateErrorPage({ status, url, message: msg, details });
    res.status(status).send(page);
  } catch (e) {
    // fallback
    try { res.status(500).send('<h1>Internal Server Error</h1>'); } catch (e2) {}
  }
}

module.exports = {
  generateErrorPage,
  expressErrorMiddleware
};
