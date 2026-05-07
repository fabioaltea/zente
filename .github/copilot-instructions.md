# Zente — Architettura e Knowledge Base per Refactoring

## Panoramica

**Zente** è un'applicazione di file-sharing peer-to-peer in tempo reale basata su WebRTC. Il trasferimento dati avviene direttamente tra i browser dei due peer, senza transitare dal server. Il server interviene solo nella fase di signaling (scambio di SDP offer/answer e ICE candidate).

La solution è composta da due package indipendenti nella stessa repository:

| Package     | Path         | Runtime                         | Ruolo                                         |
| ----------- | ------------ | ------------------------------- | --------------------------------------------- |
| `zente.web` | `zente.web/` | Browser (React 18 + Vite)       | SPA frontend — UI, logica WebRTC, DataChannel |
| `zente.ws`  | `zente.ws/`  | Node.js (vanilla, no framework) | Signaling server WebSocket                    |

---

## Flusso di connessione end-to-end

```
┌─────────┐          ┌──────────────┐          ┌─────────┐
│  Host   │◄────WS───►  Signaling   ◄───WS────►│  Guest  │
│ (peer A)│          │   Server     │          │ (peer B)│
└────┬────┘          └──────────────┘          └────┬────┘
     │                                              │
     │◄─────── WebRTC DataChannel (P2P) ──────────►│
     │         (file transfer diretto)              │
```

1. **Host** apre la pagina `/` → genera un `peerId` (UUID v4) → si registra sul signaling server via WebSocket (`type: "register"`).
2. Il server risponde `type: "registered"` → la UI mostra un QR code con l'URL `/join/<hostPeerId>`.
3. **Guest** scansiona il QR → apre `/join/<hostPeerId>` → si registra anche lui, poi crea un'offer WebRTC e la invia al signaling server con `targetId = hostPeerId`.
4. Il signaling server fa relay del messaggio all'host (`type: "offer"`).
5. L'host risponde con un answer → relay al guest.
6. Entrambi scambiano ICE candidate attraverso il signaling server.
7. Una volta stabilita la connessione WebRTC (DataChannel `"board"`), il signaling non è più necessario per il trasferimento file.

---

## zente.web — Frontend

### Stack tecnologico

- **React 18** con hook funzionali (no class component)
- **Vite** (ESM, HMR)
- **TypeScript** strict
- **React Router v6** per routing client-side
- **qrcode.react** per generazione QR inline
- Nessun state manager esterno (solo `useState`/`useRef`/`useCallback`)
- Deploy su **Vercel** (SPA con `vercel.json` rewrite catch-all)

### Struttura file

```
zente.web/src/
├── main.tsx              → Entry point, monta BrowserRouter + App
├── App.tsx               → Definisce le route (/ e /join/:hostPeerId)
├── pages/
│   └── Board.tsx         → Componente principale (tutta la UI)
├── hooks/
│   ├── useSignaling.ts   → Connessione WebSocket al signaling server
│   └── useWebRTC.ts      → Gestione RTCPeerConnection + DataChannel
└── styles/
    └── main.css          → CSS globale, dark theme, variabili CSS custom
```

### Hook: `useSignaling(peerId, onMessage)`

- Apre una connessione WebSocket a `VITE_WS_URL` (env var).
- Al `ws.onopen` invia automaticamente `{ type: "register", peerId }`.
- Espone `send(msg)` per inviare messaggi JSON al server.
- Tutti i messaggi ricevuti passano dal callback `onMessage`.
- Cleanup: chiude la WebSocket all'unmount.

### Hook: `useWebRTC(localFiles, getFileBlob, onRemoteManifest, onFileDownloaded, onFileDownloading)`

- Crea e gestisce `RTCPeerConnection` con STUN server Google.
- Gestisce un singolo `RTCDataChannel` chiamato `"board"`.
- **Protocollo DataChannel** (messaggi JSON + binary chunks):
   - `manifest` → lista di file disponibili (BoardFile[])
   - `request` → richiesta download di un file specifico per `fileId`
   - `file-start` → header del file in arrivo (fileId, name, size, mimeType)
   - Binary chunks → `ArrayBuffer` da 16KB (`CHUNK_SIZE = 16 * 1024`)
   - `file-end` → segnala fine trasmissione, il ricevente assembla il Blob
