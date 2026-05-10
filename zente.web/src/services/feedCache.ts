import type { BoardFile } from "../hooks/useWebRTC";

const KEY = "zente_feed_v1";

interface CachedPeer {
   files: BoardFile[];
   ts: number;
}

function read(): Record<string, CachedPeer> {
   try { return JSON.parse(sessionStorage.getItem(KEY) ?? "{}"); }
   catch { return {}; }
}

function write(data: Record<string, CachedPeer>): void {
   try { sessionStorage.setItem(KEY, JSON.stringify(data)); }
   catch { sessionStorage.removeItem(KEY); } // quota exceeded — clear and retry next write
}

export function cacheFiles(username: string, files: BoardFile[]): void {
   const d = read();
   d[username] = { files, ts: Date.now() };
   write(d);
}

export function loadAllCached(): Record<string, BoardFile[]> {
   const d = read();
   return Object.fromEntries(Object.entries(d).map(([u, v]) => [u, v.files]));
}

export function evict(username: string): void {
   const d = read();
   delete d[username];
   write(d);
}

export function evictAll(): void {
   sessionStorage.removeItem(KEY);
}
