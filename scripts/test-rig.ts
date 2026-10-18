/**
 * Headless tests for the 3-camera rig architecture:
 * calibration/projection, DLT triangulation, frame synchronization,
 * canonical duel-plane conversion, multi-camera fusion/identity, and the
 * end-to-end 3D -> event detector pipeline.
 *
 * Run: npm run test:rig
 */
import { JOINTS, type DuelEvent } from '../src/types';
import { MP_INDEX } from '../src/lib/pose/landmarks';
import { DuelEventDetector } from '../src/lib/duel/fightDetector';
import { DemoFight, DEMO_ASPECT } from '../src/lib/duel/simulate';
import {
  cameraCenter,
  defaultDemoRig,
  projectionMatrix,
  projectPoint,
  validateRigProfile,
  type WorldPoint,
} from '../src/lib/duel/rig/calibration';
import { triangulateJoint, triangulateSkeleton, type LandmarkLike } from '../src/lib/duel/rig/triangulate';
import { FrameSynchronizer, recommendedSkewMs } from '../src/lib/duel/rig/sync';
import { DuelCanonicalizer, type Fighter3D } from '../src/lib/duel/rig/canonical';
import { RigFusion, type CamPersons } from '../src/lib/duel/rig/fusion';

let failures = 0;
function check(label: string, ok: boolean, extra = '') {
  if (ok) console.log(`  ✓ ${label}`);
  else {
    failures += 1;
    console.error(`  ✗ ${label} ${extra}`);
  }
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(777);
const randn = () => (rand() + rand() + rand() + rand() - 2) * 0.9; // approx N(0, ~0.52)
const distPt = (a: WorldPoint, b: WorldPoint) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

const rig = defaultDemoRig();

/* ---------------------------------------------------------- calibration */
console.log('Calibration & projection:');
check('demo rig validates', validateRigProfile(JSON.parse(JSON.stringify(rig))) !== null);
check('garbage rig rejected', validateRigProfile({ id: 'x', name: 'y', cameras: [{ id: 'a' }] }) === null);
check('camera centre recovers position', rig.cameras.every((c) => Math.abs(Math.hypot(cameraCenter(c).x, cameraCenter(c).z) - 7) < 0.01));
{
  const cam = rig.cameras[0];
  const P = projectionMatrix(cam);
  const centre = projectPoint(P, { x: 0, y: 1, z: 0 });
  check('arena centre projects near image centre', centre !== null && Math.abs(centre.x - 960) < 40 && Math.abs(centre.y - 540) < 60, JSON.stringify(centre));
  check('point behind camera rejected', projectPoint(P, { x: 0, y: 3, z: -20 }) === null);
}

/* --------------------------------------------------------- triangulation */
console.log('\nTriangulation (3 cameras):');
function observe(point: WorldPoint, noisePx: number) {
  return rig.cameras.map((cam) => {
    const P = projectionMatrix(cam);
    const px = projectPoint(P, point)!;
    const landmarks: LandmarkLike[] = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0.99 }));
    landmarks[MP_INDEX.lWrist] = {
      x: (px.x + (noisePx ? randn() * noisePx : 0)) / cam.imageSize.w,
      y: (px.y + (noisePx ? randn() * noisePx : 0)) / cam.imageSize.h,
      visibility: 0.99,
    };
    return { cam, landmarks };
  });
}
{
  const truth: WorldPoint = { x: 0.8, y: 1.35, z: -0.4 };
  const exact = triangulateJoint(observe(truth, 0), 'lWrist')!;
  check('noise-free recovery < 1 mm', distPt(exact, truth) < 0.001, `err=${distPt(exact, truth).toFixed(5)} m`);
  let sum = 0;
  const N = 40;
  for (let i = 0; i < N; i++) {
    const p: WorldPoint = { x: (rand() - 0.5) * 4, y: 0.3 + rand() * 1.6, z: (rand() - 0.5) * 4 };
    const tri = triangulateJoint(observe(p, 1.2), 'lWrist')!;
    sum += distPt(tri, p);
  }
  const mean = sum / N;
  console.log(`    mean error with 1.2 px noise: ${(mean * 100).toFixed(1)} cm`);
  check('1.2 px noise -> mean error < 4 cm', mean < 0.04, `mean=${mean.toFixed(3)} m`);
  const two = triangulateJoint(observe(truth, 0).slice(0, 2), 'lWrist')!;
  check('2 cameras still triangulate (lower confidence)', distPt(two, truth) < 0.01 && two.views === 2 && two.confidence < exact.confidence);
  const one = triangulateJoint(observe(truth, 0).slice(0, 1), 'lWrist');
  check('1 camera cannot triangulate', one === null);
}

