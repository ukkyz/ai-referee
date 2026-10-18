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
