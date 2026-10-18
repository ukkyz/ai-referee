'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { PoseLandmarker } from '@mediapipe/tasks-vision';
import { detectPose, getPoseLandmarker } from '../lib/pose/detector';
import { keyVisibility, MP_INDEX } from '../lib/pose/landmarks';
import type { FighterObs } from '../lib/duel/fightDetector';
import { CORNER_COLORS, drawDuelFighters, type DrawFighter } from '../lib/duel/draw';
import { projectionMatrix, projectPoint, type RigProfile } from '../lib/duel/rig/calibration';
import { FrameSynchronizer, recommendedSkewMs } from '../lib/duel/rig/sync';
import { DuelCanonicalizer, type Fighter3D } from '../lib/duel/rig/canonical';
import { RigFusion, type CamPersons } from '../lib/duel/rig/fusion';
import type { LandmarkLike } from '../lib/duel/rig/triangulate';
import { JOINTS, type JointName, type ModelKind } from '../types';
import type { Pt3 } from '../lib/duel/geometry';
import type { DuelFrame } from './useDuelEngine';

export interface RigFrame extends DuelFrame {
  mode: '3d' | '2d-fallback';
  skewMs: number;
  reprojPx: number | null;
}

export interface RigCameraState {
  cameraId: string;
  label: string;
  state: 'off' | 'starting' | 'live' | 'error';
  actualFps: number;
  persons: number;
  error?: string;
}

export interface CameraAssignment {
  cameraId: string;
  deviceId: string;
}

interface CamRuntime {
  cameraId: string;
  video: HTMLVideoElement;
  stream: MediaStream;
  lastVideoTime: number;
  detectedCount: number;
  persons: number;
}

type Payload = { persons: { landmarks: LandmarkLike[] }[] };

