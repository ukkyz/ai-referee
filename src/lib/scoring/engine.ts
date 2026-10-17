import type {
  FeedbackItem,
  Features,
  FrameSample,
  JudgeScore,
  Jurus,
  RefereeSettings,
  Report,
  Skeleton,
  StepResult,
} from '../../types';
import { featureBreakdown, MAJOR_WEIGHT, majorElements, matchPose } from '../pose/similarity';
import { averageFeatures, featureTip, torsoLength } from '../pose/features';
import { mirrorSkeleton } from '../pose/fk';
import { clamp, fmtTime, len, maxRange, mean, meanRange, mid, pct, smoothArray, sub, uid } from '../math';

/** Score granted for skipping a step in the alignment (= minimum similarity worth matching). */
const TAU = 0.5;
const MIN_ACCEPT = 0.45;
const STRIKE = new Set(['pukulan', 'tendangan', 'tangkisan']);

export const JUDGE_PROFILES = [
  { name: 'Juri 1', profile: 'Teknik ketat · strict technique', strict: 0.85, w: [0.3, 0.25, 0.2, 0.25] },
  { name: 'Juri 2', profile: 'Seimbang · balanced', strict: 1.0, w: [0.25, 0.25, 0.25, 0.25] },
  { name: 'Juri 3', profile: 'Kemantapan · firmness focus', strict: 1.0, w: [0.4, 0.2, 0.2, 0.2] },
  { name: 'Juri 4', profile: 'Irama · rhythm focus', strict: 1.1, w: [0.2, 0.4, 0.2, 0.2] },
  { name: 'Juri 5', profile: 'Penghayatan · expression focus', strict: 1.15, w: [0.2, 0.2, 0.35, 0.25] },
];

export interface AnalyzeInput {
  frames: FrameSample[];
  jurus: Jurus;
  settings: RefereeSettings;
  duration: number;
  source: 'camera' | 'video' | 'demo';
}

export function predikatFor(index: number): { id: string; en: string } {
  if (index >= 90) return { id: 'Istimewa', en: 'Outstanding' };
  if (index >= 80) return { id: 'Sangat Baik', en: 'Very Good' };
  if (index >= 70) return { id: 'Baik', en: 'Good' };
  if (index >= 55) return { id: 'Cukup', en: 'Fair' };
  return { id: 'Perlu Latihan', en: 'Needs Practice' };
}

/** IPSI time-penalty bands (official: tol 5 s → 5–15 s: −10, 16–30 s: −15, >30 s: −20), scaled by tolerance. */
export function timePenaltyFor(duration: number, target: number, tol: number) {
  const dev = duration - target;
  const a = Math.abs(dev);
  const dir = dev > 0 ? 'over' : 'under';
  if (a <= tol) return { deviation: dev, points: 0, band: `Within ±${tol}s tolerance` };
  if (a <= 3 * tol) return { deviation: dev, points: 10, band: `${tol}–${3 * tol}s ${dir} time` };
  if (a <= 6 * tol) return { deviation: dev, points: 15, band: `${3 * tol}–${6 * tol}s ${dir} time` };
  return { deviation: dev, points: 20, band: `More than ${6 * tol}s ${dir} time` };
}

function balanceOffset(sk: Skeleton): number {
  const tl = torsoLength(sk);
  const hip = mid(sk.lHip, sk.rHip);
  const sh = mid(sk.lShoulder, sk.rShoulder);
  const kn = mid(sk.lKnee, sk.rKnee);
  const cx = 0.45 * hip.x + 0.3 * sh.x + 0.15 * kn.x + 0.1 * sk.nose.x;
  const cz = 0.45 * hip.z + 0.3 * sh.z + 0.15 * kn.z + 0.1 * sk.nose.z;
  const fh = (sk.lAnkle.y - sk.rAnkle.y) / tl;
  const sup = fh > 0.25 ? sk.rAnkle : fh < -0.25 ? sk.lAnkle : mid(sk.lAnkle, sk.rAnkle);
  return Math.hypot(cx - sup.x, cz - sup.z) / tl;
}

