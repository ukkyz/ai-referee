import { JOINTS, type JointName } from '../../types';
import type { FighterObs } from './fightDetector';
import type { Pt3 } from './geometry';

/**
 * Procedural demo fight: two side-view puppets exchange choreographed
 * techniques (clean punches/kicks, blocks, misses, head & groin fouls,
 * clinch locks and takedowns). Frames are produced in the same
 * aspect-corrected image space the detector consumes, so the demo — and the
 * headless detector test — run the real detection pipeline.
 */

export const DEMO_ASPECT = 16 / 9;
const L = 0.21; // torso length in image-height units
const GROUND = 0.88;
const CENTER = DEMO_ASPECT / 2;

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

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const lerp = (a: number, b: number, u: number) => a + (b - a) * u;
const smooth = (u: number) => {
  const x = clamp01(u);
  return x * x * (3 - 2 * x);
};
/** Ramp 0→1 between a..b, hold, back to 0 between c..d. */
function pulse(u: number, a: number, b: number, c: number, d: number): number {
  if (u < a) return 0;
  if (u < b) return smooth((u - a) / (b - a));
  if (u < c) return 1;
  if (u < d) return 1 - smooth((u - c) / (d - c));
  return 0;
}
const ramp = (u: number, a: number, b: number) => smooth((u - a) / (b - a));

interface Pose {
  punchExt: number;
  punchArm: 'front' | 'back';
  punchDy: number;
  kickExt: number;
  kickDy: number;
  blockExt: number;
  wrapAmt: number;
  trappedAmt: number;
  gripAmt: number;
  down: number;
  flinch: number;
}

const idlePose = (): Pose => ({
  punchExt: 0,
  punchArm: 'front',
  punchDy: 0.2 * L,
  kickExt: 0,
  kickDy: -0.55 * L,
  blockExt: 0,
  wrapAmt: 0,
  trappedAmt: 0,
  gripAmt: 0,
  down: 0,
  flinch: 0,
});

type SegKind = 'idle' | 'punch' | 'kick' | 'punch-blocked' | 'kick-miss' | 'head-punch' | 'groin-kick' | 'lock' | 'takedown';

interface Seg {
  kind: SegKind;
  attacker: 0 | 1;
  t0: number;
  dur: number;
  arm: 'front' | 'back';
}

const P = (x: number, y: number): Pt3 => ({ x, y, z: 0, v: 0.95 });
const lerpPt = (a: Pt3, b: Pt3, u: number): Pt3 => P(lerp(a.x, b.x, u), lerp(a.y, b.y, u));

