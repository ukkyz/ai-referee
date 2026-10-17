import { useMemo } from 'react';
import type { JointName, Skeleton } from '../types';
import { normalizeFacing } from '../lib/pose/fk';

interface Props {
  skeleton: Skeleton;
  ghost?: Skeleton | null;
  yaw?: number;
  color?: string;
  leftColor?: string;
  ghostColor?: string;
  className?: string;
  strokeWidth?: number;
  showGround?: boolean;
  title?: string;
}

const LIMBS: [JointName, JointName, 'l' | 'r' | 'c'][] = [
  ['lShoulder', 'lElbow', 'l'],
  ['lElbow', 'lWrist', 'l'],
  ['rShoulder', 'rElbow', 'r'],
  ['rElbow', 'rWrist', 'r'],
  ['lHip', 'lKnee', 'l'],
  ['lKnee', 'lAnkle', 'l'],
  ['lAnkle', 'lFoot', 'l'],
  ['rHip', 'rKnee', 'r'],
  ['rKnee', 'rAnkle', 'r'],
  ['rAnkle', 'rFoot', 'r'],
];

interface P2 {
  x: number;
  y: number;
  d: number;
}

function project(s: Skeleton, yawDeg: number): { pts: Record<JointName, P2>; groundY: number } {
  const n = normalizeFacing(s);
  const th = (yawDeg * Math.PI) / 180;
  const c = Math.cos(th);
  const sn = Math.sin(th);
  const pts = {} as Record<JointName, P2>;
  let ground = Infinity;
  for (const key of Object.keys(n) as JointName[]) {
    const p = n[key];
    const x = p.x * c + p.z * sn;
    const d = -p.x * sn + p.z * c;
    pts[key] = { x, y: -p.y, d };
    if (key === 'lAnkle' || key === 'rAnkle' || key === 'lFoot' || key === 'rFoot') ground = Math.min(ground, p.y);
  }
  return { pts, groundY: -ground };
}

function figureElements(pts: Record<JointName, P2>, groundY: number, opts: { color: string; leftColor: string; sw: number; dashed?: boolean; opacity?: number }) {
  const Y = (y: number) => y - groundY;
  const torso = ['lShoulder', 'rShoulder', 'rHip', 'lHip'] as JointName[];
  const torsoPath = torso.map((j, i) => `${i ? 'L' : 'M'}${pts[j].x.toFixed(3)},${Y(pts[j].y).toFixed(3)}`).join(' ') + ' Z';
  const limbs = [...LIMBS].sort((a, b) => (pts[a[0]].d + pts[a[1]].d) / 2 - (pts[b[0]].d + pts[b[1]].d) / 2);
  const neckX = (pts.lShoulder.x + pts.rShoulder.x) / 2;
  const neckY = (pts.lShoulder.y + pts.rShoulder.y) / 2;
  const head = pts.nose;
  const dash = opts.dashed ? '0.04 0.035' : undefined;
  return (
    <g opacity={opts.opacity ?? 1}>
      <path d={torsoPath} fill={opts.dashed ? 'none' : opts.color} fillOpacity={0.14} stroke={opts.color} strokeWidth={opts.sw * 0.8} strokeLinejoin="round" strokeDasharray={dash} />
      <line x1={neckX} y1={Y(neckY)} x2={head.x} y2={Y(head.y + 0.05)} stroke={opts.color} strokeWidth={opts.sw} strokeLinecap="round" strokeDasharray={dash} />
      {limbs.map(([a, b, side]) => {
        const depth = (pts[a].d + pts[b].d) / 2;
        const col = side === 'l' ? opts.leftColor : opts.color;
        return (
          <line
            key={`${a}-${b}`}
            x1={pts[a].x}
            y1={Y(pts[a].y)}
            x2={pts[b].x}
            y2={Y(pts[b].y)}
            stroke={col}
            strokeWidth={opts.sw}
            strokeLinecap="round"
            strokeOpacity={depth < -0.05 ? 0.6 : 1}
            strokeDasharray={dash}
          />
        );
      })}
      <circle cx={head.x} cy={Y(head.y)} r={0.105} fill={opts.dashed ? 'none' : '#0b0908'} stroke={opts.color} strokeWidth={opts.sw * 0.85} strokeDasharray={dash} />
      {!opts.dashed &&
        (['lElbow', 'rElbow', 'lKnee', 'rKnee', 'lWrist', 'rWrist'] as JointName[]).map((j) => (
          <circle key={j} cx={pts[j].x} cy={Y(pts[j].y)} r={opts.sw * 0.55} fill="#fff7e0" />
        ))}
    </g>
  );
}

export default function StickFigure({
  skeleton,
  ghost,
  yaw = 28,
  color = '#f0cf6a',
  leftColor,
  ghostColor = 'rgba(255,255,255,0.55)',
  className,
  strokeWidth = 0.055,
  showGround = true,
  title,
}: Props) {
  const main = useMemo(() => project(skeleton, yaw), [skeleton, yaw]);
  const gh = useMemo(() => (ghost ? project(ghost, yaw) : null), [ghost, yaw]);
  const xs = Object.values(main.pts).map((p) => p.x);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const W = 2.3;
  return (
    <svg viewBox={`${cx - W / 2} -1.95 ${W} 2.1`} className={className} role="img" aria-label={title ?? 'pose'}>
      {showGround && <ellipse cx={cx} cy={0.02} rx={0.75} ry={0.06} fill="rgba(229,181,58,0.12)" />}
      {gh && figureElements(gh.pts, gh.groundY, { color: ghostColor, leftColor: ghostColor, sw: strokeWidth * 0.8, dashed: true, opacity: 0.9 })}
      {figureElements(main.pts, main.groundY, { color, leftColor: leftColor ?? color, sw: strokeWidth })}
    </svg>
  );
}
