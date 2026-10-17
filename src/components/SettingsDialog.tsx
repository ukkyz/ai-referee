import { SlidersHorizontal, Volume2, VolumeX, X } from 'lucide-react';
import { DEFAULT_SETTINGS, type ModelKind, type RefereeSettings } from '../types';
import { MODEL_INFO } from '../lib/pose/detector';
import { Button } from './ui';
import { cn } from '../utils/cn';

interface Props {
  open: boolean;
  settings: RefereeSettings;
  onChange: (s: RefereeSettings) => void;
  onClose: () => void;
}

function strictLabel(v: number) {
  if (v <= 0.82) return 'Strict · competition';
  if (v <= 1.08) return 'Standard';
  if (v <= 1.25) return 'Lenient · training';
  return 'Beginner friendly';
}

export default function SettingsDialog({ open, settings: s, onChange, onClose }: Props) {
  if (!open) return null;
  const set = (patch: Partial<RefereeSettings>) => onChange({ ...s, ...patch });
  const setW = (k: keyof RefereeSettings['weights'], v: number) => onChange({ ...s, weights: { ...s.weights, [k]: v } });
  const wsum = s.weights.correctness + s.weights.artistry + s.weights.timing || 1;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-2xl border border-gold-500/20 bg-ink-900 p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 font-display text-2xl uppercase tracking-wide text-gold-100">
            <SlidersHorizontal className="h-5 w-5" /> Referee settings
          </h2>
          <button onClick={onClose} className="rounded-lg p-1.5 text-stone-400 hover:bg-white/10 hover:text-white">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mt-6 space-y-6">
          <div>
            <div className="flex justify-between text-sm">
              <span className="font-semibold text-stone-200">Strictness</span>
              <span className="text-gold-300">
                {strictLabel(s.strictness)} · ×{s.strictness.toFixed(2)}
              </span>
            </div>
            <input type="range" min={0.7} max={1.4} step={0.05} value={s.strictness} onChange={(e) => set({ strictness: Number(e.target.value) })} className="mt-2 w-full accent-amber-400" />
            <p className="text-xs text-stone-500">Scales the angle tolerances used for every technique element (lower = stricter).</p>
          </div>

          <div>
            <div className="flex justify-between text-sm">
              <span className="font-semibold text-stone-200">Live recognition threshold</span>
              <span className="text-gold-300">{Math.round(s.matchThreshold * 100)}%</span>
            </div>
            <input type="range" min={0.55} max={0.85} step={0.01} value={s.matchThreshold} onChange={(e) => set({ matchThreshold: Number(e.target.value) })} className="mt-2 w-full accent-amber-400" />
            <p className="text-xs text-stone-500">Similarity needed for the live tracker to tick off a movement. The final verdict uses full-sequence alignment.</p>
          </div>

          <div>
            <div className="text-sm font-semibold text-stone-200">Performance index weights</div>
            {(
              [
                ['correctness', 'Kebenaran · correctness'],
                ['artistry', 'Seni · artistry'],
                ['timing', 'Waktu · timing'],
              ] as const
            ).map(([k, label]) => (
              <div key={k} className="mt-2 flex items-center gap-3 text-sm">
                <span className="w-44 text-stone-400">{label}</span>
                <input type="range" min={0} max={100} step={5} value={s.weights[k]} onChange={(e) => setW(k, Number(e.target.value))} className="flex-1 accent-amber-400" />
                <span className="w-10 text-right tabular-nums text-gold-300">{Math.round((s.weights[k] / wsum) * 100)}%</span>
              </div>
            ))}
          </div>

          <div>
            <div className="text-sm font-semibold text-stone-200">Pose model</div>
            <div className="mt-2 grid gap-2 sm:grid-cols-3">
              {(Object.keys(MODEL_INFO) as ModelKind[]).map((m) => (
                <button
                  key={m}
                  onClick={() => set({ model: m })}
                  className={cn('rounded-xl border p-3 text-left text-xs transition', s.model === m ? 'border-gold-400/60 bg-gold-400/10' : 'border-white/10 hover:bg-white/5')}
                >
                  <div className="font-display text-base text-stone-100">
                    {MODEL_INFO[m].label} <span className="text-xs text-stone-500">{MODEL_INFO[m].size}</span>
                  </div>
                  <div className="mt-0.5 text-stone-400">{MODEL_INFO[m].note}</div>
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <label className="flex cursor-pointer items-center gap-2 text-sm text-stone-300">
              <input type="checkbox" checked={s.allowMirror} onChange={(e) => set({ allowMirror: e.target.checked })} className="accent-amber-400" /> Accept mirrored side
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-sm text-stone-300">
              <input type="checkbox" checked={s.autoStop} onChange={(e) => set({ autoStop: e.target.checked })} className="accent-amber-400" /> Auto-stop at final salute
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-sm text-stone-300">
              <input type="checkbox" checked={s.sound} onChange={(e) => set({ sound: e.target.checked })} className="accent-amber-400" />
              {s.sound ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />} Gong & cues
            </label>
          </div>
        </div>

        <div className="mt-8 flex justify-between">
          <Button variant="ghost" onClick={() => onChange(DEFAULT_SETTINGS)}>
            Reset defaults
          </Button>
          <Button onClick={onClose}>Done</Button>
        </div>
      </div>
    </div>
  );
}
