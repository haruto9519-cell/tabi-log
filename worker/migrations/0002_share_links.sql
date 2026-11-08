-- Share links are unlisted bearer URLs. Only explicitly shared, sanitized trip data is stored.
CREATE TABLE IF NOT EXISTS share_links (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  revoke_hash TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_share_links_expiry ON share_links(expires_at);
-- Store only a salted hash of the client IP, never the raw address.
CREATE TABLE IF NOT EXISTS share_rate_limits (
  ip_hash TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  hits INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(ip_hash, window_start)
);
