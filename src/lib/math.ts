import type { Vec3 } from '../types';

export const DEG = Math.PI / 180;

export const vec = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
export const add = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const scale = (a: Vec3, s: number): Vec3 => ({ x: a.x * s, y: a.y * s, z: a.z * s });
export const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
export const len = (a: Vec3): number => Math.hypot(a.x, a.y, a.z);
export const norm = (a: Vec3): Vec3 => {
  const l = len(a);
  return l < 1e-9 ? { x: 0, y: 0, z: 0 } : scale(a, 1 / l);
};
export const mid = (a: Vec3, b: Vec3): Vec3 => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 });

/** Angle between two vectors in degrees (0..180). */
export function angleBetween(a: Vec3, b: Vec3): number {
  const la = len(a);
  const lb = len(b);
  if (la < 1e-9 || lb < 1e-9) return 0;
  const c = Math.max(-1, Math.min(1, dot(a, b) / (la * lb)));
  return Math.acos(c) / DEG;
}

export const clamp = (x: number, lo = 0, hi = 1): number => (Number.isFinite(x) ? Math.max(lo, Math.min(hi, x)) : lo);

export const mean = (arr: ArrayLike<number>): number => {
  if (!arr.length) return 0;
  let s = 0;
  for (let i = 0; i < arr.length; i++) s += arr[i];
  return s / arr.length;
};

export function meanRange(arr: ArrayLike<number>, a: number, b: number): number {
  let s = 0;
  let n = 0;
  for (let i = Math.max(0, a); i <= Math.min(arr.length - 1, b); i++) {
    s += arr[i];
    n++;
  }
  return n ? s / n : 0;
}

export function maxRange(arr: ArrayLike<number>, a: number, b: number): number {
  let m = 0;
  for (let i = Math.max(0, a); i <= Math.min(arr.length - 1, b); i++) if (arr[i] > m) m = arr[i];
  return m;
}

/** Centered moving average with given radius. */
export function smoothArray(arr: Float32Array, radius: number): Float32Array {
  if (radius <= 0) return arr;
  const out = new Float32Array(arr.length);
  for (let i = 0; i < arr.length; i++) {
    let s = 0;
    let n = 0;
    for (let j = i - radius; j <= i + radius; j++) {
      if (j >= 0 && j < arr.length) {
        s += arr[j];
        n++;
      }
    }
    out[i] = s / n;
  }
  return out;
}

export function fmtTime(sec: number, decimals = 1): string {
  if (!Number.isFinite(sec)) return '--:--';
  const sign = sec < 0 ? '-' : '';
  const s = Math.abs(sec);
  const m = Math.floor(s / 60);
  const rest = s - m * 60;
  const restStr = rest.toFixed(decimals).padStart(decimals > 0 ? 3 + decimals : 2, '0');
  return `${sign}${m}:${restStr}`;
}

export function fmtSigned(n: number, decimals = 1): string {
  return `${n >= 0 ? '+' : ''}${n.toFixed(decimals)}`;
}

export const pct = (x: number): string => `${Math.round(clamp(x) * 100)}%`;

export function uid(prefix = ''): string {
  return prefix + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
