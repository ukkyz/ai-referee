/**
 * Multi-camera rig calibration model.
 *
 * World frame: metres, origin at the centre of the gelanggang, +y up,
 * mat plane at y = 0. Camera frame follows the OpenCV convention
 * (x right, y down, z forward); extrinsics map world -> camera:
 *   X_cam = R * X_world + t
 * A calibration JSON produced by an external tool (ChArUco board session)
 * can be imported in the Tanding setup and is validated by
 * `validateRigProfile`.
 */

export interface WorldPoint {
  x: number;
  y: number;
  z: number;
}

export interface RigCameraCalibration {
  id: string;
  label: string;
  imageSize: { w: number; h: number };
  /** Pinhole intrinsics in pixels (distortion assumed removed / negligible). */
  intrinsics: { fx: number; fy: number; cx: number; cy: number };
  extrinsics: {
    /** Row-major 3x3 rotation, world -> camera. */
    rotation: number[];
    /** Translation (metres), world -> camera. */
    translation: number[];
  };
  /** Constant timestamp correction applied to this camera's frames. */
  syncOffsetMs: number;
}

export interface RigProfile {
  version: 1;
  id: string;
  name: string;
  /** Capture target: 60 minimum, 120 recommended for fast tendangan. */
  targetFps: number;
  cameras: RigCameraCalibration[];
  createdAt?: number;
}

/** 3x4 projection matrix P = K [R|t] (row-major, length 12). */
export function projectionMatrix(cam: RigCameraCalibration): number[] {
  const { fx, fy, cx, cy } = cam.intrinsics;
  const R = cam.extrinsics.rotation;
  const t = cam.extrinsics.translation;
  const M: number[] = new Array(12).fill(0);
  // Row 0: fx * R0 + cx * R2 | fx * t0 + cx * t2  (skew = 0)
  M[0] = fx * R[0] + cx * R[6];
  M[1] = fx * R[1] + cx * R[7];
  M[2] = fx * R[2] + cx * R[8];
  M[3] = fx * t[0] + cx * t[2];
  M[4] = fy * R[3] + cy * R[6];
  M[5] = fy * R[4] + cy * R[7];
  M[6] = fy * R[5] + cy * R[8];
  M[7] = fy * t[1] + cy * t[2];
  M[8] = R[6];
  M[9] = R[7];
  M[10] = R[8];
  M[11] = t[2];
  return M;
}

/** Project a world point to pixel coordinates; null when behind the camera. */
export function projectPoint(P: number[], p: WorldPoint): { x: number; y: number } | null {
  const w = P[8] * p.x + P[9] * p.y + P[10] * p.z + P[11];
  if (w <= 1e-9) return null;
  return {
    x: (P[0] * p.x + P[1] * p.y + P[2] * p.z + P[3]) / w,
    y: (P[4] * p.x + P[5] * p.y + P[6] * p.z + P[7]) / w,
  };
}

/** Camera centre in world coordinates: C = -R^T t. */
export function cameraCenter(cam: RigCameraCalibration): WorldPoint {
  const R = cam.extrinsics.rotation;
  const t = cam.extrinsics.translation;
  return {
    x: -(R[0] * t[0] + R[3] * t[1] + R[6] * t[2]),
    y: -(R[1] * t[0] + R[4] * t[1] + R[7] * t[2]),
    z: -(R[2] * t[0] + R[5] * t[1] + R[8] * t[2]),
  };
}

const sub = (a: WorldPoint, b: WorldPoint): WorldPoint => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const cross = (a: WorldPoint, b: WorldPoint): WorldPoint => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
const norm = (a: WorldPoint): WorldPoint => {
  const l = Math.hypot(a.x, a.y, a.z) || 1;
  return { x: a.x / l, y: a.y / l, z: a.z / l };
};

