import { FEATURE_KEYS, type FeatureKey, type Features, type FeatureWeights, type Skeleton } from '../../types';
import { add, angleBetween, clamp, DEG, dot, len, mid, norm, scale, sub, vec } from '../math';

export interface FeatureMeta {
  label: string;
  labelId: string;
  kind: 'angle' | 'ratio' | 'side';
  /** Full credit tolerance */
  tol: number;
  /** Linear falloff to zero beyond tolerance */
  falloff: number;
  baseWeight: number;
  group: 'arms' | 'legs' | 'body';
  mirror: FeatureKey;
  mirrorSign: 1 | -1;
  /** Advice when the actual value is lower than target */
  lowHint: string;
  /** Advice when the actual value is higher than target */
  highHint: string;
}

const angle = (
  label: string,
  labelId: string,
  group: FeatureMeta['group'],
  mirror: FeatureKey,
  lowHint: string,
  highHint: string,
  tol = 16,
  falloff = 40,
  baseWeight = 1,
): FeatureMeta => ({ label, labelId, kind: 'angle', tol, falloff, baseWeight, group, mirror, mirrorSign: 1, lowHint, highHint });

const side = (label: string, labelId: string, group: FeatureMeta['group'], mirror: FeatureKey, limb: string): FeatureMeta => ({
  label,
  labelId,
  kind: 'side',
  tol: 0.3,
  falloff: 0.6,
  baseWeight: 0.5,
  group,
  mirror,
  mirrorSign: 1,
  lowHint: `open the ${limb} more to the side`,
  highHint: `bring the ${limb} more in front of the body`,
});

export const FEATURE_META: Record<FeatureKey, FeatureMeta> = {
  lElbow: angle('Left elbow', 'Siku kiri', 'arms', 'rElbow', 'straighten the left arm more', 'bend the left elbow more', 18, 42),
  rElbow: angle('Right elbow', 'Siku kanan', 'arms', 'lElbow', 'straighten the right arm more', 'bend the right elbow more', 18, 42),
  lShoulder: angle('Left arm height', 'Bahu kiri', 'arms', 'rShoulder', 'raise the left arm higher', 'lower the left arm', 18, 40),
  rShoulder: angle('Right arm height', 'Bahu kanan', 'arms', 'lShoulder', 'raise the right arm higher', 'lower the right arm', 18, 40),
  lArmSide: side('Left arm direction', 'Arah lengan kiri', 'arms', 'rArmSide', 'left arm'),
  rArmSide: side('Right arm direction', 'Arah lengan kanan', 'arms', 'lArmSide', 'right arm'),
  lHip: angle('Left hip / thigh', 'Pinggul kiri', 'legs', 'rHip', 'lower the left thigh (less hip flexion)', 'lift the left thigh higher / sink deeper', 15, 40),
  rHip: angle('Right hip / thigh', 'Pinggul kanan', 'legs', 'lHip', 'lower the right thigh (less hip flexion)', 'lift the right thigh higher / sink deeper', 15, 40),
  lLegSide: side('Left leg direction', 'Arah kaki kiri', 'legs', 'rLegSide', 'left leg'),
  rLegSide: side('Right leg direction', 'Arah kaki kanan', 'legs', 'lLegSide', 'right leg'),
  lKnee: angle('Left knee', 'Lutut kiri', 'legs', 'rKnee', 'straighten the left knee more', 'bend the left knee deeper', 15, 40),
  rKnee: angle('Right knee', 'Lutut kanan', 'legs', 'lKnee', 'straighten the right knee more', 'bend the right knee deeper', 15, 40),
  stance: {
    label: 'Stance width',
    labelId: 'Lebar kuda-kuda',
    kind: 'ratio',
    tol: 0.3,
    falloff: 0.75,
    baseWeight: 0.9,
    group: 'legs',
    mirror: 'stance',
    mirrorSign: 1,
    lowHint: 'widen / lengthen the stance',
    highHint: 'narrow the stance',
  },
  lean: angle('Torso lean', 'Condong badan', 'body', 'lean', 'tilt the torso more', 'keep the torso more upright', 12, 30, 0.6),
  lWristH: {
    label: 'Left hand height',
    labelId: 'Tinggi tangan kiri',
    kind: 'ratio',
    tol: 0.25,
    falloff: 0.55,
    baseWeight: 0.7,
    group: 'arms',
    mirror: 'rWristH',
    mirrorSign: 1,
    lowHint: 'raise the left hand higher',
    highHint: 'lower the left hand',
  },
  rWristH: {
    label: 'Right hand height',
    labelId: 'Tinggi tangan kanan',
    kind: 'ratio',
    tol: 0.25,
    falloff: 0.55,
    baseWeight: 0.7,
    group: 'arms',
    mirror: 'lWristH',
    mirrorSign: 1,
    lowHint: 'raise the right hand higher',
    highHint: 'lower the right hand',
  },
  handsGap: {
    label: 'Hands distance',
    labelId: 'Jarak tangan',
    kind: 'ratio',
    tol: 0.25,
    falloff: 0.6,
    baseWeight: 0.3,
    group: 'arms',
    mirror: 'handsGap',
    mirrorSign: 1,
    lowHint: 'spread the hands further apart',
    highHint: 'bring the hands closer together',
  },
  feetH: {
    label: 'Foot lift (L vs R)',
    labelId: 'Angkat kaki',
    kind: 'ratio',
    tol: 0.3,
    falloff: 0.7,
    baseWeight: 0.8,
    group: 'legs',
    mirror: 'feetH',
    mirrorSign: -1,
    lowHint: 'adjust foot height',
    highHint: 'adjust foot height',
  },
};

