const ALLOWED_ORIGINS = new Set(["https://tabi-log.pages.dev", "http://localhost:8788", "http://127.0.0.1:8788"]);
const cors = (request) => {
  const origin = request.headers.get("Origin") || "";
  const headers = {
    "access-control-allow-methods": "GET,POST,DELETE,OPTIONS",
    "access-control-allow-headers": "content-type,authorization",
    "vary": "Origin"
  };
  if (ALLOWED_ORIGINS.has(origin)) headers["access-control-allow-origin"] = origin;
  return headers;
};
const json = (request, data, status = 200, extra = {}) => new Response(JSON.stringify(data), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", "x-content-type-options": "nosniff", "cache-control": "no-store", ...cors(request), ...extra }
});
const bad = (request, error, status = 400) => json(request, { ok: false, error }, status);
async function readJson(request, maxBytes = 20000) {
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > maxBytes) return { error: bad(request, "リクエストが大きすぎます", 413) };
  try {
    const data = JSON.parse(raw);
    if (!data || typeof data !== "object" || Array.isArray(data)) return { error: bad(request, "JSONオブジェクトを送信してください") };
    return { data };
  } catch {
    return { error: bad(request, "JSON形式を確認してください") };
  }
}
const validVisibility = value => ["private", "followers", "public"].includes(value) ? value : null;
const validDate = value => !value || (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) ? (value || null) : undefined;
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
function decodeBase64Url(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}
let googleJwksCache = { keys: [], expiresAt: 0 };
async function googleSigningKeys() {
  if (googleJwksCache.expiresAt > Date.now() && googleJwksCache.keys.length) return googleJwksCache.keys;
  const response = await fetch("https://www.googleapis.com/oauth2/v3/certs", { headers: { "accept": "application/json" } });
  if (!response.ok) throw new Error("Google signing keys unavailable");
  const data = await response.json();
  const cacheControl = response.headers.get("cache-control") || "";
  const maxAge = Number((cacheControl.match(/max-age=(\d+)/i) || [])[1] || 3600);
  googleJwksCache = { keys: Array.isArray(data.keys) ? data.keys : [], expiresAt: Date.now() + Math.min(Math.max(maxAge, 60), 86400) * 1000 };
  return googleJwksCache.keys;
}
async function verifyGoogleIdToken(token, env) {
  if (!env.GOOGLE_CLIENT_ID || typeof token !== "string" || token.length > 10000) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const header = JSON.parse(new TextDecoder().decode(decodeBase64Url(parts[0])));
    const claims = JSON.parse(new TextDecoder().decode(decodeBase64Url(parts[1])));
    if (header.alg !== "RS256" || typeof header.kid !== "string") return null;
    let jwk = (await googleSigningKeys()).find(key => key.kid === header.kid && key.kty === "RSA" && key.use === "sig");
    if (!jwk) {
      googleJwksCache.expiresAt = 0;
      jwk = (await googleSigningKeys()).find(key => key.kid === header.kid && key.kty === "RSA" && key.use === "sig");
    }
    if (!jwk) return null;
    const publicKey = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    const signed = new TextEncoder().encode(parts[0] + "." + parts[1]);
    const validSignature = await crypto.subtle.verify({ name: "RSASSA-PKCS1-v1_5" }, publicKey, decodeBase64Url(parts[2]), signed);
    if (!validSignature) return null;
    const now = Math.floor(Date.now() / 1000);
    const audienceValid = claims.aud === env.GOOGLE_CLIENT_ID || (Array.isArray(claims.aud) && claims.aud.includes(env.GOOGLE_CLIENT_ID));
    if (!audienceValid || !["accounts.google.com", "https://accounts.google.com"].includes(claims.iss)) return null;
    if (!Number.isFinite(claims.exp) || claims.exp <= now || (claims.iat && claims.iat > now + 300)) return null;
    if (typeof claims.sub !== "string" || !claims.sub || claims.sub.length > 128) return null;
    return { id: claims.sub, name: cleanText(claims.name || "Traveler", 40) || "Traveler" };
  } catch {
    return null;
  }
}
function bearerToken(request) {
  const auth = request.headers.get("authorization") || "";
  const match = auth.match(/^Bearer\s+(\S+)$/i);
  return match ? match[1] : null;
}
async function userFrom(request, env) {
  const origin = request.headers.get("Origin") || "";
  const token = bearerToken(request);
  if (!ALLOWED_ORIGINS.has(origin) || !token || token.length > 100) return null;
  const tokenHash = await sha256(token);
  const now = Math.floor(Date.now() / 1000);
  const row = await env.DB.prepare(
    "SELECT s.user_id,u.display_name FROM auth_sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.revoked_at IS NULL AND s.expires_at>?"
  ).bind(tokenHash, now).first();
  return row ? { id: row.user_id, name: row.display_name, tokenHash } : null;
}
async function createAuthSession(request, env) {
  if (!env.DB) return bad(request, "認証データベースが未設定です", 503);
  const origin = request.headers.get("Origin") || "";
  if (!ALLOWED_ORIGINS.has(origin)) return bad(request, "許可されていない接続元です", 403);
  const googleToken = bearerToken(request);
  if (!googleToken) return bad(request, "Googleログイン情報がありません", 401);
  const user = await verifyGoogleIdToken(googleToken, env);
  if (!user) return bad(request, "Googleログインを確認できませんでした。もう一度お試しください", 401);
  await env.DB.prepare("INSERT INTO users(id,display_name) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET display_name=excluded.display_name")
    .bind(user.id, user.name).run();
  const sessionToken = randomToken(32);
  const tokenHash = await sha256(sessionToken);
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + 7 * 24 * 60 * 60;
  await env.DB.prepare("DELETE FROM auth_sessions WHERE expires_at<=? OR revoked_at IS NOT NULL").bind(now).run();
  await env.DB.prepare("INSERT INTO auth_sessions(token_hash,user_id,created_at,expires_at) VALUES(?,?,?,?)")
    .bind(tokenHash, user.id, now, expiresAt).run();
  return json(request, { ok: true, sessionToken, expiresAt, user: { id: user.id, name: user.name } });
}
async function logoutSession(request, env) {
  const origin = request.headers.get("Origin") || "";
  const token = bearerToken(request);
  if (!ALLOWED_ORIGINS.has(origin) || !token || token.length > 100) return bad(request, "ログイン状態を確認できません", 401);
  const tokenHash = await sha256(token);
  await env.DB.prepare("UPDATE auth_sessions SET revoked_at=? WHERE token_hash=? AND revoked_at IS NULL")
    .bind(Math.floor(Date.now() / 1000), tokenHash).run();
  return json(request, { ok: true });
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
    if (path === "/api/health" && request.method === "GET") {
      const database = { configured: Boolean(env.DB), coreSchemaReady: false, shareSchemaReady: false };
      if (env.DB) {
        try {
          const result = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
          const tables = new Set((result.results || []).map(row => row.name));
          database.coreSchemaReady = ["users","trips","trip_stops","posts","likes","comments","follows","saved_trips","reports","blocks"].every(name => tables.has(name));
          database.shareSchemaReady = ["share_links","share_rate_limits"].every(name => tables.has(name));
          database.authSchemaReady = tables.has("auth_sessions");
        } catch {
          database.querySucceeded = false;
        }
      }
      return json(request, { ok: true, service: "tabi-log-api", version: "1.3-google-auth", database });
    }
    if (path === "/api/auth/session" && request.method === "POST") return createAuthSession(request, env);
    if (path === "/api/auth/logout" && request.method === "POST") return logoutSession(request, env);
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
    if (!user) return bad(request, "ログイン状態を確認できません。再度ログインしてください。", 401);
    await env.DB.prepare("INSERT OR IGNORE INTO users(id,display_name) VALUES(?,?)").bind(user.id, user.name).run();
    if (path === "/api/me" && request.method === "GET") {
      return json(request, { ok: true, user: { id: user.id, name: user.name } });
    }
    if (path === "/api/trips" && request.method === "GET") {
      const result = await env.DB.prepare("SELECT id,title,area,description,visibility,start_date,end_date,source,created_at,updated_at FROM trips WHERE user_id=? ORDER BY created_at DESC LIMIT 100").bind(user.id).all();
      return json(request, { ok: true, items: result.results || [] });
    }
    if (path === "/api/posts" && request.method === "GET") {
      const result = await env.DB.prepare("SELECT id,trip_id,title,story,place_name,media_type,visibility,captured_at,created_at FROM posts WHERE user_id=? ORDER BY created_at DESC LIMIT 100").bind(user.id).all();
      return json(request, { ok: true, items: result.results || [] });
    }
    if (path === "/api/trips" && request.method === "POST") {
      const parsed = await readJson(request);
      if (parsed.error) return parsed.error;
      const b = parsed.data;
      const title = cleanText(b.title, 70);
      const area = cleanText(b.area, 80);
      const description = cleanText(b.description, 500);
      const visibility = validVisibility(b.visibility || "private");
      const startDate = validDate(b.start_date);
      const endDate = validDate(b.end_date);
      if (!title || !area) return bad(request, "title と area は必須です");
      if (!visibility || startDate === undefined || endDate === undefined) return bad(request, "公開範囲または日付が正しくありません");
      const id = uuid();
      await env.DB.prepare("INSERT INTO trips(id,user_id,title,area,description,visibility,source,external_plan_id,start_date,end_date) VALUES(?,?,?,?,?,?,'native',NULL,?,?)")
        .bind(id, user.id, title, area, description, visibility, startDate, endDate).run();
      return json(request, { ok: true, id }, 201);
    }
    if (path === "/api/posts" && request.method === "POST") {
      const parsed = await readJson(request);
      if (parsed.error) return parsed.error;
      const b = parsed.data;
      const title = cleanText(b.title, 70);
      const story = cleanText(b.story, 1000);
      const place = cleanText(b.place_name, 100);
      const visibility = validVisibility(b.visibility || "private");
      const tripId = typeof b.trip_id === "string" && b.trip_id ? b.trip_id.slice(0, 64) : null;
      if (!title || !story || !place) return bad(request, "title、story、place_name は必須です");
      if (!visibility) return bad(request, "公開範囲が正しくありません");
      if (tripId) {
        const ownedTrip = await env.DB.prepare("SELECT id FROM trips WHERE id=? AND user_id=?").bind(tripId, user.id).first();
        if (!ownedTrip) return bad(request, "指定した旅程が見つかりません", 404);
      }
      const id = uuid();
      await env.DB.prepare("INSERT INTO posts(id,user_id,trip_id,title,story,place_name,media_key,media_type,visibility,latitude,longitude,location_precision) VALUES(?,?,?,?,?,?,NULL,NULL,?,NULL,NULL,'hidden')")
        .bind(id, user.id, tripId, title, story, place, visibility).run();
      return json(request, { ok: true, id }, 201);
    }
    if (path === "/api/aileron/import" && request.method === "POST") {
      if (env.AILERON_IMPORT_ENABLED !== "true") return bad(request, "Aileron連携は現在無効です", 403);
      const parsed = await readJson(request);
      if (parsed.error) return parsed.error;
      const b = parsed.data;
      const externalId = cleanText(b.external_plan_id, 100);
      const title = cleanText(b.title, 70);
      const area = cleanText(b.area, 80);
      const description = cleanText(b.description, 500);
      if (!externalId || !title || !area) return bad(request, "external_plan_id、title、area は必須です");
      const old = await env.DB.prepare("SELECT id FROM trips WHERE source='aileron' AND external_plan_id=?").bind(externalId).first();
      if (old) return json(request, { ok: true, id: old.id, duplicate: true });
      const id = uuid();
      await env.DB.prepare("INSERT INTO trips(id,user_id,title,area,description,visibility,source,external_plan_id) VALUES(?,?,?,?,?,'private','aileron',?)").bind(id, user.id, title, area, description, externalId).run();
      return json(request, { ok: true, id, duplicate: false }, 201);
    }
    return bad(request, "Not found", 404);
  }
};
