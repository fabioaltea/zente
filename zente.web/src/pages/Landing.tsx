import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { PeerApiHelper, Peer } from "../services/PeerApiHelper";
import { saveSession, loadSession, clearSession, UserSession } from "../services/session";

const USERNAME_RE = /^[\w.-]{1,32}$/;

export default function Landing() {
   const navigate = useNavigate();

   const [session, setSession] = useState<UserSession | null>(() => loadSession());

   // Register form
   const [usernameInput, setUsernameInput] = useState("");
   const [registerError, setRegisterError] = useState<string | null>(null);
   const [isRegistering, setIsRegistering] = useState(false);

   // Search
   const [searchQuery, setSearchQuery] = useState("");
   const [searchResults, setSearchResults] = useState<Peer[]>([]);
   const [isSearching, setIsSearching] = useState(false);
   const [searchError, setSearchError] = useState<string | null>(null);
   const [searchPerformed, setSearchPerformed] = useState(false);

   useEffect(() => {
      handleSearch();
      // eslint-disable-next-line react-hooks/exhaustive-deps
   }, []);

   async function handleRegister() {
      const username = usernameInput.trim();
      if (!USERNAME_RE.test(username)) {
         setRegisterError("Username must be 1–32 characters: letters, digits, . _ -");
         return;
      }
      setIsRegistering(true);
      setRegisterError(null);
      try {
         const peerId = crypto.randomUUID();
         await PeerApiHelper.registerOnline(username, peerId);
         saveSession(username, peerId);
         navigate(`/board/${username}`);
      } catch (ex) {
         setRegisterError(ex instanceof Error ? ex.message : "Registration failed");
      } finally {
         setIsRegistering(false);
      }
   }

   async function handleSearch() {
      setIsSearching(true);
      setSearchError(null);
      try {
         const results = await PeerApiHelper.searchPeers(searchQuery.trim() || undefined);
         setSearchResults(results);
         setSearchPerformed(true);
      } catch (ex) {
         setSearchError(ex instanceof Error ? ex.message : "Search failed");
      } finally {
         setIsSearching(false);
      }
   }

   async function handleGoOffline() {
      if (!session) return;
      try {
         await PeerApiHelper.markOffline(session.username);
      } catch {
         // best-effort
      }
      clearSession();
      setSession(null);
   }

   return (
      <div className="page landing-page">
         <header className="board-header">
            <span className="logo">Zente</span>
         </header>

         {session && (
            <div className="session-banner">
               <span>
                  Online as <strong>{session.username}</strong>
               </span>
               <div className="session-banner-actions">
                  <button className="btn-primary" onClick={() => navigate(`/board/${session.username}`)}>
                     My board
                  </button>
                  <button className="btn-secondary" onClick={handleGoOffline}>
                     Go offline
                  </button>
               </div>
            </div>
         )}

         <div className="landing-sections">
            {!session && (
               <section className="landing-section">
                  <h2 className="landing-section-title">Go online</h2>
                  <p className="landing-section-desc">Pick a username to start sharing files with others.</p>
                  <div className="input-row">
                     <input className="text-input" type="text" placeholder="username" value={usernameInput} maxLength={32} onChange={(e) => setUsernameInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleRegister()} />
                     <button className="btn-primary" onClick={handleRegister} disabled={isRegistering}>
                        {isRegistering ? "Connecting…" : "Go online"}
                     </button>
                  </div>
                  {registerError && <p className="error-text">{registerError}</p>}
               </section>
            )}

            <section className="landing-section">
               <h2 className="landing-section-title">Find peers</h2>
               <p className="landing-section-desc">Search online users to connect and exchange files.</p>
               <div className="input-row">
                  <input className="text-input" type="text" placeholder="Search username…" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleSearch()} />
                  <button className="btn-secondary" onClick={handleSearch} disabled={isSearching}>
                     {isSearching ? "Searching…" : "Search"}
                  </button>
               </div>
               {searchError && <p className="error-text">{searchError}</p>}
               {searchResults.length > 0 && (
                  <ul className="peer-list">
                     {searchResults.map((peer) => (
                        <li key={peer.id} className="peer-card">
                           <span className="online-dot" aria-label="online" />
                           <span className="peer-card-username">{peer.username}</span>
                           <button className="btn-download" onClick={() => navigate(`/join/${peer.peer_id}`)}>
                              Connect
                           </button>
                        </li>
                     ))}
                  </ul>
               )}
               {searchPerformed && !isSearching && searchResults.length === 0 && !searchError && <p className="board-empty">No peers online{searchQuery.trim() ? ` matching "${searchQuery.trim()}"` : ""}</p>}
            </section>
         </div>
      </div>
   );
}