/** Build one puppet's joints. `f` = facing (+1 right, −1 left). Front limbs map to l* when facing right, r* when left. */
function buildFighter(hipX: number, f: 1 | -1, t: number, pose: Pose, oppCentroid: Pt3 | null, oppShoulder: Pt3 | null): Record<JointName, Pt3> {
  const bounce = pose.down > 0.05 ? 0 : Math.sin(t * 2.4 + (f > 0 ? 0 : 1.7)) * 0.018 * L;
  const hipY = GROUND - 1.62 * L + bounce + pose.down * 1.44 * L;
  const hip = P(hipX, hipY);
  const lean = 0.16 * L - pose.flinch * 0.22 * L;
  const shoulderMid = P(hip.x + f * lean * (1 - pose.down) - f * 0.92 * L * pose.down, hip.y - L * (1 - pose.down) - 0.1 * L * pose.down);
  const nose = P(shoulderMid.x + f * 0.2 * L * (1 - pose.down) - f * 0.22 * L * pose.down, shoulderMid.y - 0.3 * L * (1 - pose.down) - 0.06 * L * pose.down);

  const frontHip = P(hip.x + f * 0.1 * L, hip.y + 0.02 * L);
  const backHip = P(hip.x - f * 0.1 * L, hip.y + 0.02 * L);
  const frontShoulder = P(shoulderMid.x + f * 0.12 * L, shoulderMid.y + 0.03 * L);
  const backShoulder = P(shoulderMid.x - f * 0.1 * L, shoulderMid.y + 0.05 * L);

  // --- legs (front leg kicks) ---
  const frontAnkleStand = P(hip.x + f * 0.58 * L, GROUND);
  const backAnkleStand = P(hip.x - f * 0.52 * L, GROUND);
  const kickTarget = P(frontHip.x + f * 1.5 * L, frontHip.y + pose.kickDy);
  const chamberAnkle = P(frontHip.x + f * 0.55 * L, frontHip.y + 0.35 * L);
  const kickU = pose.kickExt;
  const frontAnkleKick = kickU < 0.45 ? lerpPt(frontAnkleStand, chamberAnkle, smooth(kickU / 0.45)) : lerpPt(chamberAnkle, kickTarget, smooth((kickU - 0.45) / 0.55));
  const frontAnkleDown = P(hip.x + f * 1.3 * L, GROUND - 0.02 * L);
  const backAnkleDown = P(hip.x + f * 1.05 * L, GROUND - 0.1 * L);
  const frontAnkle = lerpPt(kickU > 0 ? frontAnkleKick : frontAnkleStand, frontAnkleDown, pose.down);
  const backAnkle = lerpPt(backAnkleStand, backAnkleDown, pose.down);
  const frontKneeKick = kickU < 0.45 ? P(frontHip.x + f * 0.55 * L, frontHip.y - 0.3 * L) : lerpPt(P(frontHip.x + f * 0.55 * L, frontHip.y - 0.3 * L), P((frontHip.x + kickTarget.x) / 2 + f * 0.04 * L, (frontHip.y + kickTarget.y) / 2 - 0.03 * L), smooth((kickU - 0.45) / 0.55));
  const frontKneeStand = P((frontHip.x + frontAnkleStand.x) / 2 + f * 0.15 * L, (frontHip.y + GROUND) / 2);
  const frontKnee = lerpPt(kickU > 0 ? frontKneeKick : frontKneeStand, P((frontHip.x + frontAnkleDown.x) / 2, (frontHip.y + frontAnkleDown.y) / 2 - 0.06 * L), pose.down);
  const backKnee = lerpPt(P((backHip.x + backAnkleStand.x) / 2 + f * 0.1 * L, (backHip.y + GROUND) / 2), P((backHip.x + backAnkleDown.x) / 2, (backHip.y + backAnkleDown.y) / 2 - 0.05 * L), pose.down);
  const frontFoot = P(frontAnkle.x + f * 0.17 * L, frontAnkle.y + (kickU > 0.4 ? 0.02 * L : 0.045 * L));
  const backFoot = P(backAnkle.x + f * 0.16 * L, backAnkle.y + 0.045 * L);

  // --- arms ---
  const guardF = P(shoulderMid.x + f * 0.44 * L, shoulderMid.y + 0.3 * L);
  const guardB = P(shoulderMid.x + f * 0.3 * L, shoulderMid.y + 0.45 * L);
  const elbowFGuard = P(frontShoulder.x + f * 0.06 * L, frontShoulder.y + 0.46 * L);
  const elbowBGuard = P(backShoulder.x + f * 0.02 * L, backShoulder.y + 0.46 * L);

  const punchTargetF = P(frontShoulder.x + f * 1.04 * L, frontShoulder.y + pose.punchDy);
  const punchTargetB = P(backShoulder.x + f * 1.12 * L, backShoulder.y + pose.punchDy);
  let wristF = pose.punchArm === 'front' ? lerpPt(guardF, punchTargetF, pose.punchExt) : guardF;
  let wristB = pose.punchArm === 'back' ? lerpPt(guardB, punchTargetB, pose.punchExt) : guardB;
  let elbowF = pose.punchArm === 'front' ? lerpPt(elbowFGuard, P((frontShoulder.x + punchTargetF.x) / 2, (frontShoulder.y + punchTargetF.y) / 2 + 0.05 * L), pose.punchExt) : elbowFGuard;
  let elbowB = pose.punchArm === 'back' ? lerpPt(elbowBGuard, P((backShoulder.x + punchTargetB.x) / 2, (backShoulder.y + punchTargetB.y) / 2 + 0.05 * L), pose.punchExt) : elbowBGuard;

  // Block: front arm reaches out in front of the chest.
  if (pose.blockExt > 0) {
    wristF = lerpPt(wristF, P(shoulderMid.x + f * 0.58 * L, shoulderMid.y + 0.24 * L), pose.blockExt);
    elbowF = lerpPt(elbowF, P(frontShoulder.x + f * 0.3 * L, frontShoulder.y + 0.4 * L), pose.blockExt);
  }
  // Grip (takedown setup): front hand holds the opponent's shoulder.
  if (pose.gripAmt > 0 && oppShoulder) {
    wristF = lerpPt(wristF, oppShoulder, pose.gripAmt);
    elbowF = lerpPt(elbowF, P((frontShoulder.x + oppShoulder.x) / 2, (frontShoulder.y + oppShoulder.y) / 2 + 0.18 * L), pose.gripAmt);
  }
  // Body lock: both wrists wrap past the opponent's centre.
  if (pose.wrapAmt > 0 && oppCentroid) {
    wristF = lerpPt(wristF, P(oppCentroid.x + f * 0.24 * L, oppCentroid.y - 0.1 * L), pose.wrapAmt);
    wristB = lerpPt(wristB, P(oppCentroid.x + f * 0.24 * L, oppCentroid.y + 0.16 * L), pose.wrapAmt);
    elbowF = lerpPt(elbowF, P(frontShoulder.x + f * 0.45 * L, frontShoulder.y + 0.42 * L), pose.wrapAmt);
    elbowB = lerpPt(elbowB, P(backShoulder.x + f * 0.4 * L, backShoulder.y + 0.48 * L), pose.wrapAmt);
  }
  // Down: arms sprawl on the mat.
  if (pose.down > 0) {
    wristF = lerpPt(wristF, P(shoulderMid.x - f * 0.3 * L, GROUND - 0.05 * L), pose.down);
    wristB = lerpPt(wristB, P(shoulderMid.x + f * 0.35 * L, GROUND - 0.04 * L), pose.down);
    elbowF = lerpPt(elbowF, P(shoulderMid.x - f * 0.12 * L, GROUND - 0.08 * L), pose.down);
    elbowB = lerpPt(elbowB, P(shoulderMid.x + f * 0.18 * L, GROUND - 0.07 * L), pose.down);
  }

  const front: Record<string, Pt3> = { hip: frontHip, knee: frontKnee, ankle: frontAnkle, foot: frontFoot, shoulder: frontShoulder, elbow: elbowF, wrist: wristF };
  const back: Record<string, Pt3> = { hip: backHip, knee: backKnee, ankle: backAnkle, foot: backFoot, shoulder: backShoulder, elbow: elbowB, wrist: wristB };
  const Lside = f === 1 ? front : back;
  const Rside = f === 1 ? back : front;

  return {
    nose,
    lShoulder: Lside.shoulder,
    rShoulder: Rside.shoulder,
    lElbow: Lside.elbow,
    rElbow: Rside.elbow,
    lWrist: Lside.wrist,
    rWrist: Rside.wrist,
    lHip: Lside.hip,
    rHip: Rside.hip,
    lKnee: Lside.knee,
    rKnee: Rside.knee,
    lAnkle: Lside.ankle,
    rAnkle: Rside.ankle,
    lFoot: Lside.foot,
    rFoot: Rside.foot,
  };
}

