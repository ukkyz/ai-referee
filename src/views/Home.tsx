'use client';

import { Camera, Clapperboard, Crosshair, Flame, Footprints, ListOrdered, Music, Pencil, Play, Plus, Scale, ScanLine, Sparkles, Timer, Trash2, Upload } from 'lucide-react';

import type { Jurus } from '../types';
import { Badge, Button, Panel } from '../components/ui';
import StickFigure from '../components/StickFigure';
import { fmtTime } from '../lib/math';
import { LEVEL_COLOR } from './Arena';
import { POSES } from '../data/poses';

interface Props {
  presets: Jurus[];
  customs: Jurus[];
  onJudge: (j: Jurus) => void;
  onCreate: () => void;
  onEdit: (j: Jurus) => void;
  onDelete: (id: string) => void;
}

function JurusCard({ j, onJudge, onEdit, onDelete }: { j: Jurus; onJudge: () => void; onEdit?: () => void; onDelete?: () => void }) {
  const strip = j.steps.slice(0, 9);
  return (
    <Panel className="group flex flex-col p-5 transition hover:-translate-y-0.5 hover:ring-1 hover:ring-gold-400/30">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge color={LEVEL_COLOR[j.level]}>{j.level}</Badge>
            {j.custom && <Badge color="#f472b6">Custom</Badge>}
          </div>
          <h3 className="mt-2 font-display text-2xl uppercase leading-tight tracking-wide text-gold-100">{j.name}</h3>
          <p className="text-sm text-gold-300/80">{j.subtitle}</p>
        </div>
        <div className="text-right text-xs text-stone-400">
          <div className="flex items-center justify-end gap-1 font-display text-lg text-stone-200">
            <Timer className="h-4 w-4 text-gold-400" /> {fmtTime(j.targetDuration, 0)}
          </div>
          ±{j.tolerance}s
        </div>
      </div>
      <p className="mt-3 line-clamp-2 text-sm text-stone-400">{j.description}</p>
      <div className="mt-4 flex items-end gap-0.5 overflow-hidden rounded-xl bg-black/30 px-2 pt-2">
        {strip.map((s, i) => (
          <div key={s.uid + i} className="flex flex-col items-center" title={s.label ?? s.pose.name}>
            <StickFigure skeleton={s.pose.skeleton} className="h-14 w-10" showGround={false} strokeWidth={0.07} />
            <span className="pb-1 text-[9px] tabular-nums text-stone-600">{i + 1}</span>
          </div>
        ))}
        {j.steps.length > strip.length && <div className="pb-6 pl-1 text-xs text-stone-500">+{j.steps.length - strip.length}</div>}
      </div>
      <div className="mt-4 flex items-center gap-2">
        <span className="flex items-center gap-1 text-xs text-stone-400">
          <ListOrdered className="h-3.5 w-3.5" /> {j.steps.length} key movements
        </span>
        <div className="ml-auto flex gap-2">
          {onEdit && (
            <Button variant="ghost" className="px-2.5" onClick={onEdit} title="Edit">
              <Pencil className="h-4 w-4" />
            </Button>
          )}
          {onDelete && (
            <Button variant="ghost" className="px-2.5 hover:text-red-300" onClick={onDelete} title="Delete">
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
          <Button onClick={onJudge}>
            <Play className="h-4 w-4" /> Nilai · Judge
          </Button>
        </div>
      </div>
    </Panel>
  );
}

export default function Home({ presets, customs, onJudge, onCreate, onEdit, onDelete }: Props) {
  const scrollToList = () => document.getElementById('jurus-list')?.scrollIntoView({ behavior: 'smooth' });
  return (
    <div>
      {/* ---------- Hero ---------- */}
      <section className="relative overflow-hidden border-b border-gold-500/15">
        <img src="/hero.jpg" alt="Pencak Silat performer with AI pose tracking" className="absolute inset-0 h-full w-full object-cover object-right opacity-90" />
        <div className="absolute inset-0 bg-gradient-to-r from-ink-950 via-ink-950/85 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-t from-ink-950 via-transparent to-transparent" />
        <div className="relative mx-auto max-w-[1300px] px-4 py-20 sm:px-6 lg:py-28">
          <div className="max-w-2xl">
            <Badge color="#e5b53a">
              <Sparkles className="h-3 w-3" /> AI Referee · Seni Tunggal
            </Badge>
            <h1 className="mt-5 font-display text-5xl font-semibold uppercase leading-[0.95] tracking-wide text-stone-50 sm:text-7xl">
              Wasit Virtual
              <span className="text-gradient-gold block">Pencak Silat</span>
            </h1>
            <p className="mt-5 max-w-xl text-lg leading-relaxed text-stone-300">
              Not a single-pose checker — the referee watches your <em className="text-gold-200">entire jurus</em>. It aligns every key movement in order, judges firmness, power and expression, and times your rhythm against the
              reference, scored the IPSI way.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button className="px-6 py-3 text-base" onClick={scrollToList}>
                <Play className="h-5 w-5" /> Masuk Gelanggang
              </Button>
              <Button variant="outline" className="px-6 py-3 text-base" onClick={onCreate}>
                <Plus className="h-5 w-5" /> Create your own jurus
              </Button>
            </div>
            <div className="mt-10 grid max-w-xl grid-cols-3 gap-4">
              {[
                ['100 + 60', 'IPSI scoring scale'],
                ['5 juri', 'virtual judge panel'],
                [`${POSES.length}`, 'reference techniques'],
              ].map(([a, b]) => (
                <div key={b} className="border-l-2 border-gold-500/50 pl-3">
                  <div className="font-display text-2xl text-gold-200">{a}</div>
                  <div className="text-xs text-stone-400">{b}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ---------- How it scores ---------- */}
      <section className="mx-auto max-w-[1300px] px-4 py-16 sm:px-6">
        <p className="text-xs uppercase tracking-[0.25em] text-gold-400">Bagaimana wasit menilai</p>
        <h2 className="mt-1 font-display text-3xl uppercase tracking-wide text-stone-50 sm:text-4xl">Judging the whole movement, not a snapshot</h2>
        <div className="mt-8 grid gap-5 md:grid-cols-3">
          {[
            {
              icon: <ListOrdered className="h-5 w-5" />,
              title: 'Kebenaran',
              en: 'Sequence correctness · 100 − errors',
              text: 'Every frame is compared with every key movement using 18 joint-angle & body-geometry features. A dynamic-programming sequence alignment finds the best in-order match for the whole jurus — missing, out-of-order or incorrect elements become kesalahan.',
            },
            {
              icon: <Flame className="h-5 w-5" />,
              title: 'Kemantapan',
              en: 'Artistry · 50–60 points',
              text: 'The four IPSI elements: firmness (stability & balance in finishing positions), rhythm (irama), expression (dynamic contrast and flow without hesitation) and power & stamina (strike speed, first vs. second half consistency).',
            },
            {
              icon: <Music className="h-5 w-5" />,
              title: 'Waktu & Irama',
              en: 'Timing · penalties & rhythm',
              text: 'Total time vs. target with official penalty bands (±5 s tolerance → −10 / −15 / −20 for a 3-minute Tunggal), interval rhythm between movements after tempo normalisation, overall tempo and hold durations.',
            },
          ].map((c) => (
            <Panel key={c.title} className="p-6">
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-gold-400/10 text-gold-300">{c.icon}</span>
              <h3 className="mt-4 font-display text-2xl uppercase tracking-wide text-gold-100">{c.title}</h3>
              <p className="text-sm text-gold-300/80">{c.en}</p>
              <p className="mt-3 text-sm leading-relaxed text-stone-400">{c.text}</p>
            </Panel>
          ))}
        </div>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-2 rounded-2xl border border-white/5 bg-white/[0.02] p-4 text-xs text-stone-400">
          {[
            [<Camera key="c" className="h-4 w-4" />, 'Camera / video'],
            [<ScanLine key="s" className="h-4 w-4" />, '33 3D landmarks (MediaPipe)'],
            [<Crosshair key="x" className="h-4 w-4" />, '18 biomechanical features'],
            [<ListOrdered key="l" className="h-4 w-4" />, 'Ordered sequence alignment'],
            [<Footprints key="f" className="h-4 w-4" />, 'Kinematics: stability · power · flow'],
            [<Scale key="j" className="h-4 w-4" />, '5-judge panel'],
          ].map(([icon, label], i, arr) => (
            <span key={i} className="flex items-center gap-2">
              <span className="flex items-center gap-1.5 rounded-full bg-black/30 px-3 py-1.5 text-stone-300">
                <span className="text-gold-300">{icon}</span>
                {label}
              </span>
              {i < arr.length - 1 && <span className="text-gold-500">→</span>}
            </span>
          ))}
        </div>
      </section>

      {/* ---------- Jurus list ---------- */}
      <section id="jurus-list" className="mx-auto max-w-[1300px] scroll-mt-20 px-4 pb-16 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.25em] text-gold-400">Pilih jurus</p>
            <h2 className="mt-1 font-display text-3xl uppercase tracking-wide text-stone-50 sm:text-4xl">Choose a routine to be judged</h2>
          </div>
          <Button variant="outline" onClick={onCreate}>
            <Plus className="h-4 w-4" /> New custom jurus
          </Button>
        </div>
        <div className="mt-8 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {presets.map((j) => (
            <JurusCard key={j.id} j={j} onJudge={() => onJudge(j)} />
          ))}
          {customs.map((j) => (
            <JurusCard key={j.id} j={j} onJudge={() => onJudge(j)} onEdit={() => onEdit(j)} onDelete={() => onDelete(j.id)} />
          ))}
          <button
            onClick={onCreate}
            className="flex min-h-[280px] flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-gold-500/25 p-6 text-center text-stone-400 transition hover:border-gold-400/50 hover:bg-gold-400/[0.03] hover:text-gold-200"
          >
            <span className="grid h-12 w-12 place-items-center rounded-full bg-gold-400/10 text-gold-300">
              <Clapperboard className="h-6 w-6" />
            </span>
            <span className="font-display text-xl uppercase tracking-wide">Record a master&rsquo;s jurus</span>
            <span className="max-w-xs text-sm">A coach performs once in the Studio — key poses and timing are captured automatically, then students are judged against it.</span>
          </button>
        </div>
      </section>

      {/* ---------- Setup tips ---------- */}
      <section className="mx-auto max-w-[1300px] px-4 pb-20 sm:px-6">
        <Panel className="grid gap-6 p-6 md:grid-cols-4">
          <div>
            <h3 className="font-display text-xl uppercase tracking-wide text-gold-100">Persiapan kamera</h3>
            <p className="mt-1 text-sm text-stone-400">For a fair verdict, set up like a real gelanggang camera.</p>
          </div>
          {[
            [<Camera key="1" className="h-5 w-5" />, 'Full body in frame', 'Place the camera 2.5–4 m away at hip height. Head and feet must stay visible during kicks and low stances.'],
            [<Sparkles key="2" className="h-5 w-5" />, 'Light & contrast', 'Even front lighting, plain background, and clothing that contrasts with the wall improve landmark accuracy.'],
            [<Upload key="3" className="h-5 w-5" />, 'Recorded videos', 'Upload competition footage (MP4/WebM). Use 0.5× precision mode so fast strikes are sampled densely.'],
          ].map(([icon, title, text], i) => (
            <div key={i} className="flex gap-3">
              <span className="mt-0.5 text-gold-300">{icon}</span>
              <div>
                <div className="font-semibold text-stone-200">{title}</div>
                <p className="mt-1 text-sm text-stone-400">{text}</p>
              </div>
            </div>
          ))}
        </Panel>
      </section>
    </div>
  );
}
