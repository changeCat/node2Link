CREATE TABLE IF NOT EXISTS node2link_records (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  metadata TEXT,
  expires_at INTEGER,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS node2link_records_expires
  ON node2link_records(expires_at);

CREATE TABLE IF NOT EXISTS node2link_nodes (
  id TEXT PRIMARY KEY,
  sort_key TEXT NOT NULL UNIQUE,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
