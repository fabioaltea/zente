import { useEffect, useState } from "react";
import type { RemoteFileEntry } from "../hooks/useAppRoot";
import { relativeTime } from "../services/relativeTime";

export type GuestStatus = "connecting" | "connected" | "disconnected" | "offline";

interface GuestProfileProps {
   username: string;
   items: RemoteFileEntry[];
   status: GuestStatus;
   canDownload: boolean;
   onRequestFile: (fileId: string) => void;
   onRetry: () => void;
}

const STATUS_CLASS: Record<GuestStatus, string> = {
   connecting: "status-connecting",
   connected: "status-connected",
   disconnected: "status-disconnected",
   offline: "status-disconnected",
};

const STATUS_LABEL: Record<GuestStatus, string> = {
   connecting: "Connecting…",
   connected: "Connected",
   disconnected: "Disconnected",
   offline: "Offline",
};

export default function GuestProfile(props: GuestProfileProps) {
   const { username, items, status, canDownload, onRequestFile, onRetry } = props;
   const [modalFileId, setModalFileId] = useState<string | null>(null);

   useEffect(() => {
      if (!modalFileId) return;
      function onKey(e: KeyboardEvent) { if (e.key === "Escape") setModalFileId(null); }
      document.addEventListener("keydown", onKey);
      return () => document.removeEventListener("keydown", onKey);
   }, [modalFileId]);

   function openItem(f: RemoteFileEntry) {
      setModalFileId(f.file.id);
      if (canDownload && !f.url && !f.downloading) onRequestFile(f.file.id);
   }

   const modalItem = modalFileId ? items.find((f) => f.file.id === modalFileId) : null;
   const modalSrc = modalItem?.url ?? modalItem?.file.thumbnail ?? null;
   const modalLoading = !!modalItem?.downloading;

   return (
      <div className="profile-page">
         <header className="profile-header">
            <h1 className="profile-username">{username}</h1>
            <span className={`status-badge ${STATUS_CLASS[status]}`}>{STATUS_LABEL[status]}</span>
         </header>

         <div className="profile-gallery">
            {(status === "offline" || status === "disconnected") && (
               <div className="profile-empty">
                  <p>{status === "offline" ? `${username} is offline.` : "Connection failed."}</p>
                  <p className="profile-empty-hint">
                     {status === "offline"
                        ? "Come back when they're online to see their images."
                        : "Could not reach this peer."}
                  </p>
                  <button className="btn btn--secondary btn--sm" style={{ marginTop: "1rem" }} onClick={onRetry}>
                     Retry
                  </button>
               </div>
            )}

            {status === "connecting" && items.length === 0 && (
               <div className="profile-empty">
                  <p>Connecting to peer…</p>
               </div>
            )}

            {status === "connected" && items.length === 0 && (
               <div className="profile-empty">
                  <p>No images shared yet.</p>
               </div>
            )}

            {items.map((entry) => {
               const f = entry.file;
               return (
                  <div key={f.id} className="gallery-item" onClick={() => openItem(entry)}>
                     <div className="gallery-img-wrapper">
                        <img src={f.thumbnail ?? ""} alt={f.name} className="gallery-img" loading="lazy" />
                        <div className="gallery-overlay">
                           <div className="gallery-overlay-top">
                              {f.uploadedAt && <span className="gallery-overlay-date">{relativeTime(f.uploadedAt)}</span>}
                           </div>
                           {f.caption && <span className="gallery-overlay-caption">{f.caption}</span>}
                        </div>
                        {entry.downloading && (
                           <div className="gallery-progress">
                              <div className="gallery-progress-fill" style={{ width: `${Math.round(entry.progress * 100)}%` }} />
                           </div>
                        )}
                     </div>
                  </div>
               );
            })}
         </div>

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
