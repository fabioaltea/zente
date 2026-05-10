import { useState, useRef, useCallback, useEffect } from "react";
import { NavLink, Link, useNavigate } from "react-router-dom";
import { loadSession } from "../services/session";
import { useLogout } from "../hooks/useLogout";

function IconHome() {
   return (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
         <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
         <polyline points="9 22 9 12 15 12 15 22" />
      </svg>
   );
}

function IconSearch() {
   return (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
         <circle cx="11" cy="11" r="8" />
         <line x1="21" y1="21" x2="16.65" y2="16.65" />
      </svg>
   );
}

function IconPerson() {
   return (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
         <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
         <circle cx="12" cy="7" r="4" />
      </svg>
   );
}

interface ContextMenuProps {
   anchorRect: DOMRect;
   onLogout: () => void;
   onClose: () => void;
}

function ContextMenu({ anchorRect, onLogout, onClose }: ContextMenuProps) {
   const menuRef = useRef<HTMLDivElement>(null);

   useEffect(() => {
      function onPointerDown(e: PointerEvent) {
         if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose();
      }
      document.addEventListener("pointerdown", onPointerDown);
      return () => document.removeEventListener("pointerdown", onPointerDown);
   }, [onClose]);

   // Position above anchor on mobile (bottom nav), below on desktop (top nav)
   const isBottomAnchor = anchorRect.top > window.innerHeight / 2;
   const style: React.CSSProperties = isBottomAnchor
      ? { bottom: window.innerHeight - anchorRect.top + 8, left: Math.max(8, anchorRect.left + anchorRect.width / 2 - 80) }
      : { top: anchorRect.bottom + 8, right: window.innerWidth - anchorRect.right };

   return (
      <div ref={menuRef} className="nav-context-menu" style={{ position: "fixed", ...style }}>
         <button className="nav-context-item nav-context-item--danger" onClick={onLogout}>
            Go offline
         </button>
      </div>
   );
}

function useLongPress(onLongPress: () => void, delay = 500) {
   const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
   const suppressed = useRef(false);

   const start = useCallback(() => {
      timer.current = setTimeout(() => {
         suppressed.current = true;
         onLongPress();
      }, delay);
   }, [onLongPress, delay]);

   const cancel = useCallback(() => {
      if (timer.current) { clearTimeout(timer.current); timer.current = null; }
   }, []);

   const handleClick = useCallback((e: React.MouseEvent) => {
      if (suppressed.current) { e.preventDefault(); suppressed.current = false; }
   }, []);

   return {
      onMouseDown: start,
      onMouseUp: cancel,
      onMouseLeave: cancel,
      onTouchStart: start,
      onTouchEnd: cancel,
      onTouchMove: cancel,
      onClick: handleClick,
   };
}

export function AppNav() {
   const session = loadSession();
   const logout = useLogout();
   const navigate = useNavigate();
   const [menuAnchor, setMenuAnchor] = useState<DOMRect | null>(null);

   if (!session) return null;

   const initials = session.username.slice(0, 2).toUpperCase();
   const profileHref = `/feed/${session.username}`;

   function openMenu(e: React.MouseEvent | React.TouchEvent) {
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      setMenuAnchor(rect);
   }

   const desktopLongPress = useLongPress((  ) => {
      const el = document.querySelector(".app-nav-profile") as HTMLElement | null;
      if (el) setMenuAnchor(el.getBoundingClientRect());
   });

   const mobileLongPress = useLongPress(() => {
      const el = document.querySelector(".app-tab--me") as HTMLElement | null;
      if (el) setMenuAnchor(el.getBoundingClientRect());
   });

   async function handleLogout() {
      setMenuAnchor(null);
      await logout();
   }

   return (
      <>
         {/* Desktop top navbar */}
         <header className="app-header">
            <Link to="/feed" className="logo app-header-logo">Zente</Link>
            <nav className="app-nav-links">
               <NavLink to="/feed" end className={({ isActive }) => `app-nav-link${isActive ? " app-nav-link--active" : ""}`}>
                  <IconHome />
               </NavLink>
               <NavLink to="/search" className={({ isActive }) => `app-nav-link${isActive ? " app-nav-link--active" : ""}`}>
                  <IconSearch />
               </NavLink>
               <Link
                  to={profileHref}
                  className="feed-profile-btn app-nav-profile"
                  {...desktopLongPress}
               >
                  <div className="feed-profile-avatar" data-initials={initials} />
                  <span className="feed-profile-username">{session.username}</span>
                  <span className="online-dot" aria-hidden />
               </Link>
            </nav>
         </header>

         {/* Mobile bottom tab bar */}
         <nav className="app-nav-mobile">
            <NavLink to="/feed" end className={({ isActive }) => `app-tab${isActive ? " app-tab--active" : ""}`}>
               <IconHome />
               <span className="app-tab-label">Feed</span>
            </NavLink>
            <NavLink to="/search" className={({ isActive }) => `app-tab${isActive ? " app-tab--active" : ""}`}>
               <IconSearch />
               <span className="app-tab-label">Search</span>
            </NavLink>
            <NavLink
               to={profileHref}
               className={({ isActive }) => `app-tab app-tab--me${isActive ? " app-tab--active" : ""}`}
               {...mobileLongPress}
            >
               <IconPerson />
               <span className="app-tab-label">Me</span>
            </NavLink>
         </nav>

         {menuAnchor && (
            <ContextMenu
               anchorRect={menuAnchor}
               onLogout={handleLogout}
               onClose={() => setMenuAnchor(null)}
            />
         )}
      </>
   );
}
