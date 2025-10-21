/**
 * websocketHandler.js
 *
 * Handles WebSocket connections through the proxy
 * - Connects client WebSockets to target server
 * - Handles messages, errors, and closures
 * - Supports optional throttling
 * - Logs connections and traffic
 */

const WebSocket = require('ws');
const { throttlerMiddleware } = require('./throttler');
const { logInfo, logWarn } = require('./logger');

function websocketHandler(server, options = {}) {
  const wsServer = new WebSocket.Server({ server });
  const throttleMw = throttlerMiddleware();

  wsServer.on('connection', (client, req) => {
    try {
      throttleMw(req, {}, ()=>{});
      logInfo(`New WS connection from ${req.socket.remoteAddress}`);

      // Intercept target URL from query
      const params = new URLSearchParams(req.url.replace('/?',''));
      const targetUrl = params.get('target');
      if (!targetUrl) {
        client.send(JSON.stringify({ error: 'Missing target URL' }));
        client.close();
        return;
      }

      const targetWs = new WebSocket(targetUrl);

      // Pipe messages
      client.on('message', msg => {
        if (targetWs.readyState === WebSocket.OPEN) targetWs.send(msg);
      });

      targetWs.on('message', msg => {
        if (client.readyState === WebSocket.OPEN) client.send(msg);
      });

      // Error handling
      targetWs.on('error', err => logWarn('Target WS error: '+err.message));
      client.on('error', err => logWarn('Client WS error: '+err.message));

      // Close handling
      targetWs.on('close', ()=> client.close());
      client.on('close', ()=> targetWs.close());

    } catch (e) {
      logWarn('websocketHandler error: ' + e.message);
      client.close();
    }
  });

  return wsServer;
}

module.exports = {
  websocketHandler
};

