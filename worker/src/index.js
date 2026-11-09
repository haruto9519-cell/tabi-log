const ALLOWED_ORIGINS = new Set(["https://tabi-log.pages.dev", "http://localhost:8788", "http://127.0.0.1:8788"]);
const CORS_ORIGINS = new Set([...ALLOWED_ORIGINS, "https://tabi-hikaku.pages.dev", "https://aileron-japan-travel.pages.dev"]);
const cors = (request) => {
  const origin = request.headers.get("Origin") || "";
  const headers = {
    "access-control-allow-methods": "GET,POST,PUT,DELETE,OPTIONS",
    "access-control-allow-headers": "content-type,authorization",
    "vary": "Origin"
  };
  if (CORS_ORIGINS.has(origin)) headers["access-control-allow-origin"] = origin;
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
    locations: Array.isArray(input.locations) ? input.locations.slice(0, 30).map(x => ({
      name: cleanText(x?.name, 100),
      latitude: Number(x?.latitude),
      longitude: Number(x?.longitude)
    })).filter(x => x.name && Number.isFinite(x.latitude) && x.latitude >= -90 && x.latitude <= 90 && Number.isFinite(x.longitude) && x.longitude >= -180 && x.longitude <= 180) : [],
    entries: Array.isArray(input.entries) ? input.entries.slice(0, 40).map(x => ({
      title: cleanText(x?.title, 80),
      place: cleanText(x?.place, 100),
      story: cleanText(x?.story, 600),
      date: cleanText(x?.date, 30)
    })).filter(x => x.title || x.place || x.story) : [],
    author: cleanText(input.author, 40),
    aileronUrl: "https://aileron-japan-travel.pages.dev/",
    tabiLogUrl: "https://tabi-log.pages.dev/"
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

function cleanAileronPlan(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const title = cleanText(input.title, 70), area = cleanText(input.area, 80);
  const description = cleanText(input.description, 500);
  const startDate = cleanText(input.startDate, 10), endDate = cleanText(input.endDate, 10);
  const validDate = value => {
    if (!value) return true;
    if (value.length !== 10 || value[4] !== "-" || value[7] !== "-") return false;
    const [year, month, day] = value.split("-").map(Number);
    const parsed = new Date(Date.UTC(year, month - 1, day));
    return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
  };
  if (!validDate(startDate) || !validDate(endDate) || (startDate && endDate && endDate < startDate)) return null;
  const budgetAmount = Number(input.budgetAmount || 0);
  const budgetCurrency = cleanText(input.budgetCurrency || "JPY", 3).toUpperCase();
  const travelers = Number(input.travelers || 1);
  if (!title || !area || !Number.isSafeInteger(budgetAmount) || budgetAmount < 0 || budgetAmount > 100000000 ||
      !/^[A-Z]{3}$/.test(budgetCurrency) || !Number.isInteger(travelers) || travelers < 1 || travelers > 20) return null;
  const stops = Array.isArray(input.stops) ? input.stops.slice(0, 20).map((item, index) => {
    const name = cleanText(item?.name, 100);
    const rawLatitude = item?.latitude, rawLongitude = item?.longitude;
    const latitude = Number(rawLatitude), longitude = Number(rawLongitude);
    const nights = Number(item?.nights || 0);
    if (!name || rawLatitude === null || rawLatitude === undefined || rawLatitude === "" ||
        rawLongitude === null || rawLongitude === undefined || rawLongitude === "" ||
        !Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
        !Number.isFinite(longitude) || longitude < -180 || longitude > 180 ||
        !Number.isInteger(nights) || nights < 0 || nights > 30) return null;
    return { name, latitude, longitude, nights, sortOrder: index, externalPlaceId: cleanText(item?.externalPlaceId, 120) };
  }).filter(Boolean) : [];
  if (!stops.length) return null;
  return { title, area, description, startDate: startDate || null, endDate: endDate || null, budgetAmount, budgetCurrency, travelers, origin: cleanText(input.origin, 80), stops };
}
async function createPlanImport(request, env) {
  if (!env.DB) return bad(request, "旅行連携データベースが未設定です", 503);
  const origin = request.headers.get("Origin") || "";
  if (origin !== "https://tabi-hikaku.pages.dev" && origin !== "https://aileron-japan-travel.pages.dev") return bad(request, "許可されていない接続元です", 403);
  const parsed = await readJson(request, 30000);
  if (parsed.error) return parsed.error;
  const plan = cleanAileronPlan(parsed.data?.plan);
  if (!plan) return bad(request, "Aileronの旅行プラン情報を確認してください");
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const ipHash = await sha256(ip + (env.RATE_LIMIT_SALT || "tabi-log-rate-v1"));
  const now = Math.floor(Date.now() / 1000), windowStart = Math.floor(now / 600) * 600;
  await env.DB.prepare("INSERT INTO share_rate_limits(ip_hash,window_start,hits) VALUES(?,?,1) ON CONFLICT(ip_hash,window_start) DO UPDATE SET hits=hits+1").bind(ipHash,windowStart).run();
  const rate = await env.DB.prepare("SELECT hits FROM share_rate_limits WHERE ip_hash=? AND window_start=?").bind(ipHash,windowStart).first();
  if ((rate?.hits || 0) > 8) return bad(request, "連携URLの発行回数が上限に達しました。10分ほど待ってください", 429);
  const token = randomToken(32), tokenHash = await sha256(token), id = uuid();
  const expiresAt = now + 86400;
  await env.DB.prepare("DELETE FROM plan_imports WHERE expires_at<=? OR claimed_at IS NOT NULL").bind(now).run();
  await env.DB.prepare("INSERT INTO plan_imports(id,token_hash,payload_json,created_at,expires_at) VALUES(?,?,?,?,?)")
    .bind(id, tokenHash, JSON.stringify(plan), now, expiresAt).run();
  return json(request, { ok: true, importUrl: "https://tabi-log.pages.dev/?import=" + token, expiresAt }, 201);
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
      const database = { configured: Boolean(env.DB), mediaStorageReady: false, mediaStorageProvider: "device-local-only", coreSchemaReady: false, shareSchemaReady: false, itinerarySchemaReady: false, expensesSchemaReady: false, planImportsSchemaReady: false, stopCoordinatesSchemaReady: false };
      if (env.DB) {
        try {
          const result = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
          const tables = new Set((result.results || []).map(row => row.name));
          database.coreSchemaReady = ["users","trips","trip_stops","posts","likes","comments","follows","saved_trips","reports","blocks"].every(name => tables.has(name));
          const tripColumns = await env.DB.prepare("PRAGMA table_info(trips)").all();
          database.archiveSchemaReady = (tripColumns.results || []).some(column => column.name === "archived");
          database.shareSchemaReady = ["share_links","share_rate_limits"].every(name => tables.has(name));
          database.authSchemaReady = tables.has("auth_sessions");
          database.itinerarySchemaReady = tables.has("itinerary_items");
          database.expensesSchemaReady = tables.has("travel_expenses");
          database.planImportsSchemaReady = tables.has("plan_imports");
          const stopColumns = await env.DB.prepare("PRAGMA table_info(trip_stops)").all();
          const stopColumnNames = new Set((stopColumns.results || []).map(row => row.name));
          database.stopCoordinatesSchemaReady = ["latitude","longitude","external_place_id"].every(name => stopColumnNames.has(name));
        } catch {
          database.querySucceeded = false;
        }
      }
      return json(request, { ok: true, service: "tabi-log-api", version: "2.2-trip-archive", database });
    }
    if (path === "/api/auth/session" && request.method === "POST") return createAuthSession(request, env);
    if (path === "/api/auth/logout" && request.method === "POST") return logoutSession(request, env);
    if (path === "/api/shares" && request.method === "POST") return createShare(request, env);
    if (path === "/api/imports" && request.method === "POST") return createPlanImport(request, env);
    const shareMatch = path.match(/^\/api\/shares\/([A-Za-z0-9_-]+)$/);
    if (shareMatch && request.method === "GET") return readShare(request, env, shareMatch[1]);
    if (shareMatch && request.method === "DELETE") return revokeShare(request, env, shareMatch[1]);
    if (path === "/api/feed" && request.method === "GET") {
      if (!env.DB) return bad(request, "データベースが未設定です", 503);
      const r = await env.DB.prepare("SELECT p.id,p.title,p.story,p.place_name,p.media_type,p.created_at,u.display_name FROM posts p JOIN users u ON u.id=p.user_id WHERE p.visibility='public' ORDER BY p.created_at DESC LIMIT 40").all();
      return json(request, { ok: true, items: r.results || [] });
    }

    const importMatch = path.match(/^\/api\/imports\/([A-Za-z0-9_-]{40,50})$/);
    const user = await userFrom(request, env);
    if (importMatch && request.method === "POST") {
      if (!user) return bad(request, "旅ログにGoogleログインしてから連携してください", 401);
      if (!env.DB) return bad(request, "旅行連携データベースが未設定です", 503);
      const tokenHash = await sha256(importMatch[1]);
      const record = await env.DB.prepare("SELECT id,payload_json,expires_at,claimed_at FROM plan_imports WHERE token_hash=?").bind(tokenHash).first();
      const now = Math.floor(Date.now() / 1000);
      if (!record || record.expires_at <= now || record.claimed_at) return bad(request, "この旅行プランの連携URLは無効か、すでに使用されています", 410);
      let plan;
      try { plan = cleanAileronPlan(JSON.parse(record.payload_json)); } catch { plan = null; }
      if (!plan) return bad(request, "連携する旅行プランを読み込めません", 500);
      const tripId = uuid();
      const statements = [
        env.DB.prepare("UPDATE plan_imports SET claimed_at=?,claimed_by=? WHERE id=? AND claimed_at IS NULL AND expires_at>?")
          .bind(now, user.id, record.id, now),
        env.DB.prepare("INSERT INTO trips(id,user_id,title,area,description,visibility,source,external_plan_id,start_date,end_date,budget_amount,budget_currency) SELECT ?,?,?,?,?,'private','aileron',?,?,?,?,? WHERE EXISTS(SELECT 1 FROM plan_imports WHERE id=? AND claimed_by=? AND claimed_at=?)")
          .bind(tripId, user.id, plan.title, plan.area, plan.description, record.id, plan.startDate, plan.endDate, plan.budgetAmount, plan.budgetCurrency, record.id, user.id, now)
      ];
      for (const stop of plan.stops) {
        statements.push(env.DB.prepare("INSERT INTO trip_stops(id,trip_id,name,note,sort_order,location_precision,latitude,longitude,external_place_id) SELECT ?,?,?,?,?,'approximate',?,?,? WHERE EXISTS(SELECT 1 FROM trips WHERE id=? AND user_id=?)")
          .bind(uuid(), tripId, stop.name, stop.nights ? stop.nights + "泊" : "", stop.sortOrder, stop.latitude, stop.longitude, stop.externalPlaceId || null, tripId, user.id));
      }
      const results = await env.DB.batch(statements);
      if (!results?.[0]?.meta?.changes) return bad(request, "この旅行プランはすでに取り込まれています", 409);
      return json(request, { ok: true, tripId, title: plan.title, importedStops: plan.stops.length });
    }
    if (!user) return bad(request, "ログイン状態を確認できません。再度ログインしてください。", 401);
    await env.DB.prepare("INSERT OR IGNORE INTO users(id,display_name) VALUES(?,?)").bind(user.id, user.name).run();
    if (path === "/api/me" && request.method === "GET") {
      return json(request, { ok: true, user: { id: user.id, name: user.name } });
    }
    const mediaMatch = path.match(/^\/api\/media\/([A-Za-z0-9_-]{1,80})$/);
    if (mediaMatch && ["GET", "PUT", "DELETE"].includes(request.method)) {
      const postId = mediaMatch[1];
      const post = await env.DB.prepare("SELECT id,media_key,media_type FROM posts WHERE id=? AND user_id=?").bind(postId, user.id).first();
      if (!post) return bad(request, "対象の日記が見つかりません", 404);
      if (request.method === "GET") return json(request, { ok: true, fileId: post.media_key || null, mediaType: post.media_type || null });
      if (request.method === "PUT") {
        const parsed = await readJson(request, 4096);
        if (parsed.error) return parsed.error;
        const fileId = typeof parsed.data?.fileId === "string" ? parsed.data.fileId : "";
        const mediaType = typeof parsed.data?.mediaType === "string" ? parsed.data.mediaType.toLowerCase() : "";
        const size = Number(parsed.data?.size || 0);
        if (!/^[A-Za-z0-9_-]{10,200}$/.test(fileId)) return bad(request, "Google DriveのファイルIDが正しくありません");
        if (!["image/jpeg", "image/png", "image/webp"].includes(mediaType)) return bad(request, "対応形式はJPEG・PNG・WebPです", 415);
        if (!Number.isSafeInteger(size) || size < 1 || size > 5 * 1024 * 1024) return bad(request, "写真は5MB以下にしてください", 413);
        await env.DB.prepare("UPDATE posts SET media_key=?,media_type=? WHERE id=? AND user_id=?").bind(fileId, mediaType, postId, user.id).run();
        return json(request, { ok: true, fileId, mediaType });
      }
      await env.DB.prepare("UPDATE posts SET media_key=NULL,media_type=NULL WHERE id=? AND user_id=?").bind(postId, user.id).run();
      return json(request, { ok: true });
    }

    const visitedMatch = path.match(/^\/api\/trips\/([A-Za-z0-9_-]{1,80})\/visited$/);
    if (visitedMatch && request.method === "POST") {
      const parsed = await readJson(request, 2048);
      if (parsed.error) return parsed.error;
      const name = cleanText(parsed.data?.name, 100);
      const visited = parsed.data?.visited === true;
      if (!name) return bad(request, "訪問先の名前が必要です");
      const owned = await env.DB.prepare("SELECT id FROM trips WHERE id=? AND user_id=? AND source='aileron'").bind(visitedMatch[1], user.id).first();
      if (!owned) return bad(request, "連携した旅行が見つかりません", 404);
      const result = await env.DB.prepare("UPDATE trip_stops SET note=? WHERE trip_id=? AND name=?")
        .bind(visited ? "visited" : "", visitedMatch[1], name).run();
      if (!result.meta?.changes) return bad(request, "地図上の訪問先が見つかりません", 404);
      return json(request, { ok: true, name, visited });
    }
    if (path === "/api/sync" && request.method === "GET") {
      const tripRows = await env.DB.prepare(
        "SELECT t.id,t.title,t.area,t.description,t.visibility,t.start_date,t.end_date,t.budget_amount,t.budget_currency,t.archived,t.source,s.name AS stop_name,s.note AS stop_note,s.sort_order,s.latitude AS stop_latitude,s.longitude AS stop_longitude,s.external_place_id FROM trips t LEFT JOIN trip_stops s ON s.trip_id=t.id WHERE t.user_id=? AND t.source IN ('native','aileron') ORDER BY t.created_at DESC,s.sort_order ASC"
      ).bind(user.id).all();
      const tripMap = new Map();
      for (const row of tripRows.results || []) {
        if (!tripMap.has(row.id)) tripMap.set(row.id, {
          id: row.id, title: row.title, area: row.area, description: row.description,
          visibility: row.visibility, start_date: row.start_date, end_date: row.end_date, budget_amount: row.budget_amount || 0, budget_currency: row.budget_currency || "JPY", archived: Boolean(row.archived),
          source: row.source, stops: [], stopLocations: [], actual: [], dayPlans: []
        });
        if (row.stop_name) {
          tripMap.get(row.id).stops.push(row.stop_name);
          if (row.stop_note === "visited") tripMap.get(row.id).actual.push(row.stop_name);
          if (row.stop_latitude !== null && row.stop_latitude !== undefined && row.stop_longitude !== null && row.stop_longitude !== undefined && Number.isFinite(Number(row.stop_latitude)) && Number.isFinite(Number(row.stop_longitude))) tripMap.get(row.id).stopLocations.push({ name: row.stop_name, latitude: Number(row.stop_latitude), longitude: Number(row.stop_longitude), externalPlaceId: row.external_place_id || "" });
        }
      }
      const itineraryRows = await env.DB.prepare(
        "SELECT i.id,i.trip_id,i.day_date,i.name,i.start_time,i.end_time,i.note,i.sort_order,i.visited FROM itinerary_items i JOIN trips t ON t.id=i.trip_id WHERE t.user_id=? AND t.source='native' ORDER BY i.trip_id,i.day_date,i.sort_order"
      ).bind(user.id).all();
      for (const row of itineraryRows.results || []) {
        const trip = tripMap.get(row.trip_id);
        if (!trip) continue;
        let day = trip.dayPlans.find(item => item.date === row.day_date);
        if (!day) {
          day = { date: row.day_date, items: [] };
          trip.dayPlans.push(day);
        }
        day.items.push({
          id: row.id, name: row.name, startTime: row.start_time || "",
          endTime: row.end_time || "", note: row.note || "",
          sortOrder: row.sort_order, visited: Boolean(row.visited)
        });
      }
      const expenseRows = await env.DB.prepare(
        "SELECT id,trip_id,expense_date,category,amount,currency,note FROM travel_expenses WHERE user_id=? ORDER BY expense_date DESC,created_at DESC LIMIT 1000"
      ).bind(user.id).all();
      const postRows = await env.DB.prepare(
        "SELECT id,trip_id,title,story,place_name,media_key,media_type,visibility,captured_at,created_at FROM posts WHERE user_id=? ORDER BY created_at DESC LIMIT 200"
      ).bind(user.id).all();
      return json(request, { ok: true, trips: [...tripMap.values()], posts: postRows.results || [], expenses: expenseRows.results || [] });
    }
    if (path === "/api/sync" && request.method === "POST") {
      const parsed = await readJson(request, 200000);
      if (parsed.error) return parsed.error;
      const tripInput = Array.isArray(parsed.data.trips) ? parsed.data.trips.slice(0, 100) : [];
      const postInput = Array.isArray(parsed.data.posts) ? parsed.data.posts.slice(0, 100) : [];
      const expenseInput = Array.isArray(parsed.data.expenses) ? parsed.data.expenses.slice(0, 1000) : [];
      const normalizedTrips = [];
      const normalizedPosts = [];
      const normalizedExpenses = [];
      for (const item of tripInput) {
        const id = cleanText(item?.id, 64);
        const title = cleanText(item?.title, 70);
        const area = cleanText(item?.area, 80);
        const description = cleanText(item?.description, 500);
        const visibility = validVisibility(item?.visibility || "private");
        const startDate = validDate(item?.start_date);
        const endDate = validDate(item?.end_date);
        const budgetAmount = Number(item?.budget_amount || 0);
        const budgetCurrency = cleanText(item?.budget_currency || "JPY", 3).toUpperCase();
        const archived = item?.archived === true;
        if (!id || !title || !area || !visibility || startDate === undefined || endDate === undefined || !Number.isSafeInteger(budgetAmount) || budgetAmount < 0 || budgetAmount > 100000000 || !/^[A-Z]{3}$/.test(budgetCurrency)) {
          return bad(request, "旅行データの形式を確認してください");
        }
        const plannedStops = Array.isArray(item.stops) ? item.stops.slice(0, 40) : [];
        const actualStops = Array.isArray(item.actual) ? item.actual.slice(0, 40) : [];
        const stopNames = [...plannedStops, ...actualStops.filter(name => !plannedStops.includes(name))];
        const suppliedLocations = Array.isArray(item.stopLocations) ? item.stopLocations.slice(0, 40) : [];
        const existingLocationRows = await env.DB.prepare(
          "SELECT name,latitude,longitude,external_place_id FROM trip_stops WHERE trip_id=?"
        ).bind(id).all();
        const existingLocations = new Map((existingLocationRows.results || []).map(row => [row.name, row]));
        const stops = stopNames.map((stop, index) => {
          const name = cleanText(stop, 100);
          const supplied = suppliedLocations.find(point => cleanText(point?.name, 100) === name);
          const previous = existingLocations.get(name);
          const rawLatitude = supplied?.latitude ?? previous?.latitude;
          const rawLongitude = supplied?.longitude ?? previous?.longitude;
          const latitude = rawLatitude === null || rawLatitude === undefined || rawLatitude === "" ? null : Number(rawLatitude);
          const longitude = rawLongitude === null || rawLongitude === undefined || rawLongitude === "" ? null : Number(rawLongitude);
          const hasCoordinates = Number.isFinite(latitude) && latitude >= -90 && latitude <= 90 &&
            Number.isFinite(longitude) && longitude >= -180 && longitude <= 180;
          return {
            name, sort: index, visited: actualStops.includes(stop),
            latitude: hasCoordinates ? latitude : null,
            longitude: hasCoordinates ? longitude : null,
            externalPlaceId: cleanText(supplied?.externalPlaceId ?? previous?.external_place_id ?? "", 120),
            hasCoordinates
          };
        }).filter(stop => stop.name);
        const dayPlans = [];
        if (Array.isArray(item.dayPlans)) {
          for (const day of item.dayPlans.slice(0, 31)) {
            const dayDate = validDate(day?.date);
            if (!dayDate || dayDate === undefined) return bad(request, "日程の日付を確認してください");
            const items = Array.isArray(day.items) ? day.items.slice(0, 100) : [];
            for (const entry of items) {
              const itemId = cleanText(entry?.id, 64);
              const name = cleanText(entry?.name, 120);
              const startTime = cleanText(entry?.startTime, 5);
              const endTime = cleanText(entry?.endTime, 5);
              const note = cleanText(entry?.note, 500);
              if (!itemId || !name || (startTime && !/^([01]\\d|2[0-3]):[0-5]\\d$/.test(startTime)) || (endTime && !/^([01]\\d|2[0-3]):[0-5]\\d$/.test(endTime))) {
                return bad(request, "日程の内容または時刻を確認してください");
              }
              dayPlans.push({ id: itemId, date: dayDate, name, startTime, endTime, note, sort: Number.isInteger(entry.sortOrder) ? Math.max(0, Math.min(entry.sortOrder, 999)) : dayPlans.length, visited: Boolean(entry.visited) });
            }
          }
        }
        normalizedTrips.push({ id, title, area, description, visibility, startDate, endDate, budgetAmount, budgetCurrency, archived, stops, dayPlans });
      }
      const totalStops = normalizedTrips.reduce((sum, item) => sum + item.stops.length, 0);
      const totalItineraryItems = normalizedTrips.reduce((sum, item) => sum + item.dayPlans.length, 0);
      if (totalStops > 500) return bad(request, "立ち寄り先が多すぎます。一度に同期できるのは500件までです", 413);
      if (totalItineraryItems > 1000) return bad(request, "日程の項目が多すぎます。一度に同期できるのは1000件までです", 413);
      const ownedTripIds = new Set(normalizedTrips.map(item => item.id));
      for (const item of normalizedTrips) {
        const existing = await env.DB.prepare("SELECT user_id FROM trips WHERE id=?").bind(item.id).first();
        if (existing && existing.user_id !== user.id) return bad(request, "他のアカウントの旅行データは更新できません", 409);
      }
      for (const item of postInput) {
        const id = cleanText(item?.id, 64);
        const title = cleanText(item?.title, 70);
        const story = cleanText(item?.story, 1000);
        const place = cleanText(item?.place_name, 100);
        const visibility = validVisibility(item?.visibility || "private");
        const tripId = typeof item?.trip_id === "string" && item.trip_id ? cleanText(item.trip_id, 64) : null;
        const capturedAt = cleanText(item?.captured_at, 40);
        if (!id || !title || !story || !place || !visibility) return bad(request, "日記データの形式を確認してください");
        if (tripId) {
          const owned = ownedTripIds.has(tripId) || Boolean(await env.DB.prepare("SELECT id FROM trips WHERE id=? AND user_id=?").bind(tripId, user.id).first());
          if (!owned) return bad(request, "日記に指定された旅行が見つかりません", 404);
        }
        const existing = await env.DB.prepare("SELECT user_id FROM posts WHERE id=?").bind(id).first();
        if (existing && existing.user_id !== user.id) return bad(request, "他のアカウントの日記は更新できません", 409);
        normalizedPosts.push({ id, title, story, place, visibility, tripId, capturedAt });
      }
      const allowedExpenseCategories = new Set(["交通費","宿泊費","食費","観光費","買い物","その他"]);
      for (const item of expenseInput) {
        const id = cleanText(item?.id, 64);
        const tripId = cleanText(item?.trip_id, 64);
        const expenseDate = validDate(item?.expense_date);
        const category = cleanText(item?.category, 20);
        const amount = Number(item?.amount);
        const currency = cleanText(item?.currency || "JPY", 3).toUpperCase();
        const note = cleanText(item?.note, 300);
        if (!id || !tripId || !expenseDate || expenseDate === undefined || !allowedExpenseCategories.has(category) ||
            !Number.isSafeInteger(amount) || amount < 0 || amount > 100000000 || !/^[A-Z]{3}$/.test(currency)) {
          return bad(request, "支出データの形式を確認してください");
        }
        const owned = ownedTripIds.has(tripId) || Boolean(await env.DB.prepare("SELECT id FROM trips WHERE id=? AND user_id=? AND source='native'").bind(tripId, user.id).first());
        if (!owned) return bad(request, "支出に指定された旅行が見つかりません", 404);
        normalizedExpenses.push({ id, tripId, expenseDate, category, amount, currency, note });
      }
      if (normalizedExpenses.length > 1000) return bad(request, "支出の件数が多すぎます", 413);
      const statements = [];
      for (const item of normalizedTrips) {
        statements.push(env.DB.prepare(
          "INSERT INTO trips(id,user_id,title,area,description,visibility,source,external_plan_id,start_date,end_date,budget_amount,budget_currency,archived) VALUES(?,?,?,?,?,?,'native',NULL,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,area=excluded.area,description=excluded.description,visibility=excluded.visibility,start_date=excluded.start_date,end_date=excluded.end_date,budget_amount=excluded.budget_amount,budget_currency=excluded.budget_currency,archived=excluded.archived,updated_at=CURRENT_TIMESTAMP WHERE trips.user_id=excluded.user_id"
        ).bind(item.id, user.id, item.title, item.area, item.description, item.visibility, item.startDate, item.endDate, item.budgetAmount, item.budgetCurrency, item.archived ? 1 : 0));
        statements.push(env.DB.prepare("DELETE FROM trip_stops WHERE trip_id=?").bind(item.id));
        for (const stop of item.stops) {
          statements.push(env.DB.prepare(
            "INSERT INTO trip_stops(id,trip_id,name,note,sort_order,location_precision,latitude,longitude,external_place_id) VALUES(?,?,?,?,?,?,?,?,?)"
          ).bind(uuid(), item.id, stop.name, stop.visited ? "visited" : "", stop.sort,
            stop.hasCoordinates ? "approximate" : "hidden", stop.latitude, stop.longitude, stop.externalPlaceId || null));
        }
        statements.push(env.DB.prepare("DELETE FROM itinerary_items WHERE trip_id=?").bind(item.id));
        for (const entry of item.dayPlans) {
          statements.push(env.DB.prepare(
            "INSERT INTO itinerary_items(id,trip_id,day_date,name,start_time,end_time,note,sort_order,visited) VALUES(?,?,?,?,?,?,?,?,?)"
          ).bind(entry.id, item.id, entry.date, entry.name, entry.startTime, entry.endTime, entry.note, entry.sort, entry.visited ? 1 : 0));
        }
        statements.push(env.DB.prepare("DELETE FROM travel_expenses WHERE trip_id=? AND user_id=?").bind(item.id, user.id));
        for (const expense of normalizedExpenses.filter(entry => entry.tripId === item.id)) {
          statements.push(env.DB.prepare(
            "INSERT INTO travel_expenses(id,user_id,trip_id,expense_date,category,amount,currency,note) VALUES(?,?,?,?,?,?,?,?)"
          ).bind(expense.id, user.id, expense.tripId, expense.expenseDate, expense.category, expense.amount, expense.currency, expense.note));
        }
      }
      for (const item of normalizedPosts) {
        statements.push(env.DB.prepare(
          "INSERT INTO posts(id,user_id,trip_id,title,story,place_name,media_key,media_type,visibility,latitude,longitude,location_precision,captured_at) VALUES(?,?,?,?,?,?,NULL,NULL,?,NULL,NULL,'hidden',?) ON CONFLICT(id) DO UPDATE SET trip_id=excluded.trip_id,title=excluded.title,story=excluded.story,place_name=excluded.place_name,visibility=excluded.visibility,captured_at=excluded.captured_at WHERE posts.user_id=excluded.user_id"
        ).bind(item.id, user.id, item.tripId, item.title, item.story, item.place, item.visibility, item.capturedAt || null));
      }
      if (statements.length) await env.DB.batch(statements);
      return json(request, { ok: true, tripsSaved: normalizedTrips.length, postsSaved: normalizedPosts.length, expensesSaved: normalizedExpenses.length });
    }
    const postDeleteMatch = path.match(/^\/api\/posts\/([A-Za-z0-9_-]+)$/);
    if (postDeleteMatch && request.method === "DELETE") {
      const existingPost = await env.DB.prepare("SELECT media_key FROM posts WHERE id=? AND user_id=?").bind(postDeleteMatch[1], user.id).first();
      const result = await env.DB.prepare("DELETE FROM posts WHERE id=? AND user_id=?").bind(postDeleteMatch[1], user.id).run();
      return json(request, { ok: true, deleted: Boolean(result.meta?.changes) });
    }
    const tripDeleteMatch = path.match(/^\/api\/trips\/([A-Za-z0-9_-]+)$/);
    if (tripDeleteMatch && request.method === "DELETE") {
      const tripId = tripDeleteMatch[1];
      const ownedTrip = await env.DB.prepare("SELECT id FROM trips WHERE id=? AND user_id=?").bind(tripId, user.id).first();
      if (!ownedTrip) return bad(request, "削除できる旅程が見つかりません", 404);
      await env.DB.batch([
        env.DB.prepare("DELETE FROM itinerary_items WHERE trip_id=?").bind(tripId),
        env.DB.prepare("DELETE FROM travel_expenses WHERE trip_id=? AND user_id=?").bind(tripId, user.id),
        env.DB.prepare("DELETE FROM trip_stops WHERE trip_id=?").bind(tripId),
        env.DB.prepare("DELETE FROM trips WHERE id=? AND user_id=?").bind(tripId, user.id)
      ]);
      return json(request, { ok: true, deleted: true });
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
