import { FEATURE_KEYS, type FeatureKey, type FeatureWeights, type PoseCategory, type RefPose } from '../types';
import { buildSkeleton, mirrorSpec, type Dir, type PoseSpec } from '../lib/pose/fk';
import { computeFeatures, FEATURE_META } from '../lib/pose/features';

interface PoseDef {
  id: string;
  name: string;
  nameEn: string;
  category: PoseCategory;
  description: string;
  cue: string;
  spec: PoseSpec;
  focus?: Partial<Record<'arms' | 'legs' | 'body', number>>;
  weights?: Partial<Record<FeatureKey, number>>;
}

export function makePose(def: PoseDef): RefPose {
  const skeleton = buildSkeleton(def.spec);
  const features = computeFeatures(skeleton);
  const weights = {} as FeatureWeights;
  for (const k of FEATURE_KEYS) {
    const m = FEATURE_META[k];
    const focus = def.focus?.[m.group] ?? 1;
    weights[k] = def.weights?.[k] ?? m.baseWeight * focus;
  }
  return {
    id: def.id,
    name: def.name,
    nameEn: def.nameEn,
    category: def.category,
    description: def.description,
    cue: def.cue,
    features,
    weights,
    skeleton,
  };
}

function swapLR(text: string): string {
  return text
    .replace(/\bleft\b/g, '§L§')
    .replace(/\bright\b/g, 'left')
    .replace(/§L§/g, 'right')
    .replace(/\bLeft\b/g, '§LL§')
    .replace(/\bRight\b/g, 'Left')
    .replace(/§LL§/g, 'Right')
    .replace(/\bKiri\b/g, '§K§')
    .replace(/\bKanan\b/g, 'Kiri')
    .replace(/§K§/g, 'Kanan');
}

function mirrorDef(def: PoseDef, id: string): PoseDef {
  const weights: Partial<Record<FeatureKey, number>> = {};
  if (def.weights) {
    for (const [k, val] of Object.entries(def.weights)) {
      weights[FEATURE_META[k as FeatureKey].mirror] = val;
    }
  }
  return {
    ...def,
    id,
    name: swapLR(def.name),
    nameEn: swapLR(def.nameEn),
    description: swapLR(def.description),
    cue: swapLR(def.cue),
    spec: mirrorSpec(def.spec),
    weights,
  };
}

// ---- Reusable limb configurations -------------------------------------------------
type Limb = [Dir, Dir];
const CHAMBER_L: Limb = [[170, -55], [5, -5]];
const CHAMBER_R: Limb = [[-170, -55], [-5, -5]];
const GUARD_CHEST_R: Limb = [[-25, -60], [70, 35]];
const HIGH_GUARD_L: Limb = [[30, -45], [-30, 45]];

const arms = (l: Limb, r: Limb) => ({ lUpper: l[0], lFore: l[1], rUpper: r[0], rFore: r[1] });

const FRONT_STANCE_L = {
  lThigh: [10, -40] as Dir,
  lShin: [0, -88] as Dir,
  rThigh: [-170, -55] as Dir,
  rShin: [-170, -55] as Dir,
};
const HORSE = {
  lThigh: [65, -22] as Dir,
  lShin: [70, -82] as Dir,
  rThigh: [-65, -22] as Dir,
  rShin: [-70, -82] as Dir,
};

// ---- Base definitions -------------------------------------------------------------
const HORMAT: PoseDef = {
  id: 'sikap-hormat',
  name: 'Sikap Hormat',
  nameEn: 'Salutation',
  category: 'sikap',
  description: 'Opening and closing salute. Stand tall with feet together and palms pressed together in front of the chest.',
  cue: 'Palms together at chest height, elbows relaxed, feet together.',
  spec: { lUpper: [40, -50], lFore: [-75, 15], rUpper: [-40, -50], rFore: [75, 15], lThigh: [-90, -86], lShin: [-90, -87], rThigh: [90, -86], rShin: [90, -87] },
  focus: { legs: 0.8 },
  weights: { handsGap: 2.5, lWristH: 1.2, rWristH: 1.2, lElbow: 1.1, rElbow: 1.1, stance: 1.1, lean: 0.8 },
};

