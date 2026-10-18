import { JOINTS, type Corner, type JointName } from '../../../types';
import type { RigProfile, WorldPoint } from './calibration';
import { hipCentroid, type Fighter3D } from './canonical';
import { pairReprojectionError, triangulateSkeleton, type CameraSkeletonView, type LandmarkLike } from './triangulate';

/**
 * Multi-camera fusion: associate the same pesilat across cameras, triangulate
 * metric 3D skeletons, and keep Merah/Biru identities stable by 3D position
 * continuity.
 *
 * Association: the camera seeing the most people anchors the frame. Each
 * anchor person is matched in every other camera by minimum torso
 * reprojection error (the correct pairing triangulates consistently; a wrong
 * pairing does not). Groups seen by fewer than 2 cameras cannot triangulate
 * and yield no fighter that frame.
 */

export interface CamPersons {
  cameraId: string;
  persons: { landmarks: LandmarkLike[] }[];
}

const MAX_PAIR_ERROR_PX = 30;
const MIN_VALID_JOINTS = 9;

export class RigFusion {
  private prevCentroids: [WorldPoint | null, WorldPoint | null] = [null, null];
  private order: [0 | 1, 0 | 1] = [0, 1];

  constructor(private profile: RigProfile) {}

  setProfile(profile: RigProfile) {
    this.profile = profile;
    this.reset();
  }

  /** Swap which physical track reports as Merah (calibration aid). */
  swap() {
    this.order = [this.order[1], this.order[0]];
  }

  reset() {
    this.prevCentroids = [null, null];
  }

  process(perCamera: CamPersons[]): [Fighter3D | null, Fighter3D | null] {
    const calById = new Map(this.profile.cameras.map((c) => [c.id, c]));
    const cams = perCamera.filter((c) => calById.has(c.cameraId) && c.persons.length > 0);
    if (cams.length < 2) return [null, null];

    // Anchor: camera with most detected people (rig order breaks ties).
    const anchor = [...cams].sort((a, b) => b.persons.length - a.persons.length)[0];
    const anchorCal = calById.get(anchor.cameraId)!;
    const others = cams.filter((c) => c.cameraId !== anchor.cameraId);

    const groups: CameraSkeletonView[][] = [];
    const usedPerCam = new Map<string, Set<number>>(others.map((c) => [c.cameraId, new Set<number>()]));

    anchor.persons.slice(0, 2).forEach((anchorPerson) => {
      const views: CameraSkeletonView[] = [{ cam: anchorCal, landmarks: anchorPerson.landmarks }];
      for (const other of others) {
        const cal = calById.get(other.cameraId)!;
        let bestIdx = -1;
        let bestErr = Infinity;
        other.persons.forEach((person, pi) => {
          if (usedPerCam.get(other.cameraId)!.has(pi)) return;
          const err = pairReprojectionError(anchorCal, anchorPerson.landmarks, cal, person.landmarks);
          if (err < bestErr) {
            bestErr = err;
            bestIdx = pi;
          }
        });
        if (bestIdx >= 0 && bestErr <= MAX_PAIR_ERROR_PX) {
          usedPerCam.get(other.cameraId)!.add(bestIdx);
          views.push({ cam: cal, landmarks: other.persons[bestIdx].landmarks });
        } else {
          views.push({ cam: cal, landmarks: null });
        }
      }
      if (views.filter((v) => v.landmarks).length >= 2) groups.push(views);
    });

    const fighters: Fighter3D[] = [];
    for (const views of groups) {
      const joints = triangulateSkeleton(views);
      let valid = 0;
      let confSum = 0;
      let errSum = 0;
      for (const j of JOINTS) {
        const joint = joints[j];
        if (joint) {
          valid += 1;
          confSum += joint.confidence;
          errSum += joint.errorPx;
        }
      }
      if (valid < MIN_VALID_JOINTS) continue;
      fighters.push({
        joints,
        centroid: hipCentroid(joints),
        visibility: valid ? confSum / valid : 0,
        meanErrorPx: valid ? errSum / valid : 0,
        validJoints: valid,
      });
    }
    if (fighters.length === 0) return [null, null];

    // Assign to physical tracks by centroid continuity; first sighting sorts
    // by world x (Merah conventionally starts on the -x side).
    const tracks: [Fighter3D | null, Fighter3D | null] = [null, null];
    if (this.prevCentroids[0] === null && this.prevCentroids[1] === null) {
      const sorted = [...fighters].sort((a, b) => (a.centroid?.x ?? 0) - (b.centroid?.x ?? 0));
      sorted.forEach((f, i) => {
        if (i < 2) tracks[i as 0 | 1] = f;
      });
    } else {
      const pairs: { ti: number; fi: number; d: number }[] = [];
      fighters.forEach((f, fi) => {
        this.prevCentroids.forEach((pc, ti) => {
          if (pc && f.centroid) pairs.push({ ti, fi, d: Math.hypot(pc.x - f.centroid.x, pc.y - f.centroid.y, pc.z - f.centroid.z) });
        });
      });
      pairs.sort((a, b) => a.d - b.d);
      const usedF = new Set<number>();
      for (const p of pairs) {
        if (tracks[p.ti as 0 | 1] || usedF.has(p.fi)) continue;
        tracks[p.ti as 0 | 1] = fighters[p.fi];
        usedF.add(p.fi);
      }
      fighters.forEach((f, fi) => {
        if (usedF.has(fi)) return;
        const ti = tracks[0] === null ? 0 : tracks[1] === null ? 1 : -1;
        if (ti >= 0) tracks[ti as 0 | 1] = f;
      });
    }
    tracks.forEach((f, ti) => {
      if (f?.centroid) this.prevCentroids[ti as 0 | 1] = f.centroid;
    });

    const [mIdx, bIdx] = this.order;
    return [tracks[mIdx], tracks[bIdx]];
  }
}

export const cornerOfTrack = (order: [0 | 1, 0 | 1], track: 0 | 1): Corner => (order[0] === track ? 'merah' : 'biru');
export type { JointName };
