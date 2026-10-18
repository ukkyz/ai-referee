import { JOINTS, type JointName } from '../../../types';
import { MP_INDEX } from '../../pose/landmarks';
import { projectionMatrix, projectPoint, type RigCameraCalibration, type WorldPoint } from './calibration';

/**
 * Multi-view triangulation (linear DLT). Each view contributes two equations;
 * the 3D point is the smallest-eigenvalue eigenvector of A^T A, found with
 * cyclic Jacobi rotations (4x4, no external linear algebra dependency).
 */

export interface Joint3D {
  x: number;
  y: number;
  z: number;
  /** Cameras that saw this joint. */
  views: number;
  /** Mean reprojection error in pixels. */
  errorPx: number;
  /** 0..1 fused confidence (views, reprojection error, landmark visibility). */
  confidence: number;
}

export interface LandmarkLike {
  x: number; // normalised 0..1
  y: number;
  visibility?: number;
}

interface ViewObs {
  P: number[];
  x: number; // pixels
  y: number;
  weight: number;
}

/** Smallest eigenvector of a symmetric 4x4 matrix via cyclic Jacobi sweeps. */
function smallestEigenvector4(m: number[][]): number[] {
  const a = m.map((row) => [...row]);
  const v: number[][] = [
    [1, 0, 0, 0],
    [0, 1, 0, 0],
    [0, 0, 1, 0],
    [0, 0, 0, 1],
  ];
  for (let sweep = 0; sweep < 40; sweep++) {
    let off = 0;
    for (let p = 0; p < 3; p++) for (let q = p + 1; q < 4; q++) off += a[p][q] * a[p][q];
    if (off < 1e-22) break;
    for (let p = 0; p < 3; p++) {
      for (let q = p + 1; q < 4; q++) {
        const apq = a[p][q];
        if (Math.abs(apq) < 1e-15) continue;
        const theta = (a[q][q] - a[p][p]) / (2 * apq);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let k = 0; k < 4; k++) {
          const akp = a[k][p];
          const akq = a[k][q];
          a[k][p] = c * akp - s * akq;
          a[k][q] = s * akp + c * akq;
        }
        for (let k = 0; k < 4; k++) {
          const apk = a[p][k];
          const aqk = a[q][k];
          a[p][k] = c * apk - s * aqk;
          a[q][k] = s * apk + c * aqk;
        }
        for (let k = 0; k < 4; k++) {
          const vkp = v[k][p];
          const vkq = v[k][q];
          v[k][p] = c * vkp - s * vkq;
          v[k][q] = s * vkp + c * vkq;
        }
      }
    }
  }
  let minIdx = 0;
  for (let i = 1; i < 4; i++) if (a[i][i] < a[minIdx][minIdx]) minIdx = i;
  return [v[0][minIdx], v[1][minIdx], v[2][minIdx], v[3][minIdx]];
}

export interface TriangulatedPoint {
  point: WorldPoint;
  meanErrorPx: number;
  maxErrorPx: number;
  views: number;
}

function triangulateViews(views: ViewObs[]): TriangulatedPoint | null {
  if (views.length < 2) return null;
  // Build A (2n x 4) then AtA (4x4).
  const ata: number[][] = [
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
  ];
  const addRow = (row: number[]) => {
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) ata[i][j] += row[i] * row[j];
  };
  for (const v of views) {
    const w = Math.sqrt(Math.max(0.01, v.weight));
    const P = v.P;
    addRow([0, 1, 2, 3].map((k) => (v.x * P[8 + k] - P[0 + k]) * w));
    addRow([0, 1, 2, 3].map((k) => (v.y * P[8 + k] - P[4 + k]) * w));
  }
  const sol = smallestEigenvector4(ata);
  if (Math.abs(sol[3]) < 1e-12) return null;
  const point: WorldPoint = { x: sol[0] / sol[3], y: sol[1] / sol[3], z: sol[2] / sol[3] };
  let sum = 0;
  let max = 0;
  for (const v of views) {
    const pr = projectPoint(v.P, point);
    if (!pr) return null;
    const err = Math.hypot(pr.x - v.x, pr.y - v.y);
    sum += err;
    max = Math.max(max, err);
  }
  return { point, meanErrorPx: sum / views.length, maxErrorPx: max, views: views.length };
}

export interface CameraSkeletonView {
  cam: RigCameraCalibration;
  /** MediaPipe-style landmarks (normalised), or null when this camera saw nobody. */
  landmarks: LandmarkLike[] | null;
}

const MIN_VISIBILITY = 0.3;

/** Triangulate one named joint from per-camera landmark sets. */
export function triangulateJoint(viewsIn: CameraSkeletonView[], joint: JointName): Joint3D | null {
  const idx = MP_INDEX[joint];
  const views: ViewObs[] = [];
  let visSum = 0;
  for (const v of viewsIn) {
    const lm = v.landmarks?.[idx];
    if (!lm) continue;
    const vis = lm.visibility ?? 1;
    if (vis < MIN_VISIBILITY) continue;
    views.push({
      P: projectionMatrix(v.cam),
      x: lm.x * v.cam.imageSize.w,
      y: lm.y * v.cam.imageSize.h,
      weight: vis,
    });
    visSum += vis;
  }
  const tri = triangulateViews(views);
  if (!tri) return null;
  const viewFactor = tri.views >= 3 ? 1 : 0.8;
  const confidence = Math.max(0, Math.min(0.99, viewFactor * Math.exp(-tri.meanErrorPx / 9) * (visSum / tri.views)));
  return { x: tri.point.x, y: tri.point.y, z: tri.point.z, views: tri.views, errorPx: tri.meanErrorPx, confidence };
}

/** Triangulate the 15 canonical joints; joints seen by <2 cameras are null. */
export function triangulateSkeleton(viewsIn: CameraSkeletonView[]): Record<JointName, Joint3D | null> {
  const out = {} as Record<JointName, Joint3D | null>;
  for (const j of JOINTS) out[j] = triangulateJoint(viewsIn, j);
  return out;
}

/** Mean reprojection error (px) of pairing two persons across two cameras — used for identity association. */
export function pairReprojectionError(
  camA: RigCameraCalibration,
  personA: LandmarkLike[],
  camB: RigCameraCalibration,
  personB: LandmarkLike[],
): number {
  const probe: JointName[] = ['lHip', 'rHip', 'lShoulder', 'rShoulder', 'nose'];
  const views: CameraSkeletonView[] = [
    { cam: camA, landmarks: personA },
    { cam: camB, landmarks: personB },
  ];
  let sum = 0;
  let n = 0;
  for (const j of probe) {
    const tri = triangulateJoint(views, j);
    if (!tri) continue;
    sum += tri.errorPx;
    n += 1;
  }
  return n ? sum / n : Infinity;
}
