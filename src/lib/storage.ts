import { DEFAULT_SETTINGS, type Jurus, type RefereeSettings, type Report } from '../types';

const JURUS_KEY = 'wasit-silat:custom-jurus:v1';
const HISTORY_KEY = 'wasit-silat:history:v1';
const SETTINGS_KEY = 'wasit-silat:settings:v1';
const MAX_HISTORY = 25;

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

/** Round floats to 3 decimals to keep stored reports compact. */
const compact = (_k: string, v: unknown) => (typeof v === 'number' && !Number.isInteger(v) ? Math.round(v * 1000) / 1000 : v);

function write(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value, compact));
    return true;
  } catch (e) {
    console.warn('[storage] failed to save', key, e);
    return false;
  }
}

export const loadCustomJurus = (): Jurus[] => read<Jurus[]>(JURUS_KEY, []);
export const saveCustomJurus = (list: Jurus[]) => write(JURUS_KEY, list);

export const loadHistory = (): Report[] => read<Report[]>(HISTORY_KEY, []);

export function saveHistory(list: Report[]): Report[] {
  let trimmed = list.slice(0, MAX_HISTORY);
  // If storage is full, drop the oldest entries until it fits.
  while (trimmed.length && !write(HISTORY_KEY, trimmed)) trimmed = trimmed.slice(0, -1);
  return trimmed;
}

export function loadSettings(): RefereeSettings {
  const s = read<Partial<RefereeSettings>>(SETTINGS_KEY, {});
  return { ...DEFAULT_SETTINGS, ...s, weights: { ...DEFAULT_SETTINGS.weights, ...(s.weights ?? {}) } };
}
export const saveSettings = (s: RefereeSettings) => write(SETTINGS_KEY, s);

export function downloadJSON(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
