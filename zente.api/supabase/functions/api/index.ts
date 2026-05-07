import { createClient } from "npm:@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  const url = new URL(req.url);
  const path = url.pathname;

  try {
    // POST .../peers/online
    if (req.method === "POST" && path.endsWith("/peers/online")) {
      const body = await req.json() as { username?: string; peerId?: string };
      if (!body.username || !body.peerId || !/^[\w.-]{1,32}$/.test(body.username)) {
        return json({ error: "invalid input" }, 400);
      }
      const { data, error } = await supabase
        .from("peers")
        .upsert(
          { username: body.username, peer_id: body.peerId, is_online: true, last_seen: new Date().toISOString() },
          { onConflict: "username" },
        )
        .select("id, username, peer_id, is_online, last_seen")
        .single();
      if (error) throw error;
      return json(data);
    }

    // POST .../peers/offline
    if (req.method === "POST" && path.endsWith("/peers/offline")) {
      const body = await req.json() as { username?: string };
      if (!body.username) return json({ error: "invalid input" }, 400);
      const { error } = await supabase
        .from("peers")
        .update({ is_online: false, last_seen: new Date().toISOString() })
        .eq("username", body.username);
      if (error) throw error;
      return new Response(null, { status: 204, headers: CORS });
    }

    // GET .../peers?q=
    if (req.method === "GET" && path.endsWith("/peers")) {
      const q = url.searchParams.get("q")?.trim() ?? "";
      // expire stale inline: peers not seen in 5 min treated as offline
      const staleThreshold = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      let query = supabase
        .from("peers")
        .select("id, username, peer_id, last_seen")
        .eq("is_online", true)
        .gte("last_seen", staleThreshold)
        .order("last_seen", { ascending: false })
        .limit(20);
      if (q) query = query.ilike("username", `%${q}%`);
      const { data, error } = await query;
      if (error) throw error;
      return json(data ?? []);
    }

    return json({ error: "not found" }, 404);
  } catch (err) {
    console.error(err);
    return json({ error: "internal error" }, 500);
  }
});
