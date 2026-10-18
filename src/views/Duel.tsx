'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ArrowDownToLine,
  ArrowLeftRight,
  Camera,
  Check,
  Download,
  FileUp,
  Footprints,
  Hand,
  Keyboard,
  Lock,
  Pause,
  Play,
  Shield,
  Sparkles,
  Square,
  Swords,
  Timer,
  Trash2,
  TriangleAlert,
  Trophy,
  Upload,
  Video,
  X,
} from 'lucide-react';
import {
  CORNERS,
  DUEL_TECHNIQUES,
  type Corner,
  type DuelConfig,
  type DuelEvent,
  type DuelReport,
  type DuelSource,
  type DuelTechnique,
  type RefereeSettings,
  type TargetZone,
} from '../types';
import { useDuelEngine } from '../hooks/useDuelEngine';
import { listCameras, useRigEngine, type CameraAssignment } from '../hooks/useRigEngine';
import { DuelEventDetector, type DuelSnapshot } from '../lib/duel/fightDetector';
import { DemoFight, DEMO_ASPECT } from '../lib/duel/simulate';
import { CORNER_COLORS, CORNER_DEEP, drawDuelFighters } from '../lib/duel/draw';
import {
  FAIL_INFO,
  PENALTY_LADDER,
  STATUS_INFO,
  TECHNIQUE_INFO,
  ZONE_INFO,
  applyPenaltyLadder,
  computeDuelStats,
  makeEvent,
  suksesCounts,
  withStatus,
} from '../lib/duel/rules';
import { defaultDemoRig, validateRigProfile, type RigProfile } from '../lib/duel/rig/calibration';
import { clearRigProfile, downloadJSON, fetchRigProfile, persistRigProfile } from '../lib/storage';
import { playBeep, playDing, playGong } from '../lib/audio';
import { fmtTime, uid } from '../lib/math';
import { Badge, Button, Kbd, Panel, SectionTitle } from '../components/ui';
import { cn } from '../utils/cn';

interface Props {
  settings: RefereeSettings;
  duels: DuelReport[];
  onFinish: (r: DuelReport) => void;
  onOpen: (r: DuelReport) => void;
  onDelete: (id: string) => void;
}

type OutcomeSel = 'sah' | 'ditangkis' | 'meleset' | 'ilegal';

const fmtClock = (s: number) => fmtTime(Math.max(0, Math.ceil(s)), 0);

const TECH_ICON: Record<DuelTechnique, ReactNode> = {
  pukulan: <Hand className="h-4 w-4" />,
  tendangan: <Footprints className="h-4 w-4" />,
  jatuhan: <ArrowDownToLine className="h-4 w-4" />,
  kuncian: <Lock className="h-4 w-4" />,
};

const FORMATS = [
  { id: 'ipsi', label: 'IPSI · 3 babak × 2:00', rounds: 3, roundSeconds: 120, restSeconds: 60 },
  { id: 'latihan', label: 'Latihan · 2 babak × 1:00', rounds: 2, roundSeconds: 60, restSeconds: 30 },
  { id: 'kilat', label: 'Kilat · 1 babak × 1:00', rounds: 1, roundSeconds: 60, restSeconds: 0 },
];

const MANUAL_KEYS: Record<Corner, Record<DuelTechnique | 'ilegal', string>> = {
  merah: { pukulan: 'Q', tendangan: 'W', jatuhan: 'E', kuncian: 'R', ilegal: 'F' },
  biru: { pukulan: 'U', tendangan: 'I', jatuhan: 'O', kuncian: 'P', ilegal: 'J' },
};

const inputCls =
  'w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-stone-100 outline-none transition focus:border-gold-400/50';
const labelCls = 'mb-1 block text-[11px] font-semibold uppercase tracking-wider text-stone-500';

interface ClockMachine {
  started: boolean;
  running: boolean;
  seg: 'fight' | 'rest';
  round: number;
  segStartPerf: number;
  segElapsedBase: number;
  segDuration: number;
  fightBase: number;
}

const freshClock = (): ClockMachine => ({
  started: false,
  running: false,
  seg: 'fight',
  round: 1,
  segStartPerf: 0,
  segElapsedBase: 0,
  segDuration: 0,
  fightBase: 0,
});

