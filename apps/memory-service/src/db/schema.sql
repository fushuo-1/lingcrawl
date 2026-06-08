-- Memory Service — SQLite schema (v0.1)
-- Loaded on every startup via client.ts; all DDL uses IF NOT EXISTS so it is idempotent.

-- Memory entries (agent's personal notes + user profile facts, distinguished by `target`)
CREATE TABLE IF NOT EXISTS memory_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  target TEXT NOT NULL CHECK(target IN ('memory', 'user')),
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_memory_entries_target ON memory_entries(target);

-- Conversation sessions (one row per session)
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL CHECK(source IN ('cli', 'mcp', 'api')),
  client_name TEXT,
  started_at INTEGER NOT NULL DEFAULT (unixepoch()),
  ended_at INTEGER,
  metadata TEXT  -- JSON
);

-- Per-turn exchanges inside a session (one row per user+assistant pair)
CREATE TABLE IF NOT EXISTS exchanges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  sequence INTEGER NOT NULL,
  user_message TEXT NOT NULL,
  user_message_ts INTEGER NOT NULL,
  assistant_message TEXT NOT NULL,
  assistant_message_ts INTEGER NOT NULL,
  extracted_at INTEGER,  -- v0.2 extractor uses this; v0.1 stays NULL
  UNIQUE(session_id, sequence)
);

-- FTS5 virtual table mirroring exchanges(user_message, assistant_message)
CREATE VIRTUAL TABLE IF NOT EXISTS exchanges_fts USING fts5(
  user_message, assistant_message,
  content='exchanges', content_rowid='id'
);

-- Triggers that keep exchanges_fts in sync with exchanges
CREATE TRIGGER IF NOT EXISTS exchanges_ai AFTER INSERT ON exchanges BEGIN
  INSERT INTO exchanges_fts(rowid, user_message, assistant_message)
  VALUES (new.id, new.user_message, new.assistant_message);
END;
CREATE TRIGGER IF NOT EXISTS exchanges_ad AFTER DELETE ON exchanges BEGIN
  INSERT INTO exchanges_fts(exchanges_fts, rowid, user_message, assistant_message)
  VALUES('delete', old.id, old.user_message, old.assistant_message);
END;
CREATE TRIGGER IF NOT EXISTS exchanges_au AFTER UPDATE ON exchanges BEGIN
  INSERT INTO exchanges_fts(exchanges_fts, rowid, user_message, assistant_message)
  VALUES('delete', old.id, old.user_message, old.assistant_message);
  INSERT INTO exchanges_fts(rowid, user_message, assistant_message)
  VALUES (new.id, new.user_message, new.assistant_message);
END;

-- v0.2 pending review table (created empty in v0.1; the extractor worker fills it)
CREATE TABLE IF NOT EXISTS pending_memories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_exchange_id INTEGER REFERENCES exchanges(id),
  content TEXT NOT NULL,
  target TEXT NOT NULL CHECK(target IN ('memory', 'user')),
  confidence REAL NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected'))
);
