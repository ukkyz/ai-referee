import { CORNERS, opponentOf, type Corner, type DuelEvent, type DuelTechnique, type JointName, type TargetZone } from '../../types';
import { angleAtDeg, angleFromVerticalDeg, dist, mid2, pointSeg, type Pt } from './geometry';
import { COUNTER_WINDOW_S, makeEvent } from './rules';

/**
 * Streaming Tanding event detector.
 *
 * Input: both fighters' 2D joints per frame in aspect-corrected image space
 * (x pre-multiplied by frame aspect, y down). All distances/speeds are
 * normalised by torso length, so thresholds are scale-invariant.
 *
 * Detection model (heuristic, human-in-the-loop by design):
 * - Strike = end-effector (wrist/foot) fast extension towards the opponent.
 *   The frame where it comes closest to the opponent's body is the "impact".
 * - Sah / ilegal / gagal is decided by which body zone was (almost) hit and
 *   whether the opponent's guard intercepted it.
 * - Jatuhan = a fighter goes down (torso horizontal and/or knee to the mat)
 *   in contact range while the opponent stays standing.
 * - Kuncian = sustained clinch where one fighter's arms wrap the opponent's
 *   torso; touching the neck makes it ilegal.
 *
 * A referee can correct every emitted event in the UI.
 */

export interface FighterObs {
  joints: Record<JointName, Pt>;
  visibility: number;
}

export interface DuelSnapshot {
  /** Torso-centroid distance in torso lengths (null when a fighter is missing). */
  distanceNorm: number | null;
  clinch: { active: boolean; owner: Corner | null; heldSeconds: number; established: boolean; tooLong: boolean };
  downed: [boolean, boolean];
}

interface Derived {
  hipMid: Pt;
  shoulderMid: Pt;
  centroid: Pt;
  torsoLen: number;
  shoulderW: number;
  torsoAngle: number;
  downRaw: boolean;
}

function derive(o: FighterObs): Derived {
  const j = o.joints;
  const hipMid = mid2(j.lHip, j.rHip);
  const shoulderMid = mid2(j.lShoulder, j.rShoulder);
  const torsoLen = Math.max(1e-6, dist(hipMid, shoulderMid));
  const ankleLow = Math.max(j.lAnkle.y, j.rAnkle.y);
  const legSpan = ankleLow - hipMid.y;
  const torsoAngle = angleFromVerticalDeg(hipMid, shoulderMid);
  const kneeLow = Math.min(Math.abs(j.lKnee.y - ankleLow), Math.abs(j.rKnee.y - ankleLow));
  const horizontalDown = torsoAngle > 55 && legSpan < 0.65 * torsoLen;
  const kneeDown = kneeLow < 0.2 * torsoLen && legSpan < 0.95 * torsoLen && torsoAngle > 25;
  return {
    hipMid,
    shoulderMid,
    centroid: mid2(hipMid, shoulderMid),
    torsoLen,
    shoulderW: dist(j.lShoulder, j.rShoulder),
    torsoAngle,
    downRaw: horizontalDown || kneeDown,
  };
}

interface ZoneHit {
  zone: TargetZone;
  /** <= 1 means contact with that zone's surface. */
  contactRatio: number;
  /** True when the closest leg point is the knee joint itself. */
  atKnee?: boolean;
}

