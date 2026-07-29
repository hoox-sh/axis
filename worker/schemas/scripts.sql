-- AXIS user Pine scripts (Cloudflare D1).
--
-- Bound as env.DB (binding name must be "DB"; see wrangler.toml).
-- Applied by handleScripts in worker/src/scripts.ts.
--
-- Apply remote:
--   wrangler d1 execute pynescript --remote --file=schemas/scripts.sql
-- Apply local (wrangler dev):
--   wrangler d1 execute pynescript --local --file=schemas/scripts.sql
--
-- Multi-tenant: user_id is a SHA-256 prefix of the API key (never the raw key).
-- Optimistic concurrency: revision is an opaque string; clients send If-Match.

-- Saved library scripts (list omits content; GET by id returns full row).
CREATE TABLE IF NOT EXISTS scripts (
  user_id TEXT NOT NULL,          -- hashed API key partition
  id TEXT NOT NULL,               -- client or server-generated script id
  name TEXT NOT NULL,
  description TEXT,
  path TEXT,                      -- optional virtual path / folder hint
  content TEXT NOT NULL,          -- full Pine source
  revision TEXT NOT NULL,         -- opaque; changes on every write
  created_at INTEGER NOT NULL,    -- epoch ms
  updated_at INTEGER NOT NULL,    -- epoch ms
  PRIMARY KEY (user_id, id)
);

-- Newest-first listing for a single user.
CREATE INDEX IF NOT EXISTS idx_scripts_user_updated
  ON scripts (user_id, updated_at DESC);

-- One autosave draft per user (editor buffer before explicit Save).
CREATE TABLE IF NOT EXISTS script_drafts (
  user_id TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  name TEXT,
  updated_at INTEGER NOT NULL
);
