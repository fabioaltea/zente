import { pool } from "./db.js";

export interface Peer {
  id: string;
  username: string;
  peer_id: string;
  is_online: boolean;
  last_seen: string;
}

export async function upsertOnline(username: string, peerId: string): Promise<Peer> {
  const { rows } = await pool.query<Peer>(
    `INSERT INTO peers (username, peer_id, is_online, last_seen)
     VALUES ($1, $2, true, now())
     ON CONFLICT (username) DO UPDATE
       SET peer_id   = EXCLUDED.peer_id,
           is_online = true,
           last_seen = now()
     RETURNING id, username, peer_id, is_online, last_seen`,
    [username, peerId],
  );
  return rows[0]!;
}

export async function markOffline(username: string): Promise<void> {
  await pool.query(
    `UPDATE peers SET is_online = false, last_seen = now() WHERE username = $1`,
    [username],
  );
}

export async function searchOnline(q: string, limit = 20): Promise<Peer[]> {
  const { rows } = await pool.query<Peer>(
    `SELECT id, username, peer_id, is_online, last_seen
     FROM peers
     WHERE is_online = true
       AND lower(username) LIKE lower($1)
     ORDER BY last_seen DESC
     LIMIT $2`,
    [`%${q}%`, limit],
  );
  return rows;
}

// Expire peers not seen in 5 min (call periodically or from server startup)
export async function expireStale(): Promise<void> {
  await pool.query(
    `UPDATE peers SET is_online = false
     WHERE is_online = true AND last_seen < now() - INTERVAL '5 minutes'`,
  );
}
