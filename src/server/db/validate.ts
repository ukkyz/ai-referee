import 'server-only';

import { DEFAULT_SETTINGS, type DuelReport, type Jurus, type Level, type ModelKind, type RefereeSettings, type Report } from '@/types';

/**
 * Minimal runtime shape validation for API payloads. The client is trusted to
 * build full domain objects; the server rejects anything that could not have
 * come from the app before it reaches SQLite.
 */

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

const LEVELS: Level[] = ['Pemula', 'Menengah', 'Mahir'];
const MODELS: ModelKind[] = ['lite', 'full', 'heavy'];
const SOURCES = ['camera', 'video', 'demo'] as const;
const DUEL_SOURCES = ['camera', 'rig', 'video', 'demo', 'manual'] as const;
const DUEL_WINNERS = ['merah', 'biru', 'seri'] as const;

export function validateJurus(value: unknown): Jurus | null {
  if (!isRecord(value)) return null;
  if (!isStr(value.id) || !isStr(value.name)) return null;
  if (!isNum(value.targetDuration) || !isNum(value.tolerance)) return null;
  if (!Array.isArray(value.steps)) return null;
  const level = LEVELS.includes(value.level as Level) ? (value.level as Level) : 'Pemula';
  return {
    ...(value as unknown as Jurus),
    subtitle: typeof value.subtitle === 'string' ? value.subtitle : '',
    description: typeof value.description === 'string' ? value.description : '',
    level,
    custom: true,
    createdAt: isNum(value.createdAt) ? value.createdAt : Date.now(),
  };
}

export function validateReport(value: unknown): Report | null {
  if (!isRecord(value)) return null;
  if (!isStr(value.id) || !isStr(value.jurusId)) return null;
  if (![value.total, value.kebenaran, value.kemantapan, value.hukuman, value.index, value.duration, value.createdAt].every(isNum)) return null;
  if (!SOURCES.includes(value.source as (typeof SOURCES)[number])) return null;
  if (!Array.isArray(value.steps) || !Array.isArray(value.judges)) return null;
  return value as unknown as Report;
}

export function validateDuelReport(value: unknown): DuelReport | null {
  if (!isRecord(value)) return null;
  if (!isStr(value.id) || !isNum(value.createdAt) || !isNum(value.duration)) return null;
  if (!DUEL_SOURCES.includes(value.source as (typeof DUEL_SOURCES)[number])) return null;
  if (!DUEL_WINNERS.includes(value.winner as (typeof DUEL_WINNERS)[number])) return null;
  if (!isRecord(value.config) || !isRecord(value.config.merah) || !isRecord(value.config.biru)) return null;
  if (typeof value.config.merah.name !== 'string' || typeof value.config.biru.name !== 'string') return null;
  if (!Array.isArray(value.events) || !Array.isArray(value.fighters) || value.fighters.length !== 2) return null;
  const fighterOk = (f: unknown): boolean => isRecord(f) && isNum(f.score) && isRecord(f.techniques);
  if (!value.fighters.every(fighterOk)) return null;
  return value as unknown as DuelReport;
}

/** Merge an untrusted settings object over the defaults, coercing types. */
export function validateSettings(value: unknown): RefereeSettings | null {
  if (!isRecord(value)) return null;
  const w = isRecord(value.weights) ? value.weights : {};
  return {
    strictness: isNum(value.strictness) ? Math.min(3, Math.max(0.2, value.strictness)) : DEFAULT_SETTINGS.strictness,
    allowMirror: typeof value.allowMirror === 'boolean' ? value.allowMirror : DEFAULT_SETTINGS.allowMirror,
    matchThreshold: isNum(value.matchThreshold) ? Math.min(1, Math.max(0, value.matchThreshold)) : DEFAULT_SETTINGS.matchThreshold,
    weights: {
      correctness: isNum(w.correctness) ? w.correctness : DEFAULT_SETTINGS.weights.correctness,
      artistry: isNum(w.artistry) ? w.artistry : DEFAULT_SETTINGS.weights.artistry,
      timing: isNum(w.timing) ? w.timing : DEFAULT_SETTINGS.weights.timing,
    },
    sound: typeof value.sound === 'boolean' ? value.sound : DEFAULT_SETTINGS.sound,
    model: MODELS.includes(value.model as ModelKind) ? (value.model as ModelKind) : DEFAULT_SETTINGS.model,
    autoStop: typeof value.autoStop === 'boolean' ? value.autoStop : DEFAULT_SETTINGS.autoStop,
  };
}