/* ------------------------------------------------------------- synchronizer */
console.log('\nFrame synchronization (120 fps target):');
check('recommended skew at 120 fps = 10 ms', recommendedSkewMs(120) === 10);
{
  const sync = new FrameSynchronizer<number>(['a', 'b', 'c'], { maxSkewMs: recommendedSkewMs(120) });
  const period = 1000 / 120;
  let bundles = 0;
  let maxSkew = 0;
  const offsets: Record<string, number> = { a: 0, b: 2.3, c: -1.8 };
  const frames: { cameraId: string; captureMs: number; payload: number }[] = [];
  for (let i = 0; i < 240; i++) {
    for (const id of ['a', 'b', 'c']) {
      if (id === 'b' && i >= 100 && i < 106) continue; // camera B stalls ~50 ms
      frames.push({ cameraId: id, captureMs: i * period + offsets[id] + randn() * 0.4, payload: i });
    }
  }
  frames.sort((x, y) => x.captureMs - y.captureMs);
  for (const f of frames) {
    for (const b of sync.push(f)) {
      bundles += 1;
      maxSkew = Math.max(maxSkew, b.skewMs);
      const idx = Object.values(b.frames).map((x) => x.payload);
      if (Math.max(...idx) - Math.min(...idx) > 1) check('bundle members are same/adjacent frame index', false, JSON.stringify(idx));
    }
  }
  const st = sync.stats();
  console.log(`    bundles=${bundles} dropped=${st.framesDropped} maxSkew=${maxSkew.toFixed(1)} ms`);
  check('≥ 225/240 bundles emitted', bundles >= 225, `${bundles}`);
  check('all bundles within skew window', maxSkew <= 10.01, `${maxSkew}`);
  check('stall frames dropped, not mis-paired', st.framesDropped >= 6 && st.framesDropped <= 30, `${st.framesDropped}`);
}

/* ------------------------------------------------------------- canonical */
console.log('\nCanonical duel-plane conversion:');
function fighterFromWorld(joints: Fighter3D['joints']): Fighter3D {
  const valid = Object.values(joints).filter(Boolean).length;
  const l = joints.lHip!;
  const r = joints.rHip!;
  return {
    joints,
    centroid: { x: (l.x + r.x) / 2, y: (l.y + r.y) / 2, z: (l.z + r.z) / 2 },
    visibility: 0.95,
    meanErrorPx: 1,
    validJoints: valid,
  };
}
{
  // Two fighters facing each other along world +z (perpendicular to default x axis).
  const mk = (cx: number, cz: number): Fighter3D => {
    const j = {} as Fighter3D['joints'];
    for (const name of JOINTS) j[name] = { x: cx, y: 1, z: cz, views: 3, errorPx: 1, confidence: 0.95 };
    j.lHip = { x: cx - 0.1, y: 0.95, z: cz, views: 3, errorPx: 1, confidence: 0.95 };
    j.rHip = { x: cx + 0.1, y: 0.95, z: cz, views: 3, errorPx: 1, confidence: 0.95 };
    j.lShoulder = { x: cx - 0.2, y: 1.45, z: cz, views: 3, errorPx: 1, confidence: 0.95 };
    j.rShoulder = { x: cx + 0.2, y: 1.45, z: cz, views: 3, errorPx: 1, confidence: 0.95 };
    return fighterFromWorld(j);
  };
  const canon = new DuelCanonicalizer();
  const [a, b] = canon.convert([mk(0, -1.2), mk(0, 1.2)]);
  check('both converted', a !== null && b !== null);
  const torsoA = Math.hypot(
    a!.joints.lShoulder.x - a!.joints.lHip.x,
    a!.joints.lShoulder.y - a!.joints.lHip.y,
    a!.joints.lShoulder.z - a!.joints.lHip.z,
  );
  check('torso length preserved (~0.51 m)', Math.abs(torsoA - Math.hypot(0.1, 0.5)) < 0.02, `${torsoA.toFixed(3)}`);
  check('fighters separated along duel x-axis', Math.abs(b!.joints.lHip.x - a!.joints.lHip.x) > 2.0, `${(b!.joints.lHip.x - a!.joints.lHip.x).toFixed(2)}`);
  check('height becomes y-down (shoulders above hips)', a!.joints.lShoulder.y < a!.joints.lHip.y);
}

