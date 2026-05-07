'use strict';

const PEER_ID_RE = /^[a-zA-Z0-9_-]{1,128}$/;
const RELAY_TYPES = new Set(['offer', 'answer', 'ice-candidate']);

function send(ws, obj) {
  ws.send(JSON.stringify(obj));
}

function handleMessage(ws, raw, registry) {
  let msg;
  try {
    msg = JSON.parse(raw);
  } catch {
    send(ws, { type: 'error', code: 'INVALID_MESSAGE', message: 'Malformed JSON' });
    return;
  }

  if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string') {
    send(ws, { type: 'error', code: 'INVALID_MESSAGE', message: 'Missing type field' });
    return;
  }

  if (msg.type === 'register') {
    const { peerId } = msg;
    if (!peerId || !PEER_ID_RE.test(peerId)) {
      send(ws, { type: 'error', code: 'INVALID_MESSAGE', message: 'Invalid peerId format' });
      return;
    }
    if (registry.has(peerId)) {
      send(ws, { type: 'error', code: 'ALREADY_REGISTERED', message: `Peer ${peerId} already registered` });
      return;
    }
    registry.register(peerId, ws);
    send(ws, { type: 'registered', peerId });
    console.log(`[REGISTER] peerId=${peerId} peers_count=${registry.count()}`);
    return;
  }

  if (RELAY_TYPES.has(msg.type)) {
    const { targetId, payload } = msg;
    if (!targetId || typeof targetId !== 'string' || payload === undefined) {
      send(ws, { type: 'error', code: 'INVALID_MESSAGE', message: 'Missing targetId or payload' });
      return;
    }

    const fromId = registry.findByWs(ws);
    if (!fromId) {
      send(ws, { type: 'error', code: 'INVALID_MESSAGE', message: 'Sender not registered' });
      return;
    }

    const targetWs = registry.get(targetId);
    if (!targetWs) {
      send(ws, { type: 'error', code: 'PEER_NOT_FOUND', message: `Peer ${targetId} not found` });
      return;
    }

    send(targetWs, { type: msg.type, fromId, payload });
    console.log(`[RELAY] type=${msg.type} from=${fromId} to=${targetId}`);
    return;
  }

  send(ws, { type: 'error', code: 'INVALID_MESSAGE', message: `Unknown type: ${msg.type}` });
}

module.exports = { handleMessage };
