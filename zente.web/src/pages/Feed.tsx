import { useState, useEffect, useRef } from "react";
import { useNavigate, Link } from "react-router-dom";
import { PeerApiHelper, Peer } from "../services/PeerApiHelper";
import { loadSession, clearSession } from "../services/session";
import { clearUserFiles } from "../services/fileStore";
import { Input } from "../components/ui";

export default function Feed() {
   const navigate = useNavigate();
   const session = loadSession();

   const [allPeers, setAllPeers] = useState<Peer[]>([]);
   const [query, setQuery] = useState("");
   const [loading, setLoading] = useState(false);
   const [error, setError] = useState<string | null>(null);
   const [menuOpen, setMenuOpen] = useState(false);
   const menuRef = useRef<HTMLDivElement>(null);

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

   useEffect(() => {
      if (!menuOpen) return;
      function onOutsideClick(e: MouseEvent) {
         if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
            setMenuOpen(false);
         }
      }
      document.addEventListener("mousedown", onOutsideClick);
      return () => document.removeEventListener("mousedown", onOutsideClick);
   }, [menuOpen]);

   async function handleLogout() {
      setMenuOpen(false);
      if (session) {
         await Promise.all([
            PeerApiHelper.markOffline(session.username).catch(() => {}),
            clearUserFiles(session.username).catch(() => {}),
         ]);
      }
      clearSession();
      navigate("/login", { replace: true });
   }

   const trimmed = query.trim();
   const peers = trimmed.length >= 3
      ? allPeers.filter((p) => p.username.toLowerCase().includes(trimmed.toLowerCase()))
      : allPeers;

   const initials = (name: string) => name.slice(0, 2).toUpperCase();

   return (
      <div className="feed-page">
         <header className="feed-header">
            <span className="logo">Zente</span>

            {session && (
               <div className="feed-profile-trigger" ref={menuRef}>
                  <button
                     className="feed-profile-btn"
                     onClick={() => setMenuOpen((o) => !o)}
                     aria-expanded={menuOpen}
                  >
                     <div className="feed-profile-avatar" data-initials={initials(session.username)} />
                     <span className="feed-profile-username">{session.username}</span>
                     <span className="online-dot" aria-hidden />
                  </button>

                  {menuOpen && (
                     <div className="feed-profile-menu">
                        <Link
                           to={`/feed/${session.username}`}
                           className="feed-menu-item"
                           onClick={() => setMenuOpen(false)}
                        >
                           My profile
                        </Link>
                        <div className="feed-menu-divider" />
                        <button className="feed-menu-item feed-menu-item--danger" onClick={handleLogout}>
                           Go offline
                        </button>
                     </div>
                  )}
               </div>
            )}
         </header>

         <div className="feed-search">
            <Input
               placeholder="Search users…"
               value={query}
               onChange={(e) => setQuery(e.target.value)}
            />
         </div>

         {error && <p className="error-text">{error}</p>}

         {!loading && peers.filter((p) => p.username !== session?.username).length === 0 && !error && (
            <p className="feed-empty">
               {trimmed.length >= 3 ? `No users matching "${trimmed}"` : "No users online"}
            </p>
         )}

         <div className="feed-grid">
            {peers.filter((p) => p.username !== session?.username).map((peer) => (
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