function nearestZone(opp: FighterObs, d: Derived, eff: Pt): ZoneHit {
  const j = opp.joints;
  const L = d.torsoLen;
  const candidates: ZoneHit[] = [];

  // Head (around the nose).
  candidates.push({ zone: 'kepala', contactRatio: dist(eff, j.nose) / (0.36 * L) });
  // Neck (nose -> shoulders, upper part).
  const neck = pointSeg(eff, j.nose, d.shoulderMid);
  if (neck.u < 0.75) candidates.push({ zone: 'leher', contactRatio: neck.d / (0.2 * L) });
  // Torso capsule (togok).
  const torso = pointSeg(eff, d.shoulderMid, d.hipMid);
  const capsuleR = Math.max(0.5 * d.shoulderW, 0.26 * L);
  if (torso.u >= -0.05 && torso.u <= 1.05) {
    const zone: TargetZone = torso.d > 0.2 * L ? 'rusuk' : torso.u < 0.5 ? 'dada' : 'perut';
    candidates.push({ zone, contactRatio: torso.d / capsuleR });
  } else if (torso.u > 0.98 && torso.u < 1.55) {
    // Below-navel-to-groin region under the hips.
    candidates.push({ zone: 'kemaluan', contactRatio: torso.d / (0.34 * L) });
  }
  // Legs.
  let legBest = { ratio: Infinity, atKnee: false };
  const legSegs: [Pt, Pt][] = [
    [j.lHip, j.lKnee],
    [j.lKnee, j.lAnkle],
    [j.rHip, j.rKnee],
    [j.rKnee, j.rAnkle],
  ];
  for (const [a, b] of legSegs) {
    const r = pointSeg(eff, a, b).d / (0.15 * L);
    if (r < legBest.ratio) legBest = { ratio: r, atKnee: false };
  }
  for (const knee of [j.lKnee, j.rKnee]) {
    const r = dist(eff, knee) / (0.15 * L);
    if (r < legBest.ratio) legBest = { ratio: r, atKnee: true };
  }
  candidates.push({ zone: 'kaki', contactRatio: legBest.ratio, atKnee: legBest.atKnee });

  const best = candidates.reduce((b, c) => (c.contactRatio < b.contactRatio ? c : b), candidates[0]);
  // Foul calls err on the side of safety: if an illegal zone was hit about as
  // clearly as the best legal one (e.g. a kick between the legs), flag it.
  const illegal = candidates
    .filter((c) => (c.zone === 'kepala' || c.zone === 'leher' || c.zone === 'kemaluan') && c.contactRatio <= 1 && c.contactRatio <= best.contactRatio + 0.3)
    .sort((a, b) => a.contactRatio - b.contactRatio)[0];
  return illegal ?? best;
}

type LimbKind = 'hand' | 'foot';

interface LimbDef {
  kind: LimbKind;
  effector: JointName;
  mid: JointName;
  root: JointName;
  side: 'kiri' | 'kanan';
}

const LIMBS: LimbDef[] = [
  { kind: 'hand', effector: 'lWrist', mid: 'lElbow', root: 'lShoulder', side: 'kiri' },
  { kind: 'hand', effector: 'rWrist', mid: 'rElbow', root: 'rShoulder', side: 'kanan' },
  { kind: 'foot', effector: 'lFoot', mid: 'lKnee', root: 'lHip', side: 'kiri' },
  { kind: 'foot', effector: 'rFoot', mid: 'rKnee', root: 'rHip', side: 'kanan' },
];

interface ImpactInfo {
  t: number;
  zone: ZoneHit;
  blocked: boolean;
  extension: number; // 0..1 (1 = fully straight limb)
  jointAngle: number;
  effHeightNorm: number; // (own hip y - effector y) / own torso (positive = raised)
  gapNorm: number; // centroid distance in torso lengths at impact
}

interface LimbState {
  prevPos: Pt | null;
  prevT: number;
  speed: number; // torso lengths / s (smoothed)
  vel: { x: number; y: number };
  active: boolean;
  startT: number;
  peakSpeed: number;
  best: ImpactInfo | null;
  /** Closest approach to an illegal zone during this strike (foul priority). */
  bestIllegal: ImpactInfo | null;
  /** Longest continuous body contact during this strike — grips hold on, strikes don't. */
  contactStart: number | null;
  contactLongest: number;
  /** Contact ratio on the first active frame (<= ~1 means the limb was already holding on). */
  startContactRatio: number;
  slowFrames: number;
  cooldownUntil: number;
}

const newLimbState = (): LimbState => ({
  prevPos: null,
  prevT: 0,
  speed: 0,
  vel: { x: 0, y: 0 },
  active: false,
  startT: 0,
  peakSpeed: 0,
  best: null,
  bestIllegal: null,
  contactStart: null,
  contactLongest: 0,
  startContactRatio: Infinity,
  slowFrames: 0,
  cooldownUntil: 0,
});

interface FighterState {
  limbs: LimbState[];
  downSince: number | null;
  isDown: boolean;
  standingSince: number;
  lastFailedAttackAt: number; // last time THIS fighter's attack failed (counter window for opponent)
  lastSweepAt: number; // last low fast foot movement near the opponent's legs
}

