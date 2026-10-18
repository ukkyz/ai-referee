'use client';

import { useEffect, useRef, useState } from 'react';
import {
  Activity,
  ArrowLeft,
  Camera,
  Check,
  CircleDot,
  Keyboard,
  LoaderCircle,
  Play,
  RotateCcw,
  ScanLine,
  Sparkles,
  Square,
  Timer,
  TriangleAlert,
  Upload,
  X,
} from 'lucide-react';
import type { FrameSample, Jurus, RefereeSettings, Report } from '../types';
import { usePoseEngine } from '../hooks/usePoseEngine';
import { LiveTracker, type LiveSnapshot, type StepStatus } from '../lib/scoring/liveTracker';
import { analyzePerformance } from '../lib/scoring/engine';
import { DEMO_PROFILES, simulatePerformance, type DemoSkill } from '../lib/scoring/simulate';
import { liveFeatureScores } from '../lib/pose/similarity';
import { BONE_FEATURES, bodyInFrame, type FrameCheck } from '../lib/pose/landmarks';
import { MODEL_INFO } from '../lib/pose/detector';
import { torsoLength } from '../lib/pose/features';
import { playBeep, playDing, playGong } from '../lib/audio';
import { fmtTime, len, sleep, sub } from '../lib/math';
import StickFigure from '../components/StickFigure';
import { Badge, Button, Kbd, Panel, PoseViewport, scoreColor } from '../components/ui';
import { Sparkline } from '../components/charts';
import { CATEGORY_INFO } from '../data/poses';
import { cn } from '../utils/cn';

type Phase = 'setup' | 'countdown' | 'live' | 'analyzing';

interface Props {
  jurus: Jurus;
  settings: RefereeSettings;
  onFinish: (r: Report) => void;
  onBack: () => void;
}

export const LEVEL_COLOR: Record<string, string> = { Pemula: '#34d399', Menengah: '#fbbf24', Mahir: '#f87171' };

function StatusIcon({ st }: { st: StepStatus }) {
  if (st === 'matched') return <Check className="h-4 w-4 text-emerald-400" />;
  if (st === 'missed') return <X className="h-4 w-4 text-red-400" />;
  if (st === 'active') return <CircleDot className="h-4 w-4 animate-pulse text-gold-300" />;
  return <span className="mx-1 h-2 w-2 rounded-full bg-stone-600" />;
}