- Espone: `createOffer`, `handleOffer`, `handleAnswer`, `handleIceCandidate`, `requestFile`, `pushManifest`, `isConnected`.

### Pagina Board.tsx

- Determina il ruolo (host vs guest) dal parametro URL.
- Gestisce lo stato di connessione con un semplice `Status` type: `'connecting' | 'waiting' | 'connected' | 'disconnected'`.
- **My board**: drop-zone per file locali con thumbnail generation (canvas resize a 120px max).
- **Their board**: mostra i file del peer remoto con stato download/downloaded e pulsante download.
- I file locali sono mantenuti come `BoardFile[]` (metadati) + `Map<string, Blob>` (dati raw).
- Ogni modifica a `localFiles` trigga `pushManifest()` verso il peer remoto.

### Tipi chiave

```typescript
interface BoardFile {
   id: string; // UUID
   name: string;
   size: number;
   mimeType: string;
   thumbnail: string | null; // base64 dataURL
}

interface RemoteFile extends BoardFile {
   downloading: boolean;
   url: string | null; // Object URL dopo download
}
```

### Variabili d'ambiente

- `VITE_WS_URL` — URL completo del signaling server WebSocket (es. `wss://dominio.com/ws`)

---

## zente.ws — Signaling Server

### Stack tecnologico

- **Node.js** (CommonJS)
- **ws** (unica dipendenza) per WebSocket
- **PM2** (ecosystem.config.js) in produzione
- **Nginx** come reverse proxy per TLS termination e WebSocket upgrade su `/ws`
- Nessun database — stato in-memory (`Map`)

### Struttura file

```
zente.ws/src/
├── server.js     → HTTP server + WebSocketServer + heartbeat + lifecycle
├── handlers.js   → Parsing messaggi + logica di routing
└── registry.js   → Registry in-memory dei peer (Map<peerId, WebSocket>)
```

### Protocollo WebSocket (JSON)

**Client → Server:**

| type            | Campi                 | Descrizione                                      |
| --------------- | --------------------- | ------------------------------------------------ |
| `register`      | `peerId`              | Registra il peer (regex: `[a-zA-Z0-9_-]{1,128}`) |
| `offer`         | `targetId`, `payload` | Relay SDP offer al target                        |
| `answer`        | `targetId`, `payload` | Relay SDP answer al target                       |
| `ice-candidate` | `targetId`, `payload` | Relay ICE candidate al target                    |

**Server → Client:**

| type            | Campi               | Descrizione                                                  |
| --------------- | ------------------- | ------------------------------------------------------------ |
| `registered`    | `peerId`            | Conferma registrazione                                       |
| `offer`         | `fromId`, `payload` | Offer ricevuta da un peer                                    |
| `answer`        | `fromId`, `payload` | Answer ricevuta da un peer                                   |
| `ice-candidate` | `fromId`, `payload` | ICE candidate da un peer                                     |
| `error`         | `code`, `message`   | Errore (INVALID_MESSAGE, ALREADY_REGISTERED, PEER_NOT_FOUND) |

### Registry (`registry.js`)

- `Map<peerId, WebSocket>` — associazione bidirezionale.
- API: `register(peerId, ws)`, `unregister(peerId)`, `get(peerId)`, `has(peerId)`, `count()`, `findByWs(ws)`.
- `findByWs` fa scan O(n) — accettabile perché il numero di peer simultanei è basso.

### Heartbeat

- Ping ogni 30s (`PING_INTERVAL_MS`).
- Se nessun pong entro il successivo intervallo, `ws.terminate()`.
- Al disconnect (close/error) → `registry.unregister(peerId)`.

### Health endpoint

- `GET /health` → `{ status: "ok", peers: <count> }`

### Deploy infra

- PM2 single instance, porta 3000.
- Nginx: TLS su porta 443, proxy pass `/ws` e `/health` a `localhost:3000` con upgrade WebSocket.

---

## Convenzioni e pattern da rispettare nel refactoring

