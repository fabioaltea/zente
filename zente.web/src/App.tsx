import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import Feed from "./pages/Feed";
import Search from "./pages/Search";
import Profile from "./pages/Profile";
import Login from "./pages/Login";
import { AppNav } from "./components/AppNav";
import { HostProvider } from "./context/HostContext";
import { loadSession } from "./services/session";

function RootRedirect() {
   const session = loadSession();
   return session ? <Navigate to="/feed" replace /> : <Navigate to="/login" replace />;
}

function Layout({ children }: { children: React.ReactNode }) {
   const location = useLocation();
   const session = loadSession();
   const showNav = session && location.pathname !== "/login";
   return (
      <>
         {showNav && <AppNav />}
         {children}
      </>
   );
}

export default function App() {
   return (
      <HostProvider>
         <Routes>
            <Route path="/" element={<Layout><RootRedirect /></Layout>} />
            <Route path="/login" element={<Login />} />
            <Route path="/feed" element={<Layout><Feed /></Layout>} />
            <Route path="/feed/:username" element={<Layout><Profile /></Layout>} />
            <Route path="/search" element={<Layout><Search /></Layout>} />
         </Routes>
      </HostProvider>
   );
}
