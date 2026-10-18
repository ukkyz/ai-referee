import 'server-only';

import { DEFAULT_SETTINGS, type Jurus, type RefereeSettings, type Report } from '@/types';
import { databasePath, getDb } from './client';
import { validateJurus, validateReport, validateSettings } from './validate';

/** History was capped at 25 by the localStorage quota; SQLite raises the cap. */
export const MAX_HISTORY = 100;

/** Round floats to 3 decimals to keep stored reports compact (as before). */
const compact = (_k: string, v: unknown) => (typeof v === 'number' && !Number.isInteger(v) ? Math.round(v * 1000) / 1000 : v);
const toJson = (value: unknown) => JSON.stringify(value, compact);

interface JurusRow {
  payload: string;
}
interface ReportRow {
  payload: string;
}
interface SettingsRow {
  payload: string;
  updated_at: number;
}
interface CountRow {
  n: number;
}

const parseJurus = (row: JurusRow): Jurus | null => {
  try {
    return validateJurus(JSON.parse(row.payload));
  } catch {
    return null;
  }
};

const parseReport = (row: ReportRow): Report | null => {
  try {
    return validateReport(JSON.parse(row.payload));
  } catch {
    return null;
  }
};

/* ------------------------------------------------------------------ settings */

export function getSettings(): { settings: RefereeSettings; persisted: boolean; updatedAt: number | null } {
  const row = getDb().prepare('SELECT payload, updated_at FROM settings WHERE id = 1').get() as SettingsRow | undefined;
  if (!row) return { settings: DEFAULT_SETTINGS, persisted: false, updatedAt: null };
  try {
    return { settings: validateSettings(JSON.parse(row.payload)) ?? DEFAULT_SETTINGS, persisted: true, updatedAt: row.updated_at };
  } catch {
    return { settings: DEFAULT_SETTINGS, persisted: false, updatedAt: null };
  }
}

export function saveSettings(settings: RefereeSettings): RefereeSettings {
  const valid = validateSettings(settings) ?? DEFAULT_SETTINGS;
  getDb()
    .prepare(
      `INSERT INTO settings (id, payload, updated_at) VALUES (1, ?, ?)
       ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at`,
    )
    .run(toJson(valid), Date.now());
  return valid;
}

/* -------------------------------------------------------------------- jurus */

export function listCustomJurus(): Jurus[] {
  const rows = getDb().prepare('SELECT payload FROM custom_jurus ORDER BY created_at ASC, name ASC').all() as JurusRow[];
  return rows.map(parseJurus).filter((j): j is Jurus => j !== null);
}

export function getCustomJurus(id: string): Jurus | null {
  const row = getDb().prepare('SELECT payload FROM custom_jurus WHERE id = ?').get(id) as JurusRow | undefined;
  return row ? parseJurus(row) : null;
}

const UPSERT_JURUS = /* sql */ `
INSERT INTO custom_jurus (id, name, subtitle, level, target_duration, tolerance, steps_count, created_at, updated_at, payload)
VALUES (@id, @name, @subtitle, @level, @target_duration, @tolerance, @steps_count, @created_at, @updated_at, @payload)
ON CONFLICT(id) DO UPDATE SET
  name = excluded.name,
  subtitle = excluded.subtitle,
  level = excluded.level,
  target_duration = excluded.target_duration,
  tolerance = excluded.tolerance,
  steps_count = excluded.steps_count,
  updated_at = excluded.updated_at,
  payload = excluded.payload
`;

/** INSERT OR IGNORE variant (no ON CONFLICT clause — it would override OR IGNORE). */
const INSERT_JURUS_IGNORE = /* sql */ `
INSERT OR IGNORE INTO custom_jurus (id, name, subtitle, level, target_duration, tolerance, steps_count, created_at, updated_at, payload)
VALUES (@id, @name, @subtitle, @level, @target_duration, @tolerance, @steps_count, @created_at, @updated_at, @payload)
`;

function jurusParams(j: Jurus) {
  return {
    id: j.id,
    name: j.name,
    subtitle: j.subtitle ?? '',
    level: j.level,
    target_duration: j.targetDuration,
    tolerance: j.tolerance,
    steps_count: j.steps.length,
    created_at: j.createdAt ?? Date.now(),
    updated_at: Date.now(),
    payload: toJson(j),
  };
}

export function upsertCustomJurus(jurus: Jurus): Jurus {
  const j = validateJurus(jurus) ?? jurus;
  getDb().prepare(UPSERT_JURUS).run(jurusParams(j));
  return getCustomJurus(j.id) ?? j;
}

export function deleteCustomJurus(id: string): boolean {
  return getDb().prepare('DELETE FROM custom_jurus WHERE id = ?').run(id).changes > 0;
}

