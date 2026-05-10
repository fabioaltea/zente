import { useState, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import { PeerApiHelper, Peer } from "../services/PeerApiHelper";
import { loadSession } from "../services/session";
import { Input } from "../components/ui";

export default function Search() {
   const navigate = useNavigate();
   const session = loadSession();

   const [allPeers, setAllPeers] = useState<Peer[]>([]);
   const [query, setQuery] = useState("");
   const [loading, setLoading] = useState(false);
   const [error, setError] = useState<string | null>(null);

   useEffect(() => {
      if (!session) { navigate("/login", { replace: true }); return; }

      function fetchAll() {
         PeerApiHelper.searchPeers()
            .then(setAllPeers)
            .catch((ex) => setError(ex instanceof Error ? ex.message : "Failed to load peers"));
      }

      setLoading(true);
      PeerApiHelper.searchPeers()
         .then(setAllPeers)
         .catch((ex) => setError(ex instanceof Error ? ex.message : "Failed to load peers"))
         .finally(() => setLoading(false));

      const interval = setInterval(fetchAll, 10_000);
      return () => clearInterval(interval);
   }, []); // eslint-disable-line react-hooks/exhaustive-deps

   const trimmed = query.trim();
   const peers = (trimmed.length >= 3
      ? allPeers.filter((p) => p.username.toLowerCase().includes(trimmed.toLowerCase()))
      : allPeers
   ).filter((p) => p.username !== session?.username);

   const initials = (name: string) => name.slice(0, 2).toUpperCase();

   return (
      <div className="feed-page">
         <div className="search-mobile-header">
            <span className="logo">Zente</span>
         </div>
         <div className="feed-search">
            <Input placeholder="Search users…" value={query} onChange={(e) => setQuery(e.target.value)} />
         </div>

         {error && <p className="error-text">{error}</p>}

         {!loading && peers.length === 0 && !error && (
            <p className="feed-empty">
               {trimmed.length >= 3 ? `No users matching "${trimmed}"` : "No users online"}
            </p>
         )}

         <div className="feed-grid">
            {peers.map((peer) => (
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
