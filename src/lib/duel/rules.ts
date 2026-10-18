import {
  CORNERS,
  opponentOf,
  type Corner,
  type DuelConfig,
  type DuelEvent,
  type DuelEventStatus,
  type DuelTechnique,
  type FighterStats,
  type PenaltyLevel,
  type TargetZone,
  type TechniqueStats,
} from '../../types';
import { clamp, uid } from '../math';

/**
 * IPSI / PERSILAT Tanding scoring (simplified training model):
 * hand attack 1 · foot attack 2 · dropping 3 · locking 4, plus the "1+"
 * bonus for a successful defence immediately followed by a counter-attack.
 * Legal target is the togok (body protector): chest, abdomen above the navel,
 * ribs and back. Head/neck and below-navel-to-groin are serious violations.
 */

export const TECHNIQUE_INFO: Record<DuelTechnique, { label: string; en: string; points: number; color: string }> = {
  pukulan: { label: 'Pukulan', en: 'Punch / hand attack', points: 1, color: '#f87171' },
  tendangan: { label: 'Tendangan', en: 'Kick / foot attack', points: 2, color: '#a78bfa' },
  jatuhan: { label: 'Jatuhan', en: 'Takedown / dropping', points: 3, color: '#38bdf8' },
  kuncian: { label: 'Kuncian', en: 'Body lock', points: 4, color: '#fbbf24' },
};

/** Extra point when a block/evade is immediately followed by a scoring counter. */
export const COUNTER_BONUS = 1;
/** A counter must land within this window after the opponent's failed attack. */
export const COUNTER_WINDOW_S = 1.5;

export type ZoneLegality = 'sah' | 'ilegal' | 'antara';

export const ZONE_INFO: Record<TargetZone, { label: string; en: string; legality: ZoneLegality }> = {
  dada: { label: 'Dada', en: 'Chest', legality: 'sah' },
  perut: { label: 'Perut', en: 'Abdomen (above navel)', legality: 'sah' },
  rusuk: { label: 'Rusuk', en: 'Ribs', legality: 'sah' },
  punggung: { label: 'Punggung', en: 'Back', legality: 'sah' },
  kepala: { label: 'Kepala', en: 'Head', legality: 'ilegal' },
  leher: { label: 'Leher', en: 'Neck', legality: 'ilegal' },
  kemaluan: { label: 'Bawah pusar / kemaluan', en: 'Below navel / groin', legality: 'ilegal' },
  kaki: { label: 'Kaki', en: 'Legs (intermediate target, non-scoring)', legality: 'antara' },
  badan: { label: 'Badan', en: 'Body', legality: 'sah' },
  'tidak-kena': { label: 'Tidak kena', en: 'No contact', legality: 'antara' },
};

export const STATUS_INFO: Record<DuelEventStatus, { label: string; en: string; color: string }> = {
  sah: { label: 'Sah', en: 'Valid', color: '#34d399' },
  ilegal: { label: 'Ilegal', en: 'Illegal / foul', color: '#f87171' },
  gagal: { label: 'Gagal', en: 'Failed attempt', color: '#a8a29e' },
};

export const FAIL_INFO: Record<NonNullable<DuelEvent['failReason']>, { label: string; en: string }> = {
  ditangkis: { label: 'Ditangkis', en: 'Blocked' },
  meleset: { label: 'Meleset', en: 'Missed / evaded' },
  'tidak-jatuh': { label: 'Lawan tidak jatuh', en: 'Opponent stayed up' },
  lepas: { label: 'Kuncian lepas', en: 'Lock escaped' },
};

export interface PenaltyStep {
  level: PenaltyLevel;
  label: string;
  points: number;
}

/** Escalating foul ladder: Teguran I/II then Peringatan I/II then disqualification. */
export const PENALTY_LADDER: PenaltyStep[] = [
  { level: 'teguran-1', label: 'Teguran I', points: 1 },
  { level: 'teguran-2', label: 'Teguran II', points: 2 },
  { level: 'peringatan-1', label: 'Peringatan I', points: 5 },
  { level: 'peringatan-2', label: 'Peringatan II', points: 10 },
  { level: 'diskualifikasi', label: 'Diskualifikasi', points: 0 },
];

/** Penalty for a fighter's n-th foul (0-based). The 5th foul is a disqualification. */
export const penaltyForFoul = (foulIndex: number): PenaltyStep => PENALTY_LADDER[Math.max(0, Math.min(PENALTY_LADDER.length - 1, foulIndex))];
export const FOULS_FOR_DQ = PENALTY_LADDER.length;

export function pointsFor(technique: DuelTechnique, status: DuelEventStatus, counterBonus = false): number {
  if (status !== 'sah') return 0;
  return TECHNIQUE_INFO[technique].points + (counterBonus ? COUNTER_BONUS : 0);
}

