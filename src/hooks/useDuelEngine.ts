'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { PoseLandmarker } from '@mediapipe/tasks-vision';
import { detectPose, getPoseLandmarker } from '../lib/pose/detector';
import { keyVisibility, MP_INDEX, smooth2D, toLandmarks2D, type Landmark2D } from '../lib/pose/landmarks';
import type { FighterObs } from '../lib/duel/fightDetector';
import { CORNER_COLORS, drawDuelFighters, type DrawFighter } from '../lib/duel/draw';
import { JOINTS, type JointName, type ModelKind } from '../types';
import type { Pt3 } from '../lib/duel/geometry';

export interface DuelFrame {
  now: number;
  mediaTime: number;
  /** [merah, biru] in aspect-corrected image space. */
  fighters: [FighterObs | null, FighterObs | null];
  aspect: number;
}

export type DuelSourceKind = 'camera' | 'video';

interface Track {
  /** Last hip-centre in raw normalised coords (identity matching). */
  centroid: { x: number; y: number } | null;
  prevLm: Landmark2D[] | null;
  lastSeenAt: number;
  obs: FighterObs | null;
  joints: Record<JointName, Pt3> | null;
}

const newTrack = (): Track => ({ centroid: null, prevLm: null, lastSeenAt: -Infinity, obs: null, joints: null });

function toJoints(lm: Landmark2D[], aspect: number): Record<JointName, Pt3> {
  const out = {} as Record<JointName, Pt3>;
  for (const j of JOINTS) {
    const p = lm[MP_INDEX[j]];
    out[j] = { x: p.x * aspect, y: p.y, z: 0, v: p.v };
  }
  return out;
}

/**
 * Two-person pose engine for Tanding: MediaPipe with numPoses=2, greedy
 * identity tracking (the fighter starting on the left of the screen is
 * Merah; `swapCorners` corrects the assignment), dual coloured overlay.
 */
