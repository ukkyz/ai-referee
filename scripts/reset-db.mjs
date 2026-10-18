/**
 * Delete the local SQLite database (custom jurus, verdict history, settings).
 * A fresh, empty database is created on the next `npm run dev` / `npm run start`.
 *
 * Usage: npm run db:reset
 */
import fs from 'node:fs';
import path from 'node:path';

const file = process.env.DATABASE_PATH?.trim() || path.join(process.cwd(), 'data', 'wasit.db');

if (file === ':memory:') {
  console.log('DATABASE_PATH is :memory: — nothing to delete.');
  process.exit(0);
}

let removed = 0;
for (const candidate of [file, `${file}-wal`, `${file}-shm`, `${file}-journal`]) {
  if (fs.existsSync(candidate)) {
    fs.rmSync(candidate);
    removed += 1;
    console.log(`Deleted ${candidate}`);
  }
}
console.log(removed ? 'Database reset. Restart the app to create a fresh one.' : `No database found at ${file}.`);
