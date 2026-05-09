import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { PeerApiHelper } from "../services/PeerApiHelper";
import { saveSession, loadSession } from "../services/session";
import { Button, Card, Input } from "../components/ui";

const USERNAME_RE = /^[\w.-]{1,32}$/;

export default function Login() {
   const navigate = useNavigate();
   const [username, setUsername] = useState("");
   const [error, setError] = useState<string | null>(null);
   const [loading, setLoading] = useState(false);

   useEffect(() => {
      const session = loadSession();
      if (session) navigate("/feed", { replace: true });
   }, [navigate]);

   async function handleLogin() {
      const trimmed = username.trim();
      if (!USERNAME_RE.test(trimmed)) {
         setError("1–32 characters: letters, digits, . _ -");
         return;
      }
      setLoading(true);
      setError(null);
      try {
         const peerId = crypto.randomUUID();
         await PeerApiHelper.registerOnline(trimmed, peerId);
         saveSession(trimmed, peerId);
         navigate("/feed");
      } catch (ex) {
         setError(ex instanceof Error ? ex.message : "Failed to go online");
      } finally {
         setLoading(false);
      }
   }

   return (
      <div className="login-page">
         <Card className="login-card">
            <div className="login-logo">Zente</div>
            <p className="login-tagline">Share files with anyone, instantly.</p>
            <Input
               placeholder="username"
               value={username}
               onChange={(e) => setUsername(e.target.value)}
               onKeyDown={(e) => e.key === "Enter" && handleLogin()}
               maxLength={32}
               autoFocus
               error={error ?? undefined}
            />
            <Button variant="primary" loading={loading} onClick={handleLogin} style={{ width: "100%" }}>
               {loading ? "Connecting…" : "Go online"}
            </Button>
         </Card>
      </div>
   );
}
