import { JOINTS, type JointName } from '../../../types';
import type { FighterObs } from '../fightDetector';
import type { Pt3 } from '../geometry';
import type { WorldPoint } from './calibration';
import type { Joint3D } from './triangulate';

/**
 * Canonical duel-plane conversion.
 *
 * The event detector works in a fighter-centric frame: x along the line
 * between the two fighters (the axis strikes travel on), y down, z depth
 * across that line. Triangulated world skeletons (metres, y up) are rotated
 * into this frame every frame, so detection quality no longer depends on
 * where any single physical camera happens to stand — the "virtual camera"
 * is always side-on to the exchange, with true depth in z.
 */

export interface Fighter3D {
  joints: Record<JointName, Joint3D | null>;
  centroid: WorldPoint | null;
  /** Mean joint confidence 0..1. */
  visibility: number;
  /** Mean reprojection error (px) across triangulated joints. */
  meanErrorPx: number;
  /** Joints successfully triangulated (of 15). */
  validJoints: number;
}

export function hipCentroid(joints: Record<JointName, Joint3D | null>): WorldPoint | null {
  const l = joints.lHip;
  const r = joints.rHip;
  if (l && r) return { x: (l.x + r.x) / 2, y: (l.y + r.y) / 2, z: (l.z + r.z) / 2 };
  const any = l ?? r;
  return any ? { x: any.x, y: any.y, z: any.z } : null;
}

export class DuelCanonicalizer {
  /** Last duel-axis direction (world, horizontal) — kept continuous across crossings. */
  private lastU: WorldPoint = { x: 1, y: 0, z: 0 };

  reset() {
    this.lastU = { x: 1, y: 0, z: 0 };
  }

  convert(fighters: [Fighter3D | null, Fighter3D | null]): [FighterObs | null, FighterObs | null] {
    const c0 = fighters[0]?.centroid ?? null;
    const c1 = fighters[1]?.centroid ?? null;
    if (c0 && c1) {
      const dx = c1.x - c0.x;
      const dz = c1.z - c0.z;
      const len = Math.hypot(dx, dz);
      if (len > 0.15) {
        let u = { x: dx / len, y: 0, z: dz / len };
        // Keep the axis orientation stable in the world: when fighters cross,
        // they swap x-order instead of the whole frame mirroring (velocity spike).
        if (u.x * this.lastU.x + u.z * this.lastU.z < 0) u = { x: -u.x, y: 0, z: -u.z };
        this.lastU = u;
      }
    }
    const u = this.lastU;
    // w = up x u  (horizontal, perpendicular to the duel axis)
    const w: WorldPoint = { x: -u.z, y: 0, z: u.x };

    const convertOne = (f: Fighter3D | null): FighterObs | null => {
      if (!f || f.validJoints < 9) return null;
      const hip = hipCentroid(f.joints);
      if (!hip) return null;
      const joints = {} as Record<JointName, Pt3>;
      for (const j of JOINTS) {
        const p = f.joints[j] ?? { x: hip.x, y: hip.y, z: hip.z, confidence: 0 };
        joints[j] = {
          x: p.x * u.x + p.z * u.z,
          y: -p.y,
          z: p.x * w.x + p.z * w.z,
          v: f.joints[j] ? f.joints[j]!.confidence : 0,
        };
      }
      return { joints, visibility: f.visibility };
    };

    return [convertOne(fighters[0]), convertOne(fighters[1])];
  }
}