const SIAP: PoseDef = {
  id: 'sikap-siap',
  name: 'Sikap Siap',
  nameEn: 'Ready Stance',
  category: 'sikap',
  description: 'Upright ready position with feet hip-width apart and both fists chambered at the waist.',
  cue: 'Stand tall, fists at the waist, eyes forward.',
  spec: { ...arms(CHAMBER_L, CHAMBER_R), lThigh: [0, -90], lShin: [0, -90], rThigh: [0, -90], rShin: [0, -90] },
  weights: { stance: 1.1, lKnee: 1.1, rKnee: 1.1 },
};

const PASANG: PoseDef = {
  id: 'sikap-pasang',
  name: 'Sikap Pasang',
  nameEn: 'Guard Stance (left lead)',
  category: 'sikap',
  description: 'Fighting guard: left leg forward, left hand extended as a shield, right forearm guarding the chest.',
  cue: 'Lead hand forward at chest height, rear hand protects the body.',
  spec: { lUpper: [20, -30], lFore: [10, 10], rUpper: [-25, -60], rFore: [70, 35], lThigh: [15, -55], lShin: [5, -85], rThigh: [-165, -62], rShin: [-165, -70], lean: 5, twist: -10 },
};

const KUDA_TENGAH: PoseDef = {
  id: 'kuda-tengah',
  name: 'Kuda-kuda Tengah',
  nameEn: 'Horse Stance',
  category: 'kuda-kuda',
  description: 'Wide, low and symmetrical stance with both knees bent and fists chambered at the waist.',
  cue: 'Sink low, knees pushed out over the toes, back straight.',
  spec: { ...arms(CHAMBER_L, CHAMBER_R), ...HORSE },
  focus: { legs: 1.4, arms: 0.6 },
  weights: { stance: 1.4 },
};

const PUKUL_KANAN: PoseDef = {
  id: 'pukulan-lurus-kanan',
  name: 'Pukulan Lurus Kanan',
  nameEn: 'Right Straight Punch',
  category: 'pukulan',
  description: 'Front stance with the left leg forward; the right fist drives straight forward at shoulder height while the left fist returns to the waist.',
  cue: 'Full extension, fist at shoulder height, rear leg straight.',
  spec: { ...arms(CHAMBER_L, [[-4, -2], [-2, -2]]), ...FRONT_STANCE_L, lean: 5, twist: 15 },
  weights: { rElbow: 1.3, rShoulder: 1.3, rWristH: 1.0, rArmSide: 0.8 },
};

const TANGKIS_ATAS_KANAN: PoseDef = {
  id: 'tangkisan-atas-kanan',
  name: 'Tangkisan Atas Kanan',
  nameEn: 'Right High Block',
  category: 'tangkisan',
  description: 'Front stance; the right forearm sweeps up to shield above the forehead while the left fist stays at the waist.',
  cue: 'Forearm above the forehead, elbow bent about 90°.',
  spec: { ...arms(CHAMBER_L, [[-30, 35], [60, 5]]), ...FRONT_STANCE_L, twist: 10 },
  weights: { rWristH: 1.4, rElbow: 1.2, rShoulder: 1.3 },
};

