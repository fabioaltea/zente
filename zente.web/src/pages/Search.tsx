import { useState } from "react";
import { Link } from "react-router-dom";
import type { Peer } from "../services/PeerApiHelper";
import { Input } from "../components/ui";

interface SearchProps {
   peers: Peer[];
   currentUsername: string;
}

export default function Search({ peers, currentUsername }: SearchProps) {
   const [query, setQuery] = useState("");
   const trimmed = query.trim();

   const filtered = (trimmed.length >= 3
      ? peers.filter((p) => p.username.toLowerCase().includes(trimmed.toLowerCase()))
      : peers
   ).filter((p) => p.username !== currentUsername);

   const initials = (name: string) => name.slice(0, 2).toUpperCase();

   return (
      <div className="feed-page">
         <div className="search-mobile-header">
            <span className="logo">Zente</span>
         </div>
         <div className="feed-search">
            <Input placeholder="Search users…" value={query} onChange={(e) => setQuery(e.target.value)} />
         </div>

         {filtered.length === 0 && (
            <p className="feed-empty">
               {trimmed.length >= 3 ? `No users matching "${trimmed}"` : "No users online"}
            </p>
         )}

         <div className="feed-grid">
            {filtered.map((peer) => (
               <Link key={peer.id} to={`/feed/${peer.username}`} className="user-card">
                  <div className="user-card-avatar" data-initials={initials(peer.username)} />
                  <div className="user-card-info">
                     <span className="user-card-name">{peer.username}</span>
                     <span className="user-card-status">
                        <span className="online-dot" aria-hidden />
                        online
                     </span>
                  </div>
               </Link>
            ))}
         </div>
      </div>
   );
}
