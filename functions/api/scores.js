/**
 * Cloudflare Pages Function — repo path MUST be: functions/api/scores.js
 *
 * The folder path becomes the URL, so this file answers /api/scores.
 *
 * No npm packages: talks to Neon's HTTP SQL endpoint with plain fetch(),
 * so the build cannot fail on a missing dependency.
 *
 * Needs the DATABASE_URL secret (Neon POOLED connection string), set in
 * Cloudflare -> your Pages project -> Settings -> Variables and Secrets.
 */

const JSON_HEADERS = {
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
};

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });

const VALID_CHARACTERS = ["orb", "dash", "hopper", "phase"];

/** Run one parameterised statement against Neon over HTTP. */
async function runSql(connectionString, query, params = []) {
  const host = new URL(connectionString).hostname;
  const res = await fetch(`https://${host}/sql`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Neon-Connection-String": connectionString,
      "Neon-Raw-Text-Output": "false",
      "Neon-Array-Mode": "false",
    },
    body: JSON.stringify({ query, params }),
  });

  const text = await res.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Neon returned non-JSON (HTTP ${res.status}): ${text.slice(0, 200)}`);
  }
  if (!res.ok) {
    throw new Error(data.message || data.error || `Neon HTTP ${res.status}`);
  }
  return data.rows || [];
}

/* GET /api/scores  ->  top 20 */
export async function onRequestGet({ env }) {
  if (!env.DATABASE_URL) {
    return json({
      error: "DATABASE_URL is not configured",
      bindings: Object.keys(env),
    }, 500);
  }
  try {
    // "character" is a reserved word in Postgres, so it must stay quoted
    const rows = await runSql(
      env.DATABASE_URL,
      `select username, score, "character"
         from scores
        order by score desc, created_at asc
        limit 20`
    );
    return json(rows);
  } catch (err) {
    console.error("leaderboard read failed:", err);
    return json({
      error: "Database request failed",
      detail: String(err && err.message ? err.message : err),
    }, 500);
  }
}

/* POST /api/scores  ->  save one run */
export async function onRequestPost({ request, env }) {
  if (!env.DATABASE_URL) {
    return json({ error: "DATABASE_URL is not configured" }, 500);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const username = String(body.username ?? body.name ?? "").trim().slice(0, 16);
  const score = Math.floor(Number(body.score));
  const character = VALID_CHARACTERS.includes(body.character) ? body.character : null;

  if (!username) return json({ error: "Name is required" }, 400);
  if (!Number.isFinite(score) || score < 0 || score >= 10000000) {
    return json({ error: "Score out of range" }, 400);
  }

  try {
    await runSql(
      env.DATABASE_URL,
      `insert into scores (username, score, "character")
       values ($1, $2, $3)`,
      [username, score, character]
    );
    return json({ ok: true }, 201);
  } catch (err) {
    console.error("score insert failed:", err);
    return json({
      error: "Failed to save score",
      detail: String(err && err.message ? err.message : err),
    }, 500);
  }
}
