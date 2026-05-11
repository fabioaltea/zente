# Zente

Zente is a real-time peer-to-peer image sharing platform.

The final goal is simple:
- users go online with a username,
- discover other online peers,
- open each other's profiles,
- exchange media directly browser-to-browser over WebRTC.

No image payload is relayed by the signaling server. The signaling/API layer only coordinates discovery and connection setup.

## Why This Architecture

Zente is split into independent runtime components, each with a precise responsibility:

1. `zente.web` (React + Vite)
- User interface
- Session and local media state
- Peer discovery calls
- WebSocket signaling client
- WebRTC/DataChannel media exchange

2. `zente.api` (Fastify + Postgres, plus Supabase Function variant)
- Presence and peer discovery
- Online/offline updates
- Search currently available peers

3. `zente.ws` (Node.js + ws)
- WebRTC signaling relay only
- Offer/answer/ICE exchange
- Heartbeat and connection lifecycle

4. `zente.coturn` (reserved for TURN/STUN self-hosting)
- In current code, ICE credentials are fetched from Metered when configured
- Fallback is Google STUN
- The folder exists to support migration to self-hosted Coturn infrastructure

## Repository Layout

```text
zente/
  zente.web/      # Frontend SPA
  zente.api/      # Presence API + Supabase function variant
  zente.ws/       # Signaling WebSocket server
  zente.coturn/   # TURN/STUN infrastructure placeholder
```

## End-to-End Flow

```text
User A browser (Host)           zente.api             zente.ws            User B browser (Guest)
-----------------------         ---------             --------            ----------------------
login/session ---------> register online
search peers ---------> list online peers
                                                  register WS ---------->
register WS ---------->
create offer -----------------------------------------------------------> (via signaling relay)
answer <---------------------------------------------------------------- (via signaling relay)
ICE candidates <-------------------------------------------------------> (via signaling relay)

WebRTC DataChannel established
image metadata/files <===============================================> direct P2P transfer
```

## Component Details

## 1) Frontend (`zente.web`)

Tech stack:
- React 18
- TypeScript
- Vite
- React Router v6

Main responsibilities:
- auth-like local session bootstrap (`username`, `peerId`)
- peer discovery polling via API
- signaling connection with automatic reconnection
- per-peer WebRTC connection orchestration
- upload queue, thumbnails, local blob store
- feed/profile rendering with dynamic mosaic layout

Routing:
- `/login`
- `/feed`
- `/feed/:username`
- `/search`

Important front-end services:
- `PeerApiHelper`: calls presence endpoints (`/peers/online`, `/peers/offline`, `/peers`)
- `SignalingHelper`: connects to WS signaling endpoint and relays signaling messages
- `PeerConnectionManager`: manages many `WebRTCHelper` instances (viewer/host role)
- `WebRTCHelper`: handles RTCPeerConnection + DataChannel file protocol
- `LocalFileStore`: persists local user files
- `iceServers`: loads ICE credentials (Metered or STUN fallback)

### DataChannel Payload Protocol

Control messages are JSON:
- `manifest`
- `request`
- `file-start`
- `file-end`

Binary payload:
- raw ArrayBuffer chunks (default chunk size: 16KB)

This keeps transfer efficient while preserving metadata for UI overlays.

## 2) Presence API (`zente.api`)

Current Node/Fastify implementation:
- `POST /peers/online`
- `POST /peers/offline`
- `GET /peers?q=...`
- `GET /health`

Storage model:
- Postgres table `peers`
- unique `username`
- latest `peer_id`
- `is_online`
- `last_seen`

Behavior:
- online is upserted by username
- offline marks user unavailable
- search returns only online peers
- stale records are expired periodically (5 minutes window)

Also present in repo:
- Supabase Edge Function version at `zente.api/supabase/functions/api/index.ts`
- OpenAPI description in `zente.api/swagger.json`

This means you can run Zente API either as:
- standalone Fastify service, or
- Supabase function endpoint

## 3) Signaling Server (`zente.ws`)

