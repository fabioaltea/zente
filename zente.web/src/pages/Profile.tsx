import { useState, useRef, useEffect } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { SignalingHelper, SignalingMessage } from "../hooks/useSignaling";
import { WebRTCHelper, BoardFile, RemoteFile } from "../hooks/useWebRTC";
import { PeerApiHelper } from "../services/PeerApiHelper";
import { loadSession } from "../services/session";
import { Button } from "../components/ui";

type Status = "connecting" | "waiting" | "connected" | "disconnected" | "offline";

async function fileToBoardFile(file: File): Promise<BoardFile> {
   const id = crypto.randomUUID();
   const thumbnail = await makeThumbnail(file);
   return { id, name: file.name, size: file.size, mimeType: file.type, thumbnail };
}

function makeThumbnail(file: File): Promise<string | null> {
   return new Promise((resolve) => {
      if (!file.type.startsWith("image/")) { resolve(null); return; }
      const reader = new FileReader();
      reader.onload = (ev) => {
         const img = new Image();
         img.onload = () => {
            const canvas = document.createElement("canvas");
            const MAX = 120;
            const ratio = Math.min(MAX / img.width, MAX / img.height);
            canvas.width = img.width * ratio;
            canvas.height = img.height * ratio;
            canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
            resolve(canvas.toDataURL("image/jpeg", 0.7));
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

   const [myPeerId] = useState(() => session?.peerId ?? crypto.randomUUID());
   const [status, setStatus] = useState<Status>("connecting");
   const statusRef = useRef<Status>("connecting");
   const [isDragging, setIsDragging] = useState(false);

   const [localFiles, setLocalFiles] = useState<BoardFile[]>([]);
   const blobMapRef = useRef<Map<string, Blob>>(new Map());
   const previewUrlsRef = useRef<Map<string, string>>(new Map());

   const [remoteFiles, setRemoteFiles] = useState<RemoteFile[]>([]);

   const signalingRef = useRef<SignalingHelper | null>(null);
   const webRTCRef = useRef<WebRTCHelper | null>(null);
   const remotePeerIdRef = useRef<string | null>(null);

   function setStatusBoth(s: Status) {
      statusRef.current = s;
      setStatus(s);
   }

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

   useEffect(() => {
      if (!session) { navigate("/login", { replace: true }); return; }

      let cancelled = false;

      const rtc = new WebRTCHelper(getFileBlob, onRemoteManifest, onFileDownloaded, onFileDownloading, onFileProgress, onConnectionChange);
      webRTCRef.current = rtc;

      async function setup() {
         if (isOwn) {
            PeerApiHelper.registerOnline(session!.username, session!.peerId).catch(() => {});
         } else {
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
         }
         if (cancelled) return;
         const signaling = new SignalingHelper(onSignalingMessage);
         signalingRef.current = signaling;
         signaling.connect(myPeerId);
      }

      setup();

      return () => {
         cancelled = true;
         signalingRef.current?.disconnect();
         webRTCRef.current?.destroy();
         previewUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
   }, []);

   useEffect(() => {
      webRTCRef.current?.pushManifest(localFiles);
   }, [localFiles]);

   async function addFiles(files: FileList | File[]) {
      const arr = Array.from(files).filter((f) => f.type.startsWith("image/"));
      if (!arr.length) return;
      const boardFiles = await Promise.all(arr.map(fileToBoardFile));
      boardFiles.forEach((bf, i) => {
         blobMapRef.current.set(bf.id, arr[i]);
         previewUrlsRef.current.set(bf.id, URL.createObjectURL(arr[i]));
      });
      setLocalFiles((prev) => [...prev, ...boardFiles]);
   }

   function removeLocal(id: string) {
      const url = previewUrlsRef.current.get(id);
      if (url) URL.revokeObjectURL(url);
      blobMapRef.current.delete(id);
      previewUrlsRef.current.delete(id);
      setLocalFiles((prev) => prev.filter((f) => f.id !== id));
   }

   const statusLabel: Record<Status, string> = {
      connecting: "Connecting…",
      waiting: isOwn ? "Waiting for viewers" : "Connecting…",
      connected: "Connected",
      disconnected: "Disconnected",
      offline: "Offline",
   };

   const statusClass: Record<Status, string> = {
      connecting: "status-connecting",
      waiting: "status-waiting",
      connected: "status-connected",
      disconnected: "status-disconnected",
      offline: "status-disconnected",
   };

   return (
      <div className="profile-page">
         <header className="profile-header">
            <Link to="/feed" className="profile-back">← Feed</Link>
            <h1 className="profile-username">{username}</h1>
            <span className={`status-badge ${statusClass[status]}`}>{statusLabel[status]}</span>
            {isOwn && (
               <Button variant="primary" size="sm" onClick={() => fileInputRef.current?.click()}>
                  Add images
               </Button>
            )}
         </header>

         {isOwn && (
            <input ref={fileInputRef} type="file" accept="image/*" multiple hidden onChange={(e) => addFiles(e.target.files!)} />
         )}

         {isOwn ? (
            <div
               className={`profile-gallery ${isDragging ? "profile-gallery--dragging" : ""}`}
               onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
               onDragLeave={() => setIsDragging(false)}
               onDrop={(e) => { e.preventDefault(); setIsDragging(false); addFiles(e.dataTransfer.files); }}
            >
               {localFiles.length === 0 && (
                  <div className="profile-empty">
                     <p>No images yet.</p>
                     <p className="profile-empty-hint">Drop images here or click Add images.</p>
                  </div>
               )}
               {localFiles.map((f) => {
                  const src = previewUrlsRef.current.get(f.id) ?? f.thumbnail ?? "";
                  return (
                     <div key={f.id} className="gallery-item">
                        <div className="gallery-img-wrapper">
                           <img src={src} alt={f.name} className="gallery-img" />
                        </div>
                        <div className="gallery-item-footer">
                           <span className="gallery-item-name">{f.name}</span>
                           <button className="gallery-item-remove" onClick={() => removeLocal(f.id)} aria-label="Remove">✕</button>
                        </div>
                     </div>
                  );
               })}
            </div>
         ) : (
            <div className="profile-gallery">
               {status === "offline" && (
                  <div className="profile-empty">
                     <p>{username} is offline.</p>
                     <p className="profile-empty-hint">Come back when they're online to see their images.</p>
                  </div>
               )}
               {status !== "offline" && remoteFiles.length === 0 && (
                  <div className="profile-empty">
                     <p>{status === "connected" ? "No images shared yet." : "Connecting to peer…"}</p>
                  </div>
               )}
               {remoteFiles.map((f) => (
                  <div
                     key={f.id}
                     className={`gallery-item ${f.downloading ? "gallery-item--loading" : ""} ${!f.url && !f.downloading ? "gallery-item--tap" : ""}`}
                     onClick={() => !f.downloading && !f.url ? webRTCRef.current?.requestFile(f.id) : undefined}
                  >
                     <div className="gallery-img-wrapper">
                        <img src={f.url ?? f.thumbnail ?? ""} alt={f.name} className={`gallery-img ${!f.url ? "gallery-img--blur" : ""}`} />
                        {f.downloading && (
                           <div className="gallery-progress">
                              <div className="gallery-progress-fill" style={{ width: `${Math.round(f.progress * 100)}%` }} />
                           </div>
                        )}
                        {!f.url && !f.downloading && <div className="gallery-tap-hint">Tap to load</div>}
                     </div>
                     <div className="gallery-item-footer">
                        <span className="gallery-item-name">{f.name}</span>
                     </div>
                  </div>
               ))}
            </div>
         )}
      </div>
   );
}
