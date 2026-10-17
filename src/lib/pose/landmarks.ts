import { JOINTS, type FeatureKey, type JointName, type Skeleton } from '../../types';

export interface Landmark2D {
  x: number;
  y: number;
  v: number;
}

export interface RawLandmark {
  x: number;
  y: number;
  z: number;
  visibility?: number;
}

export const MP_INDEX: Record<JointName, number> = {
  nose: 0,
  lShoulder: 11,
  rShoulder: 12,
  lElbow: 13,
  rElbow: 14,
  lWrist: 15,
  rWrist: 16,
  lHip: 23,
  rHip: 24,
  lKnee: 25,
  rKnee: 26,
  lAnkle: 27,
  rAnkle: 28,
  lFoot: 31,
  rFoot: 32,
};

export const BONES: [JointName, JointName][] = [
  ['lShoulder', 'rShoulder'],
  ['lShoulder', 'lElbow'],
  ['lElbow', 'lWrist'],
  ['rShoulder', 'rElbow'],
  ['rElbow', 'rWrist'],
  ['lShoulder', 'lHip'],
  ['rShoulder', 'rHip'],
  ['lHip', 'rHip'],
  ['lHip', 'lKnee'],
  ['lKnee', 'lAnkle'],
  ['rHip', 'rKnee'],
  ['rKnee', 'rAnkle'],
  ['lAnkle', 'lFoot'],
  ['rAnkle', 'rFoot'],
];

/** Features that drive the colour of each bone in the live overlay. */
export const BONE_FEATURES: Record<string, FeatureKey[]> = {
  'lShoulder-rShoulder': ['lean'],
  'lShoulder-lElbow': ['lShoulder', 'lArmSide'],
  'lElbow-lWrist': ['lElbow', 'lWristH'],
  'rShoulder-rElbow': ['rShoulder', 'rArmSide'],
  'rElbow-rWrist': ['rElbow', 'rWristH'],
  'lShoulder-lHip': ['lean'],
  'rShoulder-rHip': ['lean'],
  'lHip-rHip': ['stance'],
  'lHip-lKnee': ['lHip', 'lLegSide'],
  'lKnee-lAnkle': ['lKnee', 'stance'],
  'rHip-rKnee': ['rHip', 'rLegSide'],
  'rKnee-rAnkle': ['rKnee', 'stance'],
  'lAnkle-lFoot': ['feetH'],
  'rAnkle-rFoot': ['feetH'],
};

/** MediaPipe world landmarks (y down, z away) -> canonical (y up, z towards camera). */
export function worldToSkeleton(world: RawLandmark[]): Skeleton {
  const s = {} as Skeleton;
  for (const j of JOINTS) {
    const p = world[MP_INDEX[j]];
    s[j] = { x: p.x, y: -p.y, z: -p.z };
  }
  return s;
}

export function toLandmarks2D(lms: RawLandmark[]): Landmark2D[] {
  return lms.map((p) => ({ x: p.x, y: p.y, v: p.visibility ?? 1 }));
}

const KEY_IDX = [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28];

export function keyVisibility(lms: RawLandmark[]): number {
  let s = 0;
  for (const i of KEY_IDX) s += lms[i]?.visibility ?? 0;
  return s / KEY_IDX.length;
}

export function smoothSkeleton(prev: Skeleton, next: Skeleton, alpha: number): Skeleton {
  const out = {} as Skeleton;
  for (const j of JOINTS) {
    const a = prev[j];
    const b = next[j];
    out[j] = { x: a.x + (b.x - a.x) * alpha, y: a.y + (b.y - a.y) * alpha, z: a.z + (b.z - a.z) * alpha };
  }
  return out;
}

export function smooth2D(prev: Landmark2D[], next: Landmark2D[], alpha: number): Landmark2D[] {
  return next.map((b, i) => {
    const a = prev[i];
    if (!a) return b;
    return { x: a.x + (b.x - a.x) * alpha, y: a.y + (b.y - a.y) * alpha, v: b.v };
  });
}

export interface FrameCheck {
  ok: boolean;
  issue: string | null;
}

/** Check whether the full body is inside the camera frame. */
export function bodyInFrame(lm: Landmark2D[] | null | undefined): FrameCheck {
  if (!lm || lm.length < 33) return { ok: false, issue: 'No performer detected' };
  const inside = (i: number, margin = 0.005) =>
    lm[i].v > 0.45 && lm[i].x > margin && lm[i].x < 1 - margin && lm[i].y > margin && lm[i].y < 1 - margin;
  if (!inside(27) || !inside(28)) return { ok: false, issue: 'Feet not visible — step back' };
  if (!inside(0)) return { ok: false, issue: 'Head cut off — step back' };
  if (!inside(15) || !inside(16)) return { ok: false, issue: 'Hands leaving frame' };
  if (!inside(23) || !inside(24)) return { ok: false, issue: 'Hips not visible' };
  return { ok: true, issue: null };
}
