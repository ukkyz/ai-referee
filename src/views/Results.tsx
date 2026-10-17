import { Fragment, useState } from 'react';
import {
  Activity,
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronRight,
  Download,
  Flame,
  Gauge,
  ListOrdered,
  Medal,
  Music,
  RotateCcw,
  Scale,
  Sparkles,
  Timer,
  TriangleAlert,
  Trophy,
  X,
} from 'lucide-react';
import type { FeedbackItem, Report, StepResult } from '../types';
import { Badge, Button, Panel, Ring, ScoreBar, SectionTitle, scoreColor } from '../components/ui';
import { RadarChart, TimelineChart } from '../components/charts';
import StickFigure from '../components/StickFigure';
import { FEATURE_META, formatFeature } from '../lib/pose/features';
import { CATEGORY_INFO } from '../data/poses';
import { fmtSigned, fmtTime, pct } from '../lib/math';
import { downloadJSON } from '../lib/storage';
import { cn } from '../utils/cn';

interface Props {
  report: Report;
  onRetry?: () => void;
  onHome: () => void;
  backLabel?: string;
}

const LEVEL_STYLE: Record<FeedbackItem['level'], { icon: typeof Check; cls: string }> = {
  good: { icon: Check, cls: 'border-emerald-500/25 bg-emerald-500/[0.06] text-emerald-200' },
  warn: { icon: TriangleAlert, cls: 'border-amber-500/25 bg-amber-500/[0.06] text-amber-100' },
  bad: { icon: X, cls: 'border-red-500/30 bg-red-500/[0.07] text-red-200' },
};

