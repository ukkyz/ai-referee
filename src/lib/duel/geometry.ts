/** Small 2D helpers for duel analysis (aspect-corrected image space, y down). */

export interface Pt {
  x: number;
  y: number;
  v?: number;
}

export const dist = (a: Pt, b: Pt): number => Math.hypot(a.x - b.x, a.y - b.y);
export const mid2 = (a: Pt, b: Pt): Pt => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

/** Distance from point p to segment a-b, plus projection parameter u (0 at a, 1 at b, unclamped). */
export function pointSeg(p: Pt, a: Pt, b: Pt): { d: number; u: number; point: Pt } {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const len2 = abx * abx + aby * aby;
  const uRaw = len2 < 1e-12 ? 0 : ((p.x - a.x) * abx + (p.y - a.y) * aby) / len2;
  const u = Math.max(0, Math.min(1, uRaw));
  const point = { x: a.x + abx * u, y: a.y + aby * u };
  return { d: dist(p, point), u: uRaw, point };
}

/** Angle at vertex b between points a and c, in degrees (0..180). 180 = straight. */
export function angleAtDeg(a: Pt, b: Pt, c: Pt): number {
  const v1x = a.x - b.x;
  const v1y = a.y - b.y;
  const v2x = c.x - b.x;
  const v2y = c.y - b.y;
  const l1 = Math.hypot(v1x, v1y);
  const l2 = Math.hypot(v2x, v2y);
  if (l1 < 1e-9 || l2 < 1e-9) return 180;
  const cos = Math.max(-1, Math.min(1, (v1x * v2x + v1y * v2y) / (l1 * l2)));
  return (Math.acos(cos) * 180) / Math.PI;
}

/** Angle between segment a->b and straight up, in degrees (0 = upright, 90 = horizontal). */
export function angleFromVerticalDeg(from: Pt, to: Pt): number {
  const dx = to.x - from.x;
  const dy = from.y - to.y; // up is positive
  const l = Math.hypot(dx, dy);
  if (l < 1e-9) return 0;
  return (Math.acos(Math.max(-1, Math.min(1, dy / l))) * 180) / Math.PI;
}

/* ------------------------------------------------------------------ 3D --
 * Detector space: x = along the duel axis, y = DOWN, z = depth. Single
 * camera observations embed with z = 0; triangulated rig observations are
 * converted into this canonical frame (see rig/canonical.ts). All duel
 * detection math is written once against Pt3.
 */
export interface Pt3 {
  x: number;
  y: number;
  z: number;
  v?: number;
}

export const dist3 = (a: Pt3, b: Pt3): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
export const mid3 = (a: Pt3, b: Pt3): Pt3 => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 });

export function pointSeg3(p: Pt3, a: Pt3, b: Pt3): { d: number; u: number; point: Pt3 } {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const abz = b.z - a.z;
  const len2 = abx * abx + aby * aby + abz * abz;
  const uRaw = len2 < 1e-12 ? 0 : ((p.x - a.x) * abx + (p.y - a.y) * aby + (p.z - a.z) * abz) / len2;
  const u = Math.max(0, Math.min(1, uRaw));
  const point = { x: a.x + abx * u, y: a.y + aby * u, z: a.z + abz * u };
  return { d: dist3(p, point), u: uRaw, point };
}

export function angleAtDeg3(a: Pt3, b: Pt3, c: Pt3): number {
  const v1 = { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
  const v2 = { x: c.x - b.x, y: c.y - b.y, z: c.z - b.z };
  const l1 = Math.hypot(v1.x, v1.y, v1.z);
  const l2 = Math.hypot(v2.x, v2.y, v2.z);
  if (l1 < 1e-9 || l2 < 1e-9) return 180;
  const cos = Math.max(-1, Math.min(1, (v1.x * v2.x + v1.y * v2.y + v1.z * v2.z) / (l1 * l2)));
  return (Math.acos(cos) * 180) / Math.PI;
}

/** Angle between segment from->to and straight up (up = -y in detector space). */
export function angleFromUpDeg3(from: Pt3, to: Pt3): number {
  const dx = to.x - from.x;
  const dy = from.y - to.y;
  const dz = to.z - from.z;
  const l = Math.hypot(dx, dy, dz);
  if (l < 1e-9) return 0;
  return (Math.acos(Math.max(-1, Math.min(1, dy / l))) * 180) / Math.PI;
}
