/**
 * Cloudflare Pages Function — repo path MUST be: functions/api/debug.js
 *
 * Visit /api/debug to see what the server can actually see.
 * Safe to delete once the leaderboard works.
 */
export async function onRequestGet({ env }) {
  const cs = env.DATABASE_URL || "";
  let host = null;
  try { host = cs ? new URL(cs).hostname : null; } catch (e) {}
  return new Response(JSON.stringify({
    version: "pages-http-v1",
    hasDatabaseUrl: !!cs,
    length: cs.length,
    host,
    isPooled: cs.includes("-pooler"),
    bindings: Object.keys(env),
  }), { headers: { "Content-Type": "application/json" } });
}
