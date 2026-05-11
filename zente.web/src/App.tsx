import { useEffect } from "react";
import { Routes, Route, Navigate, useLocation, useParams, useNavigate } from "react-router-dom";
import Feed from "./pages/Feed";
import Search from "./pages/Search";
import OwnProfile from "./pages/OwnProfile";
import GuestProfile, { GuestStatus } from "./pages/GuestProfile";
import Login from "./pages/Login";
import { AppNav } from "./components/AppNav";
import { AppProvider, useApp } from "./context/AppContext";

function RootRedirect() {
   const { status } = useApp();
   if (status === "no-session") return <Navigate to="/login" replace />;
   return <Navigate to="/feed" replace />;
}

function Layout({ children }: { children: React.ReactNode }) {
   const { session, logout } = useApp();
   const location = useLocation();
   const showNav = !!session && location.pathname !== "/login";
   return (
      <>
         {showNav && <AppNav username={session!.username} onLogout={logout} />}
         {children}
      </>
   );
}

function AuthGuard({ children }: { children: React.ReactNode }) {
   const { status } = useApp();
   if (status === "no-session") return <Navigate to="/login" replace />;
   return <>{children}</>;
}

function LoginRoute() {
   const { login, status } = useApp();
   const navigate = useNavigate();
   useEffect(() => {
      if (status === "loading" || status === "ready") navigate("/feed", { replace: true });
   }, [status, navigate]);
   return <Login onLogin={login} />;
}

function FeedRoute() {
   const { remoteFiles, refreshPeers, status } = useApp();
   return <Feed items={remoteFiles} onRefresh={refreshPeers} loading={status === "loading"} />;
}

function ProfileRoute() {
   const { username } = useParams<{ username: string }>();
   const app = useApp();
   if (!username) return null;

   const isOwn = app.session?.username === username;
   if (isOwn) {
      return (
         <OwnProfile
            username={username}
            files={app.localFiles}
            viewerCount={app.viewerCount}
            pendingCount={app.pendingCount}
            uploadQueueFirst={app.uploadQueue[0] ?? null}
            getBlobUrl={app.getLocalBlobUrl}
            onQueueFiles={app.queueFiles}
            onConfirmUpload={app.confirmUpload}
            onCancelUpload={app.cancelUpload}
            onRemoveFile={app.removeLocalFile}
         />
      );
   }

   const onlinePeer = app.onlinePeers.find((p) => p.username === username);
   const items = app.remoteFiles.filter((r) => r.username === username);
   const guestStatus: GuestStatus =
      !onlinePeer ? "offline" :
      items.length === 0 ? "connecting" :
      "connected";

   return (
      <GuestProfile
         username={username}
         items={items}
         status={guestStatus}
         canDownload={!!onlinePeer}
         onRequestFile={(fid) => { if (onlinePeer) app.requestRemoteFile(onlinePeer.peer_id, fid); }}
         onRetry={app.refreshPeers}
      />
   );
}

function SearchRoute() {
   const { onlinePeers, session } = useApp();
   return <Search peers={onlinePeers} currentUsername={session?.username ?? ""} />;
}

export default function App() {
   return (
      <AppProvider>
         <Routes>
            <Route path="/" element={<Layout><RootRedirect /></Layout>} />
            <Route path="/login" element={<LoginRoute />} />
            <Route path="/feed" element={<Layout><AuthGuard><FeedRoute /></AuthGuard></Layout>} />
            <Route path="/feed/:username" element={<Layout><AuthGuard><ProfileRoute /></AuthGuard></Layout>} />
            <Route path="/search" element={<Layout><AuthGuard><SearchRoute /></AuthGuard></Layout>} />
         </Routes>
      </AppProvider>
   );
}