/**
 * Recompute points/penalty after a referee edits an event's status.
 * Fouls are re-laddered by `applyPenaltyLadder` over the full list, so here we
 * only fix the technical points and clear/set a provisional penalty.
 */
export function withStatus(event: DuelEvent, status: DuelEventStatus): DuelEvent {
  const next: DuelEvent = { ...event, status, points: pointsFor(event.technique, status, event.counterBonus) };
  if (status !== 'ilegal') {
    next.penalty = 0;
    next.penaltyLevel = undefined;
  }
  if (status === 'sah') next.failReason = undefined;
  if (status === 'gagal' && !next.failReason) next.failReason = event.technique === 'jatuhan' ? 'tidak-jatuh' : event.technique === 'kuncian' ? 'lepas' : 'meleset';
  return next;
}

/** Assign escalating penalties to ilegal events in chronological order, per fighter. */
export function applyPenaltyLadder(events: DuelEvent[]): DuelEvent[] {
  const sorted = [...events].sort((a, b) => a.t - b.t);
  const counts: Record<Corner, number> = { merah: 0, biru: 0 };
  const byId = new Map<string, DuelEvent>();
  for (const e of sorted) {
    if (e.status === 'ilegal') {
      const step = penaltyForFoul(counts[e.attacker]);
      counts[e.attacker] += 1;
      byId.set(e.id, { ...e, penalty: step.points, penaltyLevel: step.level });
    } else {
      byId.set(e.id, e.penalty === 0 ? e : { ...e, penalty: 0, penaltyLevel: undefined });
    }
  }
  return events.map((e) => byId.get(e.id) ?? e);
}

/** Short Indonesian description, e.g. "Tendangan kanan masuk ke rusuk". */
export function autoNote(input: Pick<DuelEvent, 'technique' | 'status' | 'zone'> & Partial<Pick<DuelEvent, 'limb' | 'failReason' | 'duration' | 'counterBonus'>>): string {
  const tech = TECHNIQUE_INFO[input.technique].label;
  const limb = input.limb ? ` ${input.limb}` : '';
  const zone = ZONE_INFO[input.zone].label.toLowerCase();
  const counter = input.counterBonus ? ' (serangan balik +1)' : '';
  if (input.technique === 'jatuhan') {
    if (input.status === 'sah') return `Jatuhan sah — lawan terjatuh${counter}`;
    if (input.status === 'ilegal') return 'Jatuhan ilegal (teknik terlarang)';
    return 'Percobaan jatuhan — lawan tetap berdiri';
  }
  if (input.technique === 'kuncian') {
    const dur = input.duration ? ` ${input.duration.toFixed(1).replace('.', ',')} dtk` : '';
    if (input.status === 'sah') return `Kuncian badan terkendali${dur}`;
    if (input.status === 'ilegal') return `Kuncian ilegal — menyentuh ${zone}`;
    return `Kuncian lepas${dur}`;
  }
  if (input.status === 'sah') return `${tech}${limb} masuk ke ${zone}${counter}`;
  if (input.status === 'ilegal') return `${tech}${limb} ke ${zone} — ILEGAL`;
  if (input.failReason === 'ditangkis') return `${tech}${limb} ditangkis lawan`;
  return `${tech}${limb} meleset`;
}

export interface MakeEventInput {
  t: number;
  round: number;
  attacker: Corner;
  technique: DuelTechnique;
  status: DuelEventStatus;
  zone: TargetZone;
  failReason?: DuelEvent['failReason'];
  limb?: DuelEvent['limb'];
  duration?: number;
  counterBonus?: boolean;
  confidence?: number;
  source?: DuelEvent['source'];
  note?: string;
}

export function makeEvent(input: MakeEventInput): DuelEvent {
  const e: DuelEvent = {
    id: uid(),
    t: Math.max(0, input.t),
    round: input.round,
    attacker: input.attacker,
    technique: input.technique,
    status: input.status,
    failReason: input.failReason,
    zone: input.zone,
    points: pointsFor(input.technique, input.status, input.counterBonus),
    counterBonus: input.counterBonus,
    penalty: 0,
    limb: input.limb,
    duration: input.duration,
    confidence: clamp(input.confidence ?? 1, 0, 1),
    source: input.source ?? 'wasit',
    note: input.note ?? '',
  };
  if (!e.note) e.note = autoNote(e);
  return e;
}

export interface DuelOutcome {
  fighters: [FighterStats, FighterStats];
  winner: Corner | 'seri';
  winBy: string;
  momentum: { t: number; diff: number }[];
}