function findHesitations(frames: FrameSample[], motion: Float32Array, windows: Array<[number, number]>, startT: number, endT: number) {
  const N = frames.length;
  const inHold = new Uint8Array(N);
  for (const [L, R] of windows) {
    const a = frames[L].t - 0.5;
    const b = frames[R].t + 0.5;
    for (let f = 0; f < N; f++) if (frames[f].t >= a && frames[f].t <= b) inHold[f] = 1;
  }
  const res: { t: number; dur: number }[] = [];
  let start = -1;
  for (let f = 0; f <= N; f++) {
    const still = f < N && frames[f].t >= startT && frames[f].t <= endT && !inHold[f] && motion[f] < 0.6;
    if (still) {
      if (start < 0) start = f;
    } else if (start >= 0) {
      const dur = frames[f - 1].t - frames[start].t;
      if (dur >= 1.5) res.push({ t: frames[start].t, dur });
      start = -1;
    }
  }
  return res;
}

interface Internal {
  L: number;
  R: number;
  f: number;
  holdMotion: number;
  transPeak: number | null;
  feats: Features;
  mirrored: boolean;
}

export function analyzePerformance(input: AnalyzeInput): Report {
  const { frames, jurus, settings } = input;
  const N = frames.length;
  const K = jurus.steps.length;
  if (N < 12 || K === 0) {
    throw new Error('Not enough pose data was captured. Make sure your whole body is visible and perform for at least a few seconds.');
  }
  const duration = Math.max(input.duration, frames[N - 1].t, 0.5);
  const fps = N / duration;
  const strict = settings.strictness;
  const target = jurus.targetDuration > 0 ? jurus.targetDuration : duration;
  const tol = jurus.tolerance;

  // ---------- 1. Frame × step similarity matrix ----------
  const cache = new Map<string, { s: Float32Array; m: Uint8Array }>();
  const S: Float32Array[] = [];
  const M: Uint8Array[] = [];
  for (const step of jurus.steps) {
    let e = cache.get(step.pose.id);
    if (!e) {
      const raw = new Float32Array(N);
      const m = new Uint8Array(N);
      for (let f = 0; f < N; f++) {
        const r = matchPose(frames[f].features, step.pose, strict, settings.allowMirror);
        raw[f] = r.score;
        m[f] = r.mirrored ? 1 : 0;
      }
      e = { s: smoothArray(raw, 2), m };
      cache.set(step.pose.id, e);
    }
    S.push(e.s);
    M.push(e.m);
  }

  // ---------- 2. Ordered sequence alignment (DP with skips + weak temporal prior) ----------
  const t0 = frames[0].t;
  const span = Math.max(frames[N - 1].t - t0, 0.5);
  const minGap = Math.max(1, Math.round(0.3 * fps));
  const fracs = new Float32Array(N);
  for (let f = 0; f < N; f++) fracs[f] = (frames[f].t - t0) / span;
  const best: Float32Array[] = [];
  const choice: Uint8Array[] = [];
  for (let k = 0; k < K; k++) {
    const e = clamp(jurus.steps[k].t / target);
    const row = new Float32Array(N);
    const ch = new Uint8Array(N);
    const prev = k > 0 ? best[k - 1] : null;
    for (let f = 0; f < N; f++) {
      const a = S[k][f] - 0.25 * Math.max(0, Math.abs(fracs[f] - e) - 0.12);
      const pa = prev ? (f - minGap >= 0 ? prev[f - minGap] : k * TAU) : 0;
      const assign = a + pa;
      const skip = TAU + (prev ? prev[f] : 0);
      let v = f > 0 ? row[f - 1] : -Infinity;
      let c = 0;
      if (assign > v) {
        v = assign;
        c = 1;
      }
      if (skip > v) {
        v = skip;
        c = 2;
      }
      row[f] = v;
      ch[f] = c;
    }
    best.push(row);
    choice.push(ch);
  }
  const assigned = new Int32Array(K).fill(-1);
  {
    let k = K - 1;
    let f = N - 1;
    while (k >= 0 && f >= 0) {
      const c = choice[k][f];
      if (c === 0) f--;
      else if (c === 1) {
        assigned[k] = f;
        f -= minGap;
        k--;
      } else k--;
    }
  }

  // ---------- 3. Kinematics ----------
  const motion = new Float32Array(N);
  const peak = new Float32Array(N);
  const bal = new Float32Array(N);
  const EFF = ['lWrist', 'rWrist', 'lAnkle', 'rAnkle'] as const;
  const MIDJ = ['lElbow', 'rElbow', 'lKnee', 'rKnee'] as const;
  for (let f = 0; f < N; f++) {
    const sk = frames[f].skeleton;
    bal[f] = balanceOffset(sk);
    if (f === 0) continue;
    const pv = frames[f - 1].skeleton;
    const dt = Math.max(frames[f].t - frames[f - 1].t, 1 / 120);
    const tl = torsoLength(sk);
    let sum = 0;
    let mx = 0;
    for (const j of EFF) {
      const s = len(sub(sk[j], pv[j])) / dt / tl;
      sum += s;
      if (s > mx) mx = s;
    }
    for (const j of MIDJ) sum += len(sub(sk[j], pv[j])) / dt / tl;
    motion[f] = Math.min(sum / 8, 20);
    peak[f] = Math.min(mx, 25);
  }
  if (N > 1) {
    motion[0] = motion[1];
    peak[0] = peak[1];
  }
  const motionS = smoothArray(motion, 1);
  const peakS = smoothArray(peak, 1);

  // ---------- 4. Per-step evaluation ----------
  const isMatched = new Uint8Array(K);
  for (let k = 0; k < K; k++) if (assigned[k] >= 0 && S[k][assigned[k]] >= MIN_ACCEPT) isMatched[k] = 1;

  const internal: (Internal | null)[] = new Array(K).fill(null);
  const steps: StepResult[] = [];
  let prevMatched = -1;
  for (let k = 0; k < K; k++) {
    const step = jurus.steps[k];
    const name = step.label ?? step.pose.name;
    const elements = majorElements(step.pose);
    if (!isMatched[k]) {
      const e = clamp(step.t / target);
      let bestAttempt = 0;
      for (let f = 0; f < N; f++) if (Math.abs(fracs[f] - e) < 0.15 && S[k][f] > bestAttempt) bestAttempt = S[k][f];
      steps.push({
        index: k,
        name,
        poseId: step.pose.id,
        category: step.pose.category,
        expectedT: step.t,
        expectedHold: step.hold,
        matched: false,
        actualT: null,
        onset: null,
        holdDuration: 0,
        similarity: bestAttempt,
        mirrored: false,
        errors: elements,
        elements,
        stability: 0,
        balance: 0,
        power: null,
        features: [],
        performerSkeleton: null,
        refSkeleton: step.pose.skeleton,
        tips: [`Not detected in sequence — expected around ${fmtTime(step.t, 0)} (closest attempt ${pct(bestAttempt)}).`],
      });
      continue;
    }
    const f = assigned[k];
    const lo = prevMatched >= 0 ? assigned[prevMatched] + 1 : 0;
    let hi = N - 1;
    for (let j = k + 1; j < K; j++) {
      if (isMatched[j]) {
        hi = assigned[j] - 1;
        break;
      }
    }
    const pk = S[k][f];
    const thr = Math.max(MIN_ACCEPT, pk - 0.12);
    let L = f;
    let R = f;
    while (L - 1 >= lo && S[k][L - 1] >= thr) L--;
    while (R + 1 <= hi && S[k][R + 1] >= thr) R++;
    const holdDuration = frames[R].t - frames[L].t;
    const a = Math.max(lo, Math.min(L, f - 2));
    const b = Math.min(Math.max(hi, f), Math.max(R, f + 2));
    const holdMotion = meanRange(motionS, a, b);
    const stability = clamp(1 - (holdMotion - 0.45) / 1.6);
    const refOff = balanceOffset(step.pose.skeleton);
    const bo = meanRange(bal, a, b);
    const balance = clamp(1 - Math.max(0, bo - Math.max(0.22, refOff + 0.12)) / 0.45);

    let transPeak: number | null = null;
    if (prevMatched >= 0) {
      const pi = internal[prevMatched] as Internal;
      let s0 = pi.R;
      let s1 = L;
      if (s1 - s0 < 2) {
        s0 = pi.f;
        s1 = f;
      }
      transPeak = maxRange(peakS, s0, s1);
    }
    const power = transPeak === null ? null : clamp((transPeak - 1.5) / 4.5);
    const mirrored = M[k][f] === 1;
    const fa = Math.max(0, f - 2);
    const fb = Math.min(N - 1, f + 2);
    const feats = averageFeatures(frames.slice(fa, fb + 1).map((x) => x.features));
    const fr = featureBreakdown(feats, step.pose, strict, mirrored);
    const major = fr.filter((x) => x.weight >= MAJOR_WEIGHT);
    const errors = major.filter((x) => x.score < 0.5).length;
    const tips = major
      .filter((x) => x.score < 0.75)
      .sort((x, y) => x.score - y.score)
      .slice(0, 2)
      .map((x) => featureTip(x.key, x.actual, x.target, mirrored));
    const perf = mirrored ? mirrorSkeleton(frames[f].skeleton) : frames[f].skeleton;
    internal[k] = { L, R, f, holdMotion, transPeak, feats, mirrored };
    steps.push({
      index: k,
      name,
      poseId: step.pose.id,
      category: step.pose.category,
      expectedT: step.t,
      expectedHold: step.hold,
      matched: true,
      actualT: frames[f].t,
      onset: frames[L].t,
      holdDuration,
      similarity: pk,
      mirrored,
      errors,
      elements,
      stability,
      balance,
      power,
      features: fr,
      performerSkeleton: perf,
      refSkeleton: step.pose.skeleton,
      tips,
    });
    prevMatched = k;
  }

  // ---------- 5. Kebenaran (correctness) ----------
  const matched = steps.filter((s) => s.matched);
  const completeness = matched.length / K;
  const accuracy = mean(steps.map((s) => (s.matched ? s.similarity : 0)));
  const correctnessIdx = clamp(0.8 * accuracy + 0.2 * completeness);

  // ---------- 6. Timing & rhythm ----------
  const pairs: { a: number; e: number; from: number; to: number }[] = [];
  for (let i = 1; i < matched.length; i++) {
    const p = matched[i - 1];
    const q = matched[i];
    const a = (q.actualT as number) - (p.actualT as number);
    const e = q.expectedT - p.expectedT;
    if (e > 0.05 && a > 0) pairs.push({ a, e, from: p.index, to: q.index });
  }
  const sumA = pairs.reduce((s, p) => s + p.a, 0);
  const sumE = pairs.reduce((s, p) => s + p.e, 0);
  const tempoRatio = sumE > 0 ? sumA / sumE : 1;
  const pairScores = pairs.map((p) => clamp(1 - Math.abs(Math.log(p.a / (tempoRatio * p.e))) / Math.log(2.2)));
  const rhythm = pairs.length ? mean(pairScores) : 0;
  const tempo = pairs.length ? clamp(1 - Math.max(0, Math.abs(Math.log(tempoRatio)) - Math.log(1.15)) / Math.log(1.8)) : 0;
  const holdScores = matched.map((s) => {
    const r = s.holdDuration / Math.max(0.2, s.expectedHold);
    if (r < 0.6) return r / 0.6;
    if (r > 3.5 && s.expectedHold < 1.5) return 0.8;
    return 1;
  });
  const hold = holdScores.length ? mean(holdScores) : 0;
  const tp = timePenaltyFor(duration, target, tol);
  const absDev = Math.abs(tp.deviation);
  const durationScore = absDev <= tol ? 1 : clamp(1 - (absDev - tol) / (5 * tol + 0.1 * target));
  const timingIdx = clamp(0.35 * durationScore + 0.35 * rhythm + 0.15 * tempo + 0.15 * hold);

  // ---------- 7. Kemantapan · Penghayatan · Tenaga & Stamina ----------
  const stabilityAvg = matched.length ? mean(matched.map((s) => s.stability)) : 0;
  const balanceAvg = matched.length ? mean(matched.map((s) => s.balance)) : 0;
  const kemantapanGerakRaw = 0.6 * stabilityAvg + 0.4 * balanceAvg;
  const powered = matched.filter((s) => s.power !== null);
  let pwSum = 0;
  let pwW = 0;
  for (const s of powered) {
    const w = STRIKE.has(s.category) ? 1.5 : 1;
    pwSum += (s.power as number) * w;
    pwW += w;
  }
  const power = pwW ? pwSum / pwW : 0;
  const ints = internal.filter((x): x is Internal => x !== null);
  const holdMotions = ints.map((x) => x.holdMotion);
  const transPeaks = ints.filter((x) => x.transPeak !== null).map((x) => x.transPeak as number);
  const contrastRatio = transPeaks.length ? mean(transPeaks) / Math.max(0.25, mean(holdMotions)) : 0;
  const contrast = transPeaks.length ? clamp(Math.log(Math.max(contrastRatio, 1e-3) / 1.5) / Math.log(10)) : 0;

  const windows: Array<[number, number]> = ints.map((x) => [x.L, x.R]);
  let startT = t0 + 2;
  let endT = frames[N - 1].t - 2;
  if (ints.length) {
    startT = frames[ints[0].L].t;
    endT = frames[ints[ints.length - 1].R].t;
  }
  const hes = findHesitations(frames, motionS, windows, startT, endT);
  const hesSec = hes.reduce((s, h) => s + h.dur, 0);
  const flow = clamp(1 - 0.12 * hes.length - 0.02 * hesSec);

  const half = t0 + span / 2;
  const q = (s: StepResult) => 0.6 * s.similarity + 0.4 * (s.power ?? power);
  const firstQ = matched.filter((s) => (s.actualT as number) < half).map(q);
  const secondQ = matched.filter((s) => (s.actualT as number) >= half).map(q);
  let stamina = firstQ.length >= 2 && secondQ.length >= 2 ? clamp(1 - Math.max(0, mean(firstQ) - mean(secondQ) - 0.03) / 0.25) : clamp(completeness * 0.8);
  const firstHalfSteps = steps.filter((s) => s.expectedT < target / 2);
  const secondHalfSteps = steps.filter((s) => s.expectedT >= target / 2);
  if (firstHalfSteps.length && secondHalfSteps.length) {
    const c1 = firstHalfSteps.filter((s) => s.matched).length / firstHalfSteps.length;
    const c2 = secondHalfSteps.filter((s) => s.matched).length / secondHalfSteps.length;
    stamina = clamp(stamina * (1 - 0.5 * Math.max(0, c1 - c2)));
  }

  const irama = clamp(0.6 * rhythm + 0.2 * hold + 0.2 * tempo);
  const penghayatan = clamp(0.55 * contrast + 0.45 * flow);
  const tenagaStamina = clamp(0.6 * power + 0.4 * stamina);
  const cf = 0.5 + 0.5 * completeness;
  const el = [kemantapanGerakRaw * cf, irama * cf, penghayatan * cf, tenagaStamina * cf];
  const artistryIdx = mean(el);

  // ---------- 8. Dewan Juri: 5 judge profiles, drop highest & lowest ----------
  const elementsTotal = steps.reduce((s, x) => s + x.elements, 0);
  const perError = 100 / Math.max(1, elementsTotal);
  const judges: JudgeScore[] = JUDGE_PROFILES.map((j) => {
    const js = strict * j.strict;
    let errors = 0;
    for (let k = 0; k < K; k++) {
      const it = internal[k];
      if (!it) {
        errors += steps[k].elements;
        continue;
      }
      const fr = featureBreakdown(it.feats, jurus.steps[k].pose, js, it.mirrored);
      errors += fr.filter((x) => x.weight >= MAJOR_WEIGHT && x.score < 0.5).length;
    }
    const keb = Math.max(0, 100 - errors * perError);
    const ws = j.w.reduce((a, b) => a + b, 0);
    const art = (j.w[0] * el[0] + j.w[1] * el[1] + j.w[2] * el[2] + j.w[3] * el[3]) / ws;
    const kem = 50 + 10 * clamp(art);
    return { name: j.name, profile: j.profile, kebenaran: keb, kemantapan: kem, hukuman: tp.points, total: keb + kem - tp.points, errors, dropped: false };
  });
  const order = judges.map((j, i) => ({ t: j.total, i })).sort((a, b) => a.t - b.t);
  judges[order[0].i].dropped = true;
  judges[order[order.length - 1].i].dropped = true;
  const kept = judges.filter((j) => !j.dropped);
  const kebenaran = mean(kept.map((j) => j.kebenaran));
  const kemantapan = mean(kept.map((j) => j.kemantapan));
  const total = mean(kept.map((j) => j.total));

  // ---------- 9. Performance index ----------
  const W = settings.weights;
  const wsum = W.correctness + W.artistry + W.timing || 1;
  const index = clamp((W.correctness * correctnessIdx + W.artistry * artistryIdx + W.timing * timingIdx) / wsum) * 100;
  const pred = predikatFor(index);

  // ---------- 10. Timeline (downsampled) ----------
  const bins = Math.min(360, N);
  const timeline = { t: [] as number[], motion: [] as number[], match: [] as number[] };
  const uniq = [...cache.values()].map((v) => v.s);
  for (let bI = 0; bI < bins; bI++) {
    const a = Math.floor((bI * N) / bins);
    const z = Math.max(a, Math.floor(((bI + 1) * N) / bins) - 1);
    let mm = 0;
    let sm = 0;
    for (let f = a; f <= z; f++) {
      if (motionS[f] > mm) mm = motionS[f];
      for (const s of uniq) if (s[f] > sm) sm = s[f];
    }
    timeline.t.push(+frames[Math.floor((a + z) / 2)].t.toFixed(2));
    timeline.motion.push(+mm.toFixed(2));
    timeline.match.push(+sm.toFixed(3));
  }

  // ---------- 11. Feedback (Catatan Wasit) ----------
  const fb: FeedbackItem[] = [];
  const vis = mean(frames.map((f) => f.visibility));
  if (vis < 0.65) fb.push({ level: 'warn', area: 'Kamera', text: `Average landmark visibility was ${pct(vis)}. Keep your entire body in frame with good, even lighting for a fairer score.` });
  if (fps < 12) fb.push({ level: 'warn', area: 'Kamera', text: `Analysis ran at only ${fps.toFixed(0)} fps — fast strikes may be under-measured. Try the Lite model, or use precision playback for videos.` });
  const missed = steps.filter((s) => !s.matched);
  if (missed.length) {
    fb.push({
      level: 'bad',
      area: 'Kebenaran',
      text: `${missed.length} of ${K} key movements were not detected in sequence: ${missed
        .slice(0, 4)
        .map((s) => `#${s.index + 1} ${s.name}`)
        .join(', ')}${missed.length > 4 ? '…' : ''}. Each missing movement counts as errors (kesalahan) in Nilai Kebenaran.`,
    });
  }
  const weak = matched.filter((s) => s.similarity < 0.72).sort((a, b) => a.similarity - b.similarity).slice(0, 3);
  for (const s of weak) fb.push({ level: 'warn', area: 'Kebenaran', text: `#${s.index + 1} ${s.name} (${pct(s.similarity)} match)${s.tips[0] ? ` — ${s.tips[0]}` : ''}.` });
  if (matched.length && accuracy >= 0.85) fb.push({ level: 'good', area: 'Kebenaran', text: 'Technique closely matches the reference positions throughout the sequence.' });
  if (matched.length) {
    if (stabilityAvg < 0.6) fb.push({ level: 'warn', area: 'Kemantapan', text: `Finishing positions are unsteady (stability ${pct(stabilityAvg)}). Lock each position firmly for a moment before moving on.` });
    else if (stabilityAvg >= 0.85) fb.push({ level: 'good', area: 'Kemantapan', text: 'Firm, controlled finishing positions — excellent kemantapan gerak.' });
    if (balanceAvg < 0.6) fb.push({ level: 'warn', area: 'Kemantapan', text: `Balance drifts outside the base of support (balance ${pct(balanceAvg)}), especially on one-leg techniques. Keep the centre of gravity over the supporting foot.` });
  }
  if (powered.length) {
    if (power < 0.45) fb.push({ level: 'warn', area: 'Tenaga', text: `Strikes and kicks lack snap (power ${pct(power)}). Accelerate explosively into each technique, then stop sharply.` });
    else if (power >= 0.75) fb.push({ level: 'good', area: 'Tenaga', text: 'Explosive transitions with strong tenaga (power).' });
  }
  if (transPeaks.length && contrast < 0.4) fb.push({ level: 'warn', area: 'Penghayatan', text: `Movement dynamics look uniform (contrast ${pct(contrast)}). Contrast explosive transitions with crisp, still finishing positions to express the jurus.` });
  if (hes.length) fb.push({ level: 'bad', area: 'Penghayatan', text: `Hesitated ${hes.length}× (total ${hesSec.toFixed(1)} s, first at ${fmtTime(hes[0].t, 0)}). Pauses outside the choreography break the flow (kelancaran).` });
  else if (matched.length >= 3 && flow >= 0.95) fb.push({ level: 'good', area: 'Penghayatan', text: 'Continuous flow with no unplanned pauses.' });
  if (pairs.length) {
    const worst = pairs.map((p, i) => ({ p, s: pairScores[i] })).sort((a, b) => a.s - b.s)[0];
    if (rhythm < 0.65 && worst) {
      fb.push({ level: 'warn', area: 'Irama', text: `Rhythm is uneven — e.g. #${worst.p.from + 1} → #${worst.p.to + 1} took ${worst.p.a.toFixed(1)} s (≈${(worst.p.e * tempoRatio).toFixed(1)} s expected at your tempo).` });
    } else if (rhythm >= 0.85) fb.push({ level: 'good', area: 'Irama', text: 'Rhythm closely follows the reference timing between movements.' });
    if (tempoRatio > 1.2) fb.push({ level: 'warn', area: 'Irama', text: `Overall tempo is ${Math.round((tempoRatio - 1) * 100)}% slower than the reference.` });
    else if (tempoRatio < 0.85) fb.push({ level: 'warn', area: 'Irama', text: `Overall tempo is ${Math.round((1 - tempoRatio) * 100)}% faster than the reference — don't rush.` });
  }
  for (const s of matched.filter((x) => x.holdDuration < 0.6 * x.expectedHold).slice(0, 2)) {
    fb.push({ level: 'warn', area: 'Irama', text: `Hold #${s.index + 1} ${s.name} longer (${s.holdDuration.toFixed(1)} s held vs ${s.expectedHold.toFixed(1)} s expected).` });
  }
  if (tp.points > 0) {
    fb.push({ level: 'bad', area: 'Waktu', text: `Performance time ${fmtTime(duration)} is ${absDev.toFixed(1)} s ${tp.deviation > 0 ? 'over' : 'under'} the target ${fmtTime(target, 0)} (±${tol} s) → hukuman −${tp.points}.` });
  } else {
    fb.push({ level: 'good', area: 'Waktu', text: `Finished in ${fmtTime(duration)} — within the ±${tol} s tolerance of ${fmtTime(target, 0)}.` });
  }
  if (stamina < 0.6) fb.push({ level: 'warn', area: 'Stamina', text: `Quality dropped in the second half (stamina ${pct(stamina)}). Build endurance so power and precision last until the final salute.` });
  else if (stamina >= 0.9 && matched.length >= 4) fb.push({ level: 'good', area: 'Stamina', text: 'Consistent quality from start to finish — good stamina.' });
  const rank = { bad: 0, warn: 1, good: 2 } as const;
  fb.sort((a, b) => rank[a.level] - rank[b.level]);

  return {
    id: uid('r-'),
    createdAt: Date.now(),
    jurusId: jurus.id,
    jurusName: jurus.name,
    jurusSubtitle: jurus.subtitle,
    source: input.source,
    duration,
    targetDuration: target,
    tolerance: tol,
    kebenaran,
    kemantapan,
    hukuman: tp.points,
    total,
    judges,
    errorsTotal: kept.length ? Math.round(mean(kept.map((j) => j.errors))) : 0,
    elementsTotal,
    timePenalty: tp,
    index,
    predikat: pred.id,
    predikatEn: pred.en,
    correctness: { index: correctnessIdx, accuracy, completeness, matched: matched.length, total: K },
    artistry: {
      index: artistryIdx,
      kemantapanGerak: el[0],
      irama: el[1],
      penghayatan: el[2],
      tenagaStamina: el[3],
      stability: stabilityAvg,
      balance: balanceAvg,
      power,
      stamina,
      contrast,
      flow,
    },
    timing: { index: timingIdx, duration: durationScore, rhythm, tempo, hold, tempoRatio },
    steps,
    timeline,
    hesitations: hes,
    feedback: fb,
    avgFps: fps,
    visibility: vis,
    settingsSnapshot: { strictness: strict, allowMirror: settings.allowMirror },
  };
}
