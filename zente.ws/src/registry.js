'use strict';

const peers = new Map();

function register(peerId, ws) {
  if (peers.has(peerId)) {
    const err = new Error(`Peer already registered: ${peerId}`);
    err.code = 'ALREADY_REGISTERED';
    throw err;
  }
  peers.set(peerId, ws);
}

function unregister(peerId) {
  peers.delete(peerId);
}

function get(peerId) {
  return peers.get(peerId);
}

function has(peerId) {
  return peers.has(peerId);
}

function count() {
  return peers.size;
}

function findByWs(ws) {
  for (const [id, sock] of peers) {
    if (sock === ws) return id;
  }
  return null;
}

module.exports = { register, unregister, get, has, count, findByWs };
