'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowLeft, ArrowUp, Camera, CircleDot, Clapperboard, Crosshair, Play, Plus, Save, Square, Timer, Trash2, Upload, Wand } from 'lucide-react';
import { FEATURE_KEYS, type FeatureWeights, type Features, type Jurus, type JurusStep, type Level, type PoseCategory, type RefPose, type RefereeSettings, type Skeleton } from '../types';
import { usePoseEngine, type PoseFrame } from '../hooks/usePoseEngine';
import { averageFeatures, FEATURE_META, torsoLength } from '../lib/pose/features';
import { rawSimilarity } from '../lib/pose/similarity';
import { bodyInFrame } from '../lib/pose/landmarks';
import { CATEGORY_INFO, POSES } from '../data/poses';
import StickFigure from '../components/StickFigure';
import { Badge, Button, Kbd, Panel, PoseViewport, Ring, SectionTitle } from '../components/ui';
import { fmtTime, len, sub, uid } from '../lib/math';
import { cn } from '../utils/cn';

interface Props {
  initial?: Jurus | null;
  settings: RefereeSettings;
  onSave: (j: Jurus) => void;
  onTest: (j: Jurus) => void;
  onBack: () => void;
}

const BASE_WEIGHTS = Object.fromEntries(FEATURE_KEYS.map((k) => [k, FEATURE_META[k].baseWeight])) as FeatureWeights;

function makeCapturedPose(features: Features, skeleton: Skeleton, n: number): RefPose {
  return {
    id: uid('cp-'),
    name: `Gerakan ${n}`,
    nameEn: `Captured movement ${n}`,
    category: 'custom',
    description: 'Captured from a live demonstration in the Studio.',
    cue: 'Match the demonstrated position.',
    features,
    weights: { ...BASE_WEIGHTS },
    skeleton,
  };
}

const similarFeatures = (a: Features, b: Features) => rawSimilarity(a, { features: b, weights: BASE_WEIGHTS } as RefPose, 1);

