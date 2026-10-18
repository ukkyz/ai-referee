import { DEFAULT_SETTINGS, type DuelReport, type Jurus, type RefereeSettings, type Report } from '../types';

/**
 * Persistence client — talks to the Next.js Route Handlers under /api/*,
 * which store everything in SQLite (see src/server/db).
 *
 * Previously this module read/wrote browser localStorage. On first load,
 * `bootstrapFromServer()` transparently imports any legacy localStorage data
 * into SQLite (ids already present are never overwritten, and the old keys
 * are left untouched as a backup).
 */

/* ----------------------------------------------------------- legacy (v1) */

const LEGACY_JURUS_KEY = 'wasit-silat:custom-jurus:v1';
const LEGACY_HISTORY_KEY = 'wasit-silat:history:v1';
const LEGACY_SETTINGS_KEY = 'wasit-silat:settings:v1';
const MIGRATED_FLAG = 'wasit-silat:migrated-to-sqlite:v1';

function readLegacy<T>(key: string): T | null {
  try {
    if (typeof window === 'undefined') return null;
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------- API */

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    cache: 'no-store',
    ...init,
    headers: {
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  });
  const data = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!res.ok) throw new Error(data?.error ?? `Request failed (${res.status})`);
  return data as T;
}

function mergeSettings(partial: Partial<RefereeSettings> | null | undefined): RefereeSettings {
  if (!partial) return DEFAULT_SETTINGS;
  return { ...DEFAULT_SETTINGS, ...partial, weights: { ...DEFAULT_SETTINGS.weights, ...(partial.weights ?? {}) } };
}

export interface SettingsResponse {
  settings: RefereeSettings;
  persisted: boolean;
  updatedAt: number | null;
}

export const fetchSettings = async (): Promise<SettingsResponse> => {
  const data = await api<SettingsResponse>('/api/settings');
  return { ...data, settings: mergeSettings(data.settings) };
};

export const persistSettings = async (settings: RefereeSettings): Promise<RefereeSettings> => {
  const data = await api<{ settings: RefereeSettings }>('/api/settings', {
    method: 'PUT',
    body: JSON.stringify({ settings }),
  });
  return mergeSettings(data.settings);
};

export const fetchCustomJurus = async (): Promise<Jurus[]> => {
  const data = await api<{ jurus: Jurus[] }>('/api/jurus');
  return data.jurus ?? [];
};

export const persistJurus = async (jurus: Jurus): Promise<Jurus> => {
  const data = await api<{ jurus: Jurus }>(`/api/jurus/${encodeURIComponent(jurus.id)}`, {
    method: 'PUT',
    body: JSON.stringify({ jurus }),
  });
  return data.jurus;
};

export const removeJurus = async (id: string): Promise<void> => {
  await api(`/api/jurus/${encodeURIComponent(id)}`, { method: 'DELETE' });
};

export const fetchHistory = async (limit = 50): Promise<Report[]> => {
  const data = await api<{ reports: Report[] }>(`/api/history?limit=${limit}`);
  return data.reports ?? [];
};

export const persistReport = async (report: Report): Promise<Report> => {
  const data = await api<{ report: Report }>('/api/history', {
    method: 'POST',
    body: JSON.stringify({ report }),
  });
  return data.report;
};

export const removeReport = async (id: string): Promise<void> => {
  await api(`/api/history/${encodeURIComponent(id)}`, { method: 'DELETE' });
};

export const clearHistory = async (): Promise<void> => {
  await api('/api/history', { method: 'DELETE' });
};

export const fetchDuels = async (limit = 50): Promise<DuelReport[]> => {
  const data = await api<{ duels: DuelReport[] }>(`/api/duels?limit=${limit}`);
  return data.duels ?? [];
};

export const persistDuel = async (duel: DuelReport): Promise<DuelReport> => {
  const data = await api<{ duel: DuelReport }>('/api/duels', {
    method: 'POST',
    body: JSON.stringify({ duel }),
  });
  return data.duel;
};

export const removeDuel = async (id: string): Promise<void> => {
  await api(`/api/duels/${encodeURIComponent(id)}`, { method: 'DELETE' });
};

/* -------------------------------------------------------------- bootstrap */

export interface BootstrapData {
  settings: RefereeSettings;
  customs: Jurus[];
  history: Report[];
  duels: DuelReport[];
  migrated: boolean;
}

/**
 * Load all persisted state from SQLite, importing legacy localStorage data
 * first if this browser still holds any from the pre-Next.js version.
 */
export async function bootstrapFromServer(): Promise<BootstrapData> {
  let [settingsRes, customs, history] = await Promise.all([fetchSettings(), fetchCustomJurus(), fetchHistory()]);
  const duels = await fetchDuels().catch(() => [] as DuelReport[]);
  let migrated = false;

  try {
    const alreadyMigrated = typeof window !== 'undefined' && window.localStorage.getItem(MIGRATED_FLAG);
    const legacySettings = readLegacy<RefereeSettings>(LEGACY_SETTINGS_KEY);
    const legacyJurus = readLegacy<Jurus[]>(LEGACY_JURUS_KEY) ?? [];
    const legacyHistory = readLegacy<Report[]>(LEGACY_HISTORY_KEY) ?? [];
    const hasLegacy = legacySettings !== null || legacyJurus.length > 0 || legacyHistory.length > 0;

    if (!alreadyMigrated && hasLegacy) {
      await api('/api/migrate', {
        method: 'POST',
        body: JSON.stringify({
          settings: settingsRes.persisted ? undefined : legacySettings ?? undefined,
          jurus: legacyJurus,
          reports: legacyHistory,
        }),
      });
      window.localStorage.setItem(MIGRATED_FLAG, new Date().toISOString());
      migrated = true;
      [settingsRes, customs, history] = await Promise.all([fetchSettings(), fetchCustomJurus(), fetchHistory()]);
    }
  } catch (e) {
    // Migration is best-effort: the app keeps working with server state.
    console.warn('[storage] legacy localStorage import failed', e);
  }

  return { settings: settingsRes.settings, customs, history, duels, migrated };
}

/* ------------------------------------------------------------------ misc */

export function downloadJSON(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
