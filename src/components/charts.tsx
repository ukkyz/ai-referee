'use client';

import type { Report } from '../types';
import { fmtTime } from '../lib/math';

export function RadarChart({ axes, size = 300 }: { axes: { label: string; value: number }[]; size?: number }) {
  const n = axes.length;
  const cx = size / 2;
  const cy = size / 2;
  const R = size / 2 - 46;
  const pt = (i: number, r: number) => {
    const a = -Math.PI / 2 + (i / n) * Math.PI * 2;
    return [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
  };
  const poly = axes.map((ax, i) => pt(i, R * Math.max(0.02, Math.min(1, ax.value))).join(',')).join(' ');
  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="h-auto w-full max-w-[340px]">
      {[0.25, 0.5, 0.75, 1].map((lv) => (
        <polygon key={lv} points={axes.map((_, i) => pt(i, R * lv).join(',')).join(' ')} fill="none" stroke="rgba(229,181,58,0.14)" strokeWidth={1} />
      ))}
      {axes.map((_, i) => {
        const [x, y] = pt(i, R);
        return <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke="rgba(229,181,58,0.12)" />;
      })}
      <polygon points={poly} fill="rgba(229,181,58,0.22)" stroke="#f0cf6a" strokeWidth={2} strokeLinejoin="round" />
      {axes.map((ax, i) => {
        const [x, y] = pt(i, R * Math.max(0.02, Math.min(1, ax.value)));
        return <circle key={i} cx={x} cy={y} r={3.5} fill="#f7e3a3" />;
      })}
      {axes.map((ax, i) => {
        const [x, y] = pt(i, R + 24);
        return (
          <g key={ax.label}>
            <text x={x} y={y - 4} textAnchor="middle" className="fill-stone-300" fontSize={10.5} fontWeight={600}>
              {ax.label}
            </text>
            <text x={x} y={y + 9} textAnchor="middle" className="fill-gold-300" fontSize={10}>
              {Math.round(ax.value * 100)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export function TimelineChart({ report }: { report: Report }) {
  const W = 1000;
  const H = 300;
  const padL = 44;
  const padR = 18;
  const top = 64;
  const bottom = 228;
  const lastExpected = report.steps.length ? report.steps[report.steps.length - 1].expectedT : 0;
  const tMax = Math.max(report.duration, report.targetDuration + report.tolerance, lastExpected + 2, 1);
  const x = (t: number) => padL + (t / tMax) * (W - padL - padR);
  const ch = bottom - top;
  const tl = report.timeline;
  const motionMax = Math.max(4, ...tl.motion);
  const area =
    tl.t.length > 1
      ? `M${x(tl.t[0])},${bottom} ` + tl.t.map((t, i) => `L${x(t).toFixed(1)},${(bottom - (tl.motion[i] / motionMax) * ch * 0.9).toFixed(1)}`).join(' ') + ` L${x(tl.t[tl.t.length - 1])},${bottom} Z`
      : '';
  const matchLine = tl.t.map((t, i) => `${i ? 'L' : 'M'}${x(t).toFixed(1)},${(bottom - tl.match[i] * ch).toFixed(1)}`).join(' ');
  const step = tMax > 120 ? 30 : tMax > 60 ? 10 : 5;
  const ticks: number[] = [];
  for (let t = 0; t <= tMax + 0.01; t += step) ticks.push(t);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full">
      <defs>
        <linearGradient id="motionGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ef4444" stopOpacity="0.55" />
          <stop offset="1" stopColor="#7a1620" stopOpacity="0.05" />
        </linearGradient>
        <pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="6" stroke="#f87171" strokeWidth="2" strokeOpacity="0.45" />
        </pattern>
      </defs>
      {/* tolerance band */}
      <rect x={x(Math.max(0, report.targetDuration - report.tolerance))} y={top - 6} width={x(report.targetDuration + report.tolerance) - x(Math.max(0, report.targetDuration - report.tolerance))} height={ch + 6} fill="rgba(52,211,153,0.07)" />
      <line x1={x(report.targetDuration)} x2={x(report.targetDuration)} y1={top - 10} y2={bottom} stroke="#34d399" strokeDasharray="4 4" strokeOpacity={0.7} />
      <text x={x(report.targetDuration)} y={top - 14} textAnchor="middle" fontSize={10} className="fill-emerald-300">
        Target {fmtTime(report.targetDuration, 0)}
      </text>
      <line x1={x(report.duration)} x2={x(report.duration)} y1={top - 10} y2={bottom} stroke="#f0cf6a" strokeOpacity={0.8} />
      <text x={x(report.duration)} y={bottom + 64} textAnchor="middle" fontSize={10} className="fill-gold-300">
        Finish {fmtTime(report.duration)}
      </text>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={x(t)} x2={x(t)} y1={top} y2={bottom} stroke="rgba(255,255,255,0.05)" />
          <text x={x(t)} y={bottom + 14} textAnchor="middle" fontSize={10} className="fill-stone-500">
            {fmtTime(t, 0)}
          </text>
        </g>
      ))}
      {[0.5, 1].map((lv) => (
        <g key={lv}>
          <line x1={padL} x2={W - padR} y1={bottom - lv * ch} y2={bottom - lv * ch} stroke="rgba(255,255,255,0.06)" />
          <text x={padL - 6} y={bottom - lv * ch + 3} textAnchor="end" fontSize={9} className="fill-stone-500">
            {lv * 100}%
          </text>
        </g>
      ))}
      {/* hold windows */}
      {report.steps.map((s) =>
        s.matched && s.onset !== null ? <rect key={`w${s.index}`} x={x(s.onset)} y={top} width={Math.max(2, x(s.onset + s.holdDuration) - x(s.onset))} height={ch} fill="rgba(229,181,58,0.1)" /> : null,
      )}
      {report.hesitations.map((h, i) => (
        <rect key={`h${i}`} x={x(h.t)} y={top} width={Math.max(2, x(h.t + h.dur) - x(h.t))} height={ch} fill="url(#hatch)" />
      ))}
      {area && <path d={area} fill="url(#motionGrad)" />}
      {matchLine && <path d={matchLine} fill="none" stroke="#f0cf6a" strokeWidth={1.6} strokeOpacity={0.9} />}
      {/* expected markers (top lane) and actual markers (bottom lane) */}
      <text x={padL - 6} y={34} textAnchor="end" fontSize={9} className="fill-stone-400">
        Ref
      </text>
      <text x={padL - 6} y={bottom + 40} textAnchor="end" fontSize={9} className="fill-stone-400">
        You
      </text>
      {report.steps.map((s) => {
        const ex = x(s.expectedT);
        if (!s.matched || s.actualT === null) {
          return (
            <g key={`m${s.index}`}>
              <line x1={ex - 5} y1={25} x2={ex + 5} y2={35} stroke="#f87171" strokeWidth={2} />
              <line x1={ex + 5} y1={25} x2={ex - 5} y2={35} stroke="#f87171" strokeWidth={2} />
              <text x={ex} y={18} textAnchor="middle" fontSize={9} className="fill-red-300">
                {s.index + 1}
              </text>
            </g>
          );
        }
        const ax = x(s.actualT);
        const d = Math.abs(s.actualT - s.expectedT);
        const col = d < 1 ? '#34d399' : d < 2.5 ? '#fbbf24' : '#f87171';
        return (
          <g key={`m${s.index}`}>
            <line x1={ex} y1={36} x2={ax} y2={bottom + 30} stroke={col} strokeOpacity={0.45} strokeWidth={1.2} />
            <path d={`M${ex},${24} l5,6 l-5,6 l-5,-6 Z`} fill="#f0cf6a" />
            <text x={ex} y={18} textAnchor="middle" fontSize={9} className="fill-gold-200">
              {s.index + 1}
            </text>
            <circle cx={ax} cy={bottom + 36} r={5} fill={col} />
            <text x={ax} y={bottom + 52} textAnchor="middle" fontSize={9} className="fill-stone-300">
              {s.index + 1}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export function Sparkline({ values, color = '#f0cf6a', height = 36, max }: { values: number[]; color?: string; height?: number; max?: number }) {
  const W = 200;
  if (values.length < 2) return <svg viewBox={`0 0 ${W} ${height}`} className="h-9 w-full" />;
  const m = max ?? Math.max(1, ...values);
  const d = values.map((v, i) => `${i ? 'L' : 'M'}${((i / (values.length - 1)) * W).toFixed(1)},${(height - (v / m) * (height - 3)).toFixed(1)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${height}`} className="h-9 w-full" preserveAspectRatio="none">
      <path d={`${d} L${W},${height} L0,${height} Z`} fill={color} fillOpacity={0.12} />
      <path d={d} fill="none" stroke={color} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
