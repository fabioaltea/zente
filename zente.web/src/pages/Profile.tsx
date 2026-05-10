import { useState, useRef, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { SignalingHelper, SignalingMessage } from "../hooks/useSignaling";
import { WebRTCHelper, BoardFile, RemoteFile } from "../hooks/useWebRTC";
import { PeerApiHelper } from "../services/PeerApiHelper";
import { loadSession } from "../services/session";
import { saveFile, loadFiles, removeFile } from "../services/fileStore";
import { getIceServers } from "../services/iceServers";
import { UploadPreview } from "../components/UploadPreview";
import { useHost } from "../context/HostContext";

type Status = "connecting" | "waiting" | "connected" | "disconnected" | "offline";

function relativeTime(ts: number): string {
   const diff = Date.now() - ts;
   const mins = Math.floor(diff / 60_000);
   if (mins < 1) return "just now";
   if (mins < 60) return `${mins}m ago`;
   const hours = Math.floor(mins / 60);
   if (hours < 24) return `${hours}h ago`;
   const days = Math.floor(hours / 24);
   if (days < 30) return `${days}d ago`;
   return new Date(ts).toLocaleDateString();
}

async function fileToBoardFile(file: File, caption?: string): Promise<BoardFile> {
   const id = crypto.randomUUID();
   const thumbnail = await makeThumbnail(file);
   return { id, name: file.name, size: file.size, mimeType: file.type, thumbnail, caption, uploadedAt: Date.now() };
}

function makeThumbnail(file: File): Promise<string | null> {
   return new Promise((resolve) => {
      if (!file.type.startsWith("image/")) { resolve(null); return; }
      const reader = new FileReader();
      reader.onload = (ev) => {
         const img = new Image();
         img.onload = () => {
            const canvas = document.createElement("canvas");
            const MAX = 800;
            const ratio = Math.min(MAX / img.width, MAX / img.height, 1);
            canvas.width = Math.round(img.width * ratio);
            canvas.height = Math.round(img.height * ratio);
            canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
            resolve(canvas.toDataURL("image/webp", 0.9));
         };
         img.src = ev.target!.result as string;
      };
      reader.readAsDataURL(file);
   });
}

export default function Profile() {
   const { username } = useParams<{ username: string }>();
   const navigate = useNavigate();
   const session = loadSession();
   const isOwn = session?.username === username;
   const fileInputRef = useRef<HTMLInputElement>(null);

   const host = useHost();

   const [myPeerId] = useState(() => session?.peerId ?? crypto.randomUUID());
   const [status, setStatus] = useState<Status>("connecting");
   const statusRef = useRef<Status>("connecting");
   const [retryKey, setRetryKey] = useState(0);
   const [isDragging, setIsDragging] = useState(false);

   const [localFiles, setLocalFiles] = useState<BoardFile[]>([]);
   const [pendingCount, setPendingCount] = useState(0);
   const [uploadQueue, setUploadQueue] = useState<File[]>([]);
   const blobMapRef = useRef<Map<string, Blob>>(new Map());
   const previewUrlsRef = useRef<Map<string, string>>(new Map());

   const [remoteFiles, setRemoteFiles] = useState<RemoteFile[]>([]);

   const [modalFileId, setModalFileId] = useState<string | null>(null);

   const signalingRef = useRef<SignalingHelper | null>(null);
   const webRTCRef = useRef<WebRTCHelper | null>(null);
   const remotePeerIdRef = useRef<string | null>(null);

   function setStatusBoth(s: Status) {
      statusRef.current = s;
      setStatus(s);
   }

   // Close modal on ESC
   useEffect(() => {
      if (!modalFileId) return;
      function onKey(e: KeyboardEvent) { if (e.key === "Escape") setModalFileId(null); }
      document.addEventListener("keydown", onKey);
      return () => document.removeEventListener("keydown", onKey);
   }, [modalFileId]);

   const getFileBlob = async (fileId: string): Promise<Blob | null> =>
      blobMapRef.current.get(fileId) ?? null;

   const onRemoteManifest = (files: BoardFile[]) => {
      const images = files.filter((f) => f.mimeType.startsWith("image/"));
      setRemoteFiles(images.map((f) => ({ ...f, downloading: false, progress: 0, url: null })));
   };

   const onFileDownloaded = (fileId: string, url: string, _name: string) => {
      setRemoteFiles((prev) => prev.map((f) => (f.id === fileId ? { ...f, downloading: false, progress: 1, url } : f)));
   };

   const onFileDownloading = (fileId: string) => {
      setRemoteFiles((prev) => prev.map((f) => (f.id === fileId ? { ...f, downloading: true, progress: 0 } : f)));
   };

   const onFileProgress = (fileId: string, received: number, total: number) => {
      setRemoteFiles((prev) => prev.map((f) => (f.id === fileId ? { ...f, progress: total > 0 ? received / total : 0 } : f)));
   };

   const onConnectionChange = (connected: boolean) => {
      if (connected) {
         setStatusBoth("connected");
      } else if (statusRef.current !== "offline") {
         setStatusBoth("disconnected");
      }
   };

   const onSignalingMessage = async (msg: SignalingMessage) => {
      if (msg.type === "registered") {
         setStatusBoth("waiting");
         if (!isOwn && remotePeerIdRef.current) {
            const offer = await webRTCRef.current!.createOffer((c) => {
               signalingRef.current?.send({ type: "ice-candidate", targetId: remotePeerIdRef.current!, payload: c });
            });
            signalingRef.current?.send({ type: "offer", targetId: remotePeerIdRef.current!, payload: offer });
         }
      }
      if (msg.type === "offer") {
         remotePeerIdRef.current = msg.fromId;
         const answer = await webRTCRef.current!.handleOffer(msg.payload, (c) => {
            signalingRef.current?.send({ type: "ice-candidate", targetId: msg.fromId, payload: c });
         });
         signalingRef.current?.send({ type: "answer", targetId: msg.fromId, payload: answer });
      }
      if (msg.type === "answer") await webRTCRef.current?.handleAnswer(msg.payload);
      if (msg.type === "ice-candidate") await webRTCRef.current?.handleIceCandidate(msg.payload);
   };

   function handleRetry() {
      setStatusBoth("connecting");
      setRemoteFiles([]);
      remotePeerIdRef.current = null;
      setRetryKey((k) => k + 1);
   }

   useEffect(() => {
      if (!session) { navigate("/login", { replace: true }); return; }

      let cancelled = false;

      async function setup() {
         if (isOwn) {
            try {
               await PeerApiHelper.registerOnline(session!.username, session!.peerId);
            } catch {
               if (cancelled) return;
               navigate("/login", { replace: true });
               return;
            }
            if (cancelled) return;
            host.activate(session!.username, session!.peerId);
            try {
               const stored = await loadFiles(session!.username);
               if (cancelled) return;
               const boardFiles: BoardFile[] = [];
               stored.forEach(({ file, blob }) => {
                  blobMapRef.current.set(file.id, blob);
                  previewUrlsRef.current.set(file.id, URL.createObjectURL(blob));
                  boardFiles.push(file);
               });
               if (boardFiles.length > 0) setLocalFiles(boardFiles);
            } catch (ex) {
               console.error("[Profile] loadFiles failed", ex);
            }
         } else {
            const iceServers = await getIceServers();
            if (cancelled) return;
            const rtc = new WebRTCHelper(getFileBlob, onRemoteManifest, onFileDownloaded, onFileDownloading, onFileProgress, onConnectionChange, iceServers);
            webRTCRef.current = rtc;
            try {
               const peers = await PeerApiHelper.searchPeers(username);
               if (cancelled) return;
               const target = peers.find((p) => p.username === username);
               if (!target) { setStatusBoth("offline"); return; }
               remotePeerIdRef.current = target.peer_id;
            } catch {
               if (cancelled) return;
               setStatusBoth("offline");
               return;
            }
            if (cancelled) return;
            const signaling = new SignalingHelper(onSignalingMessage);
            signalingRef.current = signaling;
            signaling.connect(myPeerId);
         }
      }

      setup().catch(console.error);

      return () => {
         cancelled = true;
         signalingRef.current?.disconnect();
         webRTCRef.current?.destroy();
         previewUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
   }, [retryKey]);

   useEffect(() => {
      if (isOwn) host.pushManifest(localFiles, blobMapRef.current);
      else webRTCRef.current?.pushManifest(localFiles);
   }, [localFiles]); // eslint-disable-line react-hooks/exhaustive-deps

   function queueFiles(files: FileList | File[]) {
      const arr = Array.from(files).filter((f) => f.type.startsWith("image/"));
      if (!arr.length) return;
      setUploadQueue((prev) => [...prev, ...arr]);
   }

   async function confirmUpload(caption: string) {
      const file = uploadQueue[0];
      if (!file) return;
      setUploadQueue((prev) => prev.slice(1));
      setPendingCount((n) => n + 1);
      try {
         const bf = await fileToBoardFile(file, caption || undefined);
         blobMapRef.current.set(bf.id, file);
         previewUrlsRef.current.set(bf.id, URL.createObjectURL(file));
         saveFile(session!.username, bf, file).catch((ex) => console.error("[Profile] saveFile failed", ex));
         setLocalFiles((prev) => [...prev, bf]);
      } finally {
         setPendingCount((n) => n - 1);
      }
   }

   function cancelUpload() {
      setUploadQueue((prev) => prev.slice(1));
   }

   function removeLocal(id: string) {
      const url = previewUrlsRef.current.get(id);
      if (url) URL.revokeObjectURL(url);
      blobMapRef.current.delete(id);
      previewUrlsRef.current.delete(id);
      setLocalFiles((prev) => prev.filter((f) => f.id !== id));
      removeFile(id).catch((ex) => console.error("[Profile] removeFile failed", ex));
   }

   function openModal(fileId: string) {
      setModalFileId(fileId);
   }

   function openRemote(f: RemoteFile) {
      setModalFileId(f.id);
      if (!f.url && !f.downloading) webRTCRef.current?.requestFile(f.id);
   }

   // Resolve current modal image src
   const modalSrc = (() => {
      if (!modalFileId) return null;
      if (isOwn) return previewUrlsRef.current.get(modalFileId) ?? null;
      const rf = remoteFiles.find((f) => f.id === modalFileId);
      return rf?.url ?? rf?.thumbnail ?? null;
   })();

   const modalLoading = (() => {
      if (!modalFileId || isOwn) return false;
      const rf = remoteFiles.find((f) => f.id === modalFileId);
      return !!rf?.downloading;
   })();

   const guestStatusClass: Record<Status, string> = {
      connecting: "status-connecting",
      waiting: "status-connecting",
      connected: "status-connected",
      disconnected: "status-disconnected",
      offline: "status-disconnected",
   };

   const guestStatusLabel: Record<Status, string> = {
      connecting: "Connecting…",
      waiting: "Connecting…",
      connected: "Connected",
      disconnected: "Disconnected",
      offline: "Offline",
   };

   return (
      <div className="profile-page">
         <header className="profile-header">
            <h1 className="profile-username">{username}</h1>
            {isOwn ? (
               <span className={`badge ${host.viewerCount > 0 ? "badge--success" : "badge--default"}`}>
                  {host.viewerCount} {host.viewerCount === 1 ? "viewer" : "viewers"}
               </span>
            ) : (
               <span className={`status-badge ${guestStatusClass[status]}`}>{guestStatusLabel[status]}</span>
            )}
         </header>

         {isOwn && (
            <input ref={fileInputRef} type="file" accept="image/*" multiple hidden onChange={(e) => queueFiles(e.target.files!)} />
         )}

         {isOwn ? (
            <div
               className={`profile-gallery ${isDragging ? "profile-gallery--dragging" : ""}`}
               onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
               onDragLeave={() => setIsDragging(false)}
               onDrop={(e) => { e.preventDefault(); setIsDragging(false); queueFiles(e.dataTransfer.files); }}
            >
               <button className="gallery-upload-card" onClick={() => fileInputRef.current?.click()} aria-label="Add images">
                  <span className="gallery-upload-icon">+</span>
               </button>

               {Array.from({ length: pendingCount }).map((_, i) => (
                  <div key={`skeleton-${i}`} className="gallery-skeleton" />
               ))}

               {localFiles.map((f) => {
                  const src = previewUrlsRef.current.get(f.id) ?? f.thumbnail ?? "";
                  return (
                     <div key={f.id} className="gallery-item" onClick={() => openModal(f.id)}>
                        <div className="gallery-img-wrapper">
                           <img src={src} alt={f.name} className="gallery-img" loading="lazy" />
                           <div className="gallery-overlay">
                              <div className="gallery-overlay-top">
                                 {f.uploadedAt && <span className="gallery-overlay-date">{relativeTime(f.uploadedAt)}</span>}
                              </div>
                              {f.caption && <span className="gallery-overlay-caption">{f.caption}</span>}
                           </div>
                           <button
                              className="gallery-item-remove"
                              onClick={(e) => { e.stopPropagation(); removeLocal(f.id); }}
                              aria-label="Remove"
                           >✕</button>
                        </div>
                     </div>
                  );
               })}
            </div>
         ) : (
            <div className="profile-gallery">
               {(status === "offline" || status === "disconnected") && (
                  <div className="profile-empty">
                     <p>{status === "offline" ? `${username} is offline.` : "Connection failed."}</p>
                     <p className="profile-empty-hint">
                        {status === "offline"
                           ? "Come back when they're online to see their images."
                           : "Could not reach this peer."}
                     </p>
                     <button className="btn btn--secondary btn--sm" style={{ marginTop: "1rem" }} onClick={handleRetry}>
                        Retry
                     </button>
                  </div>
               )}
               {status !== "offline" && status !== "disconnected" && remoteFiles.length === 0 && (
                  <div className="profile-empty">
                     <p>{status === "connected" ? "No images shared yet." : "Connecting to peer…"}</p>
                  </div>
               )}
               {remoteFiles.map((f) => (
                  <div key={f.id} className="gallery-item" onClick={() => openRemote(f)}>
                     <div className="gallery-img-wrapper">
                        <img src={f.thumbnail ?? ""} alt={f.name} className="gallery-img" loading="lazy" />
                        <div className="gallery-overlay">
                           <div className="gallery-overlay-top">
                              {f.uploadedAt && <span className="gallery-overlay-date">{relativeTime(f.uploadedAt)}</span>}
                           </div>
                           {f.caption && <span className="gallery-overlay-caption">{f.caption}</span>}
                        </div>
                        {f.downloading && (
                           <div className="gallery-progress">
                              <div className="gallery-progress-fill" style={{ width: `${Math.round(f.progress * 100)}%` }} />
                           </div>
                        )}
                     </div>
                  </div>
               ))}
            </div>
         )}

         {uploadQueue.length > 0 && (
            <UploadPreview
               file={uploadQueue[0]}
               onConfirm={confirmUpload}
               onCancel={cancelUpload}
            />
         )}

         {/* Fullscreen modal */}
         {modalFileId && (
            <div className="gallery-modal" onClick={() => setModalFileId(null)}>
               <button className="gallery-modal-close" onClick={() => setModalFileId(null)} aria-label="Close">✕</button>
               {modalLoading && <div className="gallery-modal-spinner" />}
               {modalSrc && (
                  <img
                     src={modalSrc}
                     className={`gallery-modal-img ${modalLoading ? "gallery-modal-img--loading" : ""}`}
                     alt=""
                     onClick={(e) => e.stopPropagation()}
                  />
               )}
            </div>
         )}
      </div>
   );
}