const newFighterState = (): FighterState => ({
  limbs: LIMBS.map(newLimbState),
  downSince: null,
  isDown: false,
  standingSince: 0,
  lastFailedAttackAt: -Infinity,
  lastSweepAt: -Infinity,
});

interface PendingDrop {
  victim: Corner;
  t0: number;
  confirmAt: number;
}

interface ClinchState {
  since: number | null;
  gapSince: number | null;
  owner: Corner | null;
  ownerSince: number | null;
  ownerGapSince: number | null;
  established: boolean;
  neckTouchSeconds: Record<Corner, number>;
  lastOwnerCandidateAt: number;
}

const HAND_SPEED_ON = 2.1;
const FOOT_SPEED_ON = 2.5;
const SPEED_OFF = 0.9;

export class DuelEventDetector {
  private fighters: [FighterState, FighterState] = [newFighterState(), newFighterState()];
  private pendingDrop: PendingDrop | null = null;
  private clinch: ClinchState = {
    since: null,
    gapSince: null,
    owner: null,
    ownerSince: null,
    ownerGapSince: null,
    established: false,
    neckTouchSeconds: { merah: 0, biru: 0 },
    lastOwnerCandidateAt: -Infinity,
  };
  private lastClinchAt = -Infinity;
  private snapshot: DuelSnapshot = {
    distanceNorm: null,
    clinch: { active: false, owner: null, heldSeconds: 0, established: false, tooLong: false },
    downed: [false, false],
  };
  private lastT = 0;

  getSnapshot(): DuelSnapshot {
    return this.snapshot;
  }

  reset() {
    this.fighters = [newFighterState(), newFighterState()];
    this.pendingDrop = null;
    this.clinch = {
      since: null,
      gapSince: null,
      owner: null,
      ownerSince: null,
      ownerGapSince: null,
      established: false,
      neckTouchSeconds: { merah: 0, biru: 0 },
      lastOwnerCandidateAt: -Infinity,
    };
    this.lastClinchAt = -Infinity;
    this.lastT = 0;
  }

  /** Flush any in-flight clinch at the final gong. */
  flush(round: number): DuelEvent[] {
    return this.endClinch(this.lastT, round);
  }

