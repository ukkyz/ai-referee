export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Canonical joints used across the app (subset of MediaPipe's 33 landmarks). */
export const JOINTS = [
  'nose',
  'lShoulder',
  'rShoulder',
  'lElbow',
  'rElbow',
  'lWrist',
  'rWrist',
  'lHip',
  'rHip',
  'lKnee',
  'rKnee',
  'lAnkle',
  'rAnkle',
  'lFoot',
  'rFoot',
] as const;
export type JointName = (typeof JOINTS)[number];

/**
 * 3D skeleton in the canonical frame: hip-centred, metres,
 * x = performer's left (when facing camera), y = up, z = towards camera.
 */
export type Skeleton = Record<JointName, Vec3>;

/** Rotation-invariant biomechanical features used for pose comparison. */
export const FEATURE_KEYS = [
  'lElbow',
  'rElbow',
  'lShoulder',
  'rShoulder',
  'lArmSide',
  'rArmSide',
  'lHip',
  'rHip',
  'lLegSide',
  'rLegSide',
  'lKnee',
  'rKnee',
  'stance',
  'lean',
  'lWristH',
  'rWristH',
  'handsGap',
  'feetH',
] as const;
export type FeatureKey = (typeof FEATURE_KEYS)[number];
export type Features = Record<FeatureKey, number>;
export type FeatureWeights = Record<FeatureKey, number>;

export type PoseCategory = 'sikap' | 'kuda-kuda' | 'pukulan' | 'tangkisan' | 'tendangan' | 'elakan' | 'custom';

export interface RefPose {
  id: string;
  name: string;
  nameEn: string;
  category: PoseCategory;
  description: string;
  cue: string;
  features: Features;
  weights: FeatureWeights;
  skeleton: Skeleton;
}

export interface JurusStep {
  uid: string;
  pose: RefPose;
  /** Expected time (seconds from start) at which the key pose is reached. */
  t: number;
  /** Expected hold duration in seconds. */
  hold: number;
  label?: string;
}

export type Level = 'Pemula' | 'Menengah' | 'Mahir';

export interface Jurus {
  id: string;
  name: string;
  subtitle: string;
  description: string;
  level: Level;
  targetDuration: number;
  tolerance: number;
  steps: JurusStep[];
  custom?: boolean;
  createdAt?: number;
}

export interface FrameSample {
  t: number;
  features: Features;
  skeleton: Skeleton;
  visibility: number;
}

export type ModelKind = 'lite' | 'full' | 'heavy';

export interface RefereeSettings {
  /** Tolerance multiplier: < 1 strict, > 1 lenient. */
  strictness: number;
  allowMirror: boolean;
  matchThreshold: number;
  weights: { correctness: number; artistry: number; timing: number };
  sound: boolean;
  model: ModelKind;
  autoStop: boolean;
}

export const DEFAULT_SETTINGS: RefereeSettings = {
  strictness: 1,
  allowMirror: false,
  matchThreshold: 0.68,
  weights: { correctness: 50, artistry: 30, timing: 20 },
  sound: true,
  model: 'full',
  autoStop: true,
};

export interface FeatureResult {
  key: FeatureKey;
  actual: number;
  target: number;
  score: number;
  weight: number;
}

export interface StepResult {
  index: number;
  name: string;
  poseId: string;
  category: PoseCategory;
  expectedT: number;
  expectedHold: number;
  matched: boolean;
  actualT: number | null;
  onset: number | null;
  holdDuration: number;
  similarity: number;
  mirrored: boolean;
  errors: number;
  elements: number;
  stability: number;
  balance: number;
  power: number | null;
  features: FeatureResult[];
  performerSkeleton: Skeleton | null;
  refSkeleton: Skeleton;
  tips: string[];
}

export interface JudgeScore {
  name: string;
  profile: string;
  kebenaran: number;
  kemantapan: number;
  hukuman: number;
  total: number;
  errors: number;
  dropped: boolean;
}

export type FeedbackArea =
  | 'Kebenaran'
  | 'Kemantapan'
  | 'Irama'
  | 'Waktu'
  | 'Penghayatan'
  | 'Tenaga'
  | 'Stamina'
  | 'Kamera';

export interface FeedbackItem {
  level: 'good' | 'warn' | 'bad';
  area: FeedbackArea;
  text: string;
}

export interface Report {
  id: string;
  createdAt: number;
  jurusId: string;
  jurusName: string;
  jurusSubtitle: string;
  source: 'camera' | 'video' | 'demo';
  duration: number;
  targetDuration: number;
  tolerance: number;
  // IPSI-style (mean of middle 3 of 5 judges)
  kebenaran: number;
  kemantapan: number;
  hukuman: number;
  total: number;
  judges: JudgeScore[];
  errorsTotal: number;
  elementsTotal: number;
  timePenalty: { deviation: number; points: number; band: string };
  // 0..100 performance index
  index: number;
  predikat: string;
  predikatEn: string;
  correctness: { index: number; accuracy: number; completeness: number; matched: number; total: number };
  artistry: {
    index: number;
    kemantapanGerak: number;
    irama: number;
    penghayatan: number;
    tenagaStamina: number;
    stability: number;
    balance: number;
    power: number;
    stamina: number;
    contrast: number;
    flow: number;
  };
  timing: { index: number; duration: number; rhythm: number; tempo: number; hold: number; tempoRatio: number };
  steps: StepResult[];
  timeline: { t: number[]; motion: number[]; match: number[] };
  hesitations: { t: number; dur: number }[];
  feedback: FeedbackItem[];
  avgFps: number;
  visibility: number;
  settingsSnapshot: { strictness: number; allowMirror: boolean };
}

/* ================================================================== */
/*  TANDING (duel / fight) — Merah vs Biru                            */
/* ================================================================== */

/** Corner: sudut merah (red) or sudut biru (blue). Index 0 = merah, 1 = biru. */
export type Corner = 'merah' | 'biru';
export const CORNERS: Corner[] = ['merah', 'biru'];
export const cornerIndex = (c: Corner): 0 | 1 => (c === 'merah' ? 0 : 1);
export const opponentOf = (c: Corner): Corner => (c === 'merah' ? 'biru' : 'merah');

/**
 * Scoring techniques in Tanding.
 * pukulan = hand attack (punch/elbow), tendangan = foot attack (kick/knee),
 * jatuhan = dropping/takedown, kuncian = locking (body lock).
 */
export type DuelTechnique = 'pukulan' | 'tendangan' | 'jatuhan' | 'kuncian';
export const DUEL_TECHNIQUES: DuelTechnique[] = ['pukulan', 'tendangan', 'jatuhan', 'kuncian'];

/**
 * Verdict of one attack:
 * - `sah`    — valid scoring contact on a legal target (the *togok*)
 * - `ilegal` — foul: contact on an illegal target or with a forbidden technique
 * - `gagal`  — failed attempt: blocked (*ditangkis*), evaded/missed (*meleset*), or no drop/lock
 */
export type DuelEventStatus = 'sah' | 'ilegal' | 'gagal';

/** Body zones a strike can land on (see ZONE_INFO in lib/duel/rules). */
export type TargetZone =
  | 'dada' // chest — legal
  | 'perut' // abdomen above navel — legal
  | 'rusuk' // ribs — legal
  | 'punggung' // back of trunk — legal (except direct spine)
  | 'kepala' // head — ILLEGAL
  | 'leher' // neck — ILLEGAL
  | 'kemaluan' // below navel to groin — ILLEGAL
  | 'kaki' // legs — intermediate target only, non-scoring
  | 'badan' // body (takedown / lock / unspecified)
  | 'tidak-kena'; // no contact

export type PenaltyLevel = 'teguran-1' | 'teguran-2' | 'peringatan-1' | 'peringatan-2' | 'diskualifikasi';

export interface DuelEvent {
  id: string;
  /** Fighting-clock seconds since the first gong (rest periods excluded). */
  t: number;
  round: number;
  attacker: Corner;
  technique: DuelTechnique;
  status: DuelEventStatus;
  /** Why it failed, when status = gagal. */
  failReason?: 'ditangkis' | 'meleset' | 'tidak-jatuh' | 'lepas';
  zone: TargetZone;
  /** Points awarded to the attacker (0 unless sah; includes +1 counter bonus when set). */
  points: number;
  /** True when this scored as a defence + immediate counter (the IPSI "1+" bonus). */
  counterBonus?: boolean;
  /** Points deducted from the attacker for an ilegal event. */
  penalty: number;
  penaltyLevel?: PenaltyLevel;
  limb?: 'kiri' | 'kanan' | 'depan' | 'belakang';
  /** Hold duration in seconds for kuncian. */
  duration?: number;
  /** AI confidence 0..1 (1 for referee-entered events). */
  confidence: number;
  source: 'ai' | 'wasit';
  note: string;
}

export interface Duelist {
  name: string;
  team?: string;
}

export interface DuelConfig {
  merah: Duelist;
  biru: Duelist;
  /** Weight class / category label, free text (e.g. "Kelas D 60–65 kg"). */
  kelas?: string;
  rounds: number;
  roundSeconds: number;
  restSeconds: number;
}

export interface TechniqueStats {
  /** All attempts (sah + ilegal + gagal). */
  attempted: number;
  /** Valid scoring successes. */
  sah: number;
  /** Fouls with this technique. */
  ilegal: number;
  /** Blocked / missed / failed. */
  gagal: number;
  /** Blocked by the opponent (subset of gagal) — for strikes. */
  ditangkis: number;
  /** Points earned with this technique. */
  points: number;
}

export interface FighterStats {
  corner: Corner;
  name: string;
  /** Technical points minus own penalty deductions. */
  score: number;
  techniquePoints: number;
  penaltyPoints: number;
  techniques: Record<DuelTechnique, TechniqueStats>;
  totalAttempts: number;
  /** Successful (sah) techniques, all kinds. */
  totalSukses: number;
  /** sah / attempted strikes (pukulan+tendangan), 0..1 */
  strikeAccuracy: number;
  strikesPerMinute: number;
  /** Seconds spent holding a body lock on the opponent. */
  lockSeconds: number;
  fouls: number;
  /** Times this fighter was dropped by the opponent. */
  timesDropped: number;
  /** Net score earned per round (index 0 = round 1). */
  byRound: number[];
  disqualified: boolean;
}

export type DuelSource = 'camera' | 'video' | 'demo' | 'manual';

export interface DuelReport {
  id: string;
  createdAt: number;
  config: DuelConfig;
  source: DuelSource;
  /** Total fighting time actually elapsed, seconds. */
  duration: number;
  roundsCompleted: number;
  events: DuelEvent[];
  fighters: [FighterStats, FighterStats];
  winner: Corner | 'seri';
  /** e.g. "Menang angka", "Diskualifikasi", "Seri". */
  winBy: string;
  /** Cumulative score difference (merah − biru) after each scoring event. */
  momentum: { t: number; diff: number }[];
  avgFps: number;
  visibility: number;
}