const TANGKIS_LUAR_KIRI: PoseDef = {
  id: 'tangkisan-luar-kiri',
  name: 'Tangkisan Luar Kiri',
  nameEn: 'Left Outer Block (back stance)',
  category: 'tangkisan',
  description: 'Back stance (kuda-kuda belakang) with weight on the bent rear leg; the left forearm stands vertical to deflect outward.',
  cue: 'Weight on the back leg, forearm vertical, elbow at shoulder line.',
  spec: { lUpper: [75, -10], lFore: [15, 72], ...{ rUpper: GUARD_CHEST_R[0], rFore: GUARD_CHEST_R[1] }, lThigh: [5, -50], lShin: [5, -62], rThigh: [-130, -35], rShin: [-120, -86] },
  weights: { lElbow: 1.2, lShoulder: 1.2, lArmSide: 0.9, rKnee: 1.3, lWristH: 1.0 },
};

const TENDANG_DEPAN_KANAN: PoseDef = {
  id: 'tendangan-depan-kanan',
  name: 'Tendangan Depan Kanan',
  nameEn: 'Right Front Kick',
  category: 'tendangan',
  description: 'Standing on the left leg, the right leg snaps forward to full extension at hip height while the hands keep guard.',
  cue: 'Chamber the knee, extend fully, keep the guard up.',
  spec: { ...arms(HIGH_GUARD_L, [[-30, -60], [40, 20]]), lThigh: [0, -84], lShin: [0, -88], rThigh: [0, 5], rShin: [0, 2], lean: -8, rFootAz: 0 },
  focus: { arms: 0.5 },
  weights: { feetH: 1.6, rHip: 1.5, rKnee: 1.3 },
};

const TENDANG_SAMPING_KIRI: PoseDef = {
  id: 'tendangan-samping-kiri',
  name: 'Tendangan Samping Kiri',
  nameEn: 'Left Side Kick (T-kick)',
  category: 'tendangan',
  description: 'The signature silat T-kick: the body tilts away while the left leg thrusts out sideways, heel first.',
  cue: 'Tilt the torso away, push through the heel, hips aligned.',
  spec: { lUpper: [70, -50], lFore: [-20, 40], rUpper: [-40, -40], rFore: [40, 30], lThigh: [90, 5], lShin: [90, 2], rThigh: [0, -84], rShin: [0, -88], sideLean: -35, lFootAz: 90 },
  focus: { arms: 0.5 },
  weights: { feetH: 1.6, lLegSide: 1.4, lHip: 1.2, lKnee: 1.3, lean: 1.0 },
};

const TENDANG_SABIT_KANAN: PoseDef = {
  id: 'tendangan-sabit-kanan',
  name: 'Tendangan Sabit Kanan',
  nameEn: 'Right Crescent Kick',
  category: 'tendangan',
  description: 'Roundhouse-style "sickle" kick: the right leg whips in an arc and lands extended diagonally at mid height.',
  cue: 'Pivot the standing foot, whip the instep, recoil fast.',
  spec: { ...arms(HIGH_GUARD_L, [[-120, -50], [-150, -40]]), lThigh: [10, -84], lShin: [10, -88], rThigh: [-45, 15], rShin: [-40, 10], sideLean: 20, lean: -10, rFootAz: -45 },
  focus: { arms: 0.5 },
  weights: { feetH: 1.6, rHip: 1.4, rKnee: 1.2, rLegSide: 1.0 },
};

const PASANG_RENDAH: PoseDef = {
  id: 'pasang-rendah',
  name: 'Sikap Pasang Rendah',
  nameEn: 'Low Side Guard',
  category: 'kuda-kuda',
  description: 'Very low stance: right knee deeply bent, left leg extended straight to the side, guarding along the extended leg.',
  cue: 'Sit deep on the bent leg, extended leg straight, chest proud.',
  spec: { lUpper: [70, -20], lFore: [55, 10], rUpper: [-10, -55], rFore: [75, 30], rThigh: [-60, -12], rShin: [-50, -88], lThigh: [88, -35], lShin: [88, -35], lean: 15, lFootAz: 30 },
  focus: { legs: 1.3 },
  weights: { rKnee: 1.5, lKnee: 1.1, stance: 1.3, lLegSide: 1.0 },
};

