import { useState, useEffect, useCallback } from "react";
import { useNavigate, Link } from "react-router-dom";
import { PeerApiHelper, Peer } from "../services/PeerApiHelper";
import { loadSession, clearSession } from "../services/session";
import { Button, Input } from "../components/ui";

export default function Feed() {
   const navigate = useNavigate();
   const session = loadSession();

   const [peers, setPeers] = useState<Peer[]>([]);
   const [query, setQuery] = useState("");
   const [loading, setLoading] = useState(false);
   const [error, setError] = useState<string | null>(null);

   const fetchPeers = useCallback(async (q?: string) => {
      setLoading(true);
      setError(null);
      try {
         const results = await PeerApiHelper.searchPeers(q?.trim() || undefined);
         setPeers(results);
      } catch (ex) {
         setError(ex instanceof Error ? ex.message : "Failed to load peers");
      } finally {
         setLoading(false);
      }
   }, []);

   useEffect(() => {
      if (!session) {
         navigate("/login", { replace: true });
         return;
      }
      fetchPeers();
   }, []); // eslint-disable-line react-hooks/exhaustive-deps

   async function handleLogout() {
      if (session) {
         await PeerApiHelper.markOffline(session.username).catch(() => {});
      }
      clearSession();
      navigate("/login", { replace: true });
   }

   function handleSearch() {
      fetchPeers(query);
   }

   const initials = (name: string) => name.slice(0, 2).toUpperCase();

   return (
      <div className="feed-page">
         <header className="feed-header">
            <span className="logo">Zente</span>
            <div className="feed-header-right">
               {session && (
                  <Link to={`/feed/${session.username}`} className="feed-self-link">
                     <span className="online-dot" aria-hidden />
                     <span className="feed-self-username">{session.username}</span>
                  </Link>
               )}
               <Button variant="ghost" size="sm" onClick={handleLogout}>
                  Go offline
               </Button>
            </div>
         </header>

         <div className="feed-search">
            <Input
               placeholder="Search users…"
               value={query}
               onChange={(e) => setQuery(e.target.value)}
               onKeyDown={(e) => e.key === "Enter" && handleSearch()}
               className="feed-search-input"
            />
            <Button variant="secondary" size="sm" loading={loading} onClick={handleSearch}>
               Search
            </Button>
         </div>

         {error && <p className="error-text">{error}</p>}

         {!loading && peers.length === 0 && !error && (
            <p className="feed-empty">
               {query.trim() ? `No users matching "${query.trim()}"` : "No users online"}
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
