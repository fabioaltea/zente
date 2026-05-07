'use strict';

const http = require('http');
const { WebSocketServer } = require('ws');
const registry = require('./registry');
const { handleMessage } = require('./handlers');

const PORT = parseInt(process.env.PORT, 10) || 3000;
const PING_INTERVAL_MS = 30_000;
const PONG_TIMEOUT_MS = 10_000;

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', peers: registry.count() }));
    return;
  }
  res.writeHead(404);
  res.end();
});

const wss = new WebSocketServer({ server, path: '/ws' });

// Track ws → peerId for disconnect cleanup
const wsToPeer = new Map();

wss.on('connection', (ws, req) => {
  const ip =
    (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
    req.socket.remoteAddress;
  console.log(`[CONNECT] ip=${ip}`);

  let pongReceived = true;

  const pingTimer = setInterval(() => {
    if (!pongReceived) {
      console.log(`[HEARTBEAT] no pong — terminating`);
      clearInterval(pingTimer);
      ws.terminate();
      return;
    }
    pongReceived = false;
    ws.ping();

    // Give client PONG_TIMEOUT_MS to respond before next ping check
    setTimeout(() => {
      // Checked on next interval tick — already handled above
    }, PONG_TIMEOUT_MS);
  }, PING_INTERVAL_MS);

  ws.on('pong', () => {
    pongReceived = true;
  });

  ws.on('message', (raw) => {
    handleMessage(ws, raw, registry);
    // Track peerId after register
    if (!wsToPeer.has(ws)) {
      const id = registry.findByWs(ws);
      if (id) wsToPeer.set(ws, id);
    }
  });

  function cleanup(reason) {
    clearInterval(pingTimer);
    const peerId = wsToPeer.get(ws) || registry.findByWs(ws);
    wsToPeer.delete(ws);
    if (peerId) {
      registry.unregister(peerId);
      console.log(`[DISCONNECT] peerId=${peerId} reason=${reason} peers_count=${registry.count()}`);
    } else {
      console.log(`[DISCONNECT] peerId=<unregistered> reason=${reason}`);
    }
  }

  ws.on('close', (code, reason) => cleanup(`close(${code},${reason})`));
  ws.on('error', (err) => cleanup(`error(${err.message})`));
});

server.listen(PORT, () => {
  console.log(`[START] signaling server listening on port ${PORT}`);
});

function shutdown() {
  console.log('[SHUTDOWN] closing connections...');
  for (const ws of wss.clients) {
    ws.terminate();
  }
  server.close(() => {
    console.log('[SHUTDOWN] done');
    process.exit(0);
  });
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
