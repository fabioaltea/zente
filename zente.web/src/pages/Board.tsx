import { useState, useRef, useEffect, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { QRCodeSVG } from "qrcode.react";
import { SignalingHelper, SignalingMessage } from "../hooks/useSignaling";
import { WebRTCHelper, BoardFile, RemoteFile } from "../hooks/useWebRTC";
import { PeerApiHelper } from "../services/PeerApiHelper";
import { loadSession } from "../services/session";

type Status = "connecting" | "waiting" | "connected" | "disconnected";

async function fileToBoardFile(file: File): Promise<BoardFile> {
   const id = crypto.randomUUID();
   const thumbnail = await makeThumbnail(file);
   return { id, name: file.name, size: file.size, mimeType: file.type, thumbnail };
}

function makeThumbnail(file: File): Promise<string | null> {
   return new Promise((resolve) => {
      if (!file.type.startsWith("image/")) {
         resolve(null);
         return;
      }
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

function formatSize(bytes: number): string {
   if (bytes < 1024) return `${bytes} B`;
   if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
   return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function Board() {
   const { hostPeerId } = useParams<{ hostPeerId?: string }>();
   const { username } = useParams<{ username?: string }>();
   const navigate = useNavigate();

   const isHost = !hostPeerId;

   const session = loadSession();
   const [myPeerId] = useState(() => session?.peerId ?? crypto.randomUUID());
   const [status, setStatus] = useState<Status>("connecting");
   const [isDragging, setIsDragging] = useState(false);

   // Local board: BoardFile metadata + raw Blob
   const [localFiles, setLocalFiles] = useState<BoardFile[]>([]);
   const blobMapRef = useRef<Map<string, Blob>>(new Map());

   // Remote board
   const [remoteFiles, setRemoteFiles] = useState<RemoteFile[]>([]);

   const remotePeerIdRef = useRef<string | null>(isHost ? null : (hostPeerId ?? null));

   // Redirect to landing if host board accessed without a session
   useEffect(() => {
      if (isHost && !loadSession()) navigate("/", { replace: true });
      // eslint-disable-next-line react-hooks/exhaustive-deps
   }, []);

   const joinUrl = useMemo(() => {
      if (!isHost) return null;
      return `${window.location.origin}/join/${myPeerId}`;
   }, [isHost, myPeerId]);

   const signalingRef = useRef<SignalingHelper | null>(null);
   const webRTCRef = useRef<WebRTCHelper | null>(null);
   const [isConnected, setIsConnected] = useState(false);

   const getFileBlob = async (fileId: string): Promise<Blob | null> => blobMapRef.current.get(fileId) ?? null;

   const onRemoteManifest = (files: BoardFile[]) => setRemoteFiles(files.map((f) => ({ ...f, downloading: false, progress: 0, url: null })));

   const onFileDownloaded = (fileId: string, url: string, name: string) => {
      setRemoteFiles((prev) => prev.map((f) => (f.id === fileId ? { ...f, downloading: false, progress: 1, url } : f)));
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.click();
   };

   const onFileDownloading = (fileId: string) => setRemoteFiles((prev) => prev.map((f) => (f.id === fileId ? { ...f, downloading: true, progress: 0 } : f)));

   const onFileProgress = (fileId: string, received: number, total: number) => setRemoteFiles((prev) => prev.map((f) => (f.id === fileId ? { ...f, progress: total > 0 ? received / total : 0 } : f)));

   const onConnectionChange = (connected: boolean) => {
      setIsConnected(connected);
      if (connected) setStatus("connected");
   };

   const onSignalingMessage = async (msg: SignalingMessage) => {
      if (msg.type === "registered") {
         setStatus("waiting");
         if (!isHost && remotePeerIdRef.current) {
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
      const currentSession = loadSession();

      if (isHost && currentSession) {
         PeerApiHelper.registerOnline(currentSession.username, currentSession.peerId).catch((ex) => console.error("[Board] registerOnline failed", ex));
      }

      const rtc = new WebRTCHelper(getFileBlob, onRemoteManifest, onFileDownloaded, onFileDownloading, onFileProgress, onConnectionChange);
      webRTCRef.current = rtc;

      const signaling = new SignalingHelper(onSignalingMessage);
      signalingRef.current = signaling;
      signaling.connect(myPeerId);

      return () => {
         signaling.disconnect();
         if (isHost && currentSession) {
            PeerApiHelper.markOffline(currentSession.username);
         }
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
   }, [myPeerId]);

   // Push updated manifest when local files change
   useEffect(() => {
      webRTCRef.current?.pushManifest(localFiles);
   }, [localFiles]);

   async function addFiles(files: FileList | File[]) {
      const arr = Array.from(files);
      const boardFiles = await Promise.all(arr.map(fileToBoardFile));
      boardFiles.forEach((bf, i) => blobMapRef.current.set(bf.id, arr[i]));
      setLocalFiles((prev) => [...prev, ...boardFiles]);
   }

   function removeLocal(id: string) {
      blobMapRef.current.delete(id);
      setLocalFiles((prev) => prev.filter((f) => f.id !== id));
   }

   const statusLabel: Record<Status, string> = {
      connecting: "Connecting…",
      waiting: isHost ? "Scan QR to connect" : "Waiting for host…",
      connected: "Connected",
      disconnected: "Disconnected",
   };

   return (
      <div className="page board-page">
         <header className="board-header">
            <span className="logo">Zente</span>
            {username && <span className="board-username">@{username}</span>}
            <div className={`status-badge status-${status}`}>{statusLabel[status]}</div>
         </header>

         {/* QR shown while host waiting */}
         {isHost && status === "waiting" && joinUrl && (
            <div className="qr-section">
               <div className="qr-wrapper">
                  <QRCodeSVG value={joinUrl} size={180} />
               </div>
               <button className="btn-secondary" onClick={() => navigator.clipboard.writeText(joinUrl)}>
                  Copy link
               </button>
            </div>
         )}

         <div className="boards">
            {/* My board */}
            <section className="board-col">
               <h2 className="board-col-title">My board</h2>
               <div
                  className={`drop-zone ${isDragging ? "dragging" : ""}`}
                  onDragOver={(e) => {
                     e.preventDefault();
                     setIsDragging(true);
                  }}
                  onDragLeave={() => setIsDragging(false)}
                  onDrop={(e) => {
                     e.preventDefault();
                     setIsDragging(false);
                     addFiles(e.dataTransfer.files);
                  }}
               >
                  {localFiles.length === 0 && <p className="drop-hint">Drop files here</p>}
                  <div className="file-grid">
                     {localFiles.map((f) => (
                        <div key={f.id} className="file-card local">
                           {f.thumbnail ? <img src={f.thumbnail} alt={f.name} className="file-thumb" /> : <div className="file-icon">{f.name.split(".").pop()?.toUpperCase() ?? "?"}</div>}
                           <span className="file-card-name">{f.name}</span>
                           <span className="file-card-size">{formatSize(f.size)}</span>
                           <button className="file-remove" onClick={() => removeLocal(f.id)}>
                              ✕
                           </button>
                        </div>
                     ))}
                  </div>
                  <label className="btn-primary file-label">
                     Add files
                     <input type="file" multiple onChange={(e) => e.target.files && addFiles(e.target.files)} hidden />
                  </label>
               </div>
            </section>

            {/* Their board */}
            <section className="board-col">
               <h2 className="board-col-title">Their board</h2>
               {!isConnected ? (
                  <p className="board-empty">Connect a device to see their files</p>
               ) : remoteFiles.length === 0 ? (
                  <p className="board-empty">No files shared yet</p>
               ) : (
                  <div className="file-grid">
                     {remoteFiles.map((f) => (
                        <div key={f.id} className={`file-card remote ${f.downloading ? "downloading" : ""}`}>
                           {f.thumbnail ? <img src={f.thumbnail} alt={f.name} className="file-thumb" /> : <div className="file-icon">{f.name.split(".").pop()?.toUpperCase() ?? "?"}</div>}
                           <span className="file-card-name">{f.name}</span>
                           <span className="file-card-size">{formatSize(f.size)}</span>
                           {f.downloading && (
                              <>
                                 <div className="progress-bar-track">
                                    <div className="progress-bar-fill" style={{ width: `${Math.round(f.progress * 100)}%` }} />
                                 </div>
                                 <span className="file-card-status">{Math.round(f.progress * 100)}%</span>
                              </>
                           )}
                           {f.url && <span className="file-card-status done">Downloaded</span>}
                           {!f.downloading && !f.url && (
                              <button className="btn-download" onClick={() => webRTCRef.current?.requestFile(f.id)}>
                                 Download
                              </button>
                           )}
                        </div>
                     ))}
                  </div>
               )}
            </section>
         </div>
      </div>
   );
}
