const METERED_KEY = import.meta.env.VITE_METERED_API_KEY as string | undefined;
const METERED_APP_RAW = import.meta.env.VITE_METERED_APP_NAME as string | undefined;
const METERED_APP = METERED_APP_RAW?.replace(/\.metered\.live$/, "");

const FALLBACK: RTCIceServer[] = [
   { urls: "stun:stun.l.google.com:19302" },
];

function summarize(servers: RTCIceServer[]): string {
   const counts = { stun: 0, turn: 0, turns: 0, other: 0 };
   servers.forEach((s) => {
      const urls = Array.isArray(s.urls) ? s.urls : [s.urls];
      urls.forEach((u) => {
         if (u.startsWith("turns:")) counts.turns++;
         else if (u.startsWith("turn:")) counts.turn++;
         else if (u.startsWith("stun:")) counts.stun++;
         else counts.other++;
      });
   });
   return `stun=${counts.stun} turn=${counts.turn} turns=${counts.turns} other=${counts.other}`;
}

export async function getIceServers(): Promise<RTCIceServer[]> {
   if (!METERED_APP || !METERED_KEY) {
      console.warn("[ICE] Metered env not set (VITE_METERED_APP_NAME / VITE_METERED_API_KEY) — using fallback STUN only");
      console.log(`[ICE] servers source=fallback ${summarize(FALLBACK)}`);
      return FALLBACK;
   }
   try {
      const url = `https://${METERED_APP}.metered.live/api/v1/turn/credentials?apiKey=${METERED_KEY}`;
      console.log(`[ICE] fetching Metered credentials from ${METERED_APP}.metered.live`);
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const servers = await res.json() as RTCIceServer[];
      if (!servers.length) {
         console.warn("[ICE] Metered returned empty list — using fallback");
         console.log(`[ICE] servers source=fallback ${summarize(FALLBACK)}`);
         return FALLBACK;
      }
      console.log(`[ICE] servers source=metered count=${servers.length} ${summarize(servers)}`);
      return servers;
   } catch (ex) {
      console.error("[ICE] Metered fetch failed, falling back to STUN only", ex);
      console.log(`[ICE] servers source=fallback ${summarize(FALLBACK)}`);
      return FALLBACK;
   }
}
