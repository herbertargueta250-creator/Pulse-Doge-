/**
 * Cloudflare Pages Function — repo path MUST be: functions/api/scores.js
 *
 * GET  /api/scores                      -> { top: [...50], total }
 * GET  /api/scores?score=133&name=Haar  -> also includes { you: {rank, ...} }
 * POST /api/scores                      -> saves a run, returns its rank
 *
 * No npm packages: talks to Neon's HTTP SQL endpoint with plain fetch().
 * Needs the DATABASE_URL secret (Neon POOLED connection string).
 */

const JSON_HEADERS = {
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
};

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });

const VALID_CHARACTERS = ["orb", "dash", "hopper", "phase"];

/** How many names the board shows. Raise freely — storage is not the limit. */
const BOARD_SIZE = 50;

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

/**
 * Where a score sits in the world.
 * rank = how many scores beat it, plus one.
 */
async function rankFor(connectionString, score) {
  const rows = await runSql(
    connectionString,
    `select
       (select count(*) from scores)                        as total,
       (select count(*) + 1 from scores where score > $1)   as rank`,
    [score]
  );
  const r = rows[0] || {};
  return { rank: Number(r.rank) || 1, total: Number(r.total) || 0 };
}

/* ---------------- GET ---------------- */
export async function onRequestGet({ request, env }) {
  if (!env.DATABASE_URL) {
    return json({
      error: "DATABASE_URL is not configured",
      bindings: Object.keys(env),
    }, 500);
  }

  try {
    // "character" is a reserved word in Postgres, so it must stay quoted
    const top = await runSql(
      env.DATABASE_URL,
      `select username, score, "character"
         from scores
        order by score desc, created_at asc
        limit ${BOARD_SIZE}`
    );

    const url = new URL(request.url);
    const askedScore = Number(url.searchParams.get("score"));
    const askedName = url.searchParams.get("name");

    let you = null;
    let total = top.length;

    if (Number.isFinite(askedScore) && askedScore > 0) {
      const r = await rankFor(env.DATABASE_URL, askedScore);
      total = r.total;
      you = { rank: r.rank, score: askedScore, username: askedName || "you" };
    } else {
      const r = await runSql(env.DATABASE_URL, `select count(*) as total from scores`);
      total = Number((r[0] || {}).total) || 0;
    }

    return json({ top, total, you });
  } catch (err) {
    console.error("leaderboard read failed:", err);
    return json({
      error: "Database request failed",
      detail: String(err && err.message ? err.message : err),
    }, 500);
  }
}

/* ---------------- POST ---------------- */
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
    // tell the player where that run landed
    const { rank, total } = await rankFor(env.DATABASE_URL, score);
    return json({ ok: true, rank, total }, 201);
  } catch (err) {
    console.error("score insert failed:", err);
    return json({
      error: "Failed to save score",
      detail: String(err && err.message ? err.message : err),
    }, 500);
  }
}
