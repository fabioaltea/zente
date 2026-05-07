import pg from "pg";

const { Pool } = pg;

export const pool = new Pool({
  connectionString: process.env["DATABASE_URL"],
  ssl: process.env["DB_SSL"] !== "false" ? { rejectUnauthorized: false } : false,
  max: 10,
});

export async function migrate(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS peers (
      id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      username   TEXT        UNIQUE NOT NULL,
      peer_id    TEXT        NOT NULL,
      is_online  BOOLEAN     NOT NULL DEFAULT false,
      last_seen  TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS peers_username_lower_idx
      ON peers (lower(username));

    CREATE INDEX IF NOT EXISTS peers_online_idx
      ON peers (is_online, last_seen DESC)
      WHERE is_online = true;
  `);
}