function centroidOf(j: Record<JointName, Pt3>): Pt3 {
  const hip = { x: (j.lHip.x + j.rHip.x) / 2, y: (j.lHip.y + j.rHip.y) / 2 };
  const sho = { x: (j.lShoulder.x + j.rShoulder.x) / 2, y: (j.lShoulder.y + j.rShoulder.y) / 2 };
  return P((hip.x + sho.x) / 2, (hip.y + sho.y) / 2);
}

export interface DemoGroundTruth {
  segments: { kind: SegKind; attacker: 0 | 1 }[];
}

export class DemoFight {
  readonly aspect = DEMO_ASPECT;
  private segs: Seg[] = [];

  constructor(
    public readonly duration: number,
    seed = 20261018,
  ) {
    const rand = mulberry32(seed);
    let t = 1.4;
    let attacker: 0 | 1 = rand() < 0.5 ? 0 : 1;
    // A fixed opening showcase so every technique appears, then random play.
    const showcase: SegKind[] = ['punch', 'kick', 'punch-blocked', 'head-punch', 'kick', 'lock', 'punch', 'kick-miss', 'groin-kick', 'takedown'];
    const bag: SegKind[] = ['punch', 'punch', 'kick', 'kick', 'punch-blocked', 'kick-miss', 'head-punch', 'lock', 'takedown', 'punch'];
    let si = 0;
    while (t < duration - 4) {
      const kind = si < showcase.length ? showcase[si] : bag[Math.floor(rand() * bag.length)];
      si += 1;
      const dur = kind === 'lock' ? 5.2 : kind === 'takedown' ? 6.4 : 1.6 + rand() * 0.5;
      this.segs.push({ kind, attacker, t0: t, dur, arm: rand() < 0.55 ? 'front' : 'back' });
      t += dur + 0.9 + rand() * 1.3;
      if (rand() < 0.72) attacker = (1 - attacker) as 0 | 1;
    }
  }

  groundTruth(): DemoGroundTruth {
    return { segments: this.segs.map((s) => ({ kind: s.kind, attacker: s.attacker })) };
  }