export function useDuelEngine(model: ModelKind) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [modelStatus, setModelStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [modelError, setModelError] = useState<string | null>(null);
  const [source, setSource] = useState<DuelSourceKind | null>(null);
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [fps, setFps] = useState(0);
  const [poseCount, setPoseCount] = useState(0);
  const [videoName, setVideoName] = useState<string | null>(null);
  const [, setSwapTick] = useState(0);

  const landmarkerRef = useRef<PoseLandmarker | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const onFrameRef = useRef<((f: DuelFrame) => void) | null>(null);
  const labelsRef = useRef<{ merah: string; biru: string }>({ merah: 'MERAH', biru: 'BIRU' });
  const lastFrameRef = useRef<DuelFrame | null>(null);
  const mirrorRef = useRef(false);
  const sourceRef = useRef<DuelSourceKind | null>(null);
  const tracksRef = useRef<[Track, Track]>([newTrack(), newTrack()]);
  /** Which physical track is reported as [merah, biru]. */
  const cornerOrderRef = useRef<[0 | 1, 0 | 1]>([0, 1]);

  useEffect(() => {
    let cancelled = false;
    setModelStatus('loading');
    setModelError(null);
    landmarkerRef.current = null;
    getPoseLandmarker(model, 2)
      .then((lm) => {
        if (cancelled) return;
        landmarkerRef.current = lm;
        setModelStatus('ready');
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setModelStatus('error');
        setModelError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [model]);

  const resetTracks = useCallback(() => {
    tracksRef.current = [newTrack(), newTrack()];
    cornerOrderRef.current = [0, 1];
    lastFrameRef.current = null;
    setPoseCount(0);
  }, []);

  const stopSource = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    const v = videoRef.current;
    if (v) {
      v.pause();
      v.srcObject = null;
      v.removeAttribute('src');
      v.load();
    }
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
    sourceRef.current = null;
    setSource(null);
    setVideoName(null);
    resetTracks();
    const c = canvasRef.current;
    if (c) c.getContext('2d')?.clearRect(0, 0, c.width, c.height);
  }, [resetTracks]);

  const startCamera = useCallback(async () => {
    stopSource();
    setSourceError(null);
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera API not available in this browser (requires HTTPS).');
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
        audio: false,
      });
      streamRef.current = stream;
      const v = videoRef.current;
      if (!v) throw new Error('Video element missing');
      v.srcObject = stream;
      v.muted = true;
      v.playsInline = true;
      await v.play();
      mirrorRef.current = true;
      sourceRef.current = 'camera';
      setSource('camera');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setSourceError(/denied|NotAllowed/i.test(msg) ? 'Camera permission was denied. Allow camera access in the browser and try again.' : msg);
    }
  }, [stopSource]);

  const loadVideo = useCallback(
    async (file: File) => {
      stopSource();
      setSourceError(null);
      try {
        const url = URL.createObjectURL(file);
        objectUrlRef.current = url;
        const v = videoRef.current;
        if (!v) throw new Error('Video element missing');
        v.srcObject = null;
        v.muted = true;
        v.playsInline = true;
        v.loop = false;
        await new Promise<void>((resolve, reject) => {
          v.onloadeddata = () => resolve();
          v.onerror = () => reject(new Error('This video format cannot be decoded by the browser. Try MP4 (H.264) or WebM.'));
          v.src = url;
        });
        v.pause();
        v.currentTime = 0;
        mirrorRef.current = false;
        sourceRef.current = 'video';
        setSource('video');
        setVideoName(file.name);
      } catch (e) {
        setSourceError(e instanceof Error ? e.message : String(e));
      }
    },
    [stopSource],
  );

  /** Swap which tracked fighter counts as Merah/Biru (calibration). */
  const swapCorners = useCallback(() => {
    const [a, b] = cornerOrderRef.current;
    cornerOrderRef.current = [b, a];
    setSwapTick((n) => n + 1);
  }, []);

  useEffect(() => {
    let raf = 0;
    let lastVideoTime = -1;
    let lastDetect = 0;
    let frames = 0;
    let fpsT = performance.now();

    const assignIdentities = (candidates: { lm: Landmark2D[]; centroid: { x: number; y: number }; visibility: number }[], aspect: number, now: number) => {
      const tracks = tracksRef.current;
      const mirror = mirrorRef.current;
      const screenX = (c: { x: number }) => (mirror ? 1 - c.x : c.x);
      const usedCand = new Set<number>();
      const assigned: (number | null)[] = [null, null]; // track -> candidate index

      // First-ever assignment: left of screen = track 0.
      if (tracks[0].centroid === null && tracks[1].centroid === null && candidates.length > 0) {
        const order = candidates.map((_, i) => i).sort((a, b) => screenX(candidates[a].centroid) - screenX(candidates[b].centroid));
        order.forEach((ci, ti) => {
          if (ti < 2) {
            assigned[ti] = ci;
            usedCand.add(ci);
          }
        });
      } else {
        // Greedy nearest-centroid matching.
        const pairs: { ti: number; ci: number; d: number }[] = [];
        tracks.forEach((tr, ti) => {
          if (!tr.centroid) return;
          candidates.forEach((cand, ci) => {
            pairs.push({ ti, ci, d: Math.hypot(tr.centroid!.x - cand.centroid.x, tr.centroid!.y - cand.centroid.y) });
          });
        });
        pairs.sort((a, b) => a.d - b.d);
        for (const p of pairs) {
          if (p.d > 0.4) break;
          if (assigned[p.ti] !== null || usedCand.has(p.ci)) continue;
          assigned[p.ti] = p.ci;
          usedCand.add(p.ci);
        }
        // Any leftover candidate claims a free/stale track.
        candidates.forEach((_, ci) => {
          if (usedCand.has(ci)) return;
          const ti = assigned.findIndex((a) => a === null);
          if (ti >= 0) {
            assigned[ti] = ci;
            usedCand.add(ci);
          }
        });
      }

      tracks.forEach((tr, ti) => {
        const ci = assigned[ti];
        if (ci === null || ci === undefined) {
          tr.obs = null;
          tr.joints = null;
          if (now - tr.lastSeenAt > 2) tr.centroid = null;
          return;
        }
        const cand = candidates[ci];
        const smoothed = tr.prevLm ? smooth2D(tr.prevLm, cand.lm, 0.6) : cand.lm;
        tr.prevLm = smoothed;
        tr.centroid = cand.centroid;
        tr.lastSeenAt = now;
        tr.joints = toJoints(smoothed, aspect);
        tr.obs = { joints: tr.joints, visibility: cand.visibility };
      });
      return assigned.filter((a) => a !== null).length;
    };

    const loop = () => {
      raf = requestAnimationFrame(loop);
      const v = videoRef.current;
      const c = canvasRef.current;
      const nowMs = performance.now();
      if (nowMs - fpsT >= 1000) {
        setFps(Math.round((frames * 1000) / (nowMs - fpsT)));
        frames = 0;
        fpsT = nowMs;
      }
      if (!v || !c || v.readyState < 2 || !v.videoWidth || !sourceRef.current) return;
      const w = v.videoWidth;
      const h = v.videoHeight;
      if (c.width !== w || c.height !== h) {
        c.width = w;
        c.height = h;
      }
      const ctx = c.getContext('2d');
      if (!ctx) return;
      const mirror = mirrorRef.current;
      const aspect = w / h;
      ctx.save();
      if (mirror) {
        ctx.translate(w, 0);
        ctx.scale(-1, 1);
      }
      ctx.drawImage(v, 0, 0, w, h);
      ctx.restore();

      const lmk = landmarkerRef.current;
      if (lmk && v.currentTime !== lastVideoTime && nowMs - lastDetect >= 26) {
        lastVideoTime = v.currentTime;
        lastDetect = nowMs;
        try {
          const res = detectPose(lmk, v);
          const persons = res.landmarks ?? [];
          const candidates = persons
            .filter((lm) => lm && lm.length >= 33)
            .map((lm) => ({
              lm: toLandmarks2D(lm),
              centroid: { x: (lm[23].x + lm[24].x) / 2, y: (lm[23].y + lm[24].y) / 2 },
              visibility: keyVisibility(lm),
            }));
          const count = assignIdentities(candidates, aspect, nowMs / 1000);
          setPoseCount(count);
          const [mIdx, bIdx] = cornerOrderRef.current;
          const frame: DuelFrame = {
            now: nowMs / 1000,
            mediaTime: v.currentTime,
            fighters: [tracksRef.current[mIdx].obs, tracksRef.current[bIdx].obs],
            aspect,
          };
          lastFrameRef.current = frame;
          onFrameRef.current?.(frame);
          frames++;
        } catch (err) {
          console.warn('[duel-pose] detection error', err);
        }
      }

      const [mIdx, bIdx] = cornerOrderRef.current;
      const drawList: (DrawFighter | null)[] = [
        tracksRef.current[mIdx].joints ? { joints: tracksRef.current[mIdx].joints!, color: CORNER_COLORS.merah, label: labelsRef.current.merah } : null,
        tracksRef.current[bIdx].joints ? { joints: tracksRef.current[bIdx].joints!, color: CORNER_COLORS.biru, label: labelsRef.current.biru } : null,
      ];
      drawDuelFighters(ctx, w, h, aspect, mirror, drawList);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => () => stopSource(), [stopSource]);

  return {
    videoRef,
    canvasRef,
    modelStatus,
    modelError,
    source,
    sourceRef,
    sourceError,
    fps,
    poseCount,
    videoName,
    onFrameRef,
    labelsRef,
    lastFrameRef,
    startCamera,
    loadVideo,
    stopSource,
    swapCorners,
    resetTracks,
  };
}

export type DuelEngine = ReturnType<typeof useDuelEngine>;
