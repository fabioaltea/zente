import { useEffect, useRef, useState } from "react";
import type { BoardFile } from "../hooks/useWebRTC";
import { UploadPreview } from "../components/UploadPreview";
import { relativeTime } from "../services/relativeTime";

interface OwnProfileProps {
   username: string;
   files: BoardFile[];
   viewerCount: number;
   pendingCount: number;
   uploadQueueFirst: File | null;
   getBlobUrl: (id: string) => string | null;
   onQueueFiles: (files: FileList | File[]) => void;
   onConfirmUpload: (caption: string) => Promise<void> | void;
   onCancelUpload: () => void;
   onRemoveFile: (id: string) => Promise<void> | void;
}

export default function OwnProfile(props: OwnProfileProps) {
   const {
      username, files, viewerCount, pendingCount, uploadQueueFirst,
      getBlobUrl, onQueueFiles, onConfirmUpload, onCancelUpload, onRemoveFile,
   } = props;

   const fileInputRef = useRef<HTMLInputElement>(null);
   const [isDragging, setIsDragging] = useState(false);
   const [modalFileId, setModalFileId] = useState<string | null>(null);

   useEffect(() => {
      if (!modalFileId) return;
      function onKey(e: KeyboardEvent) { if (e.key === "Escape") setModalFileId(null); }
      document.addEventListener("keydown", onKey);
      return () => document.removeEventListener("keydown", onKey);
   }, [modalFileId]);

   const modalSrc = modalFileId ? getBlobUrl(modalFileId) ?? null : null;

   return (
      <div className="profile-page">
         <header className="profile-header">
            <h1 className="profile-username">{username}</h1>
            <span className={`badge ${viewerCount > 0 ? "badge--success" : "badge--default"}`}>
               {viewerCount} {viewerCount === 1 ? "viewer" : "viewers"}
            </span>
         </header>

         <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(e) => e.target.files && onQueueFiles(e.target.files)}
         />

         <div
            className={`profile-gallery ${isDragging ? "profile-gallery--dragging" : ""}`}
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={(e) => { e.preventDefault(); setIsDragging(false); onQueueFiles(e.dataTransfer.files); }}
         >
            <button className="gallery-upload-card" onClick={() => fileInputRef.current?.click()} aria-label="Add images">
               <span className="gallery-upload-icon">+</span>
            </button>

            {Array.from({ length: pendingCount }).map((_, i) => (
               <div key={`skeleton-${i}`} className="gallery-skeleton" />
            ))}

            {files.map((f) => {
               const src = getBlobUrl(f.id) ?? f.thumbnail ?? "";
               return (
                  <div key={f.id} className="gallery-item" onClick={() => setModalFileId(f.id)}>
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
                           onClick={(e) => { e.stopPropagation(); onRemoveFile(f.id); }}
                           aria-label="Remove"
                        >✕</button>
                     </div>
                  </div>
               );
            })}
         </div>

         {uploadQueueFirst && (
            <UploadPreview
               file={uploadQueueFirst}
               onConfirm={(caption) => { void onConfirmUpload(caption); }}
               onCancel={onCancelUpload}
            />
         )}

         {modalFileId && (
            <div className="gallery-modal" onClick={() => setModalFileId(null)}>
               <button className="gallery-modal-close" onClick={() => setModalFileId(null)} aria-label="Close">✕</button>
               {modalSrc && (
                  <img
                     src={modalSrc}
                     className="gallery-modal-img"
                     alt=""
                     onClick={(e) => e.stopPropagation()}
                  />
               )}
            </div>
         )}
      </div>
   );
}
