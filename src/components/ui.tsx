import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '../utils/cn';
import type { PoseEngine } from '../hooks/usePoseEngine';

export function Panel({ className, children, glow }: { className?: string; children: ReactNode; glow?: boolean }) {
  return (
    <div
      className={cn(
        'relative rounded-2xl border border-gold-500/15 bg-gradient-to-b from-ink-800/90 to-ink-900/90 shadow-xl shadow-black/40 backdrop-blur',
        glow && 'ring-1 ring-gold-400/25',
        className,
      )}
    >
      {children}
    </div>
  );
}

export function SectionTitle({ id, en, icon, right }: { id: string; en?: string; icon?: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-3 flex items-end justify-between gap-3">
      <div className="flex items-center gap-2.5">
        {icon && <span className="grid h-8 w-8 place-items-center rounded-lg bg-gold-400/10 text-gold-300">{icon}</span>}
        <div>
          <h3 className="font-display text-lg uppercase tracking-wide text-gold-200">{id}</h3>
          {en && <p className="-mt-0.5 text-xs text-stone-400">{en}</p>}
        </div>
      </div>
      {right}
    </div>
  );
}

type Variant = 'gold' | 'ghost' | 'danger' | 'outline' | 'success';

export function Button({ variant = 'gold', className, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  const styles: Record<Variant, string> = {
    gold: 'bg-gradient-to-b from-gold-300 to-gold-500 text-ink-950 shadow-lg shadow-gold-500/20 hover:from-gold-200 hover:to-gold-400',
    ghost: 'bg-white/5 text-stone-200 hover:bg-white/10',
    outline: 'border border-gold-400/40 text-gold-200 hover:bg-gold-400/10',
    danger: 'bg-gradient-to-b from-red-500 to-maroon-700 text-white shadow-lg shadow-red-900/30 hover:from-red-400 hover:to-red-700',
    success: 'bg-gradient-to-b from-emerald-400 to-emerald-600 text-ink-950 hover:from-emerald-300 hover:to-emerald-500',
  };
  return (
    <button
      {...rest}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40',
        styles[variant],
        className,
      )}
    >
      {children}
    </button>
  );
}

export function scoreColor(v: number): string {
  if (v >= 0.85) return '#34d399';
  if (v >= 0.7) return '#a3e635';
  if (v >= 0.55) return '#fbbf24';
  if (v >= 0.4) return '#fb923c';
  return '#f87171';
}

export function ScoreBar({ label, sub, value, display, className, color }: { label: ReactNode; sub?: ReactNode; value: number; display?: string; className?: string; color?: string }) {
  const v = Math.max(0, Math.min(1, value));
  return (
    <div className={className}>
      <div className="mb-1 flex items-baseline justify-between gap-2 text-sm">
        <span className="text-stone-200">
          {label}
          {sub && <span className="ml-1.5 text-xs text-stone-500">{sub}</span>}
        </span>
        <span className="font-display tabular-nums text-stone-100">{display ?? `${Math.round(v * 100)}`}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-white/5">
        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${v * 100}%`, background: color ?? scoreColor(v) }} />
      </div>
    </div>
  );
}

export function Ring({ value, size = 120, stroke = 10, color, children, track = 'rgba(255,255,255,0.07)' }: { value: number; size?: number; stroke?: number; color?: string; children?: ReactNode; track?: string }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(1, value));
  return (
    <div className="relative inline-grid place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} stroke={track} strokeWidth={stroke} fill="none" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={color ?? scoreColor(v)}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - v)}
          style={{ transition: 'stroke-dashoffset 0.4s ease' }}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">{children}</div>
    </div>
  );
}

export function Badge({ children, className, color }: { children: ReactNode; className?: string; color?: string }) {
  return (
    <span
      className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider', className)}
      style={color ? { color, borderColor: `${color}55`, background: `${color}14` } : undefined}
    >
      {children}
    </span>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded border border-white/15 bg-white/5 px-1.5 py-0.5 font-mono text-[10px] text-stone-300">{children}</kbd>;
}

/** Video + overlay canvas container used by Arena and Studio. */
export function PoseViewport({ engine, className, children }: { engine: PoseEngine; className?: string; children?: ReactNode }) {
  return (
    <div className={cn('relative overflow-hidden rounded-2xl border border-gold-500/20 bg-black', className)}>
      <video ref={engine.videoRef} className="absolute inset-0 h-full w-full object-contain opacity-0" playsInline muted />
      <canvas ref={engine.canvasRef} className="absolute inset-0 h-full w-full object-contain" />
      {children}
    </div>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden>
      <defs>
        <linearGradient id="lg-gold" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#f7e3a3" />
          <stop offset="1" stopColor="#c9971c" />
        </linearGradient>
      </defs>
      <circle cx="32" cy="32" r="29" fill="#3d0a10" stroke="url(#lg-gold)" strokeWidth="3" />
      <g stroke="url(#lg-gold)" strokeWidth="3.4" strokeLinecap="round" fill="none">
        <circle cx="33" cy="15.5" r="4" fill="#f0cf6a" stroke="none" />
        <path d="M32 21 L30 34" />
        <path d="M31.5 24 L44 21 L52 23" />
        <path d="M31.5 25 L22 30 L24 22" />
        <path d="M30 34 L20 40 L14 50" />
        <path d="M30 34 L40 41 L41 51" />
      </g>
    </svg>
  );
}
