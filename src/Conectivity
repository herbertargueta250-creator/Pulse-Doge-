/**
 * Worker entrypoint — src/index.js
 *
 * Serves the leaderboard API at /api/scores and hands everything else
 * to the static asset handler (your index.html).
 *
 * Deploy with:  npx wrangler deploy
 */

import { neon } from "@neondatabase/serverless";

const JSON_HEADERS = {
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
};

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });

const VALID_CHARACTERS = ["orb", "dash", "hopper", "phase"];

async function getScores(env) {
  const sql = neon(env.DATABASE_URL);
  const rows = await sql`
    select username, score, character
    from scores
    order by score desc, created_at asc
    limit 20
  `;
  return json(rows);
}

async function postScore(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  // Validate server-side — never trust the client.
  const username = String(body.username ?? body.name ?? "").trim().slice(0, 16);
  const score = Math.floor(Number(body.score));
  const character = VALID_CHARACTERS.includes(body.character) ? body.character : null;

  if (!username) return json({ error: "Name is required" }, 400);
  if (!Number.isFinite(score) || score < 0 || score >= 10_000_000) {
    return json({ error: "Score out of range" }, 400);
  }

  const sql = neon(env.DATABASE_URL);
  await sql`
    insert into scores (username, score, character)
    values (${username}, ${score}, ${character})
  `;
  return json({ ok: true }, 201);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/scores") {
      if (!env.DATABASE_URL) {
        return json({ error: "DATABASE_URL is not configured" }, 500);
      }
      try {
        if (request.method === "GET")  return await getScores(env);
        if (request.method === "POST") return await postScore(request, env);
        return json({ error: "Method not allowed" }, 405);
      } catch (err) {
        console.error("leaderboard error:", err);
        return json({ error: "Database request failed" }, 500);
      }
    }

    // Everything else: serve the static site.
    return env.ASSETS.fetch(request);
  },
};