  pushFrame(t: number, round: number, obs: [FighterObs | null, FighterObs | null]): DuelEvent[] {
    const dt = Math.min(0.1, Math.max(0.001, t - this.lastT || 0.033));
    this.lastT = t;
    const events: DuelEvent[] = [];
    const derived: (Derived | null)[] = obs.map((o) => (o ? derive(o) : null));

    // Down/up bookkeeping.
    for (let i = 0; i < 2; i++) {
      const d = derived[i];
      const st = this.fighters[i];
      if (!d) continue;
      if (d.downRaw) {
        if (st.downSince === null) st.downSince = t;
        if (!st.isDown && t - st.downSince >= 0.35) {
          st.isDown = true;
          this.onDown(CORNERS[i], st.downSince, derived);
        }
      } else {
        st.downSince = null;
        if (st.isDown) {
          st.isDown = false;
          st.standingSince = t;
        }
      }
    }

    // Pending takedown confirmation (attacker must remain standing).
    if (this.pendingDrop && t >= this.pendingDrop.confirmAt) {
      const victim = this.pendingDrop.victim;
      const attacker = opponentOf(victim);
      const attackerIdx = attacker === 'merah' ? 0 : 1;
      if (!this.fighters[attackerIdx].isDown && derived[attackerIdx]) {
        events.push(
          makeEvent({
            t: this.pendingDrop.t0,
            round,
            attacker,
            technique: 'jatuhan',
            status: 'sah',
            zone: 'badan',
            counterBonus: t - this.fighters[attacker === 'merah' ? 1 : 0].lastFailedAttackAt <= COUNTER_WINDOW_S + 1,
            confidence: 0.82,
            source: 'ai',
          }),
        );
        this.consumeCounterWindow(victim);
      }
      this.pendingDrop = null;
    }

    // Strikes.
    for (let i = 0; i < 2; i++) {
      const me = obs[i];
      const opp = obs[1 - i];
      const myD = derived[i];
      const oppD = derived[1 - i];
      if (!me || !myD) continue;
      const st = this.fighters[i];
      LIMBS.forEach((limb, li) => {
        const ls = st.limbs[li];
        const pos = me.joints[limb.effector];
        // Velocity (torso lengths / s), lightly smoothed.
        if (ls.prevPos) {
          const fdt = Math.max(0.008, t - ls.prevT);
          const vx = (pos.x - ls.prevPos.x) / fdt / myD.torsoLen;
          const vy = (pos.y - ls.prevPos.y) / fdt / myD.torsoLen;
          ls.vel = { x: ls.vel.x + (vx - ls.vel.x) * 0.55, y: ls.vel.y + (vy - ls.vel.y) * 0.55 };
          ls.speed = Math.hypot(ls.vel.x, ls.vel.y);
        }
        ls.prevPos = { x: pos.x, y: pos.y };
        ls.prevT = t;

        if (!opp || !oppD || st.isDown) {
          ls.active = false;
          ls.best = null;
          return;
        }

        const toOpp = { x: oppD.centroid.x - pos.x, y: oppD.centroid.y - pos.y };
        const toOppLen = Math.max(1e-9, Math.hypot(toOpp.x, toOpp.y));
        const dirDot = (ls.vel.x * toOpp.x + ls.vel.y * toOpp.y) / (Math.max(1e-9, ls.speed) * toOppLen || 1);
        const speedOn = limb.kind === 'hand' ? HAND_SPEED_ON : FOOT_SPEED_ON;

        const rootNow = me.joints[limb.root];
        const midNow = me.joints[limb.mid];
        const segNow = dist(rootNow, midNow) + dist(midNow, pos);
        const extensionNow = segNow > 1e-9 ? dist(rootNow, pos) / segNow : 0;

        if (!ls.active) {
          // A new strike must start from a chambered/guard position — this
          // stops one long extension from being counted twice.
          if (ls.speed >= speedOn && dirDot > 0.15 && t >= ls.cooldownUntil && extensionNow <= 0.84) {
            ls.active = true;
            ls.startT = t;
            ls.peakSpeed = ls.speed;
            ls.best = null;
            ls.bestIllegal = null;
            ls.contactStart = null;
            ls.contactLongest = 0;
            ls.startContactRatio = Infinity;
            ls.slowFrames = 0;
          } else {
            // Low, fast foot near the opponent's legs = sweep context for jatuhan.
            if (limb.kind === 'foot' && ls.speed >= 2.0) {
              const ankleDist = Math.min(dist(pos, opp.joints.lAnkle), dist(pos, opp.joints.rAnkle));
              if (ankleDist < 0.35 * oppD.torsoLen) st.lastSweepAt = t;
            }
            return;
          }
        }

        // Active strike: track impact candidates.
        ls.peakSpeed = Math.max(ls.peakSpeed, ls.speed);
        const zone = nearestZone(opp, oppD, pos);
        const root = me.joints[limb.root];
        const midJoint = me.joints[limb.mid];
        const segSum = dist(root, midJoint) + dist(midJoint, pos);
        const extension = segSum > 1e-9 ? dist(root, pos) / segSum : 0;
        // Blocked? Opponent wrist intercepted the effector away from their own torso line.
        const oppWrists = [opp.joints.lWrist, opp.joints.rWrist];
        const blocked = oppWrists.some((w) => {
          const nearEff = dist(w, pos) < 0.26 * oppD.torsoLen;
          const awayFromTorso = pointSeg(w, oppD.shoulderMid, oppD.hipMid).d > 0.13 * oppD.torsoLen;
          return nearEff && awayFromTorso;
        });
        const info: ImpactInfo = {
          t,
          zone,
          blocked,
          extension,
          jointAngle: angleAtDeg(root, midJoint, pos),
          effHeightNorm: (myD.hipMid.y - pos.y) / myD.torsoLen,
          gapNorm: dist(myD.centroid, oppD.centroid) / ((myD.torsoLen + oppD.torsoLen) / 2),
        };
        if (!Number.isFinite(ls.startContactRatio)) ls.startContactRatio = zone.contactRatio;
        if (!ls.best || zone.contactRatio < ls.best.zone.contactRatio) ls.best = info;
        if (zone.zone === 'kepala' || zone.zone === 'leher' || zone.zone === 'kemaluan') {
          if (!ls.bestIllegal || zone.contactRatio < ls.bestIllegal.zone.contactRatio) ls.bestIllegal = info;
        }
        if (zone.contactRatio <= 1.05) {
          if (ls.contactStart === null) ls.contactStart = t;
          ls.contactLongest = Math.max(ls.contactLongest, t - ls.contactStart);
        } else {
          ls.contactStart = null;
        }

        const retracting = ls.peakSpeed > speedOn && dirDot < -0.35;
        if (ls.speed < SPEED_OFF) ls.slowFrames += 1;
        else ls.slowFrames = 0;
        const ended = retracting || ls.slowFrames >= 4 || t - ls.startT > 0.95;
        if (ended) {
          ls.active = false;
          ls.cooldownUntil = t + 0.6;
          const ev = this.classifyStrike(CORNERS[i], limb, ls, round);
          if (ev) {
            events.push(ev);
            if (ev.status === 'gagal') st.lastFailedAttackAt = ev.t;
            else if (ev.status === 'sah') this.consumeCounterWindow(CORNERS[1 - i]);
          }
          ls.best = null;
          ls.bestIllegal = null;
        }
      });
    }

    // Clinch / body lock.
    events.push(...this.updateClinch(t, dt, round, obs, derived));

    // Snapshot for the UI.
    const d0 = derived[0];
    const d1 = derived[1];
    const distanceNorm = d0 && d1 ? dist(d0.centroid, d1.centroid) / ((d0.torsoLen + d1.torsoLen) / 2) : null;
    this.snapshot = {
      distanceNorm,
      clinch: {
        active: this.clinch.since !== null,
        owner: this.clinch.owner,
        heldSeconds: this.clinch.ownerSince !== null ? t - this.clinch.ownerSince : 0,
        established: this.clinch.established,
        tooLong: this.clinch.since !== null && t - this.clinch.since > 5 && !this.clinch.established,
      },
      downed: [this.fighters[0].isDown, this.fighters[1].isDown],
    };

    return events;
  }

