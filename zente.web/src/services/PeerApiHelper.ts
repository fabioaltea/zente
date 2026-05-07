const API_BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? "https://vzujgvxixkimcltevogz.supabase.co/functions/v1/api";

export interface Peer {
   id: string;
   username: string;
   peer_id: string;
   last_seen: string;
}

interface ApiError {
   error: string;
}

async function parseResponse<T>(res: Response): Promise<T> {
   if (!res.ok) {
      const body: ApiError = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      throw new Error(body.error ?? `HTTP ${res.status}`);
   }
   return res.json() as Promise<T>;
}

export class PeerApiHelper {
   /**
    * Register the current user as online (upsert).
    * Call on board mount and after session creation.
    */
   static async registerOnline(username: string, peerId: string): Promise<Peer> {
      try {
         const res = await fetch(`${API_BASE}/peers/online`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username, peerId }),
         });
         return parseResponse<Peer>(res);
      } catch (ex) {
         console.error("[PeerApi] registerOnline failed", ex);
         throw ex;
      }
   }

   /**
    * Mark the current user as offline.
    * Call on board unmount / go-offline action.
    * Swallows errors intentionally (best-effort cleanup).
    */
   static async markOffline(username: string): Promise<void> {
      try {
         await fetch(`${API_BASE}/peers/offline`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username }),
         });
      } catch (ex) {
         console.error("[PeerApi] markOffline failed", ex);
      }
   }

   /**
    * Search online peers by partial username match.
    * Pass undefined or empty string to list all online peers.
    */
   static async searchPeers(query?: string): Promise<Peer[]> {
      try {
         const url = new URL(`${API_BASE}/peers`);
         if (query?.trim()) url.searchParams.set("q", query.trim());
         const res = await fetch(url.toString());
         return parseResponse<Peer[]>(res);
      } catch (ex) {
         console.error("[PeerApi] searchPeers failed", ex);
         throw ex;
      }
   }
}
