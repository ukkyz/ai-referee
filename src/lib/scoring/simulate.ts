import { JOINTS, type FrameSample, type Jurus, type Skeleton, type Vec3 } from '../../types';
import { computeFeatures } from '../pose/features';
import { POSE_MAP } from '../../data/poses';

export type DemoSkill = 'pendekar' | 'pesilat' | 'pemula';

export const DEMO_PROFILES: Record<DemoSkill, { label: string; en: string; tempo: number; jitter: number; err: number; noise: number; miss: number; hesitations: number; burst: number; depthLoss: number; holdScale: number; sway: number }> = {
  pendekar: { label: 'Pendekar', en: 'Master', tempo: 1.0, jitter: 0.12, err: 0.025, noise: 0.005, miss: 0, hesitations: 0, burst: 0.42, depthLoss: 0, holdScale: 1, sway: 0.003 },
  pesilat: { label: 'Pesilat', en: 'Intermediate', tempo: 1.05, jitter: 0.3, err: 0.06, noise: 0.007, miss: 0.08, hesitations: 1, burst: 0.65, depthLoss: 0.1, holdScale: 0.85, sway: 0.012 },
  pemula: { label: 'Pemula', en: 'Beginner', tempo: 1.2, jitter: 0.55, err: 0.1, noise: 0.009, miss: 0.16, hesitations: 2, burst: 1.0, depthLoss: 0.25, holdScale: 0.6, sway: 0.03 },
};

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function lerpSkel(a: Skeleton, b: Skeleton, u: number): Skeleton {
  const out = {} as Skeleton;
  for (const j of JOINTS) out[j] = { x: a[j].x + (b[j].x - a[j].x) * u, y: a[j].y + (b[j].y - a[j].y) * u, z: a[j].z + (b[j].z - a[j].z) * u };
  return out;
}

const ease = (u: number) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2);

interface Key {
  t: number;
  hold: number;
  skel: Skeleton;
  freeze?: boolean;
}

/** Synthesise a full performance of a jurus for demo / self-test purposes. */
export function simulatePerformance(jurus: Jurus, skill: DemoSkill, seed = Date.now()): { frames: FrameSample[]; duration: number } {
  const P = DEMO_PROFILES[skill];
  const rng = mulberry32(seed);
  const gauss = () => {
    const u = Math.max(1e-9, rng());
    const v = rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  const rv = (s: number): Vec3 => ({ x: gauss() * s, y: gauss() * s, z: gauss() * s });
  const neutral = POSE_MAP['sikap-siap'].skeleton;

  const perturb = (s: Skeleton): Skeleton => {
    const base = P.depthLoss > 0 ? lerpSkel(s, neutral, P.depthLoss * (0.6 + 0.8 * rng())) : s;
    const out = { ...base };
    const add = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
    for (const side of ['l', 'r'] as const) {
      const o1 = rv(P.err);
      const o2 = rv(P.err);
      out[`${side}Elbow`] = add(base[`${side}Elbow`], o1);
      out[`${side}Wrist`] = add(base[`${side}Wrist`], add(o1, o2));
      const o3 = rv(P.err * 0.8);
      const o4 = rv(P.err * 0.6);
      out[`${side}Knee`] = add(base[`${side}Knee`], o3);
      out[`${side}Ankle`] = add(base[`${side}Ankle`], add(o3, o4));
      out[`${side}Foot`] = add(base[`${side}Foot`], add(o3, o4));
    }
    return out;
  };

  // ---- key-frame plan ----
  const keys: Key[] = [{ t: 0, hold: 0.8, skel: neutral }];
  const K = jurus.steps.length;
  let shift = 0;
  const hesitationAt = new Set<number>();
  for (let h = 0; h < P.hesitations; h++) hesitationAt.add(1 + Math.floor(rng() * Math.max(1, K - 2)));
  for (let i = 0; i < K; i++) {
    const st = jurus.steps[i];
    if (i > 0 && i < K - 1 && rng() < P.miss) continue;
    const prev = keys[keys.length - 1];
    if (hesitationAt.has(i) && keys.length > 1) {
      const freezeT = prev.t + prev.hold + 0.6;
      keys.push({ t: freezeT, hold: 2.2, skel: lerpSkel(prev.skel, st.pose.skeleton, 0.45), freeze: true });
      shift += 2.6;
    }
    const last = keys[keys.length - 1];
    let t = st.t * P.tempo + shift + gauss() * P.jitter;
    t = Math.max(t, last.t + last.hold + Math.max(0.35, P.burst * 0.8));
    keys.push({ t, hold: Math.max(0.3, st.hold * P.holdScale * (0.85 + 0.3 * rng())), skel: perturb(st.pose.skeleton) });
  }
  const end = keys[keys.length - 1];
  const duration = end.t + end.hold + 0.8 + rng() * 0.6;

  // ---- frame synthesis (30 fps) with correlated sensor noise ----
  const fps = 30;
  const frames: FrameSample[] = [];
  const noiseState = {} as Record<string, Vec3>;
  for (const j of JOINTS) noiseState[j] = { x: 0, y: 0, z: 0 };
  let ki = 0;
  for (let t = 0; t <= duration; t += 1 / fps) {
    while (ki < keys.length - 1 && t >= keys[ki + 1].t) ki++;
    const cur = keys[ki];
    const nxt = keys[ki + 1];
    let skel: Skeleton = cur.skel;
    if (nxt) {
      const moveStart = Math.max(cur.t + cur.hold, nxt.t - P.burst);
      if (t > moveStart) {
        const u = Math.min(1, (t - moveStart) / Math.max(0.05, nxt.t - moveStart));
        skel = lerpSkel(cur.skel, nxt.skel, ease(u));
      }
    }
    const sway = cur.freeze ? 0 : P.sway * Math.sin(t * 2 * Math.PI * 1.4);
    const noisy = {} as Skeleton;
    for (const j of JOINTS) {
      const n = noiseState[j];
      n.x = 0.85 * n.x + gauss() * P.noise * 0.5;
      n.y = 0.85 * n.y + gauss() * P.noise * 0.5;
      n.z = 0.85 * n.z + gauss() * P.noise * 0.8;
      const p = skel[j];
      const sw = j === 'lAnkle' || j === 'rAnkle' || j === 'lFoot' || j === 'rFoot' ? 0 : sway;
      noisy[j] = { x: p.x + n.x + sw, y: p.y + n.y, z: p.z + n.z + sw * 0.5 };
    }
    frames.push({ t: +t.toFixed(4), features: computeFeatures(noisy), skeleton: noisy, visibility: 0.93 + rng() * 0.05 });
  }
  return { frames, duration };
}
