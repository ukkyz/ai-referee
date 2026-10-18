import 'server-only';

import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { SCHEMA_SQL, SCHEMA_VERSION } from './schema';

type SqliteDatabase = InstanceType<typeof Database>;

/**
 * Database location. Override with the DATABASE_PATH environment variable
 * (e.g. a persistent Docker volume). `:memory:` is honoured for tests.
 */
export function databasePath(): string {
  const fromEnv = process.env.DATABASE_PATH?.trim();
  if (fromEnv) return fromEnv;
  return path.join(process.cwd(), 'data', 'wasit.db');
}

// Survive Next.js dev HMR without leaking a connection per reload.
const globalCache = globalThis as typeof globalThis & {
  __wasitDb?: SqliteDatabase;
  __wasitDbPath?: string;
};

function openDatabase(): SqliteDatabase {
  const file = databasePath();
  if (file !== ':memory:') {
    fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  }

  const db = new Database(file);
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  if (file !== ':memory:') {
    // WAL: the UI can read history while a verdict is being written.
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
  }
  db.exec(SCHEMA_SQL);
  db.pragma(`user_version = ${SCHEMA_VERSION}`);
  return db;
}

/** The one shared SQLite connection for this Node.js process. */
export function getDb(): SqliteDatabase {
  const file = databasePath();
  if (!globalCache.__wasitDb || globalCache.__wasitDbPath !== file) {
    globalCache.__wasitDb?.close();
    globalCache.__wasitDb = openDatabase();
    globalCache.__wasitDbPath = file;
  }
  return globalCache.__wasitDb;
}
