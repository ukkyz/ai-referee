/**
 * Software frame synchronizer for a multi-camera rig.
 *
 * Each camera pushes timestamped frames (capture time, already corrected by
 * the camera's syncOffsetMs). The synchronizer emits bundles whose member
 * frames lie within `maxSkewMs` of each other — at 120 fps a frame period is
 * 8.3 ms, so the default 10 ms window aligns to the nearest frame on every
 * camera. Frames that can never align (a camera stalled) are dropped and
 * counted, never silently paired with a stale partner.
 */

export interface TimedCamFrame<T> {
  cameraId: string;
  captureMs: number;
  payload: T;
}

export interface FrameBundle<T> {
  /** Mean capture time of the bundle members. */
  tMs: number;
  /** Max - min capture time across members. */
  skewMs: number;
  frames: Record<string, TimedCamFrame<T>>;
}

export interface SyncStats {
  bundlesEmitted: number;
  framesDropped: number;
  lastSkewMs: number;
  buffered: number;
}

export class FrameSynchronizer<T> {
  private queues = new Map<string, TimedCamFrame<T>[]>();
  private emitted = 0;
  private dropped = 0;
  private lastSkew = 0;

  constructor(
    private cameraIds: string[],
    private opts: { maxSkewMs?: number; maxBufferPerCam?: number } = {},
  ) {
    for (const id of cameraIds) this.queues.set(id, []);
  }

  private get maxSkew() {
    return this.opts.maxSkewMs ?? 10;
  }
  private get maxBuffer() {
    return this.opts.maxBufferPerCam ?? 10;
  }

  push(frame: TimedCamFrame<T>): FrameBundle<T>[] {
    const q = this.queues.get(frame.cameraId);
    if (!q) return [];
    q.push(frame);
    if (q.length > this.maxBuffer) {
      q.shift();
      this.dropped += 1;
    }
    const out: FrameBundle<T>[] = [];
    for (;;) {
      const bundle = this.tryBundle();
      if (!bundle) break;
      out.push(bundle);
    }
    return out;
  }

  private tryBundle(): FrameBundle<T> | null {
    const heads: TimedCamFrame<T>[] = [];
    for (const id of this.cameraIds) {
      const q = this.queues.get(id)!;
      if (q.length === 0) return null;
      heads.push(q[0]);
    }
    const times = heads.map((h) => h.captureMs);
    const tMin = Math.min(...times);
    const tMax = Math.max(...times);
    if (tMax - tMin > this.maxSkew) {
      // Drop the stale head(s) that can never join a bundle.
      for (const h of heads) {
        if (h.captureMs === tMin) {
          this.queues.get(h.cameraId)!.shift();
          this.dropped += 1;
        }
      }
      return this.tryBundle();
    }
    const frames: Record<string, TimedCamFrame<T>> = {};
    for (const h of heads) {
      frames[h.cameraId] = this.queues.get(h.cameraId)!.shift()!;
    }
    this.emitted += 1;
    this.lastSkew = tMax - tMin;
    return { tMs: times.reduce((a, b) => a + b, 0) / times.length, skewMs: tMax - tMin, frames };
  }

  stats(): SyncStats {
    let buffered = 0;
    for (const q of this.queues.values()) buffered += q.length;
    return { bundlesEmitted: this.emitted, framesDropped: this.dropped, lastSkewMs: this.lastSkew, buffered };
  }

  reset() {
    for (const q of this.queues.values()) q.length = 0;
    this.emitted = 0;
    this.dropped = 0;
    this.lastSkew = 0;
  }
}

/** Recommended skew window for a target frame rate (≈1.2 frame periods). */
export const recommendedSkewMs = (fps: number): number => Math.max(4, Math.round(1200 / Math.max(1, fps)));
