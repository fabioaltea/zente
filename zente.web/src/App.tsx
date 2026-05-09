import { Routes, Route, Navigate } from "react-router-dom";
import Feed from "./pages/Feed";
import Profile from "./pages/Profile";
import Login from "./pages/Login";
import { loadSession } from "./services/session";

function RootRedirect() {
   const session = loadSession();
   return session ? <Navigate to="/feed" replace /> : <Navigate to="/login" replace />;
}

export default function App() {
   return (
      <Routes>
         <Route path="/" element={<RootRedirect />} />
         <Route path="/login" element={<Login />} />
         <Route path="/feed" element={<Feed />} />
         <Route path="/feed/:username" element={<Profile />} />
      </Routes>
   );
}
