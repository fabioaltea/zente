const SESSION_KEY = "zente_session";

export interface UserSession {
   username: string;
   peerId: string;
}

export function saveSession(username: string, peerId: string): void {
   try {
      localStorage.setItem(SESSION_KEY, JSON.stringify({ username, peerId }));
   } catch (ex) {
      console.error("[Session] saveSession failed", ex);
   }
}

export function loadSession(): UserSession | null {
   try {
      const raw = localStorage.getItem(SESSION_KEY);
      if (!raw) return null;
      return JSON.parse(raw) as UserSession;
   } catch (ex) {
      console.error("[Session] loadSession failed", ex);
      return null;
   }
}

export function clearSession(): void {
   try {
      localStorage.removeItem(SESSION_KEY);
   } catch (ex) {
      console.error("[Session] clearSession failed", ex);
   }
}
