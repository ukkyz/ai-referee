import { FEATURE_KEYS, type FeatureKey, type FeatureResult, type Features, type RefPose } from '../../types';
import { FEATURE_META, mirrorFeatures } from './features';

export const MAJOR_WEIGHT = 0.75;

export function featureScore(key: FeatureKey, actual: number, target: number, strictness = 1): number {
  const m = FEATURE_META[key];
  const d = Math.abs(actual - target);
  const tol = m.tol * strictness;
  if (d <= tol) return 1;
  return Math.max(0, 1 - (d - tol) / (m.falloff * strictness));
}

/** Key elements (weight >= 1) can drag the overall similarity down: one clearly
 * wrong limb is a wrong movement, even if everything else is right. */
export const KEY_WEIGHT = 1.0;

export function rawSimilarity(f: Features, ref: RefPose, strictness: number): number {
  let sw = 0;
  let ss = 0;
  let worstKey = 1;
  for (const k of FEATURE_KEYS) {
    const w = ref.weights[k];
    if (w <= 0) continue;
    const s = featureScore(k, f[k], ref.features[k], strictness);
    sw += w;
    ss += w * s;
    if (w >= KEY_WEIGHT && s < worstKey) worstKey = s;
  }
  if (sw <= 0) return 0;
  return (ss / sw) * (0.7 + 0.3 * worstKey);
}

export interface MatchResult {
  score: number;
  mirrored: boolean;
}

export function matchPose(f: Features, ref: RefPose, strictness: number, allowMirror: boolean): MatchResult {
  const s1 = rawSimilarity(f, ref, strictness);
  if (!allowMirror) return { score: s1, mirrored: false };
  const s2 = rawSimilarity(mirrorFeatures(f), ref, strictness);
  return s2 > s1 ? { score: s2, mirrored: true } : { score: s1, mirrored: false };
}

export function featureBreakdown(f: Features, ref: RefPose, strictness: number, mirrored: boolean): FeatureResult[] {
  const ff = mirrored ? mirrorFeatures(f) : f;
  return FEATURE_KEYS.filter((k) => ref.weights[k] > 0).map((k) => ({
    key: k,
    actual: ff[k],
    target: ref.features[k],
    score: featureScore(k, ff[k], ref.features[k], strictness),
    weight: ref.weights[k],
  }));
}

export function majorElements(ref: RefPose): number {
  return FEATURE_KEYS.filter((k) => ref.weights[k] >= MAJOR_WEIGHT).length;
}

/** Per-feature scores keyed by the performer's own side (for overlay colouring). */
export function liveFeatureScores(f: Features, ref: RefPose, strictness: number, allowMirror: boolean): { scores: Record<FeatureKey, number>; match: MatchResult } {
  const match = matchPose(f, ref, strictness, allowMirror);
  const ff = match.mirrored ? mirrorFeatures(f) : f;
  const scores = {} as Record<FeatureKey, number>;
  for (const k of FEATURE_KEYS) {
    const s = featureScore(k, ff[k], ref.features[k], strictness);
    const ownKey = match.mirrored ? FEATURE_META[k].mirror : k;
    scores[ownKey] = ref.weights[k] > 0.25 ? s : 1;
  }
  return { scores, match };
}