  private consumeCounterWindow(failedAttacker: Corner) {
    // The counter bonus applies once per failed attack.
    this.fighters[failedAttacker === 'merah' ? 0 : 1].lastFailedAttackAt = -Infinity;
  }

  private onDown(victim: Corner, t0: number, derived: (Derived | null)[]) {
    const attacker = opponentOf(victim);
    const aIdx = attacker === 'merah' ? 0 : 1;
    const vIdx = 1 - aIdx;
    if (this.fighters[aIdx].isDown || !derived[aIdx] || !derived[vIdx]) return;
    if (this.pendingDrop) return;
    const dA = derived[aIdx]!;
    const dV = derived[vIdx]!;
    const gap = dist(dA.centroid, dV.centroid) / ((dA.torsoLen + dV.torsoLen) / 2);
    const inContact = gap < 1.5 || t0 - this.lastClinchAt < 2.5 || t0 - this.fighters[aIdx].lastSweepAt < 1.4;
    if (!inContact) return; // slipped on their own — no jatuhan
    this.pendingDrop = { victim, t0, confirmAt: t0 + 0.65 };
  }

  private classifyStrike(attacker: Corner, limb: LimbDef, ls: LimbState, round: number): DuelEvent | null {
    let best = ls.best;
    if (!best) return null;
    // Foul priority across the whole trajectory: an illegal-zone contact that
    // was about as clear as the best overall contact decides the verdict
    // (e.g. a kick that grazes the thigh on its way into the groin).
    if (ls.bestIllegal && ls.bestIllegal.zone.contactRatio <= 1.15 && ls.bestIllegal.zone.contactRatio <= best.zone.contactRatio + 0.4) {
      best = ls.bestIllegal;
    }
    // A limb that stays glued to the opponent is gripping, not striking
    // (e.g. holding a shoulder through a takedown).
    if (ls.contactLongest >= (limb.kind === 'hand' ? 0.3 : 0.4)) return null;
    if (ls.startContactRatio <= 1.05 && ls.contactLongest >= 0.18) return null;
    const speedOn = limb.kind === 'hand' ? HAND_SPEED_ON : FOOT_SPEED_ON;
    if (ls.peakSpeed < speedOn) return null;
    const extended = best.extension >= 0.76 || best.jointAngle >= 118;
    if (!extended) return null;
    // Must have been directed at the opponent (came reasonably close).
    if (best.zone.contactRatio > 2.4) return null;
    // Kicks must leave the floor area; low sweeps feed jatuhan instead.
    if (limb.kind === 'foot' && best.effHeightNorm < -0.55) return null;
    // Inside an established grapple, arm movement is gripping/locking, not
    // striking — the kuncian/jatuhan detectors own that range.
    if (best.gapNorm < 0.8) return null;
    if (this.clinch.since !== null && best.t >= this.clinch.since - 0.8 && best.gapNorm < 1.05) return null;

    const technique: DuelTechnique = limb.kind === 'hand' ? 'pukulan' : 'tendangan';
    const contact = best.zone.contactRatio <= 1;
    const oppIdx = attacker === 'merah' ? 1 : 0;
    const oppDown = this.fighters[oppIdx].isDown;
    const speedMargin = Math.min(1, (ls.peakSpeed - speedOn) / 2.2);
    const confidence = Math.min(0.97, 0.52 + 0.22 * speedMargin + (contact ? 0.18 : 0) + (best.extension > 0.85 ? 0.06 : 0));
    const base = {
      t: best.t,
      round,
      attacker,
      technique,
      limb: limb.side,
      confidence,
      source: 'ai' as const,
    };

    if (oppDown && contact) {
      return makeEvent({
        ...base,
        status: 'ilegal',
        zone: best.zone.zone === 'tidak-kena' ? 'badan' : best.zone.zone,
        note: `${technique === 'pukulan' ? 'Pukulan' : 'Tendangan'} ${limb.side} ke lawan yang sudah jatuh — ILEGAL`,
      });
    }
    if (best.blocked && (!contact || best.zone.contactRatio > 0.55)) {
      return makeEvent({ ...base, status: 'gagal', failReason: 'ditangkis', zone: contact ? best.zone.zone : 'tidak-kena' });
    }
    if (!contact) {
      return makeEvent({ ...base, status: 'gagal', failReason: 'meleset', zone: 'tidak-kena' });
    }
    const zone = best.zone.zone;
    if (zone === 'kepala' || zone === 'leher' || zone === 'kemaluan') {
      return makeEvent({ ...base, status: 'ilegal', zone });
    }
    if (zone === 'kaki') {
      if (best.zone.atKnee) {
        return makeEvent({ ...base, status: 'ilegal', zone, note: `${technique === 'pukulan' ? 'Pukulan' : 'Tendangan'} ${limb.side} langsung ke lutut — ILEGAL` });
      }
      return makeEvent({
        ...base,
        status: 'gagal',
        failReason: 'meleset',
        zone,
        note: `${technique === 'pukulan' ? 'Pukulan' : 'Tendangan'} ${limb.side} mengenai kaki — sasaran antara, tidak bernilai`,
      });
    }
    const counterBonus = best.t - this.fighters[oppIdx].lastFailedAttackAt <= COUNTER_WINDOW_S;
    return makeEvent({ ...base, status: 'sah', zone, counterBonus });
  }

