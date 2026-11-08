const cors = (request) => {
  const origin = request.headers.get("Origin") || "";
  const allowed = new Set(["https://tabi-log.pages.dev", "http://localhost:8788", "http://127.0.0.1:8788"]);
  return {
    "access-control-allow-origin": allowed.has(origin) ? origin : "https://tabi-log.pages.dev",
    "access-control-allow-methods": "GET,POST,DELETE,OPTIONS",
    "access-control-allow-headers": "content-type,authorization",
    "vary": "Origin"
  };
};
const json = (request, data, status = 200, extra = {}) => new Response(JSON.stringify(data), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", "x-content-type-options": "nosniff", "cache-control": "no-store", ...cors(request), ...extra }
});
const bad = (request, error, status = 400) => json(request, { ok: false, error }, status);
const uuid = () => crypto.randomUUID();
const randomToken = (bytes = 32) => {
  const data = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...data)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
};
const sha256 = async (value) => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map(x => x.toString(16).padStart(2, "0")).join("");
};
const cleanText = (value, max) => String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max);
const cleanList = (value, maxItems, maxLength) => Array.isArray(value)
  ? value.slice(0, maxItems).map(x => cleanText(x, maxLength)).filter(Boolean)
  : [];
function cleanShare(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const trip = {
    title: cleanText(input.title, 80),
    area: cleanText(input.area, 80),
    date: cleanText(input.date, 30),
    description: cleanText(input.description, 500),
    stops: cleanList(input.stops, 30, 100),
    visited: cleanList(input.visited, 30, 100),
    entries: Array.isArray(input.entries) ? input.entries.slice(0, 40).map(x => ({
      title: cleanText(x?.title, 80),
      place: cleanText(x?.place, 100),
      story: cleanText(x?.story, 600),
      date: cleanText(x?.date, 30)
    })).filter(x => x.title || x.place || x.story) : [],
    author: cleanText(input.author, 40)
  };
  if (!trip.title || !trip.area) return null;
  return trip;
}
async function userFrom(request, env) {
  if (!env.AUTH_VALIDATE_URL) return null;
  const auth = request.headers.get("authorization");
  if (!auth) return null;
  const r = await fetch(env.AUTH_VALIDATE_URL, { headers: { authorization: auth } });
  if (!r.ok) return null;
  const d = await r.json();
  return d?.sub ? { id: d.sub, name: d.name || "Traveler" } : null;
}
async function createShare(request, env) {
  if (!env.DB) return bad(request, "共有APIのデータベースが未設定です", 503);
  const length = Number(request.headers.get("content-length") || 0);
  if (length > 20000) return bad(request, "記録が大きすぎます。文章や立ち寄り先を減らしてください", 413);
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > 20000) return bad(request, "記録が大きすぎます。文章や立ち寄り先を減らしてください", 413);
  let body;
  try { body = JSON.parse(raw); } catch { return bad(request, "JSON形式を確認してください"); }
  const payload = cleanShare(body?.trip);
  if (!payload) return bad(request, "旅のタイトルとエリアは必須です");
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const ipHash = await sha256(ip + (env.RATE_LIMIT_SALT || "tabi-log-rate-v1"));
  const now = Math.floor(Date.now() / 1000);
  const windowStart = Math.floor(now / 600) * 600;
  await env.DB.prepare("INSERT INTO share_rate_limits(ip_hash, window_start, hits) VALUES(?,?,1) ON CONFLICT(ip_hash,window_start) DO UPDATE SET hits=hits+1").bind(ipHash, windowStart).run();
  const rate = await env.DB.prepare("SELECT hits FROM share_rate_limits WHERE ip_hash=? AND window_start=?").bind(ipHash, windowStart).first();
  if ((rate?.hits || 0) > 8) return bad(request, "共有リンクの作成回数が上限に達しました。10分ほど待ってから再度お試しください", 429);
  // Cleanup runs only after the caller passes the rate limit.
  await env.DB.prepare("DELETE FROM share_links WHERE expires_at <= ? OR revoked_at IS NOT NULL").bind(now).run();
  await env.DB.prepare("DELETE FROM share_rate_limits WHERE window_start < ?").bind(now - 86400).run();
  const token = randomToken();
  const revokeKey = randomToken();
  const tokenHash = await sha256(token);
  const revokeHash = await sha256(revokeKey);
  const id = uuid();
  const expiresAt = now + 60 * 60 * 24 * 365;
  await env.DB.prepare("INSERT INTO share_links(id,token_hash,revoke_hash,payload_json,created_at,expires_at) VALUES(?,?,?,?,?,?)")
    .bind(id, tokenHash, revokeHash, JSON.stringify(payload), now, expiresAt).run();
  return json(request, {
    ok: true,
    url: "https://tabi-log.pages.dev/share.html?token=" + token,
    revokeKey,
    expiresAt
  }, 201, { "cache-control": "no-store" });
}
async function readShare(request, env, token) {
  if (!env.DB || !/^[A-Za-z0-9_-]{40,50}$/.test(token)) return bad(request, "共有記録が見つかりません", 404);
  const tokenHash = await sha256(token);
  const row = await env.DB.prepare("SELECT payload_json,expires_at,revoked_at FROM share_links WHERE token_hash=?").bind(tokenHash).first();
  const now = Math.floor(Date.now() / 1000);
  if (!row || row.revoked_at || row.expires_at < now) return bad(request, "共有記録が見つからないか、公開期間が終了しています", 404);
  let trip;
  try { trip = JSON.parse(row.payload_json); } catch { return bad(request, "共有記録を読み込めません", 500); }
  return json(request, { ok: true, trip, expiresAt: row.expires_at }, 200, { "cache-control": "no-store" });
}
async function revokeShare(request, env, token) {
  if (!env.DB || !/^[A-Za-z0-9_-]{40,50}$/.test(token)) return bad(request, "共有記録が見つかりません", 404);
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > 1024) return bad(request, "リクエストが大きすぎます", 413);
  let body;
  try { body = JSON.parse(raw); } catch { return bad(request, "無効化キーが必要です"); }
  if (!body || typeof body.revokeKey !== "string" || !/^[A-Za-z0-9_-]{40,50}$/.test(body.revokeKey)) return bad(request, "無効化キーが正しくありません", 403);
  const tokenHash = await sha256(token);
  const revokeHash = await sha256(body.revokeKey);
  const row = await env.DB.prepare("SELECT id,revoke_hash FROM share_links WHERE token_hash=?").bind(tokenHash).first();
  if (!row || row.revoke_hash !== revokeHash) return bad(request, "無効化キーが正しくありません", 403);
  await env.DB.prepare("UPDATE share_links SET revoked_at=? WHERE id=?").bind(Math.floor(Date.now() / 1000), row.id).run();
  return json(request, { ok: true });
}
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    if (request.method === "OPTIONS") return new Response(null, { headers: cors(request) });
    if (path === "/api/health" && request.method === "GET") return json(request, { ok: true, service: "tabi-log-api", version: "1.1-share-links" });
    if (path === "/api/shares" && request.method === "POST") return createShare(request, env);
    const shareMatch = path.match(/^\/api\/shares\/([A-Za-z0-9_-]+)$/);
    if (shareMatch && request.method === "GET") return readShare(request, env, shareMatch[1]);
    if (shareMatch && request.method === "DELETE") return revokeShare(request, env, shareMatch[1]);
    if (path === "/api/feed" && request.method === "GET") {
      if (!env.DB) return bad(request, "データベースが未設定です", 503);
      const r = await env.DB.prepare("SELECT p.id,p.title,p.story,p.place_name,p.media_type,p.created_at,u.display_name FROM posts p JOIN users u ON u.id=p.user_id WHERE p.visibility='public' ORDER BY p.created_at DESC LIMIT 40").all();
      return json(request, { ok: true, items: r.results || [] });
    }
    const user = await userFrom(request, env);
    if (!user) return bad(request, "ログイン機能が未接続です。認証プロバイダーを設定してください。", 401);
    await env.DB.prepare("INSERT OR IGNORE INTO users(id,display_name) VALUES(?,?)").bind(user.id, user.name).run();
    if (path === "/api/trips" && request.method === "POST") {
      const b = await request.json();
      if (!b.title || !b.area) return bad(request, "title と area は必須です");
      const id = uuid();
      await env.DB.prepare("INSERT INTO trips(id,user_id,title,area,description,visibility,source,external_plan_id) VALUES(?,?,?,?,?,?,?,?)").bind(id, user.id, b.title, b.area, b.description || "", b.visibility || "private", b.source || "native", b.external_plan_id || null).run();
      return json(request, { ok: true, id }, 201);
    }
    if (path === "/api/posts" && request.method === "POST") {
      const b = await request.json();
      if (!b.title || !b.story || !b.place_name) return bad(request, "title、story、place_name は必須です");
      const id = uuid();
      await env.DB.prepare("INSERT INTO posts(id,user_id,trip_id,title,story,place_name,media_key,media_type,visibility,latitude,longitude,location_precision) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)").bind(id, user.id, b.trip_id || null, b.title, b.story, b.place_name, b.media_key || null, b.media_type || null, b.visibility || "private", null, null, "hidden").run();
      return json(request, { ok: true, id }, 201);
    }
    if (path === "/api/aileron/import" && request.method === "POST") {
      if (env.AILERON_IMPORT_ENABLED !== "true") return bad(request, "Aileron連携は現在無効です", 403);
      const b = await request.json();
      if (!b.external_plan_id || !b.title || !b.area) return bad(request, "external_plan_id、title、area は必須です");
      const old = await env.DB.prepare("SELECT id FROM trips WHERE source='aileron' AND external_plan_id=?").bind(b.external_plan_id).first();
      if (old) return json(request, { ok: true, id: old.id, duplicate: true });
      const id = uuid();
      await env.DB.prepare("INSERT INTO trips(id,user_id,title,area,description,visibility,source,external_plan_id) VALUES(?,?,?,?,?,'private','aileron',?)").bind(id, user.id, b.title, b.area, b.description || "", b.external_plan_id).run();
      return json(request, { ok: true, id, duplicate: false }, 201);
    }
    return bad(request, "Not found", 404);
  }
};