### Generali

- **Zero dipendenze inutili**: il progetto è minimale di proposito. Non aggiungere librerie se non strettamente necessario.
- **No class component**: solo hook funzionali React.
- **No state manager**: lo stato è locale al componente Board. Se serve condivisione, usare prop drilling o context semplice.
- **Separazione hook/UI**: la logica di rete vive negli hook (`useSignaling`, `useWebRTC`), la UI in `pages/`.
- **CommonJS nel server**: il signaling server usa `require`/`module.exports`.
- **ESM nel frontend**: il frontend usa `import`/`export` (module type in package.json).

### Naming

- File hook: `use<PascalCase>.ts`
- File pagina: `<PascalCase>.tsx`
- Variabili/funzioni: camelCase
- Costanti: UPPER_SNAKE_CASE
- Tipi/interfacce TypeScript: PascalCase

### Stili

- CSS puro con variabili custom in `:root` — no CSS-in-JS, no Tailwind, no preprocessor.
- Classe BEM-like semplificata: `.board-col-title`, `.file-card-name`.
- Dark theme di default (sfondo `#0f0f0f`).

### Comunicazione tra componenti

```
Board.tsx
  ├── useSignaling  (WebSocket → signaling server)
  │     └── send()
  └── useWebRTC     (RTCPeerConnection + DataChannel)
        ├── createOffer / handleOffer / handleAnswer / handleIceCandidate
        ├── requestFile(fileId)
        ├── pushManifest()
        └── isConnected (stato)
```

Board orchestra i due hook: i messaggi dal signaling (`offer`, `answer`, `ice-candidate`) vengono passati a useWebRTC; le azioni WebRTC (ice candidate generati localmente) vengono inviati via signaling.

### Punti di attenzione per refactoring

1. **Board.tsx è un God Component** (~220 righe) — contiene UI + logica di orchestrazione. Separare in sotto-componenti (QRSection, MyBoard, TheirBoard) è un refactoring valido.
2. **useWebRTC ha closure stale**: usa `localFilesRef` per aggirare il problema. Se si refactora, attenzione alle dipendenze dei callback.
3. **Nessun sistema di reconnection**: se il WebSocket cade, non c'è retry automatico.
4. **Un solo DataChannel**: tutto passa dallo stesso canale — manifest, richieste, file binari. Potrebbe beneficiare di channel multipli.
5. **Nessuna gestione errori UI**: gli errori dal signaling server (`type: "error"`) non vengono mostrati all'utente.
6. **findByWs è O(n)**: nel registry potrebbe servire una reverse map se il numero di peer cresce.
7. **CHUNK_SIZE fisso 16KB**: non adattivo. Per file grandi su connessioni veloci potrebbe essere subottimale.
8. **Nessun progress di upload/download**: il ricevente non ha indicazione della percentuale.
9. **Nessun test**: né unit né integration test in nessuno dei due package.
10.   **Nessun typing nel server**: il signaling server è JS puro, candidato a migrazione TypeScript.

---

## Comandi di sviluppo

```bash
# Frontend (da zente.web/)
npm run dev          # Vite dev server con HMR
npm run build        # TypeScript check + Vite build
npm run preview      # Preview del build

# Signaling server (da zente.ws/)
npm run dev          # nodemon watch
npm start            # produzione (node diretto)
```

---

## Dipendenze

### zente.web

| Pacchetto            | Versione | Uso                |
| -------------------- | -------- | ------------------ |
| react                | ^18.3.1  | UI                 |
| react-dom            | ^18.3.1  | DOM renderer       |
| react-router-dom     | ^6.26.2  | Routing client     |
| qrcode.react         | ^4.2.0   | QR code SVG        |
| vite                 | ^6.3.5   | Bundler/dev server |
| @vitejs/plugin-react | ^4.3.1   | JSX transform      |
| typescript           | ^5.5.3   | Type checking      |

### zente.ws

| Pacchetto | Versione | Uso              |
| --------- | -------- | ---------------- |
| ws        | ^8.18.0  | WebSocket server |
| nodemon   | ^3.1.0   | Dev auto-reload  |
