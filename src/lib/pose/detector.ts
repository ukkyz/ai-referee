import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';
import type { ModelKind } from '../../types';

const WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm';

export const MODEL_INFO: Record<ModelKind, { label: string; url: string; size: string; note: string }> = {
  lite: {
    label: 'Lite',
    size: '~5 MB',
    note: 'Fastest, best for low-end laptops & phones',
    url: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
  },
  full: {
    label: 'Full',
    size: '~9 MB',
    note: 'Balanced accuracy and speed (recommended)',
    url: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task',
  },
  heavy: {
    label: 'Heavy',
    size: '~29 MB',
    note: 'Most accurate, needs a strong GPU',
    url: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_heavy/float16/1/pose_landmarker_heavy.task',
  },
};

type Fileset = Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>;

let filesetPromise: Promise<Fileset> | null = null;
const cache = new Map<string, Promise<PoseLandmarker>>();

/**
 * Get (and cache) a Pose Landmarker. `numPoses` is 1 for Seni judging and 2
 * for Tanding (duel) analysis — each combination is cached separately.
 */
export function getPoseLandmarker(model: ModelKind, numPoses = 1): Promise<PoseLandmarker> {
  const key = `${model}:${numPoses}`;
  const existing = cache.get(key);
  if (existing) return existing;
  const p = (async () => {
    if (!filesetPromise) filesetPromise = FilesetResolver.forVisionTasks(WASM_URL);
    let fileset: Fileset;
    try {
      fileset = await filesetPromise;
    } catch (e) {
      filesetPromise = null;
      throw e;
    }
    const make = (delegate: 'GPU' | 'CPU') =>
      PoseLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MODEL_INFO[model].url, delegate },
        runningMode: 'VIDEO',
        numPoses,
        minPoseDetectionConfidence: 0.5,
        minPosePresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
        outputSegmentationMasks: false,
      });
    try {
      return await make('GPU');
    } catch (err) {
      console.warn('[pose] GPU delegate unavailable, falling back to CPU', err);
      return await make('CPU');
    }
  })();
  cache.set(key, p);
  p.catch(() => cache.delete(key));
  return p;
}

let lastTs = 0;

/** Run detection with a strictly increasing timestamp (required by VIDEO mode). */
export function detectPose(landmarker: PoseLandmarker, video: HTMLVideoElement) {
  let ts = performance.now();
  if (ts <= lastTs) ts = lastTs + 1;
  lastTs = ts;
  return landmarker.detectForVideo(video, ts);
}