export async function listCameras(): Promise<{ deviceId: string; label: string }[]> {
  const enumerate = async () => (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
  let devices = await enumerate();
  if (devices.length && !devices[0].label) {
    // Labels need a permission grant first.
    const probe = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    probe.getTracks().forEach((t) => t.stop());
    devices = await enumerate();
  }
  return devices.map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Kamera ${i + 1}` }));
}

function fallbackFighters(persons: { landmarks: LandmarkLike[] }[], aspect: number): [FighterObs | null, FighterObs | null] {
  const sorted = [...persons].sort((a, b) => (a.landmarks[23].x + a.landmarks[24].x) / 2 - (b.landmarks[23].x + b.landmarks[24].x) / 2);
  const toObs = (p?: { landmarks: LandmarkLike[] }): FighterObs | null => {
    if (!p) return null;
    const joints = {} as Record<JointName, Pt3>;
    for (const j of JOINTS) {
      const lm = p.landmarks[MP_INDEX[j]];
      joints[j] = { x: lm.x * aspect, y: lm.y, z: 0, v: lm.visibility ?? 1 };
    }
    return { joints, visibility: keyVisibility(p.landmarks as never) };
  };
  return [toObs(sorted[0]), toObs(sorted[1])];
}

/**
 * Multi-camera rig engine: opens up to 3 (+ ) synchronized streams at the
 * target frame rate, runs MediaPipe (2 poses) per camera, aligns frames with
 * the software synchronizer, and — when a calibration profile is present —
 * fuses them into metric 3D skeletons converted to the canonical duel plane.
 * Without calibration it runs in an explicit 2D-fallback mode (primary
 * camera only) so the limitation is visible, never silent.
 */
export function useRigEngine(model: ModelKind, profile: RigProfile | null) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [modelStatus, setModelStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [camStates, setCamStates] = useState<RigCameraState[]>([]);
  const [running, setRunning] = useState(false);
  const [quality, setQuality] = useState<{ mode: '3d' | '2d-fallback' | 'off'; skewMs: number; reprojPx: number | null; bundles: number; dropped: number }>({
    mode: 'off',
    skewMs: 0,
    reprojPx: null,
    bundles: 0,
    dropped: 0,
  });

  const landmarkerRef = useRef<PoseLandmarker | null>(null);
  const camsRef = useRef<CamRuntime[]>([]);
  const syncRef = useRef<FrameSynchronizer<Payload> | null>(null);
  const fusionRef = useRef<RigFusion | null>(null);
  const canonRef = useRef(new DuelCanonicalizer());
  const profileRef = useRef<RigProfile | null>(profile);
  const onFrameRef = useRef<((f: RigFrame) => void) | null>(null);
  const labelsRef = useRef<{ merah: string; biru: string }>({ merah: 'MERAH', biru: 'BIRU' });
  const last3dRef = useRef<[Fighter3D | null, Fighter3D | null]>([null, null]);
  const lastObsRef = useRef<[FighterObs | null, FighterObs | null]>([null, null]);
  const swapFallbackRef = useRef(false);
  const runningRef = useRef(false);

  useEffect(() => {
    profileRef.current = profile;
    if (profile) {
      if (fusionRef.current) fusionRef.current.setProfile(profile);
      else fusionRef.current = new RigFusion(profile);
    } else {
      fusionRef.current = null;
    }
  }, [profile]);

  useEffect(() => {
    let cancelled = false;
    setModelStatus('loading');
    landmarkerRef.current = null;
    getPoseLandmarker(model, 2)
      .then((lm) => {
        if (!cancelled) {
          landmarkerRef.current = lm;
          setModelStatus('ready');
        }
      })
      .catch(() => {
        if (!cancelled) setModelStatus('error');
      });
    return () => {
      cancelled = true;
    };
  }, [model]);

  const stop = useCallback(() => {
    runningRef.current = false;
    setRunning(false);
    for (const c of camsRef.current) {
      c.stream.getTracks().forEach((t) => t.stop());
      c.video.pause();
      c.video.srcObject = null;
    }
    camsRef.current = [];
    syncRef.current = null;
    canonRef.current.reset();
    fusionRef.current?.reset();
    last3dRef.current = [null, null];
    lastObsRef.current = [null, null];
    setCamStates((prev) => prev.map((s) => ({ ...s, state: 'off', persons: 0 })));
    setQuality((q) => ({ ...q, mode: 'off' }));
    const canvas = canvasRef.current;
    if (canvas) canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
  }, []);

  const start = useCallback(
    async (assignments: CameraAssignment[], targetFps: number) => {
      stop();
      const prof = profileRef.current;
      const cameraIds = assignments.map((a) => a.cameraId);
      syncRef.current = new FrameSynchronizer<Payload>(cameraIds, { maxSkewMs: recommendedSkewMs(targetFps) });
      if (prof && !fusionRef.current) fusionRef.current = new RigFusion(prof);
      fusionRef.current?.reset();
      canonRef.current.reset();

      setCamStates(
        assignments.map((a) => ({
          cameraId: a.cameraId,
          label: prof?.cameras.find((c) => c.id === a.cameraId)?.label ?? a.cameraId,
          state: 'starting',
          actualFps: 0,
          persons: 0,
        })),
      );

      const runtimes: CamRuntime[] = [];
      for (const a of assignments) {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({
            video: {
              deviceId: { exact: a.deviceId },
              width: { ideal: 1280 },
              height: { ideal: 720 },
              frameRate: { ideal: targetFps, max: targetFps },
            },
            audio: false,
          });
          const video = document.createElement('video');
          video.muted = true;
          video.playsInline = true;
          video.srcObject = stream;
          await video.play();
          runtimes.push({ cameraId: a.cameraId, video, stream, lastVideoTime: -1, detectedCount: 0, persons: 0 });
          setCamStates((prev) => prev.map((s) => (s.cameraId === a.cameraId ? { ...s, state: 'live' } : s)));
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          setCamStates((prev) => prev.map((s) => (s.cameraId === a.cameraId ? { ...s, state: 'error', error: msg } : s)));
        }
      }
      camsRef.current = runtimes;
      runningRef.current = runtimes.length > 0;
      setRunning(runtimes.length > 0);
      setQuality({ mode: prof ? '3d' : '2d-fallback', skewMs: 0, reprojPx: null, bundles: 0, dropped: 0 });
    },
    [stop],
  );

  const swapCorners = useCallback(() => {
    if (fusionRef.current) fusionRef.current.swap();
    else swapFallbackRef.current = !swapFallbackRef.current;
  }, []);

  useEffect(() => {
    let raf = 0;
    let fpsWindowStart = performance.now();
    let qualityAt = 0;

    const loop = () => {
      raf = requestAnimationFrame(loop);
      if (!runningRef.current) return;
      const canvas = canvasRef.current;
      const lmk = landmarkerRef.current;
      const sync = syncRef.current;
      const prof = profileRef.current;
      const nowMs = performance.now();

      // Per-camera detection -> synchronizer.
      if (lmk && sync) {
        for (const cam of camsRef.current) {
          const v = cam.video;
          if (v.readyState < 2 || !v.videoWidth || v.currentTime === cam.lastVideoTime) continue;
          cam.lastVideoTime = v.currentTime;
          try {
            const res = detectPose(lmk, v);
            const persons = (res.landmarks ?? [])
              .filter((lm) => lm && lm.length >= 33)
              .map((lm) => ({ landmarks: lm.map((p) => ({ x: p.x, y: p.y, visibility: p.visibility })) }));
            cam.detectedCount += 1;
            cam.persons = persons.length;
            const offset = prof?.cameras.find((c) => c.id === cam.cameraId)?.syncOffsetMs ?? 0;
            const bundles = sync.push({ cameraId: cam.cameraId, captureMs: nowMs + offset, payload: { persons } });
            for (const bundle of bundles) {
              const perCamera: CamPersons[] = Object.entries(bundle.frames).map(([cameraId, f]) => ({
                cameraId,
                persons: f.payload.persons,
              }));
              let fighters: [FighterObs | null, FighterObs | null];
              let reprojPx: number | null = null;
              if (prof && fusionRef.current) {
                const fused = fusionRef.current.process(perCamera);
                last3dRef.current = fused;
                fighters = canonRef.current.convert(fused);
                const errs = fused.filter(Boolean).map((f) => f!.meanErrorPx);
                reprojPx = errs.length ? errs.reduce((a, b) => a + b, 0) / errs.length : null;
              } else {
                const main = camsRef.current[0];
                const mainPersons = bundle.frames[main?.cameraId ?? '']?.payload.persons ?? [];
                const aspect = main && main.video.videoHeight ? main.video.videoWidth / main.video.videoHeight : 16 / 9;
                fighters = fallbackFighters(mainPersons, aspect);
                if (swapFallbackRef.current) fighters = [fighters[1], fighters[0]];
                last3dRef.current = [null, null];
              }
              lastObsRef.current = fighters;
              const main = camsRef.current[0];
              onFrameRef.current?.({
                now: bundle.tMs / 1000,
                mediaTime: main?.video.currentTime ?? 0,
                fighters,
                aspect: main && main.video.videoHeight ? main.video.videoWidth / main.video.videoHeight : 16 / 9,
                mode: prof ? '3d' : '2d-fallback',
                skewMs: bundle.skewMs,
                reprojPx,
              });
              if (nowMs - qualityAt > 400) {
                qualityAt = nowMs;
                const st = sync.stats();
                setQuality({ mode: prof ? '3d' : '2d-fallback', skewMs: bundle.skewMs, reprojPx, bundles: st.bundlesEmitted, dropped: st.framesDropped });
              }
            }
          } catch (err) {
            console.warn('[rig] detection error', cam.cameraId, err);
          }
        }
      }

      // FPS accounting (1 Hz).
      if (nowMs - fpsWindowStart >= 1000) {
        const elapsed = (nowMs - fpsWindowStart) / 1000;
        setCamStates((prev) =>
          prev.map((s) => {
            const rt = camsRef.current.find((c) => c.cameraId === s.cameraId);
            if (!rt) return s;
            const fpsActual = Math.round(rt.detectedCount / elapsed);
            rt.detectedCount = 0;
            return { ...s, actualFps: fpsActual, persons: rt.persons };
          }),
        );
        fpsWindowStart = nowMs;
      }

      // Composite preview: main camera full-frame + thumbnails + overlay.
      const main = camsRef.current[0];
      if (canvas && main && main.video.videoWidth) {
        const v = main.video;
        const w = v.videoWidth;
        const h = v.videoHeight;
        if (canvas.width !== w || canvas.height !== h) {
          canvas.width = w;
          canvas.height = h;
        }
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(v, 0, 0, w, h);
          const aspect = w / h;
          let drawList: (DrawFighter | null)[] = [null, null];
          const profNow = profileRef.current;
          const mainCal = profNow?.cameras.find((c) => c.id === main.cameraId);
          if (profNow && mainCal && (last3dRef.current[0] || last3dRef.current[1])) {
            const P = projectionMatrix(mainCal);
            const mkDraw = (f: Fighter3D | null, color: string, label: string): DrawFighter | null => {
              if (!f) return null;
              const joints = {} as Record<JointName, Pt3>;
              for (const j of JOINTS) {
                const p = f.joints[j];
                const px = p ? projectPoint(P, p) : null;
                if (!px) {
                  joints[j] = { x: 0, y: 0, z: 0, v: 0 };
                  continue;
                }
                joints[j] = { x: (px.x / mainCal.imageSize.w) * aspect, y: px.y / mainCal.imageSize.h, z: 0, v: p!.confidence };
              }
              return { joints, color, label };
            };
            drawList = [
              mkDraw(last3dRef.current[0], CORNER_COLORS.merah, labelsRef.current.merah),
              mkDraw(last3dRef.current[1], CORNER_COLORS.biru, labelsRef.current.biru),
            ];
          } else {
            drawList = [
              lastObsRef.current[0] ? { joints: lastObsRef.current[0].joints, color: CORNER_COLORS.merah, label: labelsRef.current.merah } : null,
              lastObsRef.current[1] ? { joints: lastObsRef.current[1].joints, color: CORNER_COLORS.biru, label: labelsRef.current.biru } : null,
            ];
          }
          drawDuelFighters(ctx, w, h, aspect, false, drawList);
          // Thumbnails of the other cameras (bottom-left stack).
          const tw = Math.round(w * 0.2);
          const th = Math.round(tw * (9 / 16));
          camsRef.current.slice(1).forEach((cam, i) => {
            const x = 10;
            const y = h - (i + 1) * (th + 8);
            ctx.fillStyle = 'rgba(0,0,0,0.6)';
            ctx.fillRect(x - 2, y - 2, tw + 4, th + 4);
            if (cam.video.videoWidth) ctx.drawImage(cam.video, x, y, tw, th);
          });
        }
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => () => stop(), [stop]);

  return {
    canvasRef,
    modelStatus,
    camStates,
    running,
    quality,
    onFrameRef,
    labelsRef,
    start,
    stop,
    swapCorners,
  };
}

export type RigEngine = ReturnType<typeof useRigEngine>;