/** Aggregate a (confirmed) event list into scores, statistics and a winner. Pure. */
export function computeDuelStats(eventsInput: DuelEvent[], config: DuelConfig, duration: number): DuelOutcome {
  const events = applyPenaltyLadder(eventsInput);
  const maxRound = events.reduce((m, e) => Math.max(m, e.round), config.rounds);
  const names: Record<Corner, string> = { merah: config.merah.name, biru: config.biru.name };

  const fighters = CORNERS.map((corner): FighterStats => {
    const mine = events.filter((e) => e.attacker === corner);
    const techniques = {} as Record<DuelTechnique, TechniqueStats>;
    for (const tech of ['pukulan', 'tendangan', 'jatuhan', 'kuncian'] as DuelTechnique[]) {
      const list = mine.filter((e) => e.technique === tech);
      techniques[tech] = {
        attempted: list.length,
        sah: list.filter((e) => e.status === 'sah').length,
        ilegal: list.filter((e) => e.status === 'ilegal').length,
        gagal: list.filter((e) => e.status === 'gagal').length,
        ditangkis: list.filter((e) => e.failReason === 'ditangkis').length,
        points: list.reduce((s, e) => s + e.points, 0),
      };
    }
    const techniquePoints = mine.reduce((s, e) => s + e.points, 0);
    const penaltyPoints = mine.reduce((s, e) => s + e.penalty, 0);
    const fouls = mine.filter((e) => e.status === 'ilegal').length;
    const byRound = Array.from({ length: maxRound }, () => 0);
    for (const e of mine) {
      const idx = Math.max(0, Math.min(maxRound - 1, e.round - 1));
      byRound[idx] += e.points - e.penalty;
    }
    const strikeAttempted = techniques.pukulan.attempted + techniques.tendangan.attempted;
    const strikeSah = techniques.pukulan.sah + techniques.tendangan.sah;
    const minutes = Math.max(duration, 1) / 60;
    return {
      corner,
      name: names[corner],
      score: techniquePoints - penaltyPoints,
      techniquePoints,
      penaltyPoints,
      techniques,
      totalAttempts: mine.length,
      totalSukses: mine.filter((e) => e.status === 'sah').length,
      strikeAccuracy: strikeAttempted ? strikeSah / strikeAttempted : 0,
      strikesPerMinute: strikeAttempted / minutes,
      lockSeconds: mine.filter((e) => e.technique === 'kuncian').reduce((s, e) => s + (e.duration ?? 0), 0),
      fouls,
      timesDropped: events.filter((e) => e.attacker === opponentOf(corner) && e.technique === 'jatuhan' && e.status === 'sah').length,
      byRound,
      disqualified: fouls >= FOULS_FOR_DQ,
    };
  }) as [FighterStats, FighterStats];

  // Momentum: cumulative merah − biru after every event that moves the score.
  const momentum: { t: number; diff: number }[] = [{ t: 0, diff: 0 }];
  let diff = 0;
  for (const e of [...events].sort((a, b) => a.t - b.t)) {
    const delta = e.points - e.penalty;
    if (delta === 0) continue;
    diff += e.attacker === 'merah' ? delta : -delta;
    momentum.push({ t: e.t, diff });
  }
  if (duration > 0) momentum.push({ t: duration, diff });

  const [m, b] = fighters;
  let winner: Corner | 'seri' = 'seri';
  let winBy = 'Seri — nilai sama';
  if (m.disqualified && !b.disqualified) {
    winner = 'biru';
    winBy = 'Diskualifikasi — Merah mencapai batas pelanggaran';
  } else if (b.disqualified && !m.disqualified) {
    winner = 'merah';
    winBy = 'Diskualifikasi — Biru mencapai batas pelanggaran';
  } else if (m.score !== b.score) {
    winner = m.score > b.score ? 'merah' : 'biru';
    winBy = `Menang angka ${Math.max(m.score, b.score)}–${Math.min(m.score, b.score)}`;
  } else if (m.fouls !== b.fouls) {
    winner = m.fouls < b.fouls ? 'merah' : 'biru';
    winBy = 'Menang angka — seri, pelanggaran lebih sedikit';
  } else if (m.techniques.jatuhan.sah !== b.techniques.jatuhan.sah) {
    winner = m.techniques.jatuhan.sah > b.techniques.jatuhan.sah ? 'merah' : 'biru';
    winBy = 'Menang angka — seri, jatuhan terbanyak';
  } else if (m.totalSukses !== b.totalSukses) {
    winner = m.totalSukses > b.totalSukses ? 'merah' : 'biru';
    winBy = 'Menang angka — seri, teknik masuk terbanyak';
  }

  return { fighters, winner, winBy, momentum };
}

/** Counters the user asked for: successful techniques per fighter, valid vs illegal. */
export function suksesCounts(stats: FighterStats): Record<DuelTechnique, number> {
  return {
    pukulan: stats.techniques.pukulan.sah,
    tendangan: stats.techniques.tendangan.sah,
    jatuhan: stats.techniques.jatuhan.sah,
    kuncian: stats.techniques.kuncian.sah,
  };
}
