const METERED_APP = import.meta.env.VITE_METERED_APP_NAME as string | undefined;
const METERED_KEY = import.meta.env.VITE_METERED_API_KEY as string | undefined;

const FALLBACK: RTCIceServer[] = [
   { urls: "stun:stun.l.google.com:19302" },
];

export async function getIceServers(): Promise<RTCIceServer[]> {
   if (!METERED_APP || !METERED_KEY) return FALLBACK;
   try {
      const res = await fetch(
         `https://${METERED_APP}.metered.live/api/v1/turn/credentials?apiKey=${METERED_KEY}`,
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const servers = await res.json() as RTCIceServer[];
      return servers.length ? servers : FALLBACK;
   } catch (ex) {
      console.warn("[ICE] failed to fetch TURN credentials, falling back to STUN only", ex);
      return FALLBACK;
   }
}
