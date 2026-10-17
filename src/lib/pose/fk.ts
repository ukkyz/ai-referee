import { JOINTS, type JointName, type Skeleton, type Vec3 } from '../../types';
import { add, DEG, norm, scale, sub } from '../math';

/** Direction as [azimuth, elevation] in degrees.
 * azimuth: 0 = forward, +90 = performer's left, -90 = performer's right, 180 = backward
 * elevation: -90 = straight down, 0 = horizontal, +90 = straight up */
export type Dir = [number, number];

export interface PoseSpec {
  lUpper: Dir;
  lFore: Dir;
  rUpper: Dir;
  rFore: Dir;
  lThigh: Dir;
  lShin: Dir;
  rThigh: Dir;
  rShin: Dir;
  /** forward (+) / backward (-) torso lean in degrees */
  lean?: number;
  /** lean towards performer's left (+) / right (-) */
  sideLean?: number;
  /** torso rotation, + = turning to the left (right shoulder forward) */
  twist?: number;
  lFootAz?: number;
  rFootAz?: number;
}

const L = {
  torso: 0.5,
  shoulderHalf: 0.19,
  hipHalf: 0.11,
  upper: 0.29,
  fore: 0.27,
  thigh: 0.43,
  shin: 0.42,
  foot: 0.14,
};

export function dirVec([az, el]: Dir): Vec3 {
  const a = az * DEG;
  const e = el * DEG;
  return { x: Math.cos(e) * Math.sin(a), y: Math.sin(e), z: Math.cos(e) * Math.cos(a) };
}

export function buildSkeleton(p: PoseSpec): Skeleton {
  const lean = (p.lean ?? 0) * DEG;
  const sideL = (p.sideLean ?? 0) * DEG;
  const twist = (p.twist ?? 0) * DEG;
  const hipMid: Vec3 = { x: 0, y: 0, z: 0 };
  const lHip: Vec3 = { x: L.hipHalf, y: 0, z: 0 };
  const rHip: Vec3 = { x: -L.hipHalf, y: 0, z: 0 };
  const up = norm({
    x: Math.sin(sideL),
    y: Math.cos(sideL) * Math.cos(lean),
    z: Math.cos(sideL) * Math.sin(lean),
  });
  const shMid = add(hipMid, scale(up, L.torso));
  const lat: Vec3 = { x: Math.cos(twist), y: 0, z: -Math.sin(twist) };
  const fwd: Vec3 = { x: Math.sin(twist), y: 0, z: Math.cos(twist) };
  const lShoulder = add(shMid, scale(lat, L.shoulderHalf));
  const rShoulder = sub(shMid, scale(lat, L.shoulderHalf));
  const lElbow = add(lShoulder, scale(dirVec(p.lUpper), L.upper));
  const lWrist = add(lElbow, scale(dirVec(p.lFore), L.fore));
  const rElbow = add(rShoulder, scale(dirVec(p.rUpper), L.upper));
  const rWrist = add(rElbow, scale(dirVec(p.rFore), L.fore));
  const lKnee = add(lHip, scale(dirVec(p.lThigh), L.thigh));
  const lAnkle = add(lKnee, scale(dirVec(p.lShin), L.shin));
  const rKnee = add(rHip, scale(dirVec(p.rThigh), L.thigh));
  const rAnkle = add(rKnee, scale(dirVec(p.rShin), L.shin));
  const lFoot = add(lAnkle, scale(dirVec([p.lFootAz ?? 18, -8]), L.foot));
  const rFoot = add(rAnkle, scale(dirVec([p.rFootAz ?? -18, -8]), L.foot));
  const nose = add(shMid, add(scale(up, 0.21), scale(fwd, 0.05)));
  return { nose, lShoulder, rShoulder, lElbow, rElbow, lWrist, rWrist, lHip, rHip, lKnee, rKnee, lAnkle, rAnkle, lFoot, rFoot };
}

const flipDir = ([az, el]: Dir): Dir => [-az, el];

/** Mirror a pose spec left <-> right. */
export function mirrorSpec(p: PoseSpec): PoseSpec {
  return {
    lUpper: flipDir(p.rUpper),
    lFore: flipDir(p.rFore),
    rUpper: flipDir(p.lUpper),
    rFore: flipDir(p.lFore),
    lThigh: flipDir(p.rThigh),
    lShin: flipDir(p.rShin),
    rThigh: flipDir(p.lThigh),
    rShin: flipDir(p.lShin),
    lean: p.lean,
    sideLean: p.sideLean !== undefined ? -p.sideLean : undefined,
    twist: p.twist !== undefined ? -p.twist : undefined,
    lFootAz: p.rFootAz !== undefined ? -p.rFootAz : undefined,
    rFootAz: p.lFootAz !== undefined ? -p.lFootAz : undefined,
  };
}

const SWAP: Record<JointName, JointName> = {
  nose: 'nose',
  lShoulder: 'rShoulder',
  rShoulder: 'lShoulder',
  lElbow: 'rElbow',
  rElbow: 'lElbow',
  lWrist: 'rWrist',
  rWrist: 'lWrist',
  lHip: 'rHip',
  rHip: 'lHip',
  lKnee: 'rKnee',
  rKnee: 'lKnee',
  lAnkle: 'rAnkle',
  rAnkle: 'lAnkle',
  lFoot: 'rFoot',
  rFoot: 'lFoot',
};

/** Mirror a skeleton across the sagittal plane. */
export function mirrorSkeleton(s: Skeleton): Skeleton {
  const out = {} as Skeleton;
  for (const j of JOINTS) {
    const p = s[SWAP[j]];
    out[j] = { x: -p.x, y: p.y, z: p.z };
  }
  return out;
}

/** Rotate a skeleton about the vertical axis so that it faces the camera (+z). */
export function normalizeFacing(s: Skeleton): Skeleton {
  const ax = s.lHip.x - s.rHip.x + s.lShoulder.x - s.rShoulder.x;
  const az = s.lHip.z - s.rHip.z + s.lShoulder.z - s.rShoulder.z;
  const th = Math.atan2(az, ax);
  if (Math.abs(th) < 1e-4) return s;
  const c = Math.cos(th);
  const sn = Math.sin(th);
  const hx = (s.lHip.x + s.rHip.x) / 2;
  const hz = (s.lHip.z + s.rHip.z) / 2;
  const out = {} as Skeleton;
  for (const j of JOINTS) {
    const p = s[j];
    const x = p.x - hx;
    const z = p.z - hz;
    out[j] = { x: x * c + z * sn, y: p.y, z: -x * sn + z * c };
  }
  return out;
}