  private poseAt(t: number): { gap: number; poses: [Pose, Pose]; attIdx: 0 | 1 | null } {
    const poses: [Pose, Pose] = [idlePose(), idlePose()];
    let gap = 2.6 * L;
    let attIdx: 0 | 1 | null = null;
    const seg = this.segs.find((s) => t >= s.t0 && t <= s.t0 + s.dur);
    if (!seg) return { gap, poses, attIdx };
    const u = (t - seg.t0) / seg.dur;
    const a = seg.attacker;
    const d = (1 - a) as 0 | 1;
    attIdx = a;
    const att = poses[a];
    const def = poses[d];
    att.punchArm = seg.arm;

    switch (seg.kind) {
      case 'punch':
      case 'head-punch': {
        gap = lerp(2.6 * L, 1.32 * L, pulse(u, 0, 0.38, 0.62, 0.95));
        att.punchDy = seg.kind === 'head-punch' ? -0.3 * L : 0.2 * L;
        att.punchExt = pulse(u, 0.28, 0.46, 0.58, 0.85);
        def.flinch = pulse(u, 0.46, 0.56, 0.7, 0.95) * 0.7;
        break;
      }
      case 'punch-blocked': {
        gap = lerp(2.6 * L, 1.62 * L, pulse(u, 0, 0.38, 0.62, 0.95));
        att.punchExt = pulse(u, 0.28, 0.46, 0.58, 0.85);
        def.blockExt = pulse(u, 0.3, 0.48, 0.62, 0.9);
        break;
      }
      case 'kick':
      case 'groin-kick': {
        gap = lerp(2.6 * L, 1.82 * L, pulse(u, 0, 0.38, 0.62, 0.95));
        att.kickDy = seg.kind === 'groin-kick' ? 0.26 * L : -0.55 * L;
        att.kickExt = pulse(u, 0.26, 0.48, 0.6, 0.88);
        def.flinch = pulse(u, 0.48, 0.58, 0.72, 0.95) * 0.8;
        break;
      }
      case 'kick-miss': {
        const stepBack = pulse(u, 0.3, 0.5, 0.65, 0.95) * 0.5 * L;
        gap = lerp(2.6 * L, 1.82 * L, pulse(u, 0, 0.38, 0.62, 0.95)) + stepBack;
        att.kickExt = pulse(u, 0.26, 0.48, 0.6, 0.88);
        break;
      }
      case 'lock': {
        const close = pulse(u, 0, 0.22, 0.82, 1);
        gap = lerp(2.6 * L, 0.58 * L, close);
        att.wrapAmt = pulse(u, 0.16, 0.34, 0.8, 0.97);
        def.trappedAmt = pulse(u, 0.16, 0.34, 0.8, 0.97);
        break;
      }
      case 'takedown': {
        const close = u < 0.55 ? ramp(u, 0, 0.2) : 1 - ramp(u, 0.78, 0.98) * 0.6;
        gap = lerp(2.6 * L, 0.66 * L, close) + ramp(u, 0.78, 0.98) * 0.5 * L;
        att.gripAmt = pulse(u, 0.14, 0.3, 0.5, 0.68);
        def.down = u < 0.42 ? 0 : u < 0.82 ? ramp(u, 0.42, 0.52) : 1 - ramp(u, 0.82, 0.98);
        def.trappedAmt = pulse(u, 0.14, 0.3, 0.42, 0.55);
        break;
      }
      default:
        break;
    }
    return { gap, poses, attIdx };
  }

  frameAt(t: number): [FighterObs, FighterObs] {
    const { gap, poses } = this.poseAt(Math.min(t, this.duration));
    const drift = Math.sin(t * 0.13) * 0.05;
    const xMerah = CENTER + drift - gap / 2;
    const xBiru = CENTER + drift + gap / 2;
    // Two passes: first without interaction targets (to locate centroids), then with.
    const j0a = buildFighter(xMerah, 1, t, poses[0], null, null);
    const j1a = buildFighter(xBiru, -1, t, poses[1], null, null);
    const c0 = centroidOf(j0a);
    const c1 = centroidOf(j1a);
    const sho0 = P((j0a.lShoulder.x + j0a.rShoulder.x) / 2, (j0a.lShoulder.y + j0a.rShoulder.y) / 2);
    const sho1 = P((j1a.lShoulder.x + j1a.rShoulder.x) / 2, (j1a.lShoulder.y + j1a.rShoulder.y) / 2);
    const j0 = poses[0].wrapAmt > 0 || poses[0].gripAmt > 0 ? buildFighter(xMerah, 1, t, poses[0], c1, sho1) : j0a;
    const j1 = poses[1].wrapAmt > 0 || poses[1].gripAmt > 0 ? buildFighter(xBiru, -1, t, poses[1], c0, sho0) : j1a;
    const clean = (j: Record<JointName, Pt3>) => {
      const out = {} as Record<JointName, Pt3>;
      for (const k of JOINTS) out[k] = j[k];
      return out;
    };
    return [
      { joints: clean(j0), visibility: 0.95 },
      { joints: clean(j1), visibility: 0.95 },
    ];
  }
}

/** Headless frame list for tests. */
export function simulateDuelFrames(duration: number, seed = 20261018, fps = 30): { t: number; fighters: [FighterObs, FighterObs] }[] {
  const fight = new DemoFight(duration, seed);
  const out: { t: number; fighters: [FighterObs, FighterObs] }[] = [];
  for (let t = 0; t <= duration; t += 1 / fps) out.push({ t, fighters: fight.frameAt(t) });
  return out;
}