  /** Wrists of `me` wrapped around `opp`: near the torso line and past the opponent's centre. */
  private wrapScore(me: FighterObs, myD: Derived, oppD: Derived): { near: number; wrapped: number; claspPast: boolean } {
    let near = 0;
    let wrapped = 0;
    const pastCentre = (p: Pt) =>
      (p.x - oppD.centroid.x) * (myD.centroid.x - oppD.centroid.x) + (p.y - oppD.centroid.y) * (myD.centroid.y - oppD.centroid.y) < 0;
    for (const w of [me.joints.lWrist, me.joints.rWrist]) {
      const dAxis = pointSeg(w, oppD.shoulderMid, oppD.hipMid).d;
      if (dAxis < 0.52 * oppD.torsoLen) {
        near += 1;
        if (pastCentre(w)) wrapped += 1;
      }
    }
    // Hands clasped BEHIND the opponent (not merely touching at own chest).
    const wristMid = mid2(me.joints.lWrist, me.joints.rWrist);
    const claspPast = dist(me.joints.lWrist, me.joints.rWrist) < 0.32 * myD.torsoLen && pastCentre(wristMid);
    return { near, wrapped, claspPast };
  }

  private updateClinch(t: number, dt: number, round: number, obs: [FighterObs | null, FighterObs | null], derived: (Derived | null)[]): DuelEvent[] {
    const events: DuelEvent[] = [];
    const [o0, o1] = obs;
    const [d0, d1] = derived;
    const c = this.clinch;
    if (!o0 || !o1 || !d0 || !d1 || this.fighters[0].isDown || this.fighters[1].isDown) {
      if (c.since !== null) events.push(...this.endClinch(t, round));
      return events;
    }
    const avg = (d0.torsoLen + d1.torsoLen) / 2;
    const gap = dist(d0.centroid, d1.centroid) / avg;
    const close = gap < 0.95;

    if (close) {
      if (c.since === null) {
        c.since = t;
        c.neckTouchSeconds = { merah: 0, biru: 0 };
        c.established = false;
        c.owner = null;
        c.ownerSince = null;
      }
      c.gapSince = null;
      this.lastClinchAt = t;

      const s0 = this.wrapScore(o0, d0, d1);
      const s1 = this.wrapScore(o1, d1, d0);
      // A body lock wraps BOTH arms around (or one arm, hands clasped behind).
      const owns = (s: { near: number; wrapped: number; claspPast: boolean }) => s.wrapped >= 2 || (s.wrapped >= 1 && s.claspPast);
      let candidate: Corner | null = null;
      if (owns(s0) && !owns(s1)) candidate = 'merah';
      else if (owns(s1) && !owns(s0)) candidate = 'biru';
      else if (owns(s0) && owns(s1)) candidate = s0.wrapped === s1.wrapped ? null : s0.wrapped > s1.wrapped ? 'merah' : 'biru';

      if (candidate) {
        c.lastOwnerCandidateAt = t;
        if (c.owner === candidate) {
          c.ownerGapSince = null;
        } else if (c.owner === null || (c.ownerGapSince !== null && t - c.ownerGapSince > 0.35)) {
          c.owner = candidate;
          c.ownerSince = t;
          c.ownerGapSince = null;
        }
        if (c.owner === candidate && c.ownerSince !== null && t - c.ownerSince >= 1.5) c.established = true;
        // Illegal neck touch while locking.
        const ownerObs = candidate === 'merah' ? o0 : o1;
        const victimNose = candidate === 'merah' ? o1.joints.nose : o0.joints.nose;
        const victimL = candidate === 'merah' ? d1.torsoLen : d0.torsoLen;
        const neckTouch = [ownerObs.joints.lWrist, ownerObs.joints.rWrist].some((w) => dist(w, victimNose) < 0.3 * victimL);
        if (neckTouch) c.neckTouchSeconds[candidate] += dt;
      } else if (c.owner !== null && c.ownerGapSince === null) {
        c.ownerGapSince = t;
      }
    } else if (c.since !== null) {
      if (c.gapSince === null) c.gapSince = t;
      if (t - c.gapSince > 0.4) events.push(...this.endClinch(c.gapSince, round));
    }
    return events;
  }

