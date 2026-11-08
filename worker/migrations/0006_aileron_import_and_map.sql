-- trip_stops already has latitude/longitude in 0001_init.sql.
ALTER TABLE trip_stops ADD COLUMN external_place_id TEXT;

CREATE TABLE IF NOT EXISTS plan_imports (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  payload_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  claimed_at INTEGER,
  claimed_by TEXT REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_plan_imports_expiry
ON plan_imports(expires_at, claimed_at);