export default function Duel({ settings, duels, onFinish, onOpen, onDelete }: Props) {
  const engine = useDuelEngine(settings.model);

  /* ------------------------------------------------------------ setup state */
  const [phase, setPhase] = useState<'setup' | 'live'>('setup');
  const [attempt, setAttempt] = useState(0);
  const [merahName, setMerahName] = useState('Pesilat Merah');
  const [biruName, setBiruName] = useState('Pesilat Biru');
  const [merahTeam, setMerahTeam] = useState('');
  const [biruTeam, setBiruTeam] = useState('');
  const [kelas, setKelas] = useState('');
  const [rounds, setRounds] = useState(3);
  const [roundSeconds, setRoundSeconds] = useState(120);
  const [restSeconds, setRestSeconds] = useState(60);
  const [sourceMode, setSourceMode] = useState<DuelSource>('camera');
  const [aiConfirm, setAiConfirm] = useState(false);
  const [videoFile, setVideoFile] = useState<File | null>(null);

  /* -------------------------------------------------------------- rig state */
  const [rigProfile, setRigProfile] = useState<RigProfile | null>(null);
  const rig = useRigEngine(settings.model, rigProfile);
  const [rigDevices, setRigDevices] = useState<{ deviceId: string; label: string }[]>([]);
  const [rigAssign, setRigAssign] = useState<Record<string, string>>({});
  const [rigFps, setRigFps] = useState(60);
  const [rigMsg, setRigMsg] = useState<string | null>(null);
  const rigFileRef = useRef<HTMLInputElement>(null);
  const videoFileRef2 = useRef<HTMLInputElement>(null);

  /* ------------------------------------------------------------- live state */
  const [matchConfig, setMatchConfig] = useState<DuelConfig | null>(null);
  const [events, setEventsState] = useState<DuelEvent[]>([]);
  const [pending, setPending] = useState<DuelEvent[]>([]);
  const [zoneSel, setZoneSel] = useState<TargetZone>('dada');
  const [outcomeSel, setOutcomeSel] = useState<OutcomeSel>('sah');
  const [clockView, setClockView] = useState({ started: false, running: false, seg: 'fight' as 'fight' | 'rest', round: 1, timeLeft: 0, fightElapsed: 0 });
  const [snap, setSnap] = useState<DuelSnapshot>({ distanceNorm: null, clinch: { active: false, owner: null, heldSeconds: 0, established: false, tooLong: false }, downed: [false, false] });

  const detectorRef = useRef<DuelEventDetector | null>(null);
  const clockRef = useRef<ClockMachine>(freshClock());
  const eventsRef = useRef<DuelEvent[]>([]);
  const matchConfigRef = useRef<DuelConfig | null>(null);
  const sourceModeRef = useRef<DuelSource>('camera');
  const aiConfirmRef = useRef(false);
  const soundRef = useRef(settings.sound);
  const videoFileRef = useRef<File | null>(null);
  const assignmentsRef = useRef<CameraAssignment[]>([]);
  const demoRef = useRef<DemoFight | null>(null);
  const demoCanvasRef = useRef<HTMLCanvasElement>(null);
  const finishedRef = useRef(false);
  const visRef = useRef({ sum: 0, n: 0 });

  soundRef.current = settings.sound;
  sourceModeRef.current = sourceMode;
  aiConfirmRef.current = aiConfirm;

  const names: Record<Corner, string> = {
    merah: matchConfig?.merah.name ?? merahName,
    biru: matchConfig?.biru.name ?? biruName,
  };

  useEffect(() => {
    const label = { merah: (matchConfig?.merah.name ?? merahName).toUpperCase(), biru: (matchConfig?.biru.name ?? biruName).toUpperCase() };
    engine.labelsRef.current = label;
    rig.labelsRef.current = label;
  }, [engine.labelsRef, rig.labelsRef, matchConfig, merahName, biruName]);

  useEffect(() => {
    fetchRigProfile()
      .then((r) => {
        if (r.profile) {
          setRigProfile(r.profile);
          setRigFps(r.profile.targetFps >= 100 ? 120 : 60);
        }
      })
      .catch(() => undefined);
  }, []);

  /* ----------------------------------------------------------------- clock */
  const segElapsedNow = () => {
    const c = clockRef.current;
    return c.segElapsedBase + (c.running ? (performance.now() - c.segStartPerf) / 1000 : 0);
  };
  const fightElapsedNow = () => {
    const c = clockRef.current;
    return c.seg === 'fight' ? c.fightBase + segElapsedNow() : c.fightBase;
  };
  const canFeed = () => clockRef.current.started && clockRef.current.running && clockRef.current.seg === 'fight';

  const cue = (e: DuelEvent) => {
    if (!soundRef.current) return;
    if (e.status === 'sah') playDing();
    else if (e.status === 'ilegal') playBeep(220, 0.18, 0.3);
  };

  const commitEvents = (next: DuelEvent[]) => {
    eventsRef.current = next;
    setEventsState(next);
  };

  const addDetected = (incoming: DuelEvent[]) => {
    if (!incoming.length) return;
    if (aiConfirmRef.current) {
      setPending((prev) => [...prev, ...incoming]);
    } else {
      commitEvents([...eventsRef.current, ...incoming]);
      incoming.forEach(cue);
    }
  };

  /* -------------------------------------------------------------- frame IO */
  useEffect(() => {
    engine.onFrameRef.current = (f) => {
      if (!canFeed() || !detectorRef.current) return;
      const t = sourceModeRef.current === 'video' ? f.mediaTime : fightElapsedNow();
      const evs = detectorRef.current.pushFrame(t, clockRef.current.round, f.fighters);
      addDetected(evs);
      const vis = f.fighters.filter(Boolean).map((x) => x!.visibility);
      if (vis.length) {
        visRef.current.sum += vis.reduce((a, b) => a + b, 0) / vis.length;
        visRef.current.n += 1;
      }
    };
    rig.onFrameRef.current = (f) => {
      if (!canFeed() || !detectorRef.current) return;
      const evs = detectorRef.current.pushFrame(fightElapsedNow(), clockRef.current.round, f.fighters);
      addDetected(evs);
      const vis = f.fighters.filter(Boolean).map((x) => x!.visibility);
      if (vis.length) {
        visRef.current.sum += vis.reduce((a, b) => a + b, 0) / vis.length;
        visRef.current.n += 1;
      }
    };
  }, [engine.onFrameRef, rig.onFrameRef]);

  /* ------------------------------------------------------- source lifecycle */
  useEffect(() => {
    if (phase !== 'live') return;
    const mode = sourceModeRef.current;
    if (mode === 'camera') void engine.startCamera();
    else if (mode === 'video' && videoFileRef.current) void engine.loadVideo(videoFileRef.current);
    else if (mode === 'rig') void rig.start(assignmentsRef.current, rigFps);
    return () => {
      engine.stopSource();
      rig.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, attempt]);

  // Video end -> finish.
  useEffect(() => {
    if (phase !== 'live' || sourceMode !== 'video') return;
    const v = engine.videoRef.current;
    if (!v) return;
    const onEnded = () => finishMatchRef.current?.();
    v.addEventListener('ended', onEnded);
    return () => v.removeEventListener('ended', onEnded);
  }, [phase, attempt, sourceMode, engine.videoRef, engine.source]);

  // Demo playback loop.
  useEffect(() => {
    if (phase !== 'live' || sourceMode !== 'demo') return;
    const cfg = matchConfigRef.current;
    if (!cfg) return;
    if (!demoRef.current) demoRef.current = new DemoFight(cfg.rounds * cfg.roundSeconds);
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const canvas = demoCanvasRef.current;
      const fight = demoRef.current;
      if (!canvas || !fight) return;
      const t = fightElapsedNow();
      const obs = fight.frameAt(Math.min(t, fight.duration));
      if (canFeed() && detectorRef.current) {
        addDetected(detectorRef.current.pushFrame(t, clockRef.current.round, obs));
      }
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const w = canvas.width;
      const h = canvas.height;
      const grad = ctx.createRadialGradient(w / 2, h * 0.35, 80, w / 2, h / 2, w * 0.75);
      grad.addColorStop(0, '#241a14');
      grad.addColorStop(1, '#0b0908');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = 'rgba(229,181,58,0.35)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.ellipse(w / 2, h * 0.8, w * 0.4, h * 0.16, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(w * 0.05, h * 0.88);
      ctx.lineTo(w * 0.95, h * 0.88);
      ctx.strokeStyle = 'rgba(255,255,255,0.12)';
      ctx.stroke();
      drawDuelFighters(ctx, w, h, DEMO_ASPECT, false, [
        { joints: obs[0].joints, color: CORNER_COLORS.merah, label: names.merah.toUpperCase() },
        { joints: obs[1].joints, color: CORNER_COLORS.biru, label: names.biru.toUpperCase() },
      ]);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, attempt, sourceMode]);

  // Snapshot ticker.
  useEffect(() => {
    if (phase !== 'live') return;
    const id = setInterval(() => {
      if (detectorRef.current) setSnap(detectorRef.current.getSnapshot());
    }, 300);
    return () => clearInterval(id);
  }, [phase, attempt]);

  /* ------------------------------------------------------------ transitions */
  const finishMatch = () => {
    if (finishedRef.current || !matchConfigRef.current) return;
    finishedRef.current = true;
    const cfg = matchConfigRef.current;
    const flushed = detectorRef.current?.flush(clockRef.current.round) ?? [];
    const all = applyPenaltyLadder([...eventsRef.current, ...flushed]).sort((a, b) => a.t - b.t);
    const duration = sourceModeRef.current === 'video' ? (engine.videoRef.current?.duration ?? fightElapsedNow()) : fightElapsedNow();
    const outcome = computeDuelStats(all, cfg, Math.max(1, duration));
    const report: DuelReport = {
      id: uid('duel-'),
      createdAt: Date.now(),
      config: cfg,
      source: sourceModeRef.current,
      duration: Math.round(duration * 10) / 10,
      roundsCompleted: clockRef.current.round,
      events: all,
      fighters: outcome.fighters,
      winner: outcome.winner,
      winBy: outcome.winBy,
      momentum: outcome.momentum,
      avgFps: sourceModeRef.current === 'demo' ? 60 : sourceModeRef.current === 'manual' ? 0 : engine.fps,
      visibility: visRef.current.n ? visRef.current.sum / visRef.current.n : 0,
    };
    if (soundRef.current) playGong();
    onFinish(report);
  };
  const finishMatchRef = useRef(finishMatch);
  finishMatchRef.current = finishMatch;

  const advanceSegment = () => {
    const c = clockRef.current;
    const cfg = matchConfigRef.current;
    if (!cfg) return;
    if (c.seg === 'fight') {
      c.fightBase += c.segDuration;
      if (c.round >= cfg.rounds) {
        c.running = false;
        finishMatchRef.current();
        return;
      }
      if (soundRef.current) playBeep(660, 0.15, 0.25);
      if (cfg.restSeconds > 0) {
        c.seg = 'rest';
        c.segDuration = cfg.restSeconds;
      } else {
        c.round += 1;
        c.seg = 'fight';
        c.segDuration = cfg.roundSeconds;
      }
    } else {
      c.round += 1;
      c.seg = 'fight';
      c.segDuration = cfg.roundSeconds;
      if (soundRef.current) playGong();
    }
    c.segElapsedBase = 0;
    c.segStartPerf = performance.now();
    c.running = true;
  };

  // Clock ticker.
  useEffect(() => {
    if (phase !== 'live') return;
    const id = setInterval(() => {
      const c = clockRef.current;
      if (c.started && c.running && segElapsedNow() >= c.segDuration && c.segDuration > 0 && sourceModeRef.current !== 'video') {
        advanceSegment();
      }
      setClockView({
        started: c.started,
        running: c.running,
        seg: c.seg,
        round: c.round,
        timeLeft: Math.max(0, c.segDuration - segElapsedNow()),
        fightElapsed: fightElapsedNow(),
      });
    }, 200);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, attempt]);

  /* -------------------------------------------------------------- handlers */
  const buildConfig = (): DuelConfig => ({
    merah: { name: merahName.trim() || 'Pesilat Merah', team: merahTeam.trim() || undefined },
    biru: { name: biruName.trim() || 'Pesilat Biru', team: biruTeam.trim() || undefined },
    kelas: kelas.trim() || undefined,
    rounds: sourceMode === 'video' ? 1 : Math.max(1, rounds),
    roundSeconds: sourceMode === 'video' ? 3600 : Math.max(10, roundSeconds),
    restSeconds: Math.max(0, restSeconds),
  });

  const startMatch = () => {
    const cfg = buildConfig();
    matchConfigRef.current = cfg;
    setMatchConfig(cfg);
    detectorRef.current = new DuelEventDetector();
    clockRef.current = freshClock();
    finishedRef.current = false;
    visRef.current = { sum: 0, n: 0 };
    demoRef.current = null;
    commitEvents([]);
    setPending([]);
    videoFileRef.current = videoFile;
    const slots = rigProfile?.cameras.map((c) => c.id) ?? ['cam-1', 'cam-2', 'cam-3'];
    assignmentsRef.current = slots
      .map((cameraId) => ({ cameraId, deviceId: rigAssign[cameraId] ?? '' }))
      .filter((a) => a.deviceId);
    setAttempt((n) => n + 1);
    setPhase('live');
  };

  const gongStart = () => {
    const cfg = matchConfigRef.current;
    if (!cfg) return;
    const c = clockRef.current;
    c.started = true;
    c.seg = 'fight';
    c.round = 1;
    c.segDuration = cfg.roundSeconds;
    c.segElapsedBase = 0;
    c.fightBase = 0;
    c.segStartPerf = performance.now();
    c.running = true;
    detectorRef.current?.reset();
    if (sourceModeRef.current === 'video') void engine.videoRef.current?.play();
    if (soundRef.current) playGong();
    setClockView({ started: true, running: true, seg: 'fight', round: 1, timeLeft: cfg.roundSeconds, fightElapsed: 0 });
  };

  const togglePause = () => {
    const c = clockRef.current;
    if (!c.started) return;
    if (c.running) {
      c.segElapsedBase = segElapsedNow();
      c.running = false;
      if (sourceModeRef.current === 'video') engine.videoRef.current?.pause();
    } else {
      c.segStartPerf = performance.now();
      c.running = true;
      if (sourceModeRef.current === 'video') void engine.videoRef.current?.play();
    }
    setClockView((v) => ({ ...v, running: c.running }));
  };

  const cancelMatch = () => {
    if (clockRef.current.started && !window.confirm('Batalkan pertandingan? Semua kejadian akan hilang.')) return;
    clockRef.current = freshClock();
    finishedRef.current = true;
    setPhase('setup');
  };

  const swapNow = () => {
    if (sourceModeRef.current === 'rig') rig.swapCorners();
    else engine.swapCorners();
    detectorRef.current?.reset();
  };

  /* ------------------------------------------------------------ manual pad */
  const manualAdd = (attacker: Corner, technique: DuelTechnique, forceIlegal = false) => {
    if (!clockRef.current.started) return;
    const outcome: OutcomeSel = forceIlegal ? 'ilegal' : outcomeSel;
    let zone: TargetZone = technique === 'jatuhan' || technique === 'kuncian' ? 'badan' : zoneSel;
    let status: DuelEvent['status'] = 'sah';
    let failReason: DuelEvent['failReason'];
    if (outcome === 'ilegal') {
      status = 'ilegal';
      if (ZONE_INFO[zone].legality !== 'ilegal') zone = 'kepala';
    } else if (outcome === 'ditangkis' || outcome === 'meleset') {
      status = 'gagal';
      failReason = technique === 'jatuhan' ? 'tidak-jatuh' : technique === 'kuncian' ? 'lepas' : outcome;
      if (outcome === 'meleset' && technique !== 'jatuhan' && technique !== 'kuncian') zone = 'tidak-kena';
    } else if (ZONE_INFO[zone].legality === 'ilegal') {
      status = 'ilegal';
    } else if (zone === 'kaki') {
      status = 'gagal';
      failReason = 'meleset';
    }
    const ev = makeEvent({
      t: fightElapsedNow(),
      round: clockRef.current.round,
      attacker,
      technique,
      status,
      zone,
      failReason,
      duration: technique === 'kuncian' && status === 'sah' ? 2 : undefined,
      confidence: 1,
      source: 'wasit',
    });
    commitEvents([...eventsRef.current, ev]);
    cue(ev);
  };
  const manualAddRef = useRef(manualAdd);
  manualAddRef.current = manualAdd;

  useEffect(() => {
    if (phase !== 'live') return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'SELECT') return;
      const k = e.key.toUpperCase();
      for (const corner of CORNERS) {
        const map = MANUAL_KEYS[corner];
        if (k === map.ilegal) manualAddRef.current(corner, 'pukulan', true);
        else {
          const tech = (Object.keys(map) as (DuelTechnique | 'ilegal')[]).find((t) => t !== 'ilegal' && map[t] === k) as DuelTechnique | undefined;
          if (tech) manualAddRef.current(corner, tech);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase]);

  const cycleStatus = (id: string) => {
    const order: DuelEvent['status'][] = ['sah', 'ilegal', 'gagal'];
    commitEvents(
      eventsRef.current.map((e) => {
        if (e.id !== id) return e;
        const next = order[(order.indexOf(e.status) + 1) % order.length];
        return withStatus(e, next);
      }),
    );
  };
  const deleteEvent = (id: string) => commitEvents(eventsRef.current.filter((e) => e.id !== id));
  const confirmPending = (id: string) => {
    const ev = pending.find((e) => e.id === id);
    if (!ev) return;
    setPending((prev) => prev.filter((e) => e.id !== id));
    commitEvents([...eventsRef.current, ev]);
    cue(ev);
  };
  const rejectPending = (id: string) => setPending((prev) => prev.filter((e) => e.id !== id));

  /* -------------------------------------------------------------- rig setup */
  const rigSlots = rigProfile?.cameras ?? [
    { id: 'cam-1', label: 'Kamera 1 (utama)' },
    { id: 'cam-2', label: 'Kamera 2' },
    { id: 'cam-3', label: 'Kamera 3' },
  ];

  const scanCameras = async () => {
    try {
      const list = await listCameras();
      setRigDevices(list);
      setRigMsg(list.length ? `${list.length} kamera ditemukan.` : 'Tidak ada kamera terdeteksi.');
    } catch (e) {
      setRigMsg(e instanceof Error ? e.message : 'Gagal memindai kamera (izin ditolak?).');
    }
  };

  const importRigFile = async (file: File) => {
    try {
      const parsed: unknown = JSON.parse(await file.text());
      const profile = validateRigProfile(parsed);
      if (!profile) {
        setRigMsg('Berkas kalibrasi tidak valid: butuh 2–6 kamera dengan intrinsics dan extrinsics 3×3 + 3.');
        return;
      }
      const saved = await persistRigProfile(profile);
      setRigProfile(saved);
      setRigFps(saved.targetFps >= 100 ? 120 : 60);
      setRigMsg(`Kalibrasi "${saved.name}" tersimpan di SQLite.`);
    } catch (e) {
      setRigMsg(e instanceof Error ? e.message : 'Gagal mengimpor kalibrasi.');
    }
  };

  const activateDemoRig = async () => {
    try {
      const saved = await persistRigProfile(defaultDemoRig());
      setRigProfile(saved);
      setRigFps(120);
      setRigMsg('Rig demo sintetis aktif — geometrinya hanya cocok untuk uji alur, bukan kamera nyata.');
    } catch (e) {
      setRigMsg(e instanceof Error ? e.message : 'Gagal menyimpan rig demo.');
    }
  };

  const removeRig = async () => {
    try {
      await clearRigProfile();
      setRigProfile(null);
      setRigMsg('Kalibrasi dihapus. Mode rig berjalan sebagai fallback 2D.');
    } catch {
      setRigMsg('Gagal menghapus kalibrasi.');
    }
  };

  /* ------------------------------------------------------------ derived UI */
  const displayConfig = matchConfig ?? buildConfig();
  const laddered = useMemo(() => applyPenaltyLadder(events), [events]);
  const stats = useMemo(
    () => computeDuelStats(events, displayConfig, Math.max(1, clockView.fightElapsed)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [events, clockView.fightElapsed >= 0 ? Math.floor(clockView.fightElapsed) : 0, matchConfig],
  );
  const gongReady =
    phase === 'live' &&
    !clockView.started &&
    (sourceMode === 'manual' ||
      sourceMode === 'demo' ||
      (sourceMode === 'camera' && engine.source === 'camera') ||
      (sourceMode === 'video' && engine.source === 'video') ||
      (sourceMode === 'rig' && rig.running));

  const canStart =
    sourceMode === 'video'
      ? videoFile !== null
      : sourceMode === 'rig'
        ? Object.values(rigAssign).filter(Boolean).length >= 1
        : true;

  /* ==================================================================== */
  /*  SETUP                                                                */
  /* ==================================================================== */
  if (phase === 'setup') {
    return (
      <div className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6">
        <SectionTitle
          id="Tanding"
          en="Duel / fight analysis — Merah vs Biru, AI + wasit"
          icon={<Swords className="h-4 w-4" />}
          right={<Badge color="#f0cf6a">Pukulan 1 · Tendangan 2 · Jatuhan 3 · Kuncian 4</Badge>}
        />
        <p className="mb-5 max-w-3xl text-sm leading-relaxed text-stone-400">
          Dua pesilat dilacak sekaligus. AI mendeteksi <b className="text-stone-200">pukulan, tendangan, jatuhan, dan kuncian badan</b> yang berhasil,
          lalu menggolongkannya <span className="text-emerald-300">Sah</span>, <span className="text-red-300">Ilegal</span>, atau{' '}
          <span className="text-stone-300">Gagal</span> (ditangkis/meleset) berdasarkan zona sasaran IPSI: yang sah hanya <i>togok</i> (dada, perut di atas
          pusar, rusuk, punggung). Setiap keputusan AI dapat dikoreksi wasit.
        </p>

        <div className="grid gap-5 lg:grid-cols-2">
          <Panel className="p-5">
            <h3 className="mb-4 font-display text-lg uppercase tracking-wide text-gold-200">Pesilat & Format</h3>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-3">
                <Badge color={CORNER_COLORS.merah}>Sudut Merah</Badge>
                <label className={cn(labelCls, 'mt-3')}>Nama</label>
                <input className={inputCls} value={merahName} onChange={(e) => setMerahName(e.target.value)} />
                <label className={cn(labelCls, 'mt-2')}>Perguruan / Kontingen</label>
                <input className={inputCls} value={merahTeam} onChange={(e) => setMerahTeam(e.target.value)} placeholder="Opsional" />
              </div>
              <div className="rounded-xl border border-blue-500/30 bg-blue-500/5 p-3">
                <Badge color={CORNER_COLORS.biru}>Sudut Biru</Badge>
                <label className={cn(labelCls, 'mt-3')}>Nama</label>
                <input className={inputCls} value={biruName} onChange={(e) => setBiruName(e.target.value)} />
                <label className={cn(labelCls, 'mt-2')}>Perguruan / Kontingen</label>
                <input className={inputCls} value={biruTeam} onChange={(e) => setBiruTeam(e.target.value)} placeholder="Opsional" />
              </div>
            </div>
            <label className={cn(labelCls, 'mt-4')}>Kelas / Kategori</label>
            <input className={inputCls} value={kelas} onChange={(e) => setKelas(e.target.value)} placeholder="cth. Kelas D Putra 60–65 kg" />
            <label className={cn(labelCls, 'mt-4')}>Format Pertandingan</label>
            <div className="flex flex-wrap gap-2">
              {FORMATS.map((f) => (
                <button
                  key={f.id}
                  onClick={() => {
                    setRounds(f.rounds);
                    setRoundSeconds(f.roundSeconds);
                    setRestSeconds(f.restSeconds);
                  }}
                  className={cn(
                    'rounded-xl px-3 py-2 text-sm font-medium transition',
                    rounds === f.rounds && roundSeconds === f.roundSeconds && restSeconds === f.restSeconds
                      ? 'bg-gold-400/20 text-gold-200 ring-1 ring-gold-400/50'
                      : 'bg-white/5 text-stone-400 hover:bg-white/10',
                  )}
                >
                  {f.label}
                </button>
              ))}
            </div>
            <div className="mt-3 grid grid-cols-3 gap-3">
              <div>
                <label className={labelCls}>Babak</label>
                <input type="number" min={1} max={5} className={inputCls} value={rounds} onChange={(e) => setRounds(Number(e.target.value))} />
              </div>
              <div>
                <label className={labelCls}>Detik / babak</label>
                <input type="number" min={10} step={10} className={inputCls} value={roundSeconds} onChange={(e) => setRoundSeconds(Number(e.target.value))} />
              </div>
              <div>
                <label className={labelCls}>Istirahat (dtk)</label>
                <input type="number" min={0} step={10} className={inputCls} value={restSeconds} onChange={(e) => setRestSeconds(Number(e.target.value))} />
              </div>
            </div>

            <div className="mt-5 rounded-xl bg-black/25 p-3 text-xs leading-relaxed text-stone-400">
              <b className="text-stone-200">Zona sasaran.</b>{' '}
              <span className="text-emerald-300">Sah:</span> dada, perut (pusar ke atas), rusuk, punggung.{' '}
              <span className="text-red-300">Ilegal:</span> kepala, leher, bawah pusar–kemaluan, lutut langsung, menyerang lawan jatuh. Kaki = sasaran
              antara (tidak bernilai). Pelanggaran naik tangga: Teguran I −1, II −2, Peringatan I −5, II −10, lalu diskualifikasi.
            </div>
          </Panel>

          <Panel className="p-5">
            <h3 className="mb-4 font-display text-lg uppercase tracking-wide text-gold-200">Sumber & Mode Wasit</h3>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {(
                [
                  { id: 'camera', label: '1 Kamera', icon: <Camera className="h-4 w-4" /> },
                  { id: 'rig', label: 'Rig 3 Kamera 3D', icon: <Video className="h-4 w-4" /> },
                  { id: 'video', label: 'Video', icon: <Upload className="h-4 w-4" /> },
                  { id: 'demo', label: 'Demo AI', icon: <Sparkles className="h-4 w-4" /> },
                  { id: 'manual', label: 'Manual Wasit', icon: <Keyboard className="h-4 w-4" /> },
                ] as { id: DuelSource; label: string; icon: ReactNode }[]
              ).map((s) => (
                <button
                  key={s.id}
                  onClick={() => setSourceMode(s.id)}
                  className={cn(
                    'flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm font-medium transition',
                    sourceMode === s.id ? 'bg-gold-400/20 text-gold-200 ring-1 ring-gold-400/50' : 'bg-white/5 text-stone-400 hover:bg-white/10',
                  )}
                >
                  {s.icon}
                  {s.label}
                </button>
              ))}
            </div>

            {sourceMode === 'camera' && (
              <p className="mt-3 text-xs leading-relaxed text-stone-500">
                Satu webcam melacak dua pesilat (2D). Posisikan kamera <b className="text-stone-300">menyamping</b> terhadap garis hadap kedua pesilat
                agar pukulan/tendangan terbaca maksimal. Pesilat di kiri layar = Merah (dapat ditukar saat laga).
              </p>
            )}
            {sourceMode === 'video' && (
              <div className="mt-3">
                <input
                  ref={videoFileRef2}
                  type="file"
                  accept="video/*"
                  className="hidden"
                  onChange={(e) => setVideoFile(e.target.files?.[0] ?? null)}
                />
                <Button variant="outline" onClick={() => videoFileRef2.current?.click()}>
                  <Upload className="h-4 w-4" /> {videoFile ? videoFile.name : 'Pilih video tanding…'}
                </Button>
                <p className="mt-2 text-xs text-stone-500">Video dianalisis sebagai satu babak penuh mengikuti durasi video.</p>
              </div>
            )}
            {sourceMode === 'demo' && (
              <p className="mt-3 text-xs leading-relaxed text-stone-500">
                Simulasi duel koreografis (pukulan bersih, tendangan, tangkisan, pelanggaran kepala/kemaluan, kuncian, jatuhan) yang mengalir melalui
                detektor AI yang sama — untuk mencoba tanpa kamera. Hasil demo tidak disimpan ke riwayat.
              </p>
            )}
            {sourceMode === 'manual' && (
              <p className="mt-3 text-xs leading-relaxed text-stone-500">
                Papan skor wasit tanpa kamera: jam babak berjalan, nilai dimasukkan lewat tombol atau keyboard (
                <Kbd>Q</Kbd>–<Kbd>R</Kbd>/<Kbd>F</Kbd> Merah, <Kbd>U</Kbd>–<Kbd>P</Kbd>/<Kbd>J</Kbd> Biru). Analisis akhir tetap lengkap.
              </p>
            )}

            {sourceMode === 'rig' && (
              <div className="mt-3 space-y-3">
                <div className="rounded-xl bg-black/25 p-3 text-xs leading-relaxed text-stone-400">
                  {rigProfile ? (
                    <>
                      Kalibrasi aktif: <b className="text-emerald-300">{rigProfile.name}</b> ({rigProfile.cameras.length} kamera, target{' '}
                      {rigProfile.targetFps} fps) — skeleton 3D metrik via triangulasi.
                    </>
                  ) : (
                    <>
                      <b className="text-amber-300">Belum ada kalibrasi.</b> Rig tetap berjalan tersinkron, tetapi analisis memakai kamera utama (fallback
                      2D). Impor kalibrasi ChArUco (JSON) untuk mode 3D penuh.
                    </>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  <input ref={rigFileRef} type="file" accept=".json,application/json" className="hidden" onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void importRigFile(f);
                  }} />
                  <Button variant="outline" onClick={() => rigFileRef.current?.click()}>
                    <FileUp className="h-4 w-4" /> Impor kalibrasi
                  </Button>
                  <Button variant="ghost" onClick={() => downloadJSON('rig-kalibrasi-template.json', defaultDemoRig())}>
                    <Download className="h-4 w-4" /> Template
                  </Button>
                  <Button variant="ghost" onClick={() => void activateDemoRig()}>
                    Rig demo sintetis
                  </Button>
                  {rigProfile && (
                    <Button variant="ghost" onClick={() => void removeRig()}>
                      <Trash2 className="h-4 w-4" /> Hapus
                    </Button>
                  )}
                </div>
                <div>
                  <div className="mb-2 flex items-center gap-2">
                    <span className={cn(labelCls, 'mb-0')}>Penugasan Kamera</span>
                    <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => void scanCameras()}>
                      Pindai kamera
                    </Button>
                    <span className="ml-auto flex items-center gap-1 text-xs text-stone-500">
                      Target:
                      {[60, 120].map((f) => (
                        <button
                          key={f}
                          onClick={() => setRigFps(f)}
                          className={cn('rounded-lg px-2 py-1 font-semibold', rigFps === f ? 'bg-gold-400/20 text-gold-200' : 'bg-white/5 text-stone-400')}
                        >
                          {f} fps
                        </button>
                      ))}
                    </span>
                  </div>
                  <div className="space-y-2">
                    {rigSlots.map((slot) => (
                      <div key={slot.id} className="flex items-center gap-2">
                        <span className="w-40 shrink-0 text-xs text-stone-400">{slot.label}</span>
                        <select
                          className={inputCls}
                          value={rigAssign[slot.id] ?? ''}
                          onChange={(e) => setRigAssign((prev) => ({ ...prev, [slot.id]: e.target.value }))}
                        >
                          <option value="">— tidak dipakai —</option>
                          {rigDevices.map((d) => (
                            <option key={d.deviceId} value={d.deviceId}>
                              {d.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    ))}
                  </div>
                  {rigMsg && <p className="mt-2 text-xs text-amber-200/90">{rigMsg}</p>}
                  <p className="mt-2 text-[11px] leading-relaxed text-stone-600">
                    Arsitektur: 3 kamera tersinkron (jendela skew ≈1,2× periode frame) → MediaPipe per kamera → asosiasi identitas → triangulasi DLT →
                    bidang duel kanonis → detektor kejadian. Tanpa kalibrasi, kedalaman tidak diklaim.
                  </p>
                </div>
              </div>
            )}

            {sourceMode !== 'manual' && (
              <div className="mt-5">
                <label className={labelCls}>Keputusan AI</label>
                <div className="flex gap-2">
                  <button
                    onClick={() => setAiConfirm(false)}
                    className={cn('flex-1 rounded-xl px-3 py-2 text-sm font-medium transition', !aiConfirm ? 'bg-gold-400/20 text-gold-200 ring-1 ring-gold-400/50' : 'bg-white/5 text-stone-400 hover:bg-white/10')}
                  >
                    Otomatis (wasit mengoreksi)
                  </button>
                  <button
                    onClick={() => setAiConfirm(true)}
                    className={cn('flex-1 rounded-xl px-3 py-2 text-sm font-medium transition', aiConfirm ? 'bg-gold-400/20 text-gold-200 ring-1 ring-gold-400/50' : 'bg-white/5 text-stone-400 hover:bg-white/10')}
                  >
                    Konfirmasi wasit dulu
                  </button>
                </div>
              </div>
            )}

            <Button className="mt-6 w-full py-3 text-base" disabled={!canStart} onClick={startMatch}>
              <Swords className="h-5 w-5" /> Masuk Gelanggang
            </Button>
            {sourceMode === 'rig' && !canStart && <p className="mt-2 text-center text-xs text-stone-500">Pindai & tugaskan minimal 1 kamera untuk memulai.</p>}
          </Panel>
        </div>

        {/* Past duels */}
        <div className="mt-8">
          <SectionTitle id="Pertandingan Terdahulu" en="Saved duels (SQLite)" icon={<Trophy className="h-4 w-4" />} />
          {duels.length === 0 ? (
            <Panel className="p-6 text-center text-sm text-stone-500">Belum ada pertandingan tersimpan. Hasil tanding (selain demo) akan muncul di sini.</Panel>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {duels.map((d) => {
                const [fm, fb] = d.fighters;
                const cm = suksesCounts(fm);
                const cb = suksesCounts(fb);
                return (
                  <button key={d.id} onClick={() => onOpen(d)} className="text-left">
                    <Panel className="group h-full p-4 transition hover:-translate-y-0.5 hover:ring-1 hover:ring-gold-400/30">
                      <div className="flex items-center gap-2 text-xs text-stone-500">
                        <span>{new Date(d.createdAt).toLocaleString('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                        <Badge color="#a8a29e">{d.source}</Badge>
                        {d.config.kelas && <span className="truncate">{d.config.kelas}</span>}
                        <span
                          role="button"
                          tabIndex={0}
                          title="Hapus"
                          className="ml-auto rounded p-1 text-stone-500 transition hover:bg-white/10 hover:text-red-300"
                          onClick={(e) => {
                            e.stopPropagation();
                            onDelete(d.id);
                          }}
                        >
                          <Trash2 className="h-4 w-4" />
                        </span>
                      </div>
                      <div className="mt-3 flex items-center gap-3">
                        <div className="min-w-0 flex-1">
                          <div className={cn('truncate font-display text-lg uppercase', d.winner === 'merah' ? 'text-red-300' : 'text-stone-300')}>
                            {d.config.merah.name}
                          </div>
                          <div className={cn('truncate font-display text-lg uppercase', d.winner === 'biru' ? 'text-blue-300' : 'text-stone-300')}>
                            {d.config.biru.name}
                          </div>
                        </div>
                        <div className="text-center font-display text-3xl tabular-nums text-gold-200">
                          {fm.score}–{fb.score}
                        </div>
                      </div>
                      <div className="mt-2 text-xs text-stone-500">
                        {d.winBy} · Sukses M {cm.pukulan}P/{cm.tendangan}T/{cm.jatuhan}J/{cm.kuncian}K — B {cb.pukulan}P/{cb.tendangan}T/{cb.jatuhan}J/
                        {cb.kuncian}K · Ilegal {fm.fouls + fb.fouls}
                      </div>
                    </Panel>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    );
  }

  /* ==================================================================== */
  /*  LIVE                                                                 */
  /* ==================================================================== */
  const [fm, fb] = stats.fighters;
  const viewport = (
    <div className="relative aspect-video overflow-hidden rounded-2xl border border-gold-500/20 bg-black">
      {sourceMode === 'camera' || sourceMode === 'video' ? (
        <>
          <video ref={engine.videoRef} className="absolute inset-0 h-full w-full object-contain opacity-0" playsInline muted />
          <canvas ref={engine.canvasRef} className="absolute inset-0 h-full w-full object-contain" />
        </>
      ) : sourceMode === 'rig' ? (
        <canvas ref={rig.canvasRef} className="absolute inset-0 h-full w-full object-contain" />
      ) : sourceMode === 'demo' ? (
        <canvas ref={demoCanvasRef} width={1280} height={720} className="absolute inset-0 h-full w-full object-contain" />
      ) : (
        <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
          <Swords className="h-10 w-10 text-gold-400/60" />
          <p className="max-w-md text-sm text-stone-400">
            Mode manual wasit — amati pertandingan langsung, masukkan nilai dengan pad skor / keyboard. Jam babak dan tangga hukuman berjalan otomatis.
          </p>
          <div className="flex flex-wrap justify-center gap-1.5">
            {(Object.keys(ZONE_INFO) as TargetZone[])
              .filter((z) => z !== 'tidak-kena')
              .map((z) => (
                <Badge key={z} color={ZONE_INFO[z].legality === 'sah' ? '#34d399' : ZONE_INFO[z].legality === 'ilegal' ? '#f87171' : '#a8a29e'}>
                  {ZONE_INFO[z].label}
                </Badge>
              ))}
          </div>
        </div>
      )}

      {/* status chips */}
      <div className="absolute left-3 top-3 flex flex-wrap gap-1.5">
        {sourceMode === 'camera' || sourceMode === 'video' ? (
          <>
            <Badge color={engine.poseCount === 2 ? '#34d399' : '#fbbf24'}>{engine.poseCount}/2 pesilat</Badge>
            <Badge color="#a8a29e">{engine.fps} fps</Badge>
            {engine.modelStatus !== 'ready' && <Badge color="#fbbf24">Model {engine.modelStatus}…</Badge>}
          </>
        ) : sourceMode === 'rig' ? (
          <>
            <Badge color={rig.quality.mode === '3d' ? '#34d399' : '#fbbf24'}>{rig.quality.mode === '3d' ? '3D triangulasi' : 'Fallback 2D'}</Badge>
            <Badge color="#a8a29e">skew {rig.quality.skewMs.toFixed(1)} ms</Badge>
            {rig.quality.reprojPx !== null && <Badge color="#a8a29e">reproj {rig.quality.reprojPx.toFixed(1)} px</Badge>}
            {rig.camStates.map((c) => (
              <Badge key={c.cameraId} color={c.state === 'live' ? '#34d399' : c.state === 'error' ? '#f87171' : '#fbbf24'}>
                {c.label}: {c.state === 'live' ? `${c.actualFps}fps·${c.persons}p` : c.state}
              </Badge>
            ))}
          </>
        ) : sourceMode === 'demo' ? (
          <Badge color="#f0cf6a">Simulasi AI</Badge>
        ) : (
          <Badge color="#a8a29e">Manual</Badge>
        )}
        {snap.distanceNorm !== null && sourceMode !== 'manual' && <Badge color="#a8a29e">Jarak {snap.distanceNorm.toFixed(1)}× togok</Badge>}
        {snap.clinch.active && (
          <Badge color={snap.clinch.established ? '#fbbf24' : '#a8a29e'}>
            {snap.clinch.established ? `KUNCIAN ${snap.clinch.owner ?? ''} ${snap.clinch.heldSeconds.toFixed(1)}d` : 'Clinch…'}
          </Badge>
        )}
        {snap.clinch.tooLong && <Badge color="#f87171">Bergulat &gt;5 dtk — pisahkan!</Badge>}
        {(snap.downed[0] || snap.downed[1]) && <Badge color="#38bdf8">Pesilat jatuh!</Badge>}
      </div>

      {(engine.sourceError || engine.modelError) && sourceMode !== 'rig' && (
        <div className="absolute bottom-3 left-3 right-3 rounded-xl bg-red-950/80 px-3 py-2 text-xs text-red-200">
          {engine.sourceError ?? engine.modelError}
        </div>
      )}

      {!clockView.started && (
        <div className="absolute inset-0 grid place-items-center bg-black/55 p-4">
          <div className="text-center">
            <div className="font-display text-2xl uppercase tracking-wide text-gold-100">Pasang · Siap</div>
            <p className="mx-auto mt-1 max-w-sm text-sm text-stone-300">
              Posisikan kedua pesilat dalam bingkai, periksa warna sudutnya, lalu bunyikan gong.
            </p>
            <Button className="mt-4 px-6 py-3 text-base" disabled={!gongReady} onClick={gongStart}>
              <Play className="h-5 w-5" /> Gong — Mulai Babak 1
            </Button>
            {!gongReady && <p className="mt-2 text-xs text-stone-400">Menunggu sumber video aktif…</p>}
          </div>
        </div>
      )}
      {clockView.started && clockView.seg === 'rest' && (
        <div className="absolute inset-0 grid place-items-center bg-black/45">
          <div className="text-center">
            <div className="font-display text-3xl uppercase tracking-wide text-gold-100">Istirahat</div>
            <div className="font-display text-5xl tabular-nums text-gold-300">{fmtClock(clockView.timeLeft)}</div>
          </div>
        </div>
      )}
    </div>
  );

  const countsRow = (corner: Corner) => {
    const f = corner === 'merah' ? fm : fb;
    const c = suksesCounts(f);
    const chip = (icon: ReactNode, label: string, v: number, color: string) => (
      <span key={label} className="inline-flex items-center gap-1 rounded-lg bg-white/5 px-2 py-1 text-xs" style={{ color }}>
        {icon}
        <span className="text-stone-400">{label}</span>
        <b className="font-display text-sm tabular-nums text-stone-100">{v}</b>
      </span>
    );
    return (
      <div className="flex flex-wrap gap-1.5">
        {chip(<Hand className="h-3.5 w-3.5" />, 'Pukul ✓', c.pukulan, TECHNIQUE_INFO.pukulan.color)}
        {chip(<Footprints className="h-3.5 w-3.5" />, 'Tendang ✓', c.tendangan, TECHNIQUE_INFO.tendangan.color)}
        {chip(<ArrowDownToLine className="h-3.5 w-3.5" />, 'Jatuhan', c.jatuhan, TECHNIQUE_INFO.jatuhan.color)}
        {chip(<Lock className="h-3.5 w-3.5" />, 'Kuncian', c.kuncian, TECHNIQUE_INFO.kuncian.color)}
        {chip(<TriangleAlert className="h-3.5 w-3.5" />, 'Ilegal', f.fouls, '#f87171')}
        {chip(<Shield className="h-3.5 w-3.5" />, 'Ditangkis', f.techniques.pukulan.ditangkis + f.techniques.tendangan.ditangkis, '#a8a29e')}
      </div>
    );
  };

  const eventRow = (e: DuelEvent) => {
    const st = STATUS_INFO[e.status];
    const penLabel = e.penaltyLevel ? PENALTY_LADDER.find((p) => p.level === e.penaltyLevel)?.label : undefined;
    return (
      <div key={e.id} className="flex gap-2.5 border-b border-white/5 px-3 py-2.5 last:border-0">
        <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg" style={{ background: `${TECHNIQUE_INFO[e.technique].color}1f`, color: TECHNIQUE_INFO[e.technique].color }}>
          {TECH_ICON[e.technique]}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-stone-500">
            <span className="tabular-nums">{fmtClock(e.t)}</span>
            <span>B{e.round}</span>
            <Badge color={CORNER_COLORS[e.attacker]}>{names[e.attacker]}</Badge>
            <span>{ZONE_INFO[e.zone].label}</span>
            {e.counterBonus && <Badge color="#f0cf6a">+1 serangan balik</Badge>}
            <span>{e.source === 'ai' ? `AI ${Math.round(e.confidence * 100)}%` : 'Wasit'}</span>
          </div>
          <div className="mt-0.5 text-sm leading-snug text-stone-200">{e.note}</div>
          {e.status === 'gagal' && e.failReason && <div className="text-xs text-stone-500">{FAIL_INFO[e.failReason].label}</div>}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <button onClick={() => cycleStatus(e.id)} title="Klik: ubah Sah → Ilegal → Gagal">
            <Badge color={st.color}>{st.label}</Badge>
          </button>
          {e.points > 0 && <span className="font-display text-sm tabular-nums text-emerald-300">+{e.points}</span>}
          {e.penalty > 0 && (
            <span className="font-display text-sm tabular-nums text-red-300">
              −{e.penalty}
              {penLabel ? <span className="ml-1 text-[10px] uppercase text-red-400/80">{penLabel}</span> : null}
            </span>
          )}
          <button onClick={() => deleteEvent(e.id)} className="rounded p-0.5 text-stone-600 transition hover:bg-white/10 hover:text-red-300" title="Hapus kejadian">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6">
      {/* Scoreboard */}
      <Panel glow className="mb-5 overflow-hidden">
        <div className="grid grid-cols-[1fr_auto_1fr] items-stretch">
          <div className="border-l-4 p-4" style={{ borderColor: CORNER_DEEP.merah, background: 'linear-gradient(90deg, rgba(220,38,38,0.14), transparent)' }}>
            <div className="truncate font-display text-xl uppercase text-red-300">{names.merah}</div>
            <div className="truncate text-xs text-stone-500">{matchConfig?.merah.team ?? 'Sudut Merah'}</div>
            <div className="mt-1 font-display text-5xl tabular-nums text-stone-50">{fm.score}</div>
            <div className="mt-2">{countsRow('merah')}</div>
            {fm.disqualified && <Badge color="#f87171">Diskualifikasi</Badge>}
          </div>
          <div className="flex flex-col items-center justify-center px-4 py-3 text-center">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.25em] text-stone-500">
              <Timer className="h-3.5 w-3.5" /> Babak {clockView.round}/{matchConfig?.rounds ?? rounds}
            </div>
            <div className={cn('font-display text-4xl tabular-nums', clockView.seg === 'fight' && clockView.timeLeft <= 10 && clockView.running ? 'text-red-300' : 'text-gold-200')}>
              {fmtClock(clockView.timeLeft)}
            </div>
            <Badge color={!clockView.started ? '#a8a29e' : !clockView.running ? '#fbbf24' : clockView.seg === 'rest' ? '#38bdf8' : '#34d399'}>
              {!clockView.started ? 'Belum mulai' : !clockView.running ? 'STOP — wasit' : clockView.seg === 'rest' ? 'Istirahat' : 'Bertanding'}
            </Badge>
            <div className="mt-1 text-[11px] tabular-nums text-stone-600">Waktu tanding {fmtClock(clockView.fightElapsed)}</div>
          </div>
          <div className="border-r-4 p-4 text-right" style={{ borderColor: CORNER_DEEP.biru, background: 'linear-gradient(270deg, rgba(37,99,235,0.14), transparent)' }}>
            <div className="truncate font-display text-xl uppercase text-blue-300">{names.biru}</div>
            <div className="truncate text-xs text-stone-500">{matchConfig?.biru.team ?? 'Sudut Biru'}</div>
            <div className="mt-1 font-display text-5xl tabular-nums text-stone-50">{fb.score}</div>
            <div className="mt-2 flex justify-end">{countsRow('biru')}</div>
            {fb.disqualified && <Badge color="#f87171">Diskualifikasi</Badge>}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t border-white/5 px-4 py-3">
          {!clockView.started ? (
            <Button disabled={!gongReady} onClick={gongStart}>
              <Play className="h-4 w-4" /> Gong Mulai
            </Button>
          ) : (
            <Button variant={clockView.running ? 'danger' : 'success'} onClick={togglePause}>
              {clockView.running ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
              {clockView.running ? 'STOP' : 'Mulai lagi'}
            </Button>
          )}
          <Button
            variant="ghost"
            disabled={!clockView.started}
            onClick={() => {
              clockRef.current.segElapsedBase = clockRef.current.segDuration;
              advanceSegment();
            }}
          >
            Akhiri {clockView.seg === 'rest' ? 'istirahat' : 'babak'}
          </Button>
          {(sourceMode === 'camera' || sourceMode === 'video' || sourceMode === 'rig') && (
            <Button variant="ghost" onClick={swapNow} title="Tukar penugasan sudut merah/biru">
              <ArrowLeftRight className="h-4 w-4" /> Tukar sudut
            </Button>
          )}
          <div className="ml-auto flex gap-2">
            <Button variant="ghost" onClick={cancelMatch}>
              Batalkan
            </Button>
            <Button disabled={!clockView.started} onClick={() => finishMatchRef.current()}>
              <Square className="h-4 w-4" /> Akhiri & Nilai
            </Button>
          </div>
        </div>
      </Panel>

      <div className="grid gap-5 xl:grid-cols-[1.9fr_1fr]">
        <div className="space-y-5">
          {viewport}

          {/* Manual scoring pad */}
          <Panel className="p-4">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <span className="flex items-center gap-1.5 text-sm font-semibold text-stone-200">
                <Keyboard className="h-4 w-4 text-gold-400" /> Pad Skor Wasit
              </span>
              <span className="text-xs text-stone-500">Zona:</span>
              <div className="flex flex-wrap gap-1">
                {(['dada', 'perut', 'rusuk', 'punggung', 'kepala', 'leher', 'kemaluan', 'kaki'] as TargetZone[]).map((z) => (
                  <button
                    key={z}
                    onClick={() => setZoneSel(z)}
                    className={cn(
                      'rounded-lg px-2 py-1 text-xs font-medium transition',
                      zoneSel === z
                        ? ZONE_INFO[z].legality === 'ilegal'
                          ? 'bg-red-500/25 text-red-200 ring-1 ring-red-400/60'
                          : 'bg-gold-400/20 text-gold-200 ring-1 ring-gold-400/50'
                        : 'bg-white/5 text-stone-400 hover:bg-white/10',
                    )}
                  >
                    {ZONE_INFO[z].label}
                  </button>
                ))}
              </div>
              <span className="text-xs text-stone-500">Hasil:</span>
              <div className="flex gap-1">
                {(
                  [
                    { id: 'sah', label: 'Sah' },
                    { id: 'ditangkis', label: 'Ditangkis' },
                    { id: 'meleset', label: 'Meleset' },
                    { id: 'ilegal', label: 'Ilegal' },
                  ] as { id: OutcomeSel; label: string }[]
                ).map((o) => (
                  <button
                    key={o.id}
                    onClick={() => setOutcomeSel(o.id)}
                    className={cn('rounded-lg px-2 py-1 text-xs font-medium transition', outcomeSel === o.id ? 'bg-gold-400/20 text-gold-200 ring-1 ring-gold-400/50' : 'bg-white/5 text-stone-400 hover:bg-white/10')}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {CORNERS.map((corner) => (
                <div key={corner} className="rounded-xl border p-3" style={{ borderColor: `${CORNER_DEEP[corner]}55`, background: `${CORNER_DEEP[corner]}0d` }}>
                  <div className="mb-2 flex items-center justify-between">
                    <span className="font-display uppercase tracking-wide" style={{ color: CORNER_COLORS[corner] }}>
                      {names[corner]}
                    </span>
                    <span className="font-display text-xl tabular-nums text-stone-100">{corner === 'merah' ? fm.score : fb.score}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {DUEL_TECHNIQUES.map((tech) => (
                      <button
                        key={tech}
                        disabled={!clockView.started}
                        onClick={() => manualAdd(corner, tech)}
                        className="flex items-center gap-2 rounded-xl bg-white/5 px-2.5 py-2 text-left text-sm transition hover:bg-white/10 disabled:pointer-events-none disabled:opacity-40"
                      >
                        <span style={{ color: TECHNIQUE_INFO[tech].color }}>{TECH_ICON[tech]}</span>
                        <span className="flex-1 leading-tight">
                          {TECHNIQUE_INFO[tech].label}
                          <span className="block text-[10px] text-stone-500">+{TECHNIQUE_INFO[tech].points} poin</span>
                        </span>
                        <Kbd>{MANUAL_KEYS[corner][tech]}</Kbd>
                      </button>
                    ))}
                  </div>
                  <button
                    disabled={!clockView.started}
                    onClick={() => manualAdd(corner, 'pukulan', true)}
                    className="mt-2 flex w-full items-center gap-2 rounded-xl bg-red-500/10 px-2.5 py-2 text-sm text-red-200 transition hover:bg-red-500/20 disabled:pointer-events-none disabled:opacity-40"
                  >
                    <TriangleAlert className="h-4 w-4" /> Pelanggaran (ilegal)
                    <span className="ml-auto"><Kbd>{MANUAL_KEYS[corner].ilegal}</Kbd></span>
                  </button>
                </div>
              ))}
            </div>
          </Panel>
        </div>

        <div className="space-y-5">
          {pending.length > 0 && (
            <Panel glow className="overflow-hidden">
              <div className="border-b border-amber-400/20 bg-amber-400/10 px-4 py-2.5 text-sm font-semibold text-amber-200">
                Menunggu konfirmasi wasit ({pending.length})
              </div>
              <div className="max-h-72 overflow-y-auto">
                {pending.map((e) => (
                  <div key={e.id} className="flex items-center gap-2 border-b border-white/5 px-3 py-2.5 last:border-0">
                    <Badge color={CORNER_COLORS[e.attacker]}>{names[e.attacker]}</Badge>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm text-stone-200">{e.note}</div>
                      <div className="text-[11px] text-stone-500">
                        {fmtClock(e.t)} · AI {Math.round(e.confidence * 100)}% · usulan:{' '}
                        <span style={{ color: STATUS_INFO[e.status].color }}>{STATUS_INFO[e.status].label}</span>
                      </div>
                    </div>
                    <button onClick={() => confirmPending(e.id)} className="rounded-lg bg-emerald-500/20 p-1.5 text-emerald-300 transition hover:bg-emerald-500/30" title="Sahkan">
                      <Check className="h-4 w-4" />
                    </button>
                    <button onClick={() => rejectPending(e.id)} className="rounded-lg bg-red-500/15 p-1.5 text-red-300 transition hover:bg-red-500/25" title="Tolak">
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            </Panel>
          )}

          <Panel className="overflow-hidden">
            <div className="flex items-center justify-between border-b border-white/5 px-4 py-3">
              <span className="font-display uppercase tracking-wide text-gold-200">Catatan Kejadian</span>
              <span className="text-xs text-stone-500">
                {laddered.length} kejadian · klik lencana status untuk mengoreksi
              </span>
            </div>
            <div className="max-h-[560px] overflow-y-auto">
              {laddered.length === 0 ? (
                <p className="px-4 py-8 text-center text-sm text-stone-500">
                  Belum ada kejadian. Serangan yang terdeteksi AI / dimasukkan wasit akan tercatat di sini secara kronologis.
                </p>
              ) : (
                [...laddered].reverse().map(eventRow)
              )}
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
