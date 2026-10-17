import type { Features, Jurus, RefereeSettings } from '../../types';
import { matchPose } from '../pose/similarity';

export type StepStatus = 'pending' | 'active' | 'matched' | 'missed';

export interface LiveSnapshot {
  index: number;
  statuses: StepStatus[];
  best: number[];
  matchedAt: (number | null)[];
  current: number;
  holdProgress: number;
  done: boolean;
  lastMatchedT: number | null;
  matchedCount: number;
}

/** Greedy, real-time sequence follower that gives the performer instant feedback.
 * The official verdict is recomputed afterwards with full-sequence alignment. */
export class LiveTracker {
  private jurus: Jurus;
  private strict: number;
  private mirror: boolean;
  private thr: number;
  index = 0;
  statuses: StepStatus[];
  best: number[];
  matchedAt: (number | null)[];
  current = 0;
  holdProgress = 0;
  done = false;
  lastMatchedT: number | null = null;
  private aboveSince: number | null = null;
  private skipSince: number | null = null;
  private skipTarget = -1;
  private lockUntil = 0;

  constructor(jurus: Jurus, settings: RefereeSettings) {
    this.jurus = jurus;
    this.strict = settings.strictness;
    this.mirror = settings.allowMirror;
    this.thr = settings.matchThreshold;
    this.statuses = jurus.steps.map((_, i) => (i === 0 ? 'active' : 'pending'));
    this.best = jurus.steps.map(() => 0);
    this.matchedAt = jurus.steps.map(() => null);
  }

  update(features: Features, t: number): void {
    if (this.done) return;
    const steps = this.jurus.steps;
    const i = this.index;
    const step = steps[i];
    const sim = matchPose(features, step.pose, this.strict, this.mirror).score;
    this.current = sim;
    if (sim > this.best[i]) this.best[i] = sim;
    if (t < this.lockUntil) {
      this.holdProgress = 0;
      return;
    }
    const need = Math.max(0.25, Math.min(0.5, step.hold * 0.4));
    if (sim >= this.thr) {
      if (this.aboveSince === null) this.aboveSince = t;
      this.holdProgress = Math.min(1, (t - this.aboveSince) / need);
      if (t - this.aboveSince >= need) {
        this.statuses[i] = 'matched';
        this.matchedAt[i] = this.aboveSince;
        this.lastMatchedT = t;
        this.advance(t);
        return;
      }
    } else {
      this.aboveSince = null;
      this.holdProgress = 0;
    }
    // Look ahead up to 3 movements: if the performer is clearly holding a later
    // movement, the skipped ones are marked as missed.
    let cand = -1;
    let candSim = 0;
    for (let j = i + 1; j <= Math.min(i + 3, steps.length - 1); j++) {
      if (steps[j].pose.id === step.pose.id) continue;
      const sj = matchPose(features, steps[j].pose, this.strict, this.mirror).score;
      if (sj >= this.thr + 0.04 && sj > sim + 0.12 && sj > candSim) {
        cand = j;
        candSim = sj;
      }
    }
    if (cand >= 0) {
      if (this.skipTarget !== cand || this.skipSince === null) {
        this.skipTarget = cand;
        this.skipSince = t;
      }
      if (t - this.skipSince >= 0.45) {
        for (let k = i; k < cand; k++) this.statuses[k] = 'missed';
        this.index = cand;
        this.statuses[cand] = 'active';
        this.aboveSince = this.skipSince;
        this.skipSince = null;
        this.skipTarget = -1;
      }
    } else {
      this.skipSince = null;
      this.skipTarget = -1;
    }
  }

  private advance(t: number) {
    this.aboveSince = null;
    this.skipSince = null;
    this.holdProgress = 0;
    if (this.index >= this.jurus.steps.length - 1) {
      this.done = true;
      return;
    }
    const prevId = this.jurus.steps[this.index].pose.id;
    this.index++;
    this.statuses[this.index] = 'active';
    this.lockUntil = this.jurus.steps[this.index].pose.id === prevId ? t + 0.6 : t + 0.15;
  }

  snapshot(): LiveSnapshot {
    return {
      index: this.index,
      statuses: [...this.statuses],
      best: [...this.best],
      matchedAt: [...this.matchedAt],
      current: this.current,
      holdProgress: this.holdProgress,
      done: this.done,
      lastMatchedT: this.lastMatchedT,
      matchedCount: this.statuses.filter((s) => s === 'matched').length,
    };
  }
}
