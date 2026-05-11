import { useState } from "react";
import { Button, Card, Input } from "../components/ui";

const USERNAME_RE = /^[\w.-]{1,32}$/;

interface LoginProps {
   onLogin: (username: string) => Promise<void>;
}

export default function Login({ onLogin }: LoginProps) {
   const [username, setUsername] = useState("");
   const [error, setError] = useState<string | null>(null);
   const [loading, setLoading] = useState(false);

   async function handleSubmit() {
      const trimmed = username.trim();
      if (!USERNAME_RE.test(trimmed)) {
         setError("1–32 characters: letters, digits, . _ -");
         return;
      }
      setLoading(true);
      setError(null);
      try {
         await onLogin(trimmed);
      } catch (ex) {
         setError(ex instanceof Error ? ex.message : "Failed to go online");
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
               onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
               maxLength={32}
               autoFocus
               error={error ?? undefined}
            />
            <Button variant="primary" loading={loading} onClick={handleSubmit} style={{ width: "100%" }}>
               {loading ? "Connecting…" : "Go online"}
            </Button>
         </Card>
      </div>
   );
}
