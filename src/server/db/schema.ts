import Database from 'better-sqlite3';

/**
 * SQLite schema for Wasit Virtual Pencak Silat.
 *
 * Design: the searchable / sortable fields of each record live in real
 * columns (so history can be listed, filtered and pruned with SQL), while the
 * complete domain object — a Jurus embeds full reference poses, a Report
 * embeds per-step skeletons, judges, feedback and timelines — is kept losslessly
 * in a `payload` JSON column. Timestamps are epoch milliseconds.
 */
export const SCHEMA_VERSION = 3;

export const SCHEMA_SQL = /* sql */ `
CREATE TABLE IF NOT EXISTS custom_jurus (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  subtitle        TEXT NOT NULL DEFAULT '',
  level           TEXT NOT NULL CHECK (level IN ('Pemula', 'Menengah', 'Mahir')),
  target_duration REAL NOT NULL,
  tolerance       REAL NOT NULL DEFAULT 5,
  steps_count     INTEGER NOT NULL DEFAULT 0,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  payload         TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reports (
  id           TEXT PRIMARY KEY,
  jurus_id     TEXT NOT NULL,
  jurus_name   TEXT NOT NULL DEFAULT '',
  source       TEXT NOT NULL CHECK (source IN ('camera', 'video', 'demo')),
  total        REAL NOT NULL,
  kebenaran    REAL NOT NULL,
  kemantapan   REAL NOT NULL,
  hukuman      REAL NOT NULL,
  perf_index   REAL NOT NULL,
  predikat     TEXT NOT NULL DEFAULT '',
  duration     REAL NOT NULL,
  errors_total INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL,
  payload      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS duels (
  id            TEXT PRIMARY KEY,
  merah_name    TEXT NOT NULL DEFAULT '',
  biru_name     TEXT NOT NULL DEFAULT '',
  winner        TEXT NOT NULL CHECK (winner IN ('merah', 'biru', 'seri')),
  merah_score   REAL NOT NULL DEFAULT 0,
  biru_score    REAL NOT NULL DEFAULT 0,
  source        TEXT NOT NULL CHECK (source IN ('camera', 'rig', 'video', 'demo', 'manual')),
  rounds        INTEGER NOT NULL DEFAULT 1,
  events_count  INTEGER NOT NULL DEFAULT 0,
  duration      REAL NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL,
  payload       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS rig_profile (
  id         INTEGER PRIMARY KEY CHECK (id = 1),
  payload    TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  id         INTEGER PRIMARY KEY CHECK (id = 1),
  payload    TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_reports_created ON reports (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reports_jurus   ON reports (jurus_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_jurus_created   ON custom_jurus (created_at ASC);
CREATE INDEX IF NOT EXISTS idx_duels_created   ON duels (created_at DESC);
`;

/**
 * Additive migrations for databases created by earlier schema versions.
 * v2 -> v3: widen the duels.source CHECK to include 'rig' (SQLite cannot
 * ALTER a CHECK constraint, so the table is rebuilt when needed).
 */
export function runMigrations(db: InstanceType<typeof Database>): void {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'duels'").get() as { sql?: string } | undefined;
  if (row?.sql && !row.sql.includes("'rig'")) {
    const rebuild = db.transaction(() => {
      db.exec('ALTER TABLE duels RENAME TO duels_v2');
      db.exec(SCHEMA_SQL);
      db.exec(
        `INSERT INTO duels (id, merah_name, biru_name, winner, merah_score, biru_score, source, rounds, events_count, duration, created_at, payload)
         SELECT id, merah_name, biru_name, winner, merah_score, biru_score, source, rounds, events_count, duration, created_at, payload FROM duels_v2`,
      );
      db.exec('DROP TABLE duels_v2');
    });
    rebuild();
  }
}