function StepDetail({ s }: { s: StepResult }) {
  return (
    <div className="grid gap-5 p-4 md:grid-cols-[auto_1fr]">
      <div className="flex gap-3">
        <div className="text-center">
          <div className="w-32 rounded-xl bg-black/40 p-1">
            <StickFigure skeleton={s.refSkeleton} className="h-40 w-full" />
          </div>
          <div className="mt-1 text-[11px] uppercase tracking-wider text-gold-300">Reference</div>
        </div>
        <div className="text-center">
          <div className="w-32 rounded-xl bg-black/40 p-1">
            {s.performerSkeleton ? (
              <StickFigure skeleton={s.performerSkeleton} ghost={s.refSkeleton} color="#e7e5e4" ghostColor="rgba(240,207,106,0.6)" className="h-40 w-full" />
            ) : (
              <div className="grid h-40 place-items-center text-xs text-red-300">Not performed</div>
            )}
          </div>
          <div className="mt-1 text-[11px] uppercase tracking-wider text-stone-300">You {s.mirrored && '(mirrored)'}</div>
        </div>
      </div>
      <div className="min-w-0">
        {s.features.length > 0 ? (
          <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
            {[...s.features]
              .sort((a, b) => b.weight - a.weight)
              .filter((f) => f.weight >= 0.45)
              .map((f) => (
                <ScoreBar
                  key={f.key}
                  label={FEATURE_META[s.mirrored ? FEATURE_META[f.key].mirror : f.key].label}
                  sub={`${formatFeature(f.key, f.actual)} / ${formatFeature(f.key, f.target)}`}
                  value={f.score}
                  display={pct(f.score)}
                />
              ))}
          </div>
        ) : (
          <p className="text-sm text-stone-400">This movement was not found in the expected order, so all of its elements count as errors.</p>
        )}
        {s.tips.length > 0 && (
          <ul className="mt-4 space-y-1.5">
            {s.tips.map((t, i) => (
              <li key={i} className="flex gap-2 text-sm text-amber-100/90">
                <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gold-300" /> {t}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default function Results({ report: r, onRetry, onHome, backLabel = 'Home' }: Props) {
  const [open, setOpen] = useState<number | null>(null);
  const firmness = r.artistry.stability * 0.6 + r.artistry.balance * 0.4;
  const expression = r.artistry.contrast * 0.55 + r.artistry.flow * 0.45;
  const radar = [
    { label: 'Akurasi', value: r.correctness.accuracy },
    { label: 'Kelengkapan', value: r.correctness.completeness },
    { label: 'Kemantapan', value: firmness },
    { label: 'Tenaga', value: r.artistry.power },
    { label: 'Penghayatan', value: expression },
    { label: 'Stamina', value: r.artistry.stamina },
    { label: 'Irama', value: r.timing.rhythm },
    { label: 'Waktu', value: r.timing.duration },
  ];
  const perError = 100 / Math.max(1, r.elementsTotal);
  const dev = r.timePenalty.deviation;

  return (
    <div className="mx-auto max-w-[1300px] px-4 pb-20 pt-6 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Button variant="ghost" onClick={onHome} className="mb-3">
            <ArrowLeft className="h-4 w-4" /> {backLabel}
          </Button>
          <p className="text-xs uppercase tracking-[0.25em] text-gold-400">Keputusan Wasit · Referee Verdict</p>
          <h1 className="font-display text-3xl uppercase tracking-wide text-gold-100 sm:text-4xl">
            {r.jurusName} <span className="text-xl normal-case text-stone-400">· {r.jurusSubtitle}</span>
          </h1>
          <p className="mt-1 text-sm text-stone-400">
            {new Date(r.createdAt).toLocaleString()} · {r.source === 'camera' ? 'Live camera' : r.source === 'video' ? 'Video upload' : 'Simulated demo performance'} · {r.avgFps.toFixed(0)} fps analysed · strictness ×{r.settingsSnapshot.strictness.toFixed(2)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {onRetry && (
            <Button onClick={onRetry}>
              <RotateCcw className="h-4 w-4" /> Ulangi · Retry
            </Button>
          )}
          <Button variant="outline" onClick={() => downloadJSON(`wasit-silat-${r.jurusId}-${r.createdAt}.json`, r)}>
            <Download className="h-4 w-4" /> Export
          </Button>
        </div>
      </div>

      {/* ---------- Score hero ---------- */}
      <div className="mt-6 grid gap-5 lg:grid-cols-3">
        <Panel className="overflow-hidden p-6 lg:col-span-2" glow>
          <div className="bg-batik pointer-events-none absolute inset-0 opacity-60" />
          <div className="relative flex flex-wrap items-center justify-between gap-6">
            <div>
              <div className="flex items-center gap-2 text-sm text-gold-300">
                <Trophy className="h-4 w-4" /> Nilai Akhir · IPSI Seni Tunggal
              </div>
              <div className="mt-1 flex items-baseline gap-3">
                <span className="text-gradient-gold font-display text-7xl font-semibold tabular-nums sm:text-8xl">{r.total.toFixed(2)}</span>
                <span className="font-display text-2xl text-stone-500">/ 160</span>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Badge color={scoreColor(r.index / 100)}>
                  <Medal className="h-3 w-3" /> {r.predikat} · {r.predikatEn}
                </Badge>
                <span className="text-xs text-stone-400">Mean of the middle 3 of 5 judges (highest &amp; lowest discarded)</span>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3 text-center">
              <div className="rounded-xl border border-white/10 bg-black/30 px-4 py-3">
                <div className="text-[10px] uppercase tracking-widest text-stone-400">Kebenaran</div>
                <div className="font-display text-3xl tabular-nums text-stone-100">{r.kebenaran.toFixed(1)}</div>
                <div className="text-[11px] text-stone-500">
                  100 − {r.errorsTotal} × {perError.toFixed(2)}
                </div>
              </div>
              <div className="rounded-xl border border-white/10 bg-black/30 px-4 py-3">
                <div className="text-[10px] uppercase tracking-widest text-stone-400">Kemantapan</div>
                <div className="font-display text-3xl tabular-nums text-stone-100">{r.kemantapan.toFixed(1)}</div>
                <div className="text-[11px] text-stone-500">range 50–60</div>
              </div>
              <div className={cn('rounded-xl border px-4 py-3', r.hukuman ? 'border-red-500/30 bg-red-500/10' : 'border-white/10 bg-black/30')}>
                <div className="text-[10px] uppercase tracking-widest text-stone-400">Hukuman</div>
                <div className={cn('font-display text-3xl tabular-nums', r.hukuman ? 'text-red-300' : 'text-stone-100')}>−{r.hukuman}</div>
                <div className="text-[11px] text-stone-500">time penalty</div>
              </div>
            </div>
          </div>
          <div className="relative mt-5 grid gap-3 border-t border-white/10 pt-4 text-sm text-stone-300 sm:grid-cols-3">
            <div className="flex items-center gap-2">
              <ListOrdered className="h-4 w-4 text-gold-300" /> {r.correctness.matched}/{r.correctness.total} movements in sequence
            </div>
            <div className="flex items-center gap-2">
              <Timer className="h-4 w-4 text-gold-300" /> {fmtTime(r.duration)} <span className="text-stone-500">({fmtSigned(dev)} s vs {fmtTime(r.targetDuration, 0)})</span>
            </div>
            <div className="flex items-center gap-2">
              <Scale className="h-4 w-4 text-gold-300" /> {r.elementsTotal} technique elements · {perError.toFixed(2)} pt each
            </div>
          </div>
        </Panel>

        <Panel className="p-6">
          <SectionTitle id="Indeks Performa" en="Weighted 0–100 performance index" icon={<Gauge className="h-4 w-4" />} />
          <div className="flex items-center gap-5">
            <Ring value={r.index / 100} size={128} stroke={11}>
              <div>
                <div className="font-display text-4xl tabular-nums text-stone-50">{Math.round(r.index)}</div>
                <div className="text-[10px] uppercase tracking-widest text-stone-500">of 100</div>
              </div>
            </Ring>
            <div className="flex-1 space-y-3">
              <ScoreBar label="Kebenaran" sub="correctness" value={r.correctness.index} />
              <ScoreBar label="Seni" sub="artistry" value={r.artistry.index} />
              <ScoreBar label="Waktu" sub="timing" value={r.timing.index} />
            </div>
          </div>
        </Panel>
      </div>

      {/* ---------- Dewan Juri ---------- */}
      <Panel className="mt-5 p-5">
        <SectionTitle id="Dewan Juri Virtual" en="Five judge profiles score the same performance; highest and lowest totals are discarded (IPSI procedure)" icon={<Scale className="h-4 w-4" />} />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wider text-stone-500">
                <th className="py-2 pr-3 font-medium">Juri</th>
                <th className="py-2 pr-3 font-medium">Profile</th>
                <th className="py-2 pr-3 text-right font-medium">Errors</th>
                <th className="py-2 pr-3 text-right font-medium">Kebenaran</th>
                <th className="py-2 pr-3 text-right font-medium">Kemantapan</th>
                <th className="py-2 pr-3 text-right font-medium">Hukuman</th>
                <th className="py-2 text-right font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              {r.judges.map((j) => (
                <tr key={j.name} className={cn('border-t border-white/5', j.dropped && 'text-stone-500')}>
                  <td className="py-2 pr-3 font-semibold">{j.name}</td>
                  <td className="py-2 pr-3 text-stone-400">
                    {j.profile} {j.dropped && <Badge className="ml-2" color="#78716c">discarded</Badge>}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">{j.errors}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{j.kebenaran.toFixed(2)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{j.kemantapan.toFixed(2)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">−{j.hukuman}</td>
                  <td className={cn('py-2 text-right font-display text-base tabular-nums', j.dropped ? 'line-through' : 'text-gold-200')}>{j.total.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      {/* ---------- Radar + elements ---------- */}
      <div className="mt-5 grid gap-5 lg:grid-cols-5">
        <Panel className="flex flex-col items-center p-5 lg:col-span-2">
          <SectionTitle id="Profil Penampilan" en="Performance profile" icon={<Activity className="h-4 w-4" />} />
          <RadarChart axes={radar} />
        </Panel>
        <Panel className="p-5 lg:col-span-3">
          <SectionTitle id="Unsur Kemantapan" en="The four IPSI firmness elements (each 0–100 → Nilai Kemantapan 50–60)" icon={<Flame className="h-4 w-4" />} />
          <div className="grid gap-5 sm:grid-cols-2">
            <div className="rounded-xl bg-white/[0.03] p-4">
              <ScoreBar label="Kemantapan Gerak" sub="firmness" value={r.artistry.kemantapanGerak} />
              <p className="mt-2 text-xs text-stone-400">
                Hold stability {pct(r.artistry.stability)} · balance {pct(r.artistry.balance)}
              </p>
            </div>
            <div className="rounded-xl bg-white/[0.03] p-4">
              <ScoreBar label="Irama Gerak" sub="rhythm" value={r.artistry.irama} />
              <p className="mt-2 text-xs text-stone-400">
                Interval consistency {pct(r.timing.rhythm)} · holds {pct(r.timing.hold)} · tempo {pct(r.timing.tempo)}
              </p>
            </div>
            <div className="rounded-xl bg-white/[0.03] p-4">
              <ScoreBar label="Penghayatan Gerak" sub="expression" value={r.artistry.penghayatan} />
              <p className="mt-2 text-xs text-stone-400">
                Dynamic contrast {pct(r.artistry.contrast)} · flow {pct(r.artistry.flow)} · {r.hesitations.length} hesitation{r.hesitations.length === 1 ? '' : 's'}
              </p>
            </div>
            <div className="rounded-xl bg-white/[0.03] p-4">
              <ScoreBar label="Tenaga & Stamina" sub="power & stamina" value={r.artistry.tenagaStamina} />
              <p className="mt-2 text-xs text-stone-400">
                Strike power {pct(r.artistry.power)} · stamina {pct(r.artistry.stamina)}
              </p>
            </div>
          </div>
          <div className="mt-5 grid gap-3 border-t border-white/10 pt-4 sm:grid-cols-4">
            <div>
              <div className="text-[10px] uppercase tracking-widest text-stone-500">Duration</div>
              <div className="font-display text-xl tabular-nums text-stone-100">{fmtTime(r.duration)}</div>
              <div className={cn('text-xs', r.hukuman ? 'text-red-300' : 'text-emerald-300')}>{r.timePenalty.band}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-widest text-stone-500">Tempo vs ref</div>
              <div className="font-display text-xl tabular-nums text-stone-100">{r.timing.tempoRatio.toFixed(2)}×</div>
              <div className="text-xs text-stone-400">{r.timing.tempoRatio > 1.05 ? 'slower' : r.timing.tempoRatio < 0.95 ? 'faster' : 'on tempo'}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-widest text-stone-500">Rhythm</div>
              <div className="font-display text-xl tabular-nums text-stone-100">{pct(r.timing.rhythm)}</div>
              <div className="text-xs text-stone-400">interval consistency</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-widest text-stone-500">Hold accuracy</div>
              <div className="font-display text-xl tabular-nums text-stone-100">{pct(r.timing.hold)}</div>
              <div className="text-xs text-stone-400">finishing positions</div>
            </div>
          </div>
        </Panel>
      </div>

      {/* ---------- Timeline ---------- */}
      <Panel className="mt-5 p-5">
        <SectionTitle
          id="Penjajaran Urutan & Waktu"
          en="Sequence & timing alignment — reference timing (top) vs your performance (bottom)"
          icon={<Music className="h-4 w-4" />}
          right={
            <div className="hidden flex-wrap gap-3 text-[11px] text-stone-400 md:flex">
              <span className="flex items-center gap-1">
                <span className="h-2 w-4 rounded bg-red-500/60" /> motion energy
              </span>
              <span className="flex items-center gap-1">
                <span className="h-0.5 w-4 bg-gold-300" /> pose match
              </span>
              <span className="flex items-center gap-1">
                <span className="h-2 w-4 rounded bg-gold-400/20" /> held position
              </span>
              <span className="flex items-center gap-1">
                <span className="h-2 w-4 rounded bg-red-400/40" /> hesitation
              </span>
            </div>
          }
        />
        <TimelineChart report={r} />
      </Panel>

      {/* ---------- Steps ---------- */}
      <Panel className="mt-5 p-5">
        <SectionTitle id="Rincian Gerakan" en="Movement-by-movement breakdown — click a row for the pose comparison" icon={<ListOrdered className="h-4 w-4" />} />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wider text-stone-500">
                <th className="py-2 pl-2 font-medium">#</th>
                <th className="py-2 font-medium">Movement</th>
                <th className="py-2 text-right font-medium">Expected</th>
                <th className="py-2 text-right font-medium">Actual (Δ)</th>
                <th className="py-2 text-right font-medium">Hold</th>
                <th className="py-2 text-right font-medium">Match</th>
                <th className="py-2 text-right font-medium">Errors</th>
                <th className="py-2 text-right font-medium">Stability</th>
                <th className="py-2 pr-2 text-right font-medium">Power</th>
              </tr>
            </thead>
            <tbody>
              {r.steps.map((s) => {
                const isOpen = open === s.index;
                const delta = s.actualT !== null ? s.actualT - s.expectedT : null;
                const cat = CATEGORY_INFO[s.category];
                return (
                  <Fragment key={s.index}>
                    <tr onClick={() => setOpen(isOpen ? null : s.index)} className={cn('cursor-pointer border-t border-white/5 transition hover:bg-white/[0.03]', isOpen && 'bg-white/[0.04]')}>
                      <td className="py-2 pl-2 text-stone-500">
                        <span className="flex items-center gap-1">
                          {isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                          {s.index + 1}
                        </span>
                      </td>
                      <td className="py-2">
                        <div className="flex items-center gap-2">
                          <StickFigure skeleton={s.refSkeleton} className="h-10 w-8" showGround={false} strokeWidth={0.08} />
                          <div>
                            <div className={cn('font-medium', s.matched ? 'text-stone-100' : 'text-red-300')}>{s.name}</div>
                            <div className="text-[11px]" style={{ color: cat.color }}>
                              {cat.label}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="py-2 text-right tabular-nums text-stone-400">{fmtTime(s.expectedT)}</td>
                      <td className="py-2 text-right tabular-nums">
                        {s.actualT !== null && delta !== null ? (
                          <>
                            {fmtTime(s.actualT)}{' '}
                            <span className={cn('text-xs', Math.abs(delta) < 1 ? 'text-emerald-300' : Math.abs(delta) < 2.5 ? 'text-amber-300' : 'text-red-300')}>({fmtSigned(delta)})</span>
                          </>
                        ) : (
                          <span className="text-red-300">missed</span>
                        )}
                      </td>
                      <td className="py-2 text-right tabular-nums text-stone-300">
                        {s.matched ? `${s.holdDuration.toFixed(1)}s` : '—'}
                        <span className="text-xs text-stone-500"> / {s.expectedHold}s</span>
                      </td>
                      <td className="py-2 text-right font-display text-base tabular-nums" style={{ color: s.matched ? scoreColor(s.similarity) : '#f87171' }}>
                        {s.matched ? pct(s.similarity) : '0%'}
                      </td>
                      <td className="py-2 text-right tabular-nums">
                        <span className={s.errors ? 'text-amber-300' : 'text-emerald-300'}>{s.errors}</span>
                        <span className="text-xs text-stone-500">/{s.elements}</span>
                      </td>
                      <td className="py-2 text-right tabular-nums text-stone-300">{s.matched ? pct(s.stability) : '—'}</td>
                      <td className="py-2 pr-2 text-right tabular-nums text-stone-300">{s.power !== null ? pct(s.power) : '—'}</td>
                    </tr>
                    {isOpen && (
                      <tr className="bg-black/20">
                        <td colSpan={9}>
                          <StepDetail s={s} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>

      {/* ---------- Feedback ---------- */}
      <Panel className="mt-5 p-5">
        <SectionTitle id="Catatan Wasit" en="Referee notes & coaching advice" icon={<Sparkles className="h-4 w-4" />} />
        <div className="grid gap-2.5 md:grid-cols-2">
          {r.feedback.map((f, i) => {
            const st = LEVEL_STYLE[f.level];
            const Icon = st.icon;
            return (
              <div key={i} className={cn('flex gap-3 rounded-xl border p-3 text-sm', st.cls)}>
                <Icon className="mt-0.5 h-4 w-4 shrink-0" />
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-widest opacity-70">{f.area}</div>
                  <div className="leading-relaxed">{f.text}</div>
                </div>
              </div>
            );
          })}
        </div>
      </Panel>
    </div>
  );
}
