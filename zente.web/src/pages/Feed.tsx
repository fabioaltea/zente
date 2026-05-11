import { Link } from "react-router-dom";
import type { RemoteFileEntry } from "../hooks/useAppRoot";
import { relativeTime } from "../services/relativeTime";

interface FeedProps {
   items: RemoteFileEntry[];
   onRefresh: () => void;
   loading: boolean;
}

export default function Feed({ items, onRefresh, loading }: FeedProps) {
   return (
      <div className="feed-page">
         <div className="feed-toolbar">
            <button className="btn btn--secondary btn--sm" onClick={onRefresh}>Refresh</button>
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
      </div>
   );
}
