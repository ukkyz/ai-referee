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
