import { useRef } from "react";
import { Link } from "react-router-dom";
import type { RemoteFileEntry } from "../hooks/useAppRoot";
import { UploadPreview } from "../components/UploadPreview";
import { relativeTime } from "../services/relativeTime";

interface FeedProps {
   items: RemoteFileEntry[];
   onRefresh: () => void;
   loading: boolean;
   uploadQueueFirst: File | null;
   onQueueFiles: (files: FileList | File[]) => void;
   onConfirmUpload: (caption: string) => Promise<void> | void;
   onCancelUpload: () => void;
}

export default function Feed({
   items,
   onRefresh,
   loading,
   uploadQueueFirst,
   onQueueFiles,
   onConfirmUpload,
   onCancelUpload,
}: FeedProps) {
   const fileInputRef = useRef<HTMLInputElement>(null);

   return (
      <div className="feed-page">
         <div className="feed-toolbar">
            <input
               ref={fileInputRef}
               type="file"
               accept="image/*"
               multiple
               hidden
               onChange={(e) => e.target.files && onQueueFiles(e.target.files)}
            />
            <button className="profile-add-btn feed-refresh-btn" onClick={onRefresh} aria-label="Refresh feed" title="Refresh">
               <svg className="feed-refresh-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M20 12a8 8 0 1 1-2.34-5.66" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  <polyline points="20 4 20 10 14 10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
               </svg>
            </button>
            <button className="profile-add-btn" onClick={() => fileInputRef.current?.click()} aria-label="Add images" title="Add images">
               +
            </button>
         </div>

         {loading && items.length === 0 && (
            <div className="feed-connecting">
               <p className="feed-empty">Connecting to peers…</p>
            </div>
         )}

         {!loading && items.length === 0 && (
            <p className="feed-empty">No content yet. Connect with peers to see their images.</p>
         )}

         <div className="profile-gallery">
            {items.map((item) => (
               <Link
                  key={`${item.peerId}-${item.file.id}`}
                  to={`/feed/${item.username}`}
                  className="gallery-item feed-gallery-item"
               >
                  <div className="gallery-img-wrapper">
                     <img src={item.file.thumbnail ?? ""} alt={item.file.name} className="gallery-img" loading="lazy" />
                     <div className="gallery-overlay">
                        <div className="gallery-overlay-top">
                           <span className="gallery-overlay-user">{item.username}</span>
                           {item.file.uploadedAt && <span className="gallery-overlay-date">{relativeTime(item.file.uploadedAt)}</span>}
                        </div>
                        {item.file.caption && <span className="gallery-overlay-caption">{item.file.caption}</span>}
                     </div>
                  </div>
               </Link>
            ))}
         </div>

         {uploadQueueFirst && (
            <UploadPreview
               file={uploadQueueFirst}
               onConfirm={(caption) => { void onConfirmUpload(caption); }}
               onCancel={onCancelUpload}
            />
         )}
      </div>
   );
}
