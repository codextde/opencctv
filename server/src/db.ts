import { Database } from "bun:sqlite";
import { chmodSync, existsSync } from "node:fs";

const MIGRATIONS: string[] = [
  `
  CREATE TABLE users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE tokens (
    hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_name TEXT,
    created_at INTEGER NOT NULL,
    last_used_at INTEGER NOT NULL
  );
  CREATE TABLE pairing_codes (
    code_hash TEXT PRIMARY KEY,
    role TEXT NOT NULL,
    created_by TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE TABLE cameras (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    brand TEXT NOT NULL,
    kind TEXT NOT NULL,
    fields_json TEXT NOT NULL DEFAULT '{}',
    url TEXT NOT NULL,
    sub_url TEXT,
    grp TEXT,
    ord INTEGER NOT NULL DEFAULT 0,
    enabled INTEGER NOT NULL DEFAULT 1,
    recording_mode TEXT NOT NULL DEFAULT 'continuous',
    use_substream INTEGER NOT NULL DEFAULT 0,
    motion_enabled INTEGER NOT NULL DEFAULT 1,
    sensitivity INTEGER NOT NULL DEFAULT 5,
    notify INTEGER NOT NULL DEFAULT 1,
    caps_json TEXT NOT NULL DEFAULT '{}',
    stream_key TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE recordings (
    id TEXT PRIMARY KEY,
    camera_id TEXT NOT NULL,
    start_ms INTEGER NOT NULL,
    end_ms INTEGER NOT NULL,
    duration REAL NOT NULL,
    size INTEGER NOT NULL,
    path TEXT,
    thumb_path TEXT,
    state TEXT NOT NULL DEFAULT 'kept',
    created_at INTEGER NOT NULL
  );
  CREATE INDEX recordings_cam_start ON recordings(camera_id, start_ms);
  CREATE INDEX recordings_start ON recordings(start_ms);
  CREATE UNIQUE INDEX recordings_path ON recordings(path);
  CREATE TABLE uploads (
    recording_id TEXT NOT NULL REFERENCES recordings(id) ON DELETE CASCADE,
    target_id TEXT NOT NULL,
    status TEXT NOT NULL,
    remote_path TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    error TEXT,
    next_try_at INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (recording_id, target_id)
  );
  CREATE INDEX uploads_status ON uploads(status, next_try_at);
  CREATE TABLE events (
    id TEXT PRIMARY KEY,
    camera_id TEXT NOT NULL,
    start_ms INTEGER NOT NULL,
    end_ms INTEGER,
    score REAL NOT NULL,
    snapshot_path TEXT
  );
  CREATE INDEX events_cam_start ON events(camera_id, start_ms);
  CREATE INDEX events_start ON events(start_ms);
  CREATE TABLE storage_targets (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    name TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    config_json TEXT NOT NULL,
    path TEXT NOT NULL DEFAULT '',
    retention_days INTEGER NOT NULL DEFAULT 30,
    last_upload INTEGER,
    last_error TEXT,
    used_bytes INTEGER,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE TABLE push_tokens (
    token TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    platform TEXT,
    cameras_json TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE sites (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    secret_hash TEXT,
    link_code_hash TEXT,
    link_expires INTEGER,
    last_seen INTEGER,
    version TEXT,
    cameras INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );
  `,
  `ALTER TABLE push_tokens ADD COLUMN server TEXT;`,
];

export type DB = Database;

export function openDb(file: string): DB {
  const fresh = !existsSync(file);
  const db = new Database(file, { create: true, strict: true });
  if (fresh && process.platform !== "win32") {
    try {
      chmodSync(file, 0o600);
    } catch {}
  }
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA synchronous = NORMAL;");
  const version = (db.query("PRAGMA user_version").get() as { user_version: number }).user_version;
  for (let i = version; i < MIGRATIONS.length; i++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[i]!);
      db.exec(`PRAGMA user_version = ${i + 1}`);
    })();
  }
  return db;
}

export function getSetting<T>(db: DB, key: string): T | undefined {
  const row = db.query("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | null;
  return row ? (JSON.parse(row.value) as T) : undefined;
}

export function setSetting(db: DB, key: string, value: unknown): void {
  db.query("INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(
    key,
    JSON.stringify(value),
  );
}

export function deleteSetting(db: DB, key: string): void {
  db.query("DELETE FROM settings WHERE key = ?").run(key);
}