export default function Arena({ jurus, settings, onFinish, onBack }: Props) {
  const engine = usePoseEngine(settings.model);
  const { onFrameRef, boneColorRef, sourceRef, lastFrameRef, videoRef } = engine;
  const [phase, setPhase] = useState<Phase>('setup');
  const phaseRef = useRef<Phase>('setup');
  const [countdown, setCountdown] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [snap, setSnap] = useState<LiveSnapshot | null>(null);
  const [check, setCheck] = useState<FrameCheck>({ ok: false, issue: 'No performer detected' });
  const [liveSim, setLiveSim] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [rate, setRate] = useState(1);
  const [motionHist, setMotionHist] = useState<number[]>([]);
  const [frameCount, setFrameCount] = useState(0);

  const framesRef = useRef<FrameSample[]>([]);
  const trackerRef = useRef<LiveTracker | null>(null);
  const startRef = useRef({ perf: 0, media: 0 });
  const prevFrameRef = useRef<{ now: number; media: number } | null>(null);
  const lastSkRef = useRef<FrameSample['skeleton'] | null>(null);
  const motionRef = useRef<number[]>([]);
  const boneColorsRef = useRef<Record<string, string>>({});
  const simRef = useRef(0);
  const prevMatchedRef = useRef(0);
  const cancelRef = useRef(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const finishRef = useRef<() => void>(() => {});

  const setPhaseBoth = (p: Phase) => {
    phaseRef.current = p;
    setPhase(p);
  };

  const currentElapsed = () => {
    if (sourceRef.current === 'video') {
      const v = videoRef.current;
      return v ? v.currentTime - startRef.current.media : 0;
    }
    return performance.now() / 1000 - startRef.current.perf;
  };

  // ---- per-frame processing ----
  useEffect(() => {
    onFrameRef.current = (f) => {
      if (!f) {
        boneColorsRef.current = {};
        simRef.current = 0;
        return;
      }
      const ph = phaseRef.current;
      const idx = ph === 'live' && trackerRef.current ? trackerRef.current.index : 0;
      const step = jurus.steps[Math.min(idx, jurus.steps.length - 1)];
      const { scores, match } = liveFeatureScores(f.features, step.pose, settings.strictness, settings.allowMirror);
      const colors: Record<string, string> = {};
      for (const [bone, keys] of Object.entries(BONE_FEATURES)) {
        const s = Math.min(...keys.map((k) => scores[k]));
        colors[bone] = s >= 0.8 ? '#34d399' : s >= 0.5 ? '#fbbf24' : '#f87171';
      }
      boneColorsRef.current = colors;
      simRef.current = match.score;

      // live motion energy (end-effector speed, torso-normalised)
      const tl = torsoLength(f.skeleton);
      const sk = f.skeleton;
      const prev = prevFrameRef.current;
      const isVideo = sourceRef.current === 'video';
      if (prev) {
        const dt = Math.max(isVideo ? f.mediaTime - prev.media : f.now - prev.now, 1 / 120);
        const cur = [sk.lWrist, sk.rWrist, sk.lAnkle, sk.rAnkle];
        const lastSk = lastSkRef.current;
        if (lastSk) {
          const old = [lastSk.lWrist, lastSk.rWrist, lastSk.lAnkle, lastSk.rAnkle];
          const sp = cur.reduce((s, p, i) => s + len(sub(p, old[i])), 0) / 4 / dt / tl;
          motionRef.current.push(Math.min(sp, 12));
          if (motionRef.current.length > 90) motionRef.current.shift();
        }
      }
      lastSkRef.current = sk;
      prevFrameRef.current = { now: f.now, media: f.mediaTime };

      if (ph === 'live') {
        const t = isVideo ? f.mediaTime - startRef.current.media : f.now - startRef.current.perf;
        if (t >= 0) {
          framesRef.current.push({ t, features: f.features, skeleton: f.skeleton, visibility: f.visibility });
          trackerRef.current?.update(f.features, t);
        }
      }
    };
    boneColorRef.current = (a, b) => boneColorsRef.current[`${a}-${b}`] ?? null;
    return () => {
      onFrameRef.current = null;
      boneColorRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jurus, settings]);

  // ---- UI refresh loop (10 Hz) ----
  useEffect(() => {
    const id = setInterval(() => {
      setCheck(bodyInFrame(lastFrameRef.current?.lm));
      setLiveSim(simRef.current);
      setMotionHist([...motionRef.current]);
      if (phaseRef.current === 'live') {
        const t = currentElapsed();
        setElapsed(t);
        setFrameCount(framesRef.current.length);
        const tr = trackerRef.current;
        if (tr) {
          const s = tr.snapshot();
          if (s.matchedCount > prevMatchedRef.current && settings.sound) playDing();
          prevMatchedRef.current = s.matchedCount;
          setSnap(s);
          if (settings.autoStop && s.done && s.lastMatchedT !== null) {
            const last = jurus.steps[jurus.steps.length - 1];
            if (t >= s.lastMatchedT + Math.max(0.6, last.hold * 0.6)) finishRef.current();
          }
        }
        if (t > jurus.targetDuration + 60) finishRef.current();
      }
    }, 100);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jurus, settings]);

  // ---- keep active step visible ----
  const idx = phase === 'live' && snap ? snap.index : 0;
  useEffect(() => {
    const list = listRef.current;
    const el = list?.querySelector<HTMLElement>(`[data-idx="${idx}"]`);
    if (list && el) list.scrollTo({ top: el.offsetTop - list.clientHeight / 2 + el.clientHeight / 2, behavior: 'smooth' });
  }, [idx]);

  const begin = async () => {
    if (!engine.source || phaseRef.current !== 'setup' || engine.modelStatus !== 'ready') return;
    const v = videoRef.current;
    if (!v) return;
    setError(null);
    framesRef.current = [];
    trackerRef.current = new LiveTracker(jurus, settings);
    prevMatchedRef.current = 0;
    setSnap(trackerRef.current.snapshot());
    setElapsed(0);
    setFrameCount(0);
    cancelRef.current = false;
    if (engine.source === 'camera') {
      setPhaseBoth('countdown');
      for (let i = 3; i >= 1; i--) {
        setCountdown(i);
        if (settings.sound) playBeep(i === 1 ? 990 : 660, 0.16);
        await sleep(1000);
        if (cancelRef.current) {
          setPhaseBoth('setup');
          return;
        }
      }
      setCountdown(0);
    } else {
      if (v.ended || v.currentTime >= v.duration - 0.25) v.currentTime = 0;
      v.playbackRate = rate;
      try {
        await v.play();
      } catch {
        setError('Could not start video playback.');
        return;
      }
    }
    if (settings.sound) playGong();
    startRef.current = { perf: performance.now() / 1000, media: v.currentTime };
    setPhaseBoth('live');
  };

  const finish = () => {
    if (phaseRef.current !== 'live') return;
    const duration = currentElapsed();
    setPhaseBoth('analyzing');
    const v = videoRef.current;
    if (sourceRef.current === 'video' && v) v.pause();
    if (settings.sound) playGong();
    const frames = framesRef.current;
    const src = sourceRef.current ?? 'camera';
    setTimeout(() => {
      try {
        const report = analyzePerformance({ frames, jurus, settings, duration, source: src });
        onFinish(report);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setPhaseBoth('setup');
      }
    }, 80);
  };
  finishRef.current = finish;

  const runDemo = (skill: DemoSkill) => {
    if (phaseRef.current !== 'setup') return;
    setError(null);
    setPhaseBoth('analyzing');
    setTimeout(() => {
      try {
        const { frames, duration } = simulatePerformance(jurus, skill);
        setFrameCount(frames.length);
        const report = analyzePerformance({ frames, jurus, settings, duration, source: 'demo' });
        onFinish(report);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setPhaseBoth('setup');
      }
    }, 60);
  };

  const cancel = () => {
    cancelRef.current = true;
    if (phaseRef.current === 'live') {
      const v = videoRef.current;
      if (sourceRef.current === 'video' && v) v.pause();
      framesRef.current = [];
      setSnap(null);
      setElapsed(0);
      setPhaseBoth('setup');
    }
  };

  // video end => finish
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onEnded = () => finishRef.current();
    v.addEventListener('ended', onEnded);
    return () => v.removeEventListener('ended', onEnded);
  }, [videoRef]);

  // keyboard shortcuts
  const beginRef = useRef(begin);
  beginRef.current = begin;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'SELECT') return;
      if (e.code === 'Space') {
        e.preventDefault();
        if (phaseRef.current === 'setup') void beginRef.current();
        else if (phaseRef.current === 'live') finishRef.current();
      } else if (e.code === 'Escape') {
        cancelRef.current = true;
        if (phaseRef.current === 'live') {
          framesRef.current = [];
          setPhaseBoth('setup');
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const currentStep = jurus.steps[Math.min(idx, jurus.steps.length - 1)];
  const nextStep = phase === 'live' ? jurus.steps[idx + 1] : jurus.steps[1];
  const sim = phase === 'live' && snap ? snap.current : liveSim;
  const cat = CATEGORY_INFO[currentStep.pose.category];
  const inTol = Math.abs(elapsed - jurus.targetDuration) <= jurus.tolerance;
  const timeColor = phase !== 'live' ? 'text-stone-200' : inTol ? 'text-emerald-300' : elapsed > jurus.targetDuration ? 'text-red-400' : 'text-gold-100';
  const progress = Math.min(1, elapsed / Math.max(1, jurus.targetDuration));

  return (
    <div className="mx-auto max-w-[1400px] px-4 pb-16 pt-6 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Button variant="ghost" onClick={onBack} disabled={phase === 'analyzing'}>
            <ArrowLeft className="h-4 w-4" /> Back
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <Badge color="#e5b53a">Seni Tunggal</Badge>
              <Badge color={LEVEL_COLOR[jurus.level]}>{jurus.level}</Badge>
              <span className="text-xs text-stone-500">{jurus.steps.length} key movements</span>
            </div>
            <h1 className="mt-1 font-display text-2xl uppercase tracking-wide text-gold-100 sm:text-3xl">
              {jurus.name} <span className="text-lg normal-case text-stone-400">· {jurus.subtitle}</span>
            </h1>
          </div>
        </div>
        <div className="flex items-center gap-5 rounded-2xl border border-gold-500/15 bg-ink-900/80 px-5 py-2.5">
          <div className="text-right">
            <div className="text-[10px] uppercase tracking-[0.2em] text-stone-500">Waktu · Time</div>
            <div className={cn('font-display text-4xl tabular-nums leading-tight', timeColor)}>{fmtTime(elapsed)}</div>
          </div>
          <div className="border-l border-white/10 pl-5 text-right">
            <div className="text-[10px] uppercase tracking-[0.2em] text-stone-500">Target</div>
            <div className="font-display text-2xl tabular-nums text-stone-300">
              {fmtTime(jurus.targetDuration, 0)} <span className="text-sm text-stone-500">±{jurus.tolerance}s</span>
            </div>
          </div>
        </div>
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/5">
        <div className={cn('h-full rounded-full transition-all', inTol ? 'bg-emerald-400' : elapsed > jurus.targetDuration ? 'bg-red-500' : 'bg-gold-400')} style={{ width: `${progress * 100}%` }} />
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <PoseViewport engine={engine} className="aspect-video w-full">
            {!engine.source && (
              <div className="bg-batik absolute inset-0 grid place-items-center">
                <div className="max-w-md px-6 text-center">
                  <ScanLine className="mx-auto h-12 w-12 text-gold-300" />
                  <h3 className="mt-3 font-display text-2xl uppercase text-gold-100">Prepare the gelanggang</h3>
                  <p className="mt-1 text-sm text-stone-400">
                    Use a live camera or upload a recorded performance. Stand 2.5–4 m away so your whole body — head to feet — stays in frame.
                  </p>
                  <div className="mt-5 flex flex-wrap justify-center gap-3">
                    <Button onClick={() => void engine.startCamera()}>
                      <Camera className="h-4 w-4" /> Live Camera
                    </Button>
                    <Button variant="outline" onClick={() => fileRef.current?.click()}>
                      <Upload className="h-4 w-4" /> Upload Video
                    </Button>
                  </div>
                  {engine.sourceError && <p className="mt-3 text-sm text-red-300">{engine.sourceError}</p>}
                </div>
              </div>
            )}
            {engine.source && (
              <div className="absolute left-3 top-3 flex flex-wrap gap-2">
                {phase === 'live' && (
                  <span className="flex items-center gap-1.5 rounded-full bg-red-600/90 px-2.5 py-1 text-xs font-bold text-white">
                    <span className="h-2 w-2 animate-pulse rounded-full bg-white" /> REC
                  </span>
                )}
                <span className="rounded-full bg-black/60 px-2.5 py-1 text-xs text-stone-300">
                  {engine.fps} fps · {MODEL_INFO[settings.model].label}
                  {engine.source === 'video' && engine.videoName ? ` · ${engine.videoName}` : ''}
                </span>
              </div>
            )}
            {engine.source && (
              <div
                className={cn(
                  'absolute right-3 top-3 rounded-full px-3 py-1 text-xs font-semibold backdrop-blur',
                  check.ok ? 'bg-emerald-500/20 text-emerald-200 ring-1 ring-emerald-400/40' : 'bg-amber-500/25 text-amber-100 ring-1 ring-amber-400/40',
                )}
              >
                {check.ok ? '✓ Full body in frame' : check.issue}
              </div>
            )}
            {engine.modelStatus !== 'ready' && (
              <div className="absolute inset-x-0 top-1/2 mx-auto w-fit -translate-y-1/2 rounded-xl bg-black/75 px-5 py-3 text-center text-sm text-stone-200 backdrop-blur">
                {engine.modelStatus === 'loading' ? (
                  <span className="flex items-center gap-2">
                    <LoaderCircle className="h-4 w-4 animate-spin text-gold-300" /> Loading AI pose model ({MODEL_INFO[settings.model].size})…
                  </span>
                ) : (
                  <span className="text-red-300">Model failed to load: {engine.modelError}. Check your internet connection.</span>
                )}
              </div>
            )}
            {phase === 'countdown' && (
              <div className="absolute inset-0 grid place-items-center bg-black/40">
                <div key={countdown} className="animate-countdown font-display text-[150px] leading-none text-gold-200 drop-shadow-[0_0_30px_rgba(229,181,58,0.6)]">
                  {countdown}
                </div>
              </div>
            )}
            {phase === 'analyzing' && (
              <div className="absolute inset-0 grid place-items-center bg-black/75 backdrop-blur-sm">
                <div className="text-center">
                  <LoaderCircle className="mx-auto h-10 w-10 animate-spin text-gold-300" />
                  <p className="mt-3 font-display text-2xl uppercase text-gold-100">Dewan Juri menilai…</p>
                  <p className="text-sm text-stone-400">Aligning {frameCount} frames against {jurus.steps.length} key movements</p>
                </div>
              </div>
            )}
            {engine.source && (phase === 'live' || phase === 'setup') && (
              <div className="pointer-events-none absolute inset-x-3 bottom-3 flex items-end justify-between gap-3">
                <div className="rounded-xl bg-black/70 px-4 py-2.5 backdrop-blur">
                  <div className="text-[10px] uppercase tracking-widest text-stone-400">
                    {phase === 'live' ? `Gerakan ${idx + 1} / ${jurus.steps.length}` : 'Get into the starting position'}
                  </div>
                  <div className="font-display text-xl text-gold-100">{currentStep.label ?? currentStep.pose.name}</div>
                  <div className="mt-1.5 h-1.5 w-56 overflow-hidden rounded-full bg-white/10">
                    <div className="h-full rounded-full transition-all" style={{ width: `${sim * 100}%`, background: scoreColor(sim) }} />
                  </div>
                </div>
                <div className="rounded-xl bg-black/70 px-3 py-2 text-center backdrop-blur">
                  <div className="font-display text-3xl tabular-nums" style={{ color: scoreColor(sim) }}>
                    {Math.round(sim * 100)}%
                  </div>
                  <div className="text-[10px] uppercase tracking-wider text-stone-400">match</div>
                </div>
              </div>
            )}
          </PoseViewport>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            {phase === 'setup' && (
              <>
                <Button onClick={() => void begin()} disabled={!engine.source || engine.modelStatus !== 'ready'} className="px-6">
                  <Play className="h-4 w-4" /> {engine.source === 'video' ? 'Judge this video' : 'Mulai · Start'}
                </Button>
                {engine.source && (
                  <>
                    <Button variant="ghost" onClick={() => void engine.startCamera()}>
                      <Camera className="h-4 w-4" /> Camera
                    </Button>
                    <Button variant="ghost" onClick={() => fileRef.current?.click()}>
                      <Upload className="h-4 w-4" /> Video
                    </Button>
                  </>
                )}
                {engine.source === 'video' && (
                  <>
                    <Button
                      variant="ghost"
                      onClick={() => {
                        if (videoRef.current) videoRef.current.currentTime = 0;
                      }}
                    >
                      <RotateCcw className="h-4 w-4" /> Rewind
                    </Button>
                    <label className="flex items-center gap-2 text-sm text-stone-300">
                      Analysis speed
                      <select value={rate} onChange={(e) => setRate(Number(e.target.value))} className="rounded-lg border border-white/10 bg-ink-900 px-2 py-1.5 text-sm">
                        <option value={1}>1× realtime</option>
                        <option value={0.5}>0.5× precision</option>
                        <option value={0.25}>0.25× max precision</option>
                      </select>
                    </label>
                  </>
                )}
              </>
            )}
            {phase === 'countdown' && (
              <Button variant="ghost" onClick={cancel}>
                <X className="h-4 w-4" /> Cancel
              </Button>
            )}
            {phase === 'live' && (
              <>
                <Button variant="danger" onClick={finish} className="px-6">
                  <Square className="h-4 w-4" /> Selesai · Finish
                </Button>
                <Button variant="ghost" onClick={cancel}>
                  <X className="h-4 w-4" /> Abort
                </Button>
              </>
            )}
            <div className="ml-auto hidden items-center gap-2 text-xs text-stone-500 md:flex">
              <Keyboard className="h-4 w-4" /> <Kbd>Space</Kbd> start / finish <Kbd>Esc</Kbd> abort
            </div>
          </div>
          {error && (
            <div className="mt-3 flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" /> {error}
            </div>
          )}
          {phase === 'setup' && (
            <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-gold-500/15 bg-gold-400/[0.04] p-3">
              <Sparkles className="h-4 w-4 shrink-0 text-gold-300" />
              <div className="mr-auto text-sm">
                <span className="font-semibold text-gold-200">No camera handy?</span>{' '}
                <span className="text-stone-400">Let a simulated performer execute this jurus and see the full verdict.</span>
              </div>
              {(Object.keys(DEMO_PROFILES) as DemoSkill[]).map((k) => (
                <Button key={k} variant="outline" className="px-3 py-1.5" onClick={() => runDemo(k)}>
                  {DEMO_PROFILES[k].label} <span className="text-xs font-normal text-stone-400">{DEMO_PROFILES[k].en}</span>
                </Button>
              ))}
            </div>
          )}
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
          <div className="mt-4 grid gap-3 text-xs text-stone-400 sm:grid-cols-3">
            <div className="rounded-xl border border-white/5 bg-white/[0.02] p-3">
              <span className="font-semibold text-emerald-300">Green</span> limbs match the expected movement, <span className="font-semibold text-amber-300">amber</span> are close,{' '}
              <span className="font-semibold text-red-300">red</span> need correction.
            </div>
            <div className="rounded-xl border border-white/5 bg-white/[0.02] p-3">The gong starts the timer. Finish with the closing salute — the referee auto-stops when it is recognised.</div>
            <div className="rounded-xl border border-white/5 bg-white/[0.02] p-3">Live tracking is indicative only; the final verdict re-aligns the entire recorded sequence.</div>
          </div>
        </div>

        <div className="space-y-5">
          <Panel className="p-4" glow>
            <div className="flex items-start gap-4">
              <div className="w-32 shrink-0 rounded-xl bg-black/40 p-1">
                <StickFigure skeleton={currentStep.pose.skeleton} className="h-40 w-full" />
              </div>
              <div className="min-w-0">
                <Badge color={cat.color}>
                  {cat.label} · {cat.en}
                </Badge>
                <h3 className="mt-1.5 font-display text-xl leading-tight text-gold-100">{currentStep.label ?? currentStep.pose.name}</h3>
                <p className="text-xs text-stone-400">{currentStep.pose.nameEn}</p>
                <p className="mt-2 text-sm text-stone-300">{currentStep.pose.cue}</p>
                <div className="mt-2 flex flex-wrap gap-3 text-xs text-stone-400">
                  <span className="flex items-center gap-1">
                    <Timer className="h-3.5 w-3.5" /> at {fmtTime(currentStep.t)}
                  </span>
                  <span>hold {currentStep.hold}s</span>
                </div>
              </div>
            </div>
            {phase === 'live' && snap && (
              <div className="mt-3">
                <div className="mb-1 flex justify-between text-[11px] uppercase tracking-wider text-stone-500">
                  <span>Hold to confirm</span>
                  <span>{Math.round(snap.holdProgress * 100)}%</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
                  <div className="h-full rounded-full bg-gold-300 transition-all" style={{ width: `${snap.holdProgress * 100}%` }} />
                </div>
              </div>
            )}
            {nextStep && (
              <div className="mt-3 flex items-center gap-3 rounded-xl bg-white/[0.03] p-2">
                <StickFigure skeleton={nextStep.pose.skeleton} className="h-14 w-12" showGround={false} />
                <div className="min-w-0">
                  <div className="text-[10px] uppercase tracking-widest text-stone-500">Next</div>
                  <div className="truncate text-sm text-stone-200">{nextStep.label ?? nextStep.pose.name}</div>
                </div>
                <div className="ml-auto text-xs tabular-nums text-stone-500">{fmtTime(nextStep.t)}</div>
              </div>
            )}
          </Panel>

          <Panel className="p-4">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="font-display text-base uppercase tracking-wide text-gold-200">Urutan Gerakan</h3>
              <span className="text-xs text-stone-400">
                {snap?.matchedCount ?? 0} / {jurus.steps.length} recognised
              </span>
            </div>
            <ol ref={listRef} className="relative max-h-[330px] space-y-1 overflow-y-auto pr-1">
              {jurus.steps.map((s, i) => {
                const st: StepStatus = snap?.statuses[i] ?? (i === 0 ? 'active' : 'pending');
                return (
                  <li
                    key={s.uid + i}
                    data-idx={i}
                    className={cn(
                      'flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm',
                      st === 'active' && 'bg-gold-400/10 ring-1 ring-gold-400/30',
                      st === 'matched' && 'text-stone-300',
                      st === 'missed' && 'text-red-300/80',
                      st === 'pending' && 'text-stone-400',
                    )}
                  >
                    <span className="grid w-5 place-items-center">
                      <StatusIcon st={st} />
                    </span>
                    <span className="w-5 text-xs tabular-nums text-stone-500">{i + 1}</span>
                    <span className="flex-1 truncate">{s.label ?? s.pose.name}</span>
                    {snap && snap.best[i] > 0 && <span className="text-[11px] tabular-nums text-stone-500">{Math.round(snap.best[i] * 100)}%</span>}
                    <span className="w-10 text-right text-xs tabular-nums text-stone-500">{fmtTime(s.t, 0)}</span>
                  </li>
                );
              })}
            </ol>
          </Panel>

          <Panel className="p-4">
            <div className="flex items-center justify-between">
              <h3 className="flex items-center gap-2 font-display text-base uppercase tracking-wide text-gold-200">
                <Activity className="h-4 w-4" /> Tenaga · Motion
              </h3>
              <span className="text-xs text-stone-500">{frameCount} frames recorded</span>
            </div>
            <div className="mt-2">
              <Sparkline values={motionHist} color="#ef4444" max={8} />
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-stone-500">
              Explosive peaks between still, firm finishing positions show strong tenaga and kemantapan. Uniform motion lowers the penghayatan score.
            </p>
          </Panel>
        </div>
      </div>
    </div>
  );
}
