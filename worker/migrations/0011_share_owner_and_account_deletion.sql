ALTER TABLE share_links ADD COLUMN owner_id TEXT;
CREATE INDEX IF NOT EXISTS idx_share_links_owner ON share_links(owner_id);
