import { Database } from "bun:sqlite";
import { closeSync, openSync } from "node:fs";

// One entry per schema version; PRAGMA user_version records how many ran.
const MIGRATIONS = [
  `CREATE TABLE threads (
     id           TEXT PRIMARY KEY,
     file_path    TEXT NOT NULL,
     start_line   INTEGER NOT NULL,
     end_line     INTEGER NOT NULL,
     anchor_text  TEXT NOT NULL,
     file_sha     TEXT NOT NULL,
     origin_view  TEXT NOT NULL,
     status       TEXT NOT NULL DEFAULT 'open',
     outdated     INTEGER NOT NULL DEFAULT 0,
     created_by   TEXT NOT NULL,
     created_at   TEXT NOT NULL,
     resolved_by  TEXT,
     resolved_at  TEXT,
     exported_at  TEXT
   );
   CREATE TABLE comments (
     id          TEXT PRIMARY KEY,
     thread_id   TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
     author      TEXT NOT NULL,
     client_id   TEXT NOT NULL,
     body        TEXT NOT NULL,
     created_at  TEXT NOT NULL,
     updated_at  TEXT
   );
   CREATE INDEX idx_threads_file ON threads (file_path, start_line);
   CREATE INDEX idx_comments_thread ON comments (thread_id, created_at);`,
];

export function openReviewDb(path: string): Database {
  // Create the file ourselves so it is private; SQLite gives -wal / -shm the same mode.
  closeSync(openSync(path, "a", 0o600));
  const db = new Database(path, { strict: true });
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  // `reviewbuddy export` may read while the server writes.
  db.exec("PRAGMA busy_timeout = 5000");
  const { user_version } = db.query("PRAGMA user_version").get() as {
    user_version: number;
  };
  for (let version = user_version; version < MIGRATIONS.length; version++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[version]!);
      db.exec(`PRAGMA user_version = ${version + 1}`);
    })();
  }
  return db;
}