Purpose:
- Relay-only signaling
- Never stores or forwards image file contents

Supported message types:
- `register`
- `offer`
- `answer`
- `ice-candidate`

Server responses/events:
- `registered`
- relayed `offer`, `answer`, `ice-candidate`
- `error` (`INVALID_MESSAGE`, `ALREADY_REGISTERED`, `PEER_NOT_FOUND`)

Runtime behavior:
- in-memory registry `peerId -> WebSocket`
- heartbeat ping/pong
- disconnect cleanup and unregister
- health endpoint `/health`

Production support files:
- PM2 app file (`ecosystem.config.js`)
- Nginx reverse proxy for `/ws` and `/health`

## 4) TURN/STUN and `zente.coturn`

WebRTC connectivity requires ICE servers.

Current behavior in code:
- if `VITE_METERED_APP_NAME` and `VITE_METERED_API_KEY` are set:
  - fetch TURN/STUN credentials from Metered
- else:
  - fallback to `stun:stun.l.google.com:19302`

About `zente.coturn`:
- currently empty placeholder directory
- intended for self-hosted TURN/STUN setup (Coturn)
- useful for symmetric NAT / enterprise networks where STUN-only fails

Recommended production direction:
- deploy your own Coturn in `zente.coturn`
- issue short-lived TURN credentials
- point frontend ICE loader to your TURN endpoint

## Environment Variables

## Frontend (`zente.web`)

- `VITE_API_URL`
  - Presence API base URL
  - Default fallback in code points to Supabase function URL
- `VITE_WS_URL`
  - Signaling WS endpoint, e.g. `wss://your-domain/ws`
- `VITE_METERED_APP_NAME` (optional)
- `VITE_METERED_API_KEY` (optional)

## API (`zente.api` Fastify)

- `PORT` (default `3001`)
- `CORS_ORIGIN` (default `*`)
- `DATABASE_URL`
- `DB_SSL` (`false` to disable SSL)

## Signaling (`zente.ws`)

- `PORT` (default `3000`)

## Local Development

Requirements:
- Node.js 18+
- npm or pnpm
- Postgres (only for Fastify API mode)

### 1) Start signaling server

```bash
cd zente.ws
pnpm install
pnpm dev
```

### 2) Start API (Fastify mode)

```bash
cd zente.api
pnpm install
pnpm dev
```

Or use the Supabase function mode if your environment is already configured.

### 3) Start frontend

```bash
cd zente.web
pnpm install
pnpm dev
```

### 4) Configure frontend env

Set at least:
- `VITE_WS_URL`
- `VITE_API_URL`

Optional for robust NAT traversal:
- Metered credentials (or your own Coturn once implemented)

## Production Topology (Typical)

- `zente.web` deployed as static SPA (e.g. Vercel)
- `zente.ws` behind Nginx + TLS, managed by PM2
- `zente.api` hosted separately (Fastify service) or via Supabase function
- TURN/STUN via Metered today, migrate to self-hosted Coturn for full control

## Reliability Notes

- Signaling client has reconnect with exponential backoff
- API marks stale peers offline periodically
- Signaling server heartbeats dead connections
- DataChannel file transfer reports progress via callbacks

## Security Notes

Current repository focuses on core transport behavior, not hard auth.

Production hardening recommended:
- authenticated sessions/JWT for API + WS association
- stricter CORS and origin checks
- rate limiting on API and signaling relay
- signed short-lived TURN credentials
- audit logging and abuse controls

## Known Limitations

- No end-to-end encryption layer above WebRTC transport defaults
- No persistent social graph/follow model
- No advanced retry queue for interrupted transfers
- `zente.coturn` not yet implemented in-repo (placeholder)

## Final Outcome

Zente delivers a lightweight Instagram-like P2P sharing experience:
- discovery and coordination are centralized,
- media payload transfer is decentralized and direct,
- architecture is modular enough to scale each layer independently.

That makes it suitable both for rapid product iteration and for future hardening into a production-grade real-time media network.