const UP = vec(0, 1, 0);

export function torsoLength(s: Skeleton): number {
  return Math.max(len(sub(mid(s.lShoulder, s.rShoulder), mid(s.lHip, s.rHip))), 1e-3);
}

/** Compute rotation-invariant features from a canonical (y-up) skeleton. */
export function computeFeatures(s: Skeleton): Features {
  const shMid = mid(s.lShoulder, s.rShoulder);
  const hipMid = mid(s.lHip, s.rHip);
  const torso = sub(shMid, hipMid);
  const tl = Math.max(len(torso), 1e-3);
  const leftward = norm(add(sub(s.lShoulder, s.rShoulder), sub(s.lHip, s.rHip)));
  const rightward = scale(leftward, -1);
  const lUpper = norm(sub(s.lElbow, s.lShoulder));
  const rUpper = norm(sub(s.rElbow, s.rShoulder));
  const lThigh = norm(sub(s.lKnee, s.lHip));
  const rThigh = norm(sub(s.rKnee, s.rHip));
  const ankles = sub(s.lAnkle, s.rAnkle);

  return {
    lElbow: angleBetween(sub(s.lShoulder, s.lElbow), sub(s.lWrist, s.lElbow)),
    rElbow: angleBetween(sub(s.rShoulder, s.rElbow), sub(s.rWrist, s.rElbow)),
    lShoulder: angleBetween(sub(s.lHip, s.lShoulder), sub(s.lElbow, s.lShoulder)),
    rShoulder: angleBetween(sub(s.rHip, s.rShoulder), sub(s.rElbow, s.rShoulder)),
    lArmSide: dot(lUpper, leftward),
    rArmSide: dot(rUpper, rightward),
    lHip: angleBetween(sub(s.lShoulder, s.lHip), sub(s.lKnee, s.lHip)),
    rHip: angleBetween(sub(s.rShoulder, s.rHip), sub(s.rKnee, s.rHip)),
    lLegSide: dot(lThigh, leftward),
    rLegSide: dot(rThigh, rightward),
    lKnee: angleBetween(sub(s.lHip, s.lKnee), sub(s.lAnkle, s.lKnee)),
    rKnee: angleBetween(sub(s.rHip, s.rKnee), sub(s.rAnkle, s.rKnee)),
    stance: Math.hypot(ankles.x, ankles.z) / tl,
    lean: angleBetween(torso, UP),
    lWristH: (s.lWrist.y - s.lShoulder.y) / tl,
    rWristH: (s.rWrist.y - s.rShoulder.y) / tl,
    handsGap: len(sub(s.lWrist, s.rWrist)) / tl,
    feetH: (s.lAnkle.y - s.rAnkle.y) / tl,
  };
}

/** Swap left/right features (performer executing the mirrored version). */
export function mirrorFeatures(f: Features): Features {
  const out = {} as Features;
  for (const k of FEATURE_KEYS) {
    const m = FEATURE_META[k];
    out[k] = f[m.mirror] * m.mirrorSign;
  }
  return out;
}

export function mirrorWeights(w: FeatureWeights): FeatureWeights {
  const out = {} as FeatureWeights;
  for (const k of FEATURE_KEYS) out[k] = w[FEATURE_META[k].mirror];
  return out;
}

export function averageFeatures(list: Features[]): Features {
  const out = {} as Features;
  for (const k of FEATURE_KEYS) {
    let s = 0;
    for (const f of list) s += f[k];
    out[k] = list.length ? s / list.length : 0;
  }
  return out;
}

export function formatFeature(key: FeatureKey, value: number): string {
  const m = FEATURE_META[key];
  if (m.kind === 'angle') return `${Math.round(value)}°`;
  if (m.kind === 'side') return `${Math.round(Math.asin(clamp(value, -1, 1)) / DEG)}°`;
  return `${value.toFixed(2)}×`;
}

/** Human-readable coaching tip for a feature deviation. */
export function featureTip(key: FeatureKey, actual: number, target: number, mirrored: boolean): string {
  const shownKey = mirrored ? FEATURE_META[key].mirror : key;
  const meta = FEATURE_META[shownKey];
  let hint: string;
  if (key === 'feetH') {
    if (Math.abs(target) > 0.5) hint = Math.abs(actual) < Math.abs(target) ? 'lift the kicking foot higher' : 'control the kicking leg height';
    else hint = 'keep both feet grounded and stable';
  } else {
    const base = FEATURE_META[key];
    let low = base.lowHint;
    let high = base.highHint;
    if (mirrored) {
      low = meta.lowHint;
      high = meta.highHint;
    }
    hint = actual < target ? low : high;
  }
  return `${meta.label}: ${formatFeature(key, actual)} vs ${formatFeature(key, target)} — ${hint}`;
}