  private endClinch(t: number, round: number): DuelEvent[] {
    const c = this.clinch;
    const events: DuelEvent[] = [];
    if (c.since !== null && c.owner !== null && c.ownerSince !== null) {
      const held = t - c.ownerSince;
      const neckFoul = c.neckTouchSeconds[c.owner] > 0.7;
      if (c.established || held >= 1.5) {
        events.push(
          makeEvent({
            t: c.ownerSince,
            round,
            attacker: c.owner,
            technique: 'kuncian',
            status: neckFoul ? 'ilegal' : 'sah',
            zone: neckFoul ? 'leher' : 'badan',
            duration: Math.round(held * 10) / 10,
            confidence: neckFoul ? 0.7 : 0.78,
            source: 'ai',
          }),
        );
      } else if (held >= 0.6) {
        events.push(
          makeEvent({
            t: c.ownerSince,
            round,
            attacker: c.owner,
            technique: 'kuncian',
            status: 'gagal',
            failReason: 'lepas',
            zone: 'badan',
            duration: Math.round(held * 10) / 10,
            confidence: 0.6,
            source: 'ai',
          }),
        );
      }
    }
    c.since = null;
    c.gapSince = null;
    c.owner = null;
    c.ownerSince = null;
    c.ownerGapSince = null;
    c.established = false;
    c.neckTouchSeconds = { merah: 0, biru: 0 };
    return events;
  }
}