const TEBASAN_KANAN: PoseDef = {
  id: 'tebasan-kanan',
  name: 'Tebasan Samping Kanan',
  nameEn: 'Right Side Chop',
  category: 'pukulan',
  description: 'From the horse stance the right arm slices out to the side at shoulder height, palm edge leading.',
  cue: 'Arm straight to the side at shoulder level, stance stays low.',
  spec: { ...arms(CHAMBER_L, [[-90, -5], [-90, -5]]), ...HORSE },
  weights: { rArmSide: 1.3, rElbow: 1.2, rShoulder: 1.2, stance: 1.2 },
};

const ELAKAN_KANAN: PoseDef = {
  id: 'elakan-samping-kanan',
  name: 'Elakan Samping Kanan',
  nameEn: 'Right Side Evasion',
  category: 'elakan',
  description: 'Evasion: the torso slips sideways to the right over a bent right knee while both hands guard the head.',
  cue: 'Shift weight right, tilt the torso, hands stay up.',
  spec: { lUpper: [40, -40], lFore: [-40, 50], rUpper: [-40, -50], rFore: [40, 40], rThigh: [-70, -35], rShin: [-60, -85], lThigh: [80, -50], lShin: [80, -50], sideLean: -25 },
  weights: { lean: 1.4, rKnee: 1.2 },
};

const BASE_DEFS: PoseDef[] = [
  HORMAT,
  SIAP,
  PASANG,
  mirrorDef(PASANG, 'sikap-pasang-kanan'),
  KUDA_TENGAH,
  PASANG_RENDAH,
  PUKUL_KANAN,
  mirrorDef(PUKUL_KANAN, 'pukulan-lurus-kiri'),
  TEBASAN_KANAN,
  mirrorDef(TEBASAN_KANAN, 'tebasan-kiri'),
  TANGKIS_ATAS_KANAN,
  mirrorDef(TANGKIS_ATAS_KANAN, 'tangkisan-atas-kiri'),
  TANGKIS_LUAR_KIRI,
  mirrorDef(TANGKIS_LUAR_KIRI, 'tangkisan-luar-kanan'),
  TENDANG_DEPAN_KANAN,
  mirrorDef(TENDANG_DEPAN_KANAN, 'tendangan-depan-kiri'),
  TENDANG_SAMPING_KIRI,
  mirrorDef(TENDANG_SAMPING_KIRI, 'tendangan-samping-kanan'),
  TENDANG_SABIT_KANAN,
  mirrorDef(TENDANG_SABIT_KANAN, 'tendangan-sabit-kiri'),
  ELAKAN_KANAN,
  mirrorDef(ELAKAN_KANAN, 'elakan-samping-kiri'),
];

// Fix the mirrored guard's English name
const pasangKanan = BASE_DEFS.find((d) => d.id === 'sikap-pasang-kanan');
if (pasangKanan) {
  pasangKanan.name = 'Sikap Pasang Kanan';
  pasangKanan.nameEn = 'Guard Stance (right lead)';
}

export const POSES: RefPose[] = BASE_DEFS.map(makePose);

export const POSE_MAP: Record<string, RefPose> = Object.fromEntries(POSES.map((p) => [p.id, p]));

export const CATEGORY_INFO: Record<PoseCategory, { label: string; en: string; color: string }> = {
  sikap: { label: 'Sikap', en: 'Attitude', color: '#e5b53a' },
  'kuda-kuda': { label: 'Kuda-kuda', en: 'Stance', color: '#f59e0b' },
  pukulan: { label: 'Pukulan', en: 'Strike', color: '#ef4444' },
  tangkisan: { label: 'Tangkisan', en: 'Block', color: '#38bdf8' },
  tendangan: { label: 'Tendangan', en: 'Kick', color: '#a78bfa' },
  elakan: { label: 'Elakan', en: 'Evasion', color: '#34d399' },
  custom: { label: 'Rekaman', en: 'Captured', color: '#f472b6' },
};
