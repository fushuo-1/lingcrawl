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

-- Knowledge-base notes (issue #93)
CREATE TABLE IF NOT EXISTS notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  path TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  tags TEXT NOT NULL DEFAULT '[]',  -- JSON array
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_notes_path ON notes(path);

-- FTS5 virtual table for notes full-text search
CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
  title, content,
  content='notes', content_rowid='id'
);

-- Triggers that keep notes_fts in sync with notes
CREATE TRIGGER IF NOT EXISTS notes_ai AFTER INSERT ON notes BEGIN
  INSERT INTO notes_fts(rowid, title, content)
  VALUES (new.id, new.title, new.content);
END;
CREATE TRIGGER IF NOT EXISTS notes_ad AFTER DELETE ON notes BEGIN
  INSERT INTO notes_fts(notes_fts, rowid, title, content)
  VALUES('delete', old.id, old.title, old.content);
END;
CREATE TRIGGER IF NOT EXISTS notes_au AFTER UPDATE ON notes BEGIN
  INSERT INTO notes_fts(notes_fts, rowid, title, content)
  VALUES('delete', old.id, old.title, old.content);
  INSERT INTO notes_fts(rowid, title, content)
  VALUES (new.id, new.title, new.content);
END;

-- Bidirectional links between notes (issue #93)
CREATE TABLE IF NOT EXISTS links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_path TEXT NOT NULL,
  target_title TEXT NOT NULL,
  UNIQUE(source_path, target_title)
);
CREATE INDEX IF NOT EXISTS idx_links_source ON links(source_path);
CREATE INDEX IF NOT EXISTS idx_links_target ON links(target_title);

-- Financial memories (issue #99 → #107 瘦身索引表，长文本存入 Markdown 笔记)
CREATE TABLE IF NOT EXISTS financial_memories (
  note_path TEXT PRIMARY KEY REFERENCES notes(path) ON DELETE CASCADE,
  entity_type TEXT NOT NULL CHECK(entity_type IN ('opinion','strategy','position','lesson')),
  ticker TEXT,
  market TEXT,
  direction TEXT CHECK(direction IN ('bullish','bearish','neutral')),
  time_horizon TEXT CHECK(time_horizon IN ('short','medium','long')),
  confidence INTEGER CHECK(confidence BETWEEN 1 AND 5),
  asset_class TEXT CHECK(asset_class IN ('stock','etf','bond','crypto','mixed')),
  strategy_status TEXT CHECK(strategy_status IN ('draft','active','paused','retired')),
  position_status TEXT CHECK(position_status IN ('holding','watching','closed')),
  quantity REAL,
  lesson_category TEXT CHECK(lesson_category IN ('mistake','principle','framework','insight')),
  tags TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_fin_entity_type ON financial_memories(entity_type);
CREATE INDEX IF NOT EXISTS idx_fin_ticker ON financial_memories(ticker);