/* ---------------------------------------------------------------- fusion */
console.log('\nFusion & identity (synthetic projection):');
{
  // Ground-truth 3D skeletons from a choreographed frame embedded in world space.
  const fight = new DemoFight(10);
  const [f0, f1] = fight.frameAt(2.2);
  const S = 0.5 / 0.21; // stage torso 0.21 units -> 0.5 m
  const embed = (obs: typeof f0, laneZ: number) => {
    const j = {} as Fighter3D['joints'];
    for (const name of JOINTS) {
      const p = obs.joints[name];
      j[name] = { x: (p.x - DEMO_ASPECT / 2) * S, y: (0.88 - p.y) * S, z: laneZ, views: 3, errorPx: 0, confidence: 0.99 };
    }
    return fighterFromWorld(j);
  };
  const truthA = embed(f0, 0.05);
  const truthB = embed(f1, -0.05);
  const projectPerson = (f: Fighter3D, camIdx: number): LandmarkLike[] => {
    const cam = rig.cameras[camIdx];
    const P = projectionMatrix(cam);
    const out: LandmarkLike[] = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0.9 }));
    for (const name of JOINTS) {
      const p = f.joints[name]!;
      const px = projectPoint(P, p)!;
      out[MP_INDEX[name]] = { x: px.x / cam.imageSize.w, y: px.y / cam.imageSize.h, visibility: 0.97 };
    }
    return out;
  };
  const perCamera: CamPersons[] = rig.cameras.map((cam, ci) => ({
    cameraId: cam.id,
    // Reverse person order on one camera to prove association is geometric, not positional.
    persons: ci === 1 ? [{ landmarks: projectPerson(truthB, ci) }, { landmarks: projectPerson(truthA, ci) }] : [{ landmarks: projectPerson(truthA, ci) }, { landmarks: projectPerson(truthB, ci) }],
  }));
  const fusion = new RigFusion(rig);
  const [m, b] = fusion.process(perCamera);
  check('both fighters fused', m !== null && b !== null);
  check('merah = western (-x) fighter', (m?.centroid?.x ?? 99) < (b?.centroid?.x ?? -99), `${m?.centroid?.x.toFixed(2)} vs ${b?.centroid?.x.toFixed(2)}`);
  check('centroids within 5 cm of truth', distPt(m!.centroid!, truthA.centroid!) < 0.05 && distPt(b!.centroid!, truthB.centroid!) < 0.05,
    `${distPt(m!.centroid!, truthA.centroid!).toFixed(3)} / ${distPt(b!.centroid!, truthB.centroid!).toFixed(3)} m`);
  check('reprojection error small', m!.meanErrorPx < 2 && b!.meanErrorPx < 2, `${m!.meanErrorPx.toFixed(2)} px`);
  const skel = triangulateSkeleton(perCamera.map((c, ci) => ({ cam: rig.cameras[ci], landmarks: c.persons[0].landmarks })));
  check('skeleton has ≥13 triangulated joints', Object.values(skel).filter(Boolean).length >= 13);
}

/* ------------------------------------------- end-to-end 3D -> detector */
console.log('\nEnd-to-end: world 3D -> canonical -> event detector (75 s fight):');
{
  const fight = new DemoFight(75);
  const canon = new DuelCanonicalizer();
  const detector = new DuelEventDetector();
  const S = 0.5 / 0.21;
  const embed = (obs: ReturnType<DemoFight['frameAt']>[0], lane: number): Fighter3D => {
    const j = {} as Fighter3D['joints'];
    for (const name of JOINTS) {
      const p = obs.joints[name];
      j[name] = { x: (p.x - DEMO_ASPECT / 2) * S, y: (0.88 - p.y) * S, z: lane, views: 3, errorPx: 1, confidence: 0.95 };
    }
    return fighterFromWorld(j);
  };
  const events: DuelEvent[] = [];
  for (let t = 0; t <= 75; t += 1 / 30) {
    const [a, b] = fight.frameAt(t);
    const wobble = Math.sin(t * 0.4) * 0.03;
    const obs = canon.convert([embed(a, 0.03 + wobble), embed(b, -0.03 - wobble)]);
    events.push(...detector.pushFrame(t, 1, obs));
  }
  events.push(...detector.flush(1));
  const n = (tech: string, status: string) => events.filter((e) => e.technique === tech && e.status === status).length;
  console.log(`    pukulan sah=${n('pukulan', 'sah')} tendangan sah=${n('tendangan', 'sah')} kuncian sah=${n('kuncian', 'sah')} jatuhan sah=${n('jatuhan', 'sah')} ilegal=${events.filter((e) => e.status === 'ilegal').length}`);
  check('3D path detects punches', n('pukulan', 'sah') >= 3);
  check('3D path detects kicks', n('tendangan', 'sah') >= 2);
  check('3D path detects locks', n('kuncian', 'sah') >= 2);
  check('3D path detects takedowns', n('jatuhan', 'sah') >= 2);
  check('3D path flags fouls', events.filter((e) => e.status === 'ilegal').length >= 2);
}

if (failures) {
  console.error(`\n${failures} rig test(s) FAILED`);
  process.exit(1);
}
console.log('\nAll rig tests passed.');