/** Build a calibration from a camera position looking at a target (tests, demo rigs, planning). */
export function makeLookAtCamera(input: {
  id: string;
  label: string;
  position: WorldPoint;
  target: WorldPoint;
  imageSize?: { w: number; h: number };
  horizontalFovDeg?: number;
  syncOffsetMs?: number;
}): RigCameraCalibration {
  const imageSize = input.imageSize ?? { w: 1920, h: 1080 };
  const fov = ((input.horizontalFovDeg ?? 55) * Math.PI) / 180;
  const fx = imageSize.w / 2 / Math.tan(fov / 2);
  const up: WorldPoint = { x: 0, y: 1, z: 0 };
  const zc = norm(sub(input.target, input.position)); // forward
  const xc = norm(cross(zc, up)); // right
  const yc = cross(zc, xc); // down
  const R = [xc.x, xc.y, xc.z, yc.x, yc.y, yc.z, zc.x, zc.y, zc.z];
  const pos = input.position;
  const t = [
    -(R[0] * pos.x + R[1] * pos.y + R[2] * pos.z),
    -(R[3] * pos.x + R[4] * pos.y + R[5] * pos.z),
    -(R[6] * pos.x + R[7] * pos.y + R[8] * pos.z),
  ];
  return {
    id: input.id,
    label: input.label,
    imageSize,
    intrinsics: { fx, fy: fx, cx: imageSize.w / 2, cy: imageSize.h / 2 },
    extrinsics: { rotation: R, translation: t },
    syncOffsetMs: input.syncOffsetMs ?? 0,
  };
}

/** Synthetic surround rig (120° apart, elevated) for tests and UI planning demos. */
export function defaultDemoRig(): RigProfile {
  const target: WorldPoint = { x: 0, y: 1, z: 0 };
  const mk = (id: string, label: string, azimuthDeg: number) => {
    const a = (azimuthDeg * Math.PI) / 180;
    const r = 7;
    return makeLookAtCamera({
      id,
      label,
      position: { x: r * Math.sin(a), y: 3, z: -r * Math.cos(a) },
      target,
    });
  };
  return {
    version: 1,
    id: 'demo-rig-3cam',
    name: 'Demo Rig — 3 kamera (sintetis)',
    targetFps: 120,
    cameras: [mk('cam-depan', 'Depan', 0), mk('cam-kanan', 'Kanan belakang', 120), mk('cam-kiri', 'Kiri belakang', 240)],
    createdAt: 0,
  };
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isRec = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const numArray = (v: unknown, len: number): v is number[] => Array.isArray(v) && v.length === len && v.every(isNum);

/** Validate an imported rig profile JSON. Returns null when malformed. */
export function validateRigProfile(value: unknown): RigProfile | null {
  if (!isRec(value)) return null;
  if (typeof value.id !== 'string' || typeof value.name !== 'string') return null;
  if (!Array.isArray(value.cameras) || value.cameras.length < 2 || value.cameras.length > 6) return null;
  const cameras: RigCameraCalibration[] = [];
  for (const c of value.cameras) {
    if (!isRec(c) || typeof c.id !== 'string' || !isRec(c.imageSize) || !isRec(c.intrinsics) || !isRec(c.extrinsics)) return null;
    const { w, h } = c.imageSize as { w: unknown; h: unknown };
    const intr = c.intrinsics as Record<string, unknown>;
    const extr = c.extrinsics as Record<string, unknown>;
    if (!isNum(w) || !isNum(h) || w <= 0 || h <= 0) return null;
    if (![intr.fx, intr.fy, intr.cx, intr.cy].every(isNum)) return null;
    if (!numArray(extr.rotation, 9) || !numArray(extr.translation, 3)) return null;
    cameras.push({
      id: c.id,
      label: typeof c.label === 'string' ? c.label : c.id,
      imageSize: { w, h },
      intrinsics: { fx: intr.fx as number, fy: intr.fy as number, cx: intr.cx as number, cy: intr.cy as number },
      extrinsics: { rotation: [...(extr.rotation as number[])], translation: [...(extr.translation as number[])] },
      syncOffsetMs: isNum(c.syncOffsetMs) ? c.syncOffsetMs : 0,
    });
  }
  if (new Set(cameras.map((c) => c.id)).size !== cameras.length) return null;
  return {
    version: 1,
    id: value.id,
    name: value.name,
    targetFps: isNum(value.targetFps) ? Math.min(240, Math.max(24, value.targetFps)) : 60,
    cameras,
    createdAt: isNum(value.createdAt) ? value.createdAt : Date.now(),
  };
}