export function countCustomJurus(): number {
  return (getDb().prepare('SELECT COUNT(*) AS n FROM custom_jurus').get() as CountRow).n;
}

/* ------------------------------------------------------------------ reports */

export function listReports(limit = 50): Report[] {
  const safeLimit = Math.min(MAX_HISTORY, Math.max(1, Math.floor(limit) || 50));
  const rows = getDb().prepare('SELECT payload FROM reports ORDER BY created_at DESC LIMIT ?').all(safeLimit) as ReportRow[];
  return rows.map(parseReport).filter((r): r is Report => r !== null);
}

export function getReport(id: string): Report | null {
  const row = getDb().prepare('SELECT payload FROM reports WHERE id = ?').get(id) as ReportRow | undefined;
  return row ? parseReport(row) : null;
}

const INSERT_REPORT = /* sql */ `
INSERT OR REPLACE INTO reports
  (id, jurus_id, jurus_name, source, total, kebenaran, kemantapan, hukuman, perf_index, predikat, duration, errors_total, created_at, payload)
VALUES
  (@id, @jurus_id, @jurus_name, @source, @total, @kebenaran, @kemantapan, @hukuman, @perf_index, @predikat, @duration, @errors_total, @created_at, @payload)
`;

const INSERT_REPORT_IGNORE = INSERT_REPORT.replace('INSERT OR REPLACE INTO', 'INSERT OR IGNORE INTO');

function reportParams(r: Report) {
  return {
    id: r.id,
    jurus_id: r.jurusId,
    jurus_name: r.jurusName ?? '',
    source: r.source,
    total: r.total,
    kebenaran: r.kebenaran,
    kemantapan: r.kemantapan,
    hukuman: r.hukuman,
    perf_index: r.index,
    predikat: r.predikat ?? '',
    duration: r.duration,
    errors_total: r.errorsTotal ?? 0,
    created_at: r.createdAt,
    payload: toJson(r),
  };
}

/** Keep only the newest MAX_HISTORY verdicts. */
function pruneReports() {
  getDb()
    .prepare('DELETE FROM reports WHERE id IN (SELECT id FROM reports ORDER BY created_at DESC LIMIT -1 OFFSET ?)')
    .run(MAX_HISTORY);
}

export function insertReport(report: Report): Report {
  const db = getDb();
  db.transaction(() => {
    db.prepare(INSERT_REPORT).run(reportParams(report));
    pruneReports();
  })();
  return getReport(report.id) ?? report;
}

export function deleteReport(id: string): boolean {
  return getDb().prepare('DELETE FROM reports WHERE id = ?').run(id).changes > 0;
}

export function clearReports(): number {
  return getDb().prepare('DELETE FROM reports').run().changes;
}

export function countReports(): number {
  return (getDb().prepare('SELECT COUNT(*) AS n FROM reports').get() as CountRow).n;
}

/* ------------------------------------------------------- legacy import / misc */

export interface LegacyImport {
  settings?: unknown;
  jurus?: unknown[];
  reports?: unknown[];
}

/**
 * One-time, non-destructive import of the old browser localStorage data
 * (pre-Next.js versions). Idempotent: existing ids are never overwritten.
 */
export function importLegacyData(input: LegacyImport): { settings: boolean; jurus: number; reports: number } {
  const db = getDb();
  let settingsImported = false;
  let jurusImported = 0;
  let reportsImported = 0;

  db.transaction(() => {
    if (input.settings !== undefined && !getSettings().persisted) {
      const valid = validateSettings(input.settings);
      if (valid) {
        saveSettings(valid);
        settingsImported = true;
      }
    }
    const insertJurus = db.prepare(INSERT_JURUS_IGNORE);
    for (const raw of input.jurus ?? []) {
      const j = validateJurus(raw);
      if (j) jurusImported += insertJurus.run(jurusParams(j)).changes;
    }
    const insertReportStmt = db.prepare(INSERT_REPORT_IGNORE);
    for (const raw of input.reports ?? []) {
      const r = validateReport(raw);
      if (r) reportsImported += insertReportStmt.run(reportParams(r)).changes;
    }
    pruneReports();
  })();

  return { settings: settingsImported, jurus: jurusImported, reports: reportsImported };
}

export function healthCheck(): { ok: boolean; database: string; counts: { customJurus: number; reports: number; settingsPersisted: boolean } } {
  getDb().prepare('SELECT 1').get();
  const file = databasePath();
  return {
    ok: true,
    database: file === ':memory:' ? ':memory:' : file.split('/').pop() ?? 'wasit.db',
    counts: {
      customJurus: countCustomJurus(),
      reports: countReports(),
      settingsPersisted: getSettings().persisted,
    },
  };
}
