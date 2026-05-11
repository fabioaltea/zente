import { useEffect, useRef, useState } from "react";
import { SignalingHelper, SignalingMessage } from "./useSignaling";
import { BoardFile } from "./useWebRTC";
import { PeerApiHelper, Peer } from "../services/PeerApiHelper";
import { LocalFileStore } from "../services/LocalFileStore";
import { PeerConnectionManager } from "../services/PeerConnectionManager";
import { getIceServers } from "../services/iceServers";
import { loadSession, saveSession, clearSession, UserSession } from "../services/session";
import { makeThumbnail } from "../services/thumbnail";

export type AppStatus = "idle" | "loading" | "ready" | "no-session" | "error";

const POLL_INTERVAL = 10_000;

export interface RemoteFileEntry {
   peerId: string;
   username: string;
   file: BoardFile;
   url: string | null;
   downloading: boolean;
   progress: number;
}

export interface AppRootValue {
   status: AppStatus;
   session: UserSession | null;
   localFiles: BoardFile[];
   onlinePeers: Peer[];
   remoteFiles: RemoteFileEntry[];
   viewerCount: number;
   pendingCount: number;
   uploadQueue: File[];
   login: (username: string) => Promise<void>;
   logout: () => Promise<void>;
   removeLocalFile: (fileId: string) => Promise<void>;
   refreshPeers: () => Promise<void>;
   requestRemoteFile: (peerId: string, fileId: string) => void;
   getLocalBlobUrl: (fileId: string) => string | null;
   queueFiles: (files: FileList | File[]) => void;
   confirmUpload: (caption: string) => Promise<void>;
   cancelUpload: () => void;
}

