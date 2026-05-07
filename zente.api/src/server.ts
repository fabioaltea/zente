import "dotenv/config";
import Fastify from "fastify";
import cors from "@fastify/cors";
import { migrate, pool } from "./db.js";
import { upsertOnline, markOffline, searchOnline, expireStale } from "./peers.js";

const PORT = Number(process.env["PORT"] ?? 3001);
const ORIGIN = process.env["CORS_ORIGIN"] ?? "*";

const app = Fastify({ logger: true });

await app.register(cors, { origin: ORIGIN });

// ── Health ────────────────────────────────────────────────────────────────────

app.get("/health", async () => ({ status: "ok" }));

// ── Peers ─────────────────────────────────────────────────────────────────────

app.post<{ Body: { username: string; peerId: string } }>(
  "/peers/online",
  {
    schema: {
      body: {
        type: "object",
        required: ["username", "peerId"],
        properties: {
          username: { type: "string", minLength: 1, maxLength: 32, pattern: "^[\\w.-]+$" },
          peerId:   { type: "string", minLength: 1, maxLength: 128 },
        },
        additionalProperties: false,
      },
    },
  },
  async (req) => {
    const peer = await upsertOnline(req.body.username, req.body.peerId);
    return peer;
  },
);

app.post<{ Body: { username: string } }>(
  "/peers/offline",
  {
    schema: {
      body: {
        type: "object",
        required: ["username"],
        properties: {
          username: { type: "string", minLength: 1, maxLength: 32 },
        },
        additionalProperties: false,
      },
    },
  },
  async (req, reply) => {
    await markOffline(req.body.username);
    return reply.status(204).send();
  },
);

app.get<{ Querystring: { q?: string } }>(
  "/peers",
  {
    schema: {
      querystring: {
        type: "object",
        properties: {
          q: { type: "string", maxLength: 64 },
        },
      },
    },
  },
  async (req) => {
    const q = req.query.q?.trim() ?? "";
    const peers = await searchOnline(q);
    return peers;
  },
);

// ── Boot ──────────────────────────────────────────────────────────────────────

await migrate();
app.log.info("DB migrated");

// Expire stale peers every minute
setInterval(() => void expireStale(), 60_000);

await app.listen({ port: PORT, host: "0.0.0.0" });
