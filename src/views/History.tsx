import { ArrowLeft, ChevronRight, History as HistoryIcon, Trash2, Trophy } from 'lucide-react';
import type { Report } from '../types';
import { Badge, Button, Panel, Ring, scoreColor } from '../components/ui';
import { Sparkline } from '../components/charts';
import { fmtTime } from '../lib/math';

interface Props {
  history: Report[];
  onOpen: (r: Report) => void;
  onDelete: (id: string) => void;
  onClear: () => void;
  onBack: () => void;
}

export default function History({ history, onOpen, onDelete, onClear, onBack }: Props) {
  const chrono = [...history].sort((a, b) => a.createdAt - b.createdAt);
  const best = history.reduce((m, r) => Math.max(m, r.total), 0);
  const avg = history.length ? history.reduce((s, r) => s + r.index, 0) / history.length : 0;
  return (
    <div className="mx-auto max-w-[1100px] px-4 pb-20 pt-6 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Button variant="ghost" onClick={onBack}>
            <ArrowLeft className="h-4 w-4" /> Back
          </Button>
          <div>
            <p className="text-xs uppercase tracking-[0.25em] text-gold-400">Riwayat penilaian</p>
            <h1 className="font-display text-3xl uppercase tracking-wide text-gold-100">Training history</h1>
          </div>
        </div>
        {history.length > 0 && (
          <Button
            variant="ghost"
            className="hover:text-red-300"
            onClick={() => {
              if (window.confirm('Delete all saved verdicts?')) onClear();
            }}
          >
            <Trash2 className="h-4 w-4" /> Clear all
          </Button>
        )}
      </div>

      {history.length === 0 ? (
        <Panel className="mt-8 grid place-items-center p-16 text-center">
          <HistoryIcon className="h-10 w-10 text-gold-400" />
          <p className="mt-3 font-display text-xl uppercase text-stone-200">No verdicts yet</p>
          <p className="mt-1 text-sm text-stone-500">Every judged performance is saved here so you can track progress over time.</p>
        </Panel>
      ) : (
        <>
          <div className="mt-6 grid gap-4 sm:grid-cols-3">
            <Panel className="p-5">
              <div className="text-xs uppercase tracking-widest text-stone-500">Sessions</div>
              <div className="font-display text-4xl text-stone-50">{history.length}</div>
            </Panel>
            <Panel className="p-5">
              <div className="flex items-center gap-1.5 text-xs uppercase tracking-widest text-stone-500">
                <Trophy className="h-3.5 w-3.5 text-gold-400" /> Best IPSI total
              </div>
              <div className="font-display text-4xl text-gold-200">{best.toFixed(2)}</div>
            </Panel>
            <Panel className="p-5">
              <div className="text-xs uppercase tracking-widest text-stone-500">Index trend (avg {Math.round(avg)})</div>
              <Sparkline values={chrono.map((r) => r.index)} max={100} />
            </Panel>
          </div>
          <div className="mt-5 space-y-2.5">
            {history.map((r) => (
              <Panel key={r.id} className="flex flex-wrap items-center gap-4 p-4 transition hover:ring-1 hover:ring-gold-400/30">
                <Ring value={r.index / 100} size={56} stroke={6}>
                  <span className="font-display text-lg text-stone-50">{Math.round(r.index)}</span>
                </Ring>
                <button className="min-w-[200px] flex-1 text-left" onClick={() => onOpen(r)}>
                  <div className="font-display text-xl uppercase tracking-wide text-gold-100">{r.jurusName}</div>
                  <div className="text-xs text-stone-400">
                    {new Date(r.createdAt).toLocaleString()} · {r.source} · {fmtTime(r.duration)} · {r.correctness.matched}/{r.correctness.total} movements
                  </div>
                </button>
                <Badge color={scoreColor(r.index / 100)}>{r.predikat}</Badge>
                <div className="text-right">
                  <div className="font-display text-2xl tabular-nums text-stone-50">{r.total.toFixed(2)}</div>
                  <div className="text-[10px] uppercase tracking-widest text-stone-500">IPSI / 160</div>
                </div>
                <div className="flex gap-1">
                  <Button variant="ghost" className="px-2.5 hover:text-red-300" onClick={() => onDelete(r.id)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" className="px-2.5" onClick={() => onOpen(r)}>
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </Panel>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