export function useAppRoot(): AppRootValue {
   const [bootstrapTarget, setBootstrapTarget] = useState<UserSession | null>(() => loadSession());
   const [status, setStatus] = useState<AppStatus>(() => (loadSession() ? "loading" : "no-session"));
   const [session, setSession] = useState<UserSession | null>(() => loadSession());
   const [localFiles, setLocalFiles] = useState<BoardFile[]>([]);
   const [onlinePeers, setOnlinePeers] = useState<Peer[]>([]);
   const [remoteFiles, setRemoteFiles] = useState<RemoteFileEntry[]>([]);
   const [viewerCount, setViewerCount] = useState(0);
   const [pendingCount, setPendingCount] = useState(0);
   const [uploadQueue, setUploadQueue] = useState<File[]>([]);

   const storeRef = useRef<LocalFileStore>(new LocalFileStore());
   const signalingRef = useRef<SignalingHelper | null>(null);
   const managerRef = useRef<PeerConnectionManager | null>(null);
   const blobMapRef = useRef<Map<string, Blob>>(new Map());
   const localUrlsRef = useRef<Map<string, string>>(new Map());
   const localFilesRef = useRef<BoardFile[]>([]);
   const sessionRef = useRef<UserSession | null>(null);

   useEffect(() => {
      setSession(bootstrapTarget);
      sessionRef.current = bootstrapTarget;

      if (!bootstrapTarget) {
         setStatus("no-session");
         return;
      }

      const s = bootstrapTarget;
      let cancelled = false;
      setStatus("loading");

      async function bootstrap() {
         let iceServers: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];
         try { iceServers = await getIceServers(); } catch (ex) { console.warn("[App] iceServers fallback", ex); }
         if (cancelled) return;

         try {
            const stored = await storeRef.current.loadAll(s.username);
            if (cancelled) return;
            const files: BoardFile[] = [];
            stored.forEach(({ file, blob }) => {
               blobMapRef.current.set(file.id, blob);
               localUrlsRef.current.set(file.id, URL.createObjectURL(blob));
               files.push(file);
            });
            localFilesRef.current = files;
            setLocalFiles(files);
         } catch (ex) {
            console.error("[App] loadAll failed", ex);
         }

         try {
            await PeerApiHelper.registerOnline(s.username, s.peerId);
         } catch (ex) {
            console.error("[App] registerOnline failed", ex);
            if (!cancelled) setStatus("error");
            return;
         }
         if (cancelled) return;

         const signaling = new SignalingHelper((msg: SignalingMessage) => {
            if (msg.type === "registered") return;
            if (msg.type === "error") { console.error("[App] signaling error", msg.code, msg.message); return; }
            managerRef.current?.handleSignalingMessage(msg);
         });
         signalingRef.current = signaling;

         const manager = new PeerConnectionManager(signaling, iceServers, {
            onRemoteManifest: ({ peerId, username, files }) => {
               const images = files.filter((f) => f.mimeType.startsWith("image/"));
               setRemoteFiles((prev) => {
                  const others = prev.filter((r) => r.peerId !== peerId);
                  const next = images.map<RemoteFileEntry>((f) => {
                     const existing = prev.find((r) => r.peerId === peerId && r.file.id === f.id);
                     return existing ? { ...existing, file: f, username } : { peerId, username, file: f, url: null, downloading: false, progress: 0 };
                  });
                  return [...others, ...next];
               });
            },
            onFileDownloaded: ({ peerId, fileId, url }) => {
               setRemoteFiles((prev) => prev.map((r) =>
                  r.peerId === peerId && r.file.id === fileId ? { ...r, url, downloading: false, progress: 1 } : r,
               ));
            },
            onFileDownloading: (peerId, fileId) => {
               setRemoteFiles((prev) => prev.map((r) =>
                  r.peerId === peerId && r.file.id === fileId ? { ...r, downloading: true, progress: 0 } : r,
               ));
            },
            onFileProgress: ({ peerId, fileId, received, total }) => {
               setRemoteFiles((prev) => prev.map((r) =>
                  r.peerId === peerId && r.file.id === fileId ? { ...r, progress: total > 0 ? received / total : 0 } : r,
               ));
            },
            onViewerConnectionChange: ({ peerId, connected }) => {
               if (!connected) setRemoteFiles((prev) => prev.filter((r) => r.peerId !== peerId));
            },
            onHostConnectionChange: ({ connected }) => {
               setViewerCount((n) => Math.max(0, n + (connected ? 1 : -1)));
            },
         });
         managerRef.current = manager;

         signaling.connect(s.peerId);

         let peers: Peer[] = [];
         try { peers = await PeerApiHelper.searchPeers(); }
         catch (ex) { console.error("[App] searchPeers failed", ex); }
         if (cancelled) return;

         const others = peers.filter((p) => p.username !== s.username);
         setOnlinePeers(others);
         others.forEach((p) => manager.connectAsViewer(p));

         setStatus("ready");
      }

      bootstrap().catch((ex) => {
         console.error("[App] bootstrap failed", ex);
         if (!cancelled) setStatus("error");
      });

      const poll = setInterval(async () => {
         if (cancelled || !managerRef.current) return;
         try {
            const fresh = await PeerApiHelper.searchPeers();
            if (cancelled) return;
            const others = fresh.filter((p) => p.username !== s.username);
            setOnlinePeers(others);
            const freshIds = new Set(others.map((p) => p.peer_id));
            managerRef.current.listConnectedPeers().forEach((peerId) => {
               if (!freshIds.has(peerId)) managerRef.current?.disconnectPeer(peerId);
            });
            setRemoteFiles((prev) => prev.filter((r) => freshIds.has(r.peerId)));
            const connected = new Set(managerRef.current.listConnectedPeers());
            others.forEach((p) => { if (!connected.has(p.peer_id)) managerRef.current?.connectAsViewer(p); });
         } catch { /* keep state on network error */ }
      }, POLL_INTERVAL);

      return () => {
         cancelled = true;
         clearInterval(poll);
         managerRef.current?.destroy();
         managerRef.current = null;
         signalingRef.current?.disconnect();
         signalingRef.current = null;
         localUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
         localUrlsRef.current.clear();
         blobMapRef.current.clear();
         localFilesRef.current = [];
         setLocalFiles([]);
         setRemoteFiles([]);
         setOnlinePeers([]);
         setViewerCount(0);
         setPendingCount(0);
         setUploadQueue([]);
      };
   }, [bootstrapTarget]);

   const login = async (username: string): Promise<void> => {
      const trimmed = username.trim();
      const peerId = crypto.randomUUID();
      await PeerApiHelper.registerOnline(trimmed, peerId);
      saveSession(trimmed, peerId);
      setBootstrapTarget({ username: trimmed, peerId });
   };

   const logout = async (): Promise<void> => {
      const s = sessionRef.current;
      if (s) {
         await Promise.all([
            PeerApiHelper.markOffline(s.username).catch(() => {}),
            storeRef.current.clearUser(s.username).catch(() => {}),
         ]);
      }
      clearSession();
      setBootstrapTarget(null);
   };

   const removeLocalFile = async (fileId: string): Promise<void> => {
      const url = localUrlsRef.current.get(fileId);
      if (url) URL.revokeObjectURL(url);
      localUrlsRef.current.delete(fileId);
      blobMapRef.current.delete(fileId);
      const next = localFilesRef.current.filter((f) => f.id !== fileId);
      localFilesRef.current = next;
      setLocalFiles(next);
      managerRef.current?.pushManifest(next, blobMapRef.current);
      try { await storeRef.current.remove(fileId); }
      catch (ex) { console.error("[App] remove failed", ex); }
   };

   const refreshPeers = async (): Promise<void> => {
      const s = sessionRef.current;
      if (!s || !managerRef.current) return;
      try {
         const fresh = await PeerApiHelper.searchPeers();
         const others = fresh.filter((p) => p.username !== s.username);
         setOnlinePeers(others);
         const connected = new Set(managerRef.current.listConnectedPeers());
         others.forEach((p) => { if (!connected.has(p.peer_id)) managerRef.current!.connectAsViewer(p); });
      } catch (ex) {
         console.error("[App] refreshPeers failed", ex);
      }
   };

   const requestRemoteFile = (peerId: string, fileId: string): void => {
      managerRef.current?.requestFile(peerId, fileId);
   };

   const getLocalBlobUrl = (fileId: string): string | null => {
      return localUrlsRef.current.get(fileId) ?? null;
   };

   const queueFiles = (files: FileList | File[]): void => {
      const arr = Array.from(files).filter((f) => f.type.startsWith("image/"));
      if (!arr.length) return;
      setUploadQueue((prev) => [...prev, ...arr]);
   };

   const confirmUpload = async (caption: string): Promise<void> => {
      const s = sessionRef.current;
      if (!s) return;
      const file = uploadQueue[0];
      if (!file) return;
      setUploadQueue((prev) => prev.slice(1));
      setPendingCount((n) => n + 1);
      try {
         const bf: BoardFile = {
            id: crypto.randomUUID(),
            name: file.name,
            size: file.size,
            mimeType: file.type,
            thumbnail: await makeThumbnail(file),
            caption: caption || undefined,
            uploadedAt: Date.now(),
         };
         blobMapRef.current.set(bf.id, file);
         localUrlsRef.current.set(bf.id, URL.createObjectURL(file));
         storeRef.current.save(s.username, bf, file).catch((ex) => console.error("[App] save failed", ex));
         const next = [...localFilesRef.current, bf];
         localFilesRef.current = next;
         setLocalFiles(next);
         managerRef.current?.pushManifest(next, blobMapRef.current);
      } finally {
         setPendingCount((n) => Math.max(0, n - 1));
      }
   };

   const cancelUpload = (): void => {
      setUploadQueue((prev) => prev.slice(1));
   };

   return {
      status, session, localFiles, onlinePeers, remoteFiles, viewerCount,
      pendingCount, uploadQueue,
      login, logout,
      removeLocalFile, refreshPeers, requestRemoteFile, getLocalBlobUrl,
      queueFiles, confirmUpload, cancelUpload,
   };
}