export default function Studio({ initial, settings, onSave, onTest, onBack }: Props) {
  const engine = usePoseEngine(settings.model);
  const { onFrameRef, sourceRef, videoRef, lastFrameRef } = engine;
  const [name, setName] = useState(initial?.name ?? 'Jurus Baru');
  const [subtitle, setSubtitle] = useState(initial?.subtitle ?? 'Custom routine');
  const [description, setDescription] = useState(initial?.description ?? 'Recorded in the Studio from a live demonstration.');
  const [level, setLevel] = useState<Level>(initial?.level ?? 'Menengah');
  const [target, setTarget] = useState(initial?.targetDuration ?? 30);
  const [tolerance, setTolerance] = useState(initial?.tolerance ?? 3);
  const [steps, setSteps] = useState<JurusStep[]>(initial?.steps ?? []);
  const stepsRef = useRef<JurusStep[]>(steps);
  stepsRef.current = steps;
  const [recording, setRecording] = useState(false);
  const recordingRef = useRef(false);
  const recStartRef = useRef(0);
  const [recElapsed, setRecElapsed] = useState(0);
  const [autoCapture, setAutoCapture] = useState(true);
  const autoRef = useRef(true);
  autoRef.current = autoCapture;
  const [toast, setToast] = useState<string | null>(null);
  const [filter, setFilter] = useState<PoseCategory | 'all'>('all');
  const [stillProgress, setStillProgress] = useState(0);
  const [frameOk, setFrameOk] = useState<string | null>(null);
  const bufferRef = useRef<PoseFrame[]>([]);
  const stillSinceRef = useRef<number | null>(null);
  const motionEmaRef = useRef(1);
  const lastCaptureRef = useRef<{ features: Features; t: number } | null>(null);
  const counterRef = useRef((initial?.steps.filter((s) => s.pose.category === 'custom').length ?? 0) + 1);
  const fileRef = useRef<HTMLInputElement>(null);
  const idRef = useRef(initial?.id ?? uid('custom-'));
  const toastTimer = useRef<number | undefined>(undefined);

  const flash = (msg: string) => {
    setToast(msg);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 1800);
  };

  const timeOf = (f: PoseFrame) => (sourceRef.current === 'video' ? f.mediaTime : f.now);
  const nowBasis = () => (sourceRef.current === 'video' ? (videoRef.current?.currentTime ?? 0) : performance.now() / 1000);
  const nextT = () => {
    const s = stepsRef.current;
    return s.length ? +(Math.max(...s.map((x) => x.t)) + 3).toFixed(1) : 2;
  };

  const capture = (auto: boolean) => {
    const buf = bufferRef.current;
    if (!buf.length || !lastFrameRef.current) {
      flash('No performer detected');
      return;
    }
    const recent = buf.slice(-8);
    const features = averageFeatures(recent.map((f) => f.features));
    const last = recent[recent.length - 1];
    const n = counterRef.current++;
    const pose = makeCapturedPose(features, last.skeleton, n);
    const now = timeOf(last);
    const startAt = auto && stillSinceRef.current !== null ? stillSinceRef.current : now;
    const t = recordingRef.current ? Math.max(0, startAt - recStartRef.current) : nextT();
    const hold = auto && stillSinceRef.current !== null ? Math.max(0.6, Math.min(3, now - stillSinceRef.current)) : 0.8;
    setSteps((prev) => [...prev, { uid: uid('s-'), pose, t: +t.toFixed(1), hold: +hold.toFixed(1) }]);
    lastCaptureRef.current = { features, t: now };
    flash(`Pose #${n} captured${recordingRef.current ? ` at ${fmtTime(t)}` : ''}`);
  };
  const captureRef = useRef(capture);
  captureRef.current = capture;

  useEffect(() => {
    onFrameRef.current = (f) => {
      if (!f) {
        stillSinceRef.current = null;
        return;
      }
      const buf = bufferRef.current;
      const prev = buf[buf.length - 1];
      buf.push(f);
      if (buf.length > 45) buf.shift();
      if (!prev) return;
      const dt = Math.max(timeOf(f) - timeOf(prev), 1 / 120);
      const tl = torsoLength(f.skeleton);
      const joints = ['lWrist', 'rWrist', 'lAnkle', 'rAnkle', 'lElbow', 'rElbow', 'lKnee', 'rKnee'] as const;
      const motion = joints.reduce((s, j) => s + len(sub(f.skeleton[j], prev.skeleton[j])), 0) / joints.length / dt / tl;
      motionEmaRef.current = motionEmaRef.current * 0.7 + Math.min(motion, 10) * 0.3;
      const now = timeOf(f);
      if (motionEmaRef.current < 0.6) {
        if (stillSinceRef.current === null) stillSinceRef.current = now;
      } else stillSinceRef.current = null;
      if (recordingRef.current && autoRef.current && stillSinceRef.current !== null && now - stillSinceRef.current >= 0.7) {
        const lc = lastCaptureRef.current;
        const recentFeat = averageFeatures(buf.slice(-8).map((x) => x.features));
        if (!lc || (similarFeatures(recentFeat, lc.features) < 0.8 && now - lc.t > 0.8)) captureRef.current(true);
      }
    };
    return () => {
      onFrameRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const id = setInterval(() => {
      const ss = stillSinceRef.current;
      const last = bufferRef.current[bufferRef.current.length - 1];
      setStillProgress(ss !== null && last ? Math.min(1, (timeOf(last) - ss) / 0.7) : 0);
      setFrameOk(bodyInFrame(lastFrameRef.current?.lm).issue);
      if (recordingRef.current) setRecElapsed(nowBasis() - recStartRef.current);
    }, 100);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startRecording = async () => {
    if (!engine.source) return;
    if (stepsRef.current.length && !window.confirm('Start a new recording? Existing steps will be replaced.')) return;
    setSteps([]);
    counterRef.current = 1;
    lastCaptureRef.current = null;
    const v = videoRef.current;
    if (sourceRef.current === 'video' && v) {
      if (v.ended) v.currentTime = 0;
      try {
        await v.play();
      } catch {
        flash('Could not play video');
        return;
      }
    }
    recStartRef.current = nowBasis();
    recordingRef.current = true;
    setRecording(true);
    setRecElapsed(0);
  };

  const stopRecording = () => {
    if (!recordingRef.current) return;
    const el = nowBasis() - recStartRef.current;
    recordingRef.current = false;
    setRecording(false);
    if (sourceRef.current === 'video') videoRef.current?.pause();
    const tgt = Math.max(5, Math.ceil(el + 1));
    setTarget(tgt);
    setTolerance(Math.max(2, Math.round(tgt * 0.07)));
    flash(`Recording stopped · target set to ${fmtTime(tgt, 0)}`);
  };
  const stopRef = useRef(stopRecording);
  stopRef.current = stopRecording;

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onEnded = () => stopRef.current();
    v.addEventListener('ended', onEnded);
    return () => v.removeEventListener('ended', onEnded);
  }, [videoRef]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.code === 'Space' && sourceRef.current) {
        e.preventDefault();
        captureRef.current(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sourceRef]);

  const addFromLibrary = (p: RefPose) => {
    setSteps((prev) => [...prev, { uid: uid('s-'), pose: p, t: nextT(), hold: p.category === 'tendangan' ? 0.6 : 1 }]);
    flash(`${p.name} added`);
  };

  const update = (i: number, patch: Partial<JurusStep>) => setSteps((prev) => prev.map((s, k) => (k === i ? { ...s, ...patch } : s)));
  const move = (i: number, d: -1 | 1) =>
    setSteps((prev) => {
      const j = i + d;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  const remove = (i: number) => setSteps((prev) => prev.filter((_, k) => k !== i));
  const spaceEvenly = () =>
    setSteps((prev) => {
      if (prev.length < 2) return prev;
      const a = 2;
      const b = Math.max(a + prev.length, target - 3);
      return prev.map((s, i) => ({ ...s, t: +(a + ((b - a) * i) / (prev.length - 1)).toFixed(1) }));
    });
  const sortByTime = () => setSteps((prev) => [...prev].sort((x, y) => x.t - y.t));

  const outOfOrder = steps.some((s, i) => i > 0 && s.t <= steps[i - 1].t);

  const build = (): Jurus | null => {
    if (!name.trim()) {
      flash('Give the jurus a name');
      return null;
    }
    if (steps.length < 2) {
      flash('Add at least 2 movements');
      return null;
    }
    const sorted = [...steps].sort((x, y) => x.t - y.t);
    const lastT = sorted[sorted.length - 1].t;
    return {
      id: idRef.current,
      name: name.trim(),
      subtitle: subtitle.trim() || 'Custom routine',
      description: description.trim(),
      level,
      targetDuration: Math.max(target, Math.ceil(lastT + 1)),
      tolerance: Math.max(1, tolerance),
      steps: sorted,
      custom: true,
      createdAt: initial?.createdAt ?? Date.now(),
    };
  };

  const save = () => {
    const j = build();
    if (!j) return;
    onSave(j);
    flash('Jurus saved');
  };

  const test = () => {
    const j = build();
    if (!j) return;
    onSave(j);
    onTest(j);
  };

  const lib = POSES.filter((p) => filter === 'all' || p.category === filter);

  return (
    <div className="mx-auto max-w-[1400px] px-4 pb-20 pt-6 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Button variant="ghost" onClick={onBack}>
            <ArrowLeft className="h-4 w-4" /> Back
          </Button>
          <div>
            <p className="text-xs uppercase tracking-[0.25em] text-gold-400">Studio Jurus</p>
            <h1 className="font-display text-3xl uppercase tracking-wide text-gold-100">{initial ? 'Edit jurus' : 'Create a jurus'}</h1>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={save}>
            <Save className="h-4 w-4" /> Save
          </Button>
          <Button onClick={test}>
            <Play className="h-4 w-4" /> Save & judge
          </Button>
        </div>
      </div>

      <Panel className="mt-5 grid gap-4 p-5 md:grid-cols-6">
        <label className="md:col-span-2">
          <span className="text-xs uppercase tracking-wider text-stone-500">Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} className="mt-1 w-full rounded-lg border border-white/10 bg-ink-950 px-3 py-2 text-stone-100 outline-none focus:border-gold-400/50" />
        </label>
        <label className="md:col-span-2">
          <span className="text-xs uppercase tracking-wider text-stone-500">Subtitle</span>
          <input value={subtitle} onChange={(e) => setSubtitle(e.target.value)} className="mt-1 w-full rounded-lg border border-white/10 bg-ink-950 px-3 py-2 text-stone-100 outline-none focus:border-gold-400/50" />
        </label>
        <label>
          <span className="text-xs uppercase tracking-wider text-stone-500">Level</span>
          <select value={level} onChange={(e) => setLevel(e.target.value as Level)} className="mt-1 w-full rounded-lg border border-white/10 bg-ink-950 px-3 py-2 text-stone-100">
            <option>Pemula</option>
            <option>Menengah</option>
            <option>Mahir</option>
          </select>
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label>
            <span className="text-xs uppercase tracking-wider text-stone-500">Target s</span>
            <input type="number" min={5} value={target} onChange={(e) => setTarget(Math.max(1, Number(e.target.value)))} className="mt-1 w-full rounded-lg border border-white/10 bg-ink-950 px-2 py-2 text-stone-100" />
          </label>
          <label>
            <span className="text-xs uppercase tracking-wider text-stone-500">± s</span>
            <input type="number" min={1} value={tolerance} onChange={(e) => setTolerance(Math.max(1, Number(e.target.value)))} className="mt-1 w-full rounded-lg border border-white/10 bg-ink-950 px-2 py-2 text-stone-100" />
          </label>
        </div>
        <label className="md:col-span-6">
          <span className="text-xs uppercase tracking-wider text-stone-500">Description</span>
          <input value={description} onChange={(e) => setDescription(e.target.value)} className="mt-1 w-full rounded-lg border border-white/10 bg-ink-950 px-3 py-2 text-stone-100 outline-none focus:border-gold-400/50" />
        </label>
      </Panel>

      <div className="mt-5 grid gap-5 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <PoseViewport engine={engine} className="aspect-video w-full">
            {!engine.source && (
              <div className="bg-batik absolute inset-0 grid place-items-center">
                <div className="max-w-md px-6 text-center">
                  <Clapperboard className="mx-auto h-12 w-12 text-gold-300" />
                  <h3 className="mt-3 font-display text-2xl uppercase text-gold-100">Record a master&rsquo;s demonstration</h3>
                  <p className="mt-1 text-sm text-stone-400">
                    Press record, then perform the jurus. Every time the performer holds a position still for ~0.7 s, it is captured as a key movement with its timing. Or press <Kbd>Space</Kbd> to capture manually.
                  </p>
                  <div className="mt-5 flex flex-wrap justify-center gap-3">
                    <Button onClick={() => void engine.startCamera()}>
                      <Camera className="h-4 w-4" /> Live Camera
                    </Button>
                    <Button variant="outline" onClick={() => fileRef.current?.click()}>
                      <Upload className="h-4 w-4" /> Reference Video
                    </Button>
                  </div>
                  {engine.sourceError && <p className="mt-3 text-sm text-red-300">{engine.sourceError}</p>}
                  {engine.modelStatus === 'loading' && <p className="mt-3 text-xs text-stone-500">Loading pose model…</p>}
                </div>
              </div>
            )}
            {engine.source && (
              <>
                <div className="absolute left-3 top-3 flex gap-2">
                  {recording && (
                    <span className="flex items-center gap-1.5 rounded-full bg-red-600/90 px-2.5 py-1 text-xs font-bold text-white">
                      <span className="h-2 w-2 animate-pulse rounded-full bg-white" /> REC {fmtTime(recElapsed)}
                    </span>
                  )}
                  <span className="rounded-full bg-black/60 px-2.5 py-1 text-xs text-stone-300">{engine.fps} fps</span>
                </div>
                <div className={cn('absolute right-3 top-3 rounded-full px-3 py-1 text-xs font-semibold', frameOk ? 'bg-amber-500/25 text-amber-100' : 'bg-emerald-500/20 text-emerald-200')}>
                  {frameOk ?? '✓ Full body in frame'}
                </div>
                <div className="pointer-events-none absolute bottom-3 left-3 flex items-center gap-3 rounded-xl bg-black/70 px-3 py-2 backdrop-blur">
                  <Ring value={stillProgress} size={44} stroke={5} color="#f0cf6a">
                    <Crosshair className="h-4 w-4 text-gold-200" />
                  </Ring>
                  <div className="text-xs">
                    <div className="font-semibold text-stone-200">{stillProgress >= 1 ? 'Holding still' : 'Moving'}</div>
                    <div className="text-stone-400">{autoCapture ? 'Auto-capture on hold' : 'Manual capture (Space)'}</div>
                  </div>
                </div>
              </>
            )}
            {toast && <div className="animate-pop absolute left-1/2 top-14 -translate-x-1/2 rounded-full bg-gold-300 px-4 py-1.5 text-sm font-semibold text-ink-950 shadow-lg">{toast}</div>}
          </PoseViewport>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            {!recording ? (
              <Button variant="danger" onClick={() => void startRecording()} disabled={!engine.source || engine.modelStatus !== 'ready'}>
                <CircleDot className="h-4 w-4" /> Record demonstration
              </Button>
            ) : (
              <Button variant="danger" onClick={stopRecording}>
                <Square className="h-4 w-4" /> Stop recording
              </Button>
            )}
            <Button variant="outline" onClick={() => capture(false)} disabled={!engine.source}>
              <Crosshair className="h-4 w-4" /> Capture pose
            </Button>
            <label className="flex cursor-pointer items-center gap-2 text-sm text-stone-300">
              <input type="checkbox" checked={autoCapture} onChange={(e) => setAutoCapture(e.target.checked)} className="accent-amber-400" /> Auto-capture held poses
            </label>
            {engine.source && (
              <div className="ml-auto flex gap-2">
                <Button variant="ghost" onClick={() => void engine.startCamera()}>
                  <Camera className="h-4 w-4" />
                </Button>
                <Button variant="ghost" onClick={() => fileRef.current?.click()}>
                  <Upload className="h-4 w-4" />
                </Button>
              </div>
            )}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="video/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void engine.loadVideo(f);
              e.target.value = '';
            }}
          />
        </div>

        <Panel className="flex max-h-[640px] flex-col p-4">
          <SectionTitle id="Pustaka Gerakan" en="Pose library — click to append" icon={<Wand className="h-4 w-4" />} />
          <div className="mb-3 flex flex-wrap gap-1.5">
            {(['all', 'sikap', 'kuda-kuda', 'pukulan', 'tangkisan', 'tendangan', 'elakan'] as const).map((c) => (
              <button
                key={c}
                onClick={() => setFilter(c)}
                className={cn('rounded-full px-2.5 py-1 text-xs transition', filter === c ? 'bg-gold-400 text-ink-950' : 'bg-white/5 text-stone-300 hover:bg-white/10')}
              >
                {c === 'all' ? 'All' : CATEGORY_INFO[c].label}
              </button>
            ))}
          </div>
          <div className="grid flex-1 grid-cols-2 gap-2 overflow-y-auto pr-1 sm:grid-cols-3 lg:grid-cols-2 xl:grid-cols-3">
            {lib.map((p) => (
              <button key={p.id} onClick={() => addFromLibrary(p)} className="group rounded-xl border border-white/5 bg-black/30 p-2 text-left transition hover:border-gold-400/40 hover:bg-gold-400/5" title={p.description}>
                <StickFigure skeleton={p.skeleton} className="h-24 w-full" />
                <div className="mt-1 text-[11px] font-semibold leading-tight text-stone-200">{p.name}</div>
                <div className="text-[10px]" style={{ color: CATEGORY_INFO[p.category].color }}>
                  {CATEGORY_INFO[p.category].en}
                </div>
              </button>
            ))}
          </div>
        </Panel>
      </div>

      <Panel className="mt-5 p-5">
        <SectionTitle
          id="Urutan & Waktu"
          en="Sequence & timing — expected time (s from start) and hold duration of each key movement"
          icon={<Timer className="h-4 w-4" />}
          right={
            <div className="flex flex-wrap gap-2">
              <Button variant="ghost" onClick={sortByTime} disabled={steps.length < 2}>
                Sort by time
              </Button>
              <Button variant="ghost" onClick={spaceEvenly} disabled={steps.length < 2}>
                Space evenly
              </Button>
              <Button variant="ghost" onClick={() => setSteps([])} disabled={!steps.length}>
                <Trash2 className="h-4 w-4" /> Clear
              </Button>
            </div>
          }
        />
        {outOfOrder && <p className="mb-3 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-200">Times are not increasing — steps will be sorted by time when saved.</p>}
        {steps.length === 0 ? (
          <div className="grid place-items-center rounded-xl border border-dashed border-white/10 py-12 text-center text-sm text-stone-500">
            <Plus className="mb-2 h-6 w-6" />
            Record a demonstration or add movements from the library.
          </div>
        ) : (
          <div className="space-y-2">
            {steps.map((s, i) => (
              <div key={s.uid} className="flex flex-wrap items-center gap-3 rounded-xl border border-white/5 bg-white/[0.02] p-2">
                <span className="w-6 text-center font-display text-lg text-stone-500">{i + 1}</span>
                <StickFigure skeleton={s.pose.skeleton} className="h-14 w-11" showGround={false} strokeWidth={0.07} />
                <div className="min-w-[180px] flex-1">
                  <input
                    value={s.label ?? s.pose.name}
                    onChange={(e) => update(i, { label: e.target.value })}
                    className="w-full rounded-md border border-transparent bg-transparent px-1.5 py-1 text-sm font-semibold text-stone-100 outline-none hover:border-white/10 focus:border-gold-400/40"
                  />
                  <Badge className="ml-1.5" color={CATEGORY_INFO[s.pose.category].color}>
                    {CATEGORY_INFO[s.pose.category].label}
                  </Badge>
                </div>
                <label className="flex items-center gap-1.5 text-xs text-stone-400">
                  at
                  <input type="number" step={0.1} min={0} value={s.t} onChange={(e) => update(i, { t: Number(e.target.value) })} className="w-20 rounded-md border border-white/10 bg-ink-950 px-2 py-1 text-sm text-stone-100" />s
                </label>
                <label className="flex items-center gap-1.5 text-xs text-stone-400">
                  hold
                  <input type="number" step={0.1} min={0.2} value={s.hold} onChange={(e) => update(i, { hold: Math.max(0.2, Number(e.target.value)) })} className="w-16 rounded-md border border-white/10 bg-ink-950 px-2 py-1 text-sm text-stone-100" />s
                </label>
                <div className="flex gap-1">
                  <Button variant="ghost" className="px-2 py-1.5" onClick={() => move(i, -1)} disabled={i === 0}>
                    <ArrowUp className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" className="px-2 py-1.5" onClick={() => move(i, 1)} disabled={i === steps.length - 1}>
                    <ArrowDown className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" className="px-2 py-1.5 hover:text-red-300" onClick={() => remove(i)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}
