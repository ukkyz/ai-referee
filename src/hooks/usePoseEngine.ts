import { useCallback, useEffect, useRef, useState } from 'react';
import type { PoseLandmarker } from '@mediapipe/tasks-vision';
import { detectPose, getPoseLandmarker } from '../lib/pose/detector';
import {
  BONES,
  keyVisibility,
  MP_INDEX,
  smooth2D,
  smoothSkeleton,
  toLandmarks2D,
  worldToSkeleton,
  type Landmark2D,
} from '../lib/pose/landmarks';
import { computeFeatures } from '../lib/pose/features';
import type { Features, JointName, ModelKind, Skeleton } from '../types';

export interface PoseFrame {
  now: number;
  mediaTime: number;
  lm: Landmark2D[];
  skeleton: Skeleton;
  features: Features;
  visibility: number;
}

export type SourceKind = 'camera' | 'video';
export type BoneColorFn = (a: JointName, b: JointName) => string | null;

const DEFAULT_BONE = 'rgba(240, 207, 106, 0.95)';

function drawSkeleton(ctx: CanvasRenderingContext2D, lm: Landmark2D[], w: number, h: number, mirror: boolean, colorFn: BoneColorFn | null) {
  const P = (i: number) => ({ x: (mirror ? 1 - lm[i].x : lm[i].x) * w, y: lm[i].y * h });
  const lw = Math.max(3, w / 200);
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const [a, b] of BONES) {
    const ia = MP_INDEX[a];
    const ib = MP_INDEX[b];
    if (lm[ia].v < 0.25 || lm[ib].v < 0.25) continue;
    const pa = P(ia);
    const pb = P(ib);
    const color = colorFn?.(a, b) ?? DEFAULT_BONE;
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.lineWidth = lw + 4;
    ctx.beginPath();
    ctx.moveTo(pa.x, pa.y);
    ctx.lineTo(pb.x, pb.y);
    ctx.stroke();
    ctx.strokeStyle = color;
    ctx.lineWidth = lw;
    ctx.shadowColor = color;
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.moveTo(pa.x, pa.y);
    ctx.lineTo(pb.x, pb.y);
    ctx.stroke();
    ctx.shadowBlur = 0;
  }
  const joints: JointName[] = ['lShoulder', 'rShoulder', 'lElbow', 'rElbow', 'lWrist', 'rWrist', 'lHip', 'rHip', 'lKnee', 'rKnee', 'lAnkle', 'rAnkle'];
  for (const j of joints) {
    const i = MP_INDEX[j];
    if (lm[i].v < 0.25) continue;
    const p = P(i);
    ctx.fillStyle = '#fff7e0';
    ctx.strokeStyle = 'rgba(20,14,8,0.9)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(p.x, p.y, lw * 0.9, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  // head marker
  if (lm[0].v > 0.3) {
    const n = P(0);
    const sw = Math.hypot(P(11).x - P(12).x, P(11).y - P(12).y);
    ctx.strokeStyle = DEFAULT_BONE;
    ctx.lineWidth = lw * 0.7;
    ctx.beginPath();
    ctx.arc(n.x, n.y, Math.max(10, sw * 0.32), 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

export function usePoseEngine(model: ModelKind) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [modelStatus, setModelStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [modelError, setModelError] = useState<string | null>(null);
  const [source, setSource] = useState<SourceKind | null>(null);
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [fps, setFps] = useState(0);
  const [hasPose, setHasPose] = useState(false);
  const [videoName, setVideoName] = useState<string | null>(null);

  const landmarkerRef = useRef<PoseLandmarker | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const onFrameRef = useRef<((f: PoseFrame | null) => void) | null>(null);
  const boneColorRef = useRef<BoneColorFn | null>(null);
  const lastFrameRef = useRef<PoseFrame | null>(null);
  const mirrorRef = useRef(false);
  const sourceRef = useRef<SourceKind | null>(null);
  const resetSmoothingRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    setModelStatus('loading');
    setModelError(null);
    landmarkerRef.current = null;
    getPoseLandmarker(model)
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
    lastFrameRef.current = null;
    resetSmoothingRef.current = true;
    sourceRef.current = null;
    setHasPose(false);
    setSource(null);
    setVideoName(null);
    const c = canvasRef.current;
    if (c) c.getContext('2d')?.clearRect(0, 0, c.width, c.height);
  }, []);

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

  useEffect(() => {
    let raf = 0;
    let lastVideoTime = -1;
    let lastDetect = 0;
    let frames = 0;
    let fpsT = performance.now();
    let prevSkel: Skeleton | null = null;
    let prevLm: Landmark2D[] | null = null;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const v = videoRef.current;
      const c = canvasRef.current;
      const now = performance.now();
      if (now - fpsT >= 1000) {
        setFps(Math.round((frames * 1000) / (now - fpsT)));
        setHasPose(!!lastFrameRef.current);
        frames = 0;
        fpsT = now;
      }
      if (!v || !c || v.readyState < 2 || !v.videoWidth || !sourceRef.current) return;
      if (resetSmoothingRef.current) {
        prevSkel = null;
        prevLm = null;
        lastVideoTime = -1;
        resetSmoothingRef.current = false;
      }
      const w = v.videoWidth;
      const h = v.videoHeight;
      if (c.width !== w || c.height !== h) {
        c.width = w;
        c.height = h;
      }
      const ctx = c.getContext('2d');
      if (!ctx) return;
      const mirror = mirrorRef.current;
      ctx.save();
      if (mirror) {
        ctx.translate(w, 0);
        ctx.scale(-1, 1);
      }
      ctx.drawImage(v, 0, 0, w, h);
      ctx.restore();

      const lmk = landmarkerRef.current;
      if (lmk && v.currentTime !== lastVideoTime && now - lastDetect >= 26) {
        lastVideoTime = v.currentTime;
        lastDetect = now;
        try {
          const res = detectPose(lmk, v);
          const lm = res.landmarks?.[0];
          const wl = res.worldLandmarks?.[0];
          if (lm && wl && lm.length >= 33 && wl.length >= 33) {
            const raw = worldToSkeleton(wl);
            const skel = prevSkel ? smoothSkeleton(prevSkel, raw, 0.55) : raw;
            prevSkel = skel;
            const l2 = toLandmarks2D(lm);
            const lms = prevLm ? smooth2D(prevLm, l2, 0.6) : l2;
            prevLm = lms;
            const frame: PoseFrame = {
              now: now / 1000,
              mediaTime: v.currentTime,
              lm: lms,
              skeleton: skel,
              features: computeFeatures(skel),
              visibility: keyVisibility(lm),
            };
            lastFrameRef.current = frame;
            onFrameRef.current?.(frame);
          } else {
            lastFrameRef.current = null;
            prevSkel = null;
            prevLm = null;
            onFrameRef.current?.(null);
          }
          frames++;
        } catch (err) {
          console.warn('[pose] detection error', err);
        }
      }
      const f = lastFrameRef.current;
      if (f) drawSkeleton(ctx, f.lm, w, h, mirror, boneColorRef.current);
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
    hasPose,
    videoName,
    onFrameRef,
    boneColorRef,
    lastFrameRef,
    startCamera,
    loadVideo,
    stopSource,
  };
}

export type PoseEngine = ReturnType<typeof usePoseEngine>;
