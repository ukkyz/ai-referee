'use client';

import { useMemo, type ReactNode } from 'react';
import {
  ArrowDownToLine,
  ArrowLeft,
  Download,
  Footprints,
  Hand,
  Lock,
  RotateCcw,
  Shield,
  Target,
  TriangleAlert,
  Trophy,
  X,
} from 'lucide-react';
import {
  CORNERS,
  DUEL_TECHNIQUES,
  type Corner,
  type DuelEvent,
  type DuelReport,
  type DuelTechnique,
  type FighterStats,
  type TechniqueStats,
} from '../types';
import {
  FAIL_INFO,
  PENALTY_LADDER,
  STATUS_INFO,
  TECHNIQUE_INFO,
  ZONE_INFO,
  applyPenaltyLadder,
  computeDuelStats,
  withStatus,
} from '../lib/duel/rules';
import { CORNER_COLORS, CORNER_DEEP } from '../lib/duel/draw';
import { downloadJSON } from '../lib/storage';
import { fmtTime } from '../lib/math';
import { RadarChart } from '../components/charts';
import { Badge, Button, Panel, SectionTitle } from '../components/ui';
import { cn } from '../utils/cn';

interface Props {
  report: DuelReport;
  onBack: () => void;
  onRematch: () => void;
  onUpdate: (r: DuelReport) => void;
}

const fmtClock = (s: number) => fmtTime(Math.max(0, Math.ceil(s)), 0);

const TECH_ICON: Record<DuelTechnique, ReactNode> = {
  pukulan: <Hand className="h-4 w-4" />,
  tendangan: <Footprints className="h-4 w-4" />,
  jatuhan: <ArrowDownToLine className="h-4 w-4" />,
  kuncian: <Lock className="h-4 w-4" />,
};

const techAcc = (s: TechniqueStats): number | null => (s.attempted > 0 ? s.sah / s.attempted : null);

function insights(r: DuelReport): string[] {
  const [fm, fb] = r.fighters;
  const name = (c: Corner) => (c === 'merah' ? r.config.merah.name : r.config.biru.name);
  const out: string[] = [];
  if (fm.totalAttempts !== fb.totalAttempts) {
    const busier: Corner = fm.totalAttempts > fb.totalAttempts ? 'merah' : 'biru';
    out.push(
      `${name(busier)} lebih agresif: ${Math.max(fm.totalAttempts, fb.totalAttempts)} serangan vs ${Math.min(fm.totalAttempts, fb.totalAttempts)} (${(busier === 'merah' ? fm : fb).strikesPerMinute.toFixed(1)} serangan/menit).`,
    );
  }
  for (const c of CORNERS) {
    const f = c === 'merah' ? fm : fb;
    const best = DUEL_TECHNIQUES.map((t) => ({ t, s: f.techniques[t].sah })).sort((a, b) => b.s - a.s)[0];
    if (best && best.s > 0) out.push(`Teknik andalan ${name(c)}: ${TECHNIQUE_INFO[best.t].label.toLowerCase()} — ${best.s}× berhasil masuk.`);
    if (f.fouls >= 2) out.push(`${name(c)} melakukan ${f.fouls} pelanggaran (−${f.penaltyPoints} poin). Disiplin zona sasaran (togok) perlu dilatih.`);
    if (f.lockSeconds > 0) out.push(`${name(c)} menguasai kuncian badan selama total ${f.lockSeconds.toFixed(1)} detik.`);
    if (f.techniques.pukulan.attempted + f.techniques.tendangan.attempted >= 4) {
      const acc = Math.round(f.strikeAccuracy * 100);
      out.push(`Akurasi serangan ${name(c)} ${acc}% — ${f.strikeAccuracy >= 0.5 ? 'efektif; seleksi serangannya bagus' : 'banyak serangan terbuang; latih jarak, timing, dan feint'}.`);
    }
    if (f.timesDropped >= 2) out.push(`${name(c)} terjatuh ${f.timesDropped}× — pertahanan bantingan & kuda-kuda perlu diperkuat.`);
  }
  const blockedTotal = DUEL_TECHNIQUES.reduce((a, t) => a + fm.techniques[t].ditangkis + fb.techniques[t].ditangkis, 0);
  if (blockedTotal > 0) out.push(`Sebanyak ${blockedTotal} serangan berhasil ditangkis sepanjang laga — pertahanan ${blockedTotal >= 6 ? 'rapat di kedua sisi' : 'cukup aktif'}.`);
  if (r.winner !== 'seri') out.push(`${r.winBy}: ${name(r.winner)} (${fm.score}–${fb.score}).`);
  else out.push(`Hasil seri ${fm.score}–${fb.score} — kedua pesilat seimbang.`);
  return out;
}

function MomentumChart({ report }: { report: DuelReport }) {
  const W = 640;
  const H = 180;
  const pad = 10;
  const maxAbs = Math.max(4, ...report.momentum.map((p) => Math.abs(p.diff)));
  const maxX = Math.max(1, report.duration);
  const X = (t: number) => pad + (t / maxX) * (W - pad * 2);
  const Y = (d: number) => H / 2 - (d / maxAbs) * (H / 2 - pad);
  const segs: ReactNode[] = [];
  for (let i = 1; i < report.momentum.length; i += 1) {
    const a = report.momentum[i - 1];
    const b = report.momentum[i];
    segs.push(
      <line
        key={i}
        x1={X(a.t)}
        y1={Y(a.diff)}
        x2={X(b.t)}
        y2={Y(b.diff)}
        stroke={b.diff >= 0 ? CORNER_COLORS.merah : CORNER_COLORS.biru}
        strokeWidth={2.5}
        strokeLinecap="round"
      />,
    );
  }
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
        <rect x={pad} y={pad} width={W - pad * 2} height={H / 2 - pad} fill="rgba(248,113,113,0.05)" />
        <rect x={pad} y={H / 2} width={W - pad * 2} height={H / 2 - pad} fill="rgba(96,165,250,0.05)" />
        <line x1={pad} x2={W - pad} y1={H / 2} y2={H / 2} stroke="rgba(255,255,255,0.18)" strokeWidth={1} />
        {segs}
      </svg>
      <div className="flex gap-4 text-xs text-stone-400">
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-4 rounded" style={{ background: CORNER_COLORS.merah }} /> {report.config.merah.name} unggul (atas)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-4 rounded" style={{ background: CORNER_COLORS.biru }} /> {report.config.biru.name} unggul (bawah)
        </span>
        <span className="ml-auto tabular-nums">selisih skor s.d. {fmtClock(report.duration)}</span>
      </div>
    </div>
  );
}

export default function DuelResults({ report, onBack, onRematch, onUpdate }: Props) {
  const analysis = useMemo(() => insights(report), [report]);
  const laddered = useMemo(() => applyPenaltyLadder(report.events), [report.events]);
  const fouls = laddered.filter((e) => e.status === 'ilegal');
  const name = (c: Corner) => (c === 'merah' ? report.config.merah.name : report.config.biru.name);
  const [fm, fb] = report.fighters;

  const editStatus = (ev: DuelEvent) => {
    const order: DuelEvent['status'][] = ['sah', 'ilegal', 'gagal'];
    const next = order[(order.indexOf(ev.status) + 1) % order.length];
    const events = applyPenaltyLadder(report.events.map((e) => (e.id === ev.id ? withStatus(e, next) : e)));
    const outcome = computeDuelStats(events, report.config, report.duration);
    onUpdate({ ...report, events, fighters: outcome.fighters, winner: outcome.winner, winBy: outcome.winBy, momentum: outcome.momentum });
  };

  const techTable = (corner: Corner) => {
    const f = corner === 'merah' ? fm : fb;
    const cell = (v: ReactNode, cls = '') => <td className={cn('px-2 py-2 text-center tabular-nums', cls)}>{v}</td>;
    return (
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-white/10 text-[11px] uppercase tracking-wider text-stone-500">
            <th className="px-2 py-2 text-left font-semibold">Teknik</th>
            <th className="px-2 py-2 font-semibold">Sukses</th>
            <th className="px-2 py-2 font-semibold">Coba</th>
            <th className="px-2 py-2 font-semibold">Ditangkis</th>
            <th className="px-2 py-2 font-semibold">Gagal</th>
            <th className="px-2 py-2 font-semibold">Ilegal</th>
            <th className="px-2 py-2 font-semibold">Akurasi</th>
            <th className="px-2 py-2 font-semibold">Poin</th>
          </tr>
        </thead>
        <tbody>
          {DUEL_TECHNIQUES.map((t) => {
            const s = f.techniques[t];
            const acc = techAcc(s);
            return (
              <tr key={t} className="border-b border-white/5 last:border-0">
                <td className="px-2 py-2">
                  <span className="flex items-center gap-2" style={{ color: TECHNIQUE_INFO[t].color }}>
                    {TECH_ICON[t]}
                    <span className="text-stone-200">{TECHNIQUE_INFO[t].label}</span>
                  </span>
                </td>
                {cell(<b className="text-emerald-300">{s.sah}</b>)}
                {cell(s.attempted)}
                {cell(s.ditangkis)}
                {cell(s.gagal)}
                {cell(<span className={s.ilegal ? 'font-semibold text-red-300' : ''}>{s.ilegal}</span>)}
                {cell(acc === null ? '—' : `${Math.round(acc * 100)}%`)}
                {cell(`+${s.points}`)}
              </tr>
            );
          })}
        </tbody>
      </table>
    );
  };

  const radarFor = (f: FighterStats) => [
    { label: 'Pukulan', value: (techAcc(f.techniques.pukulan) ?? 0) * 100 },
    { label: 'Tendangan', value: (techAcc(f.techniques.tendangan) ?? 0) * 100 },
    { label: 'Jatuhan', value: (techAcc(f.techniques.jatuhan) ?? 0) * 100 },
    { label: 'Kuncian', value: Math.min(100, f.lockSeconds * 25) },
    { label: 'Disiplin', value: Math.max(0, 100 - f.fouls * 25) },
    { label: 'Efektivitas', value: f.strikeAccuracy * 100 },
  ];

  const roundsShown = Math.max(fm.byRound.length, fb.byRound.length);

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6">
      <SectionTitle
        id="Hasil Tanding"
        en={`Match analysis · ${new Date(report.createdAt).toLocaleString('id-ID')}`}
        icon={<Trophy className="h-4 w-4" />}
        right={
          <>
            <Button variant="ghost" onClick={onBack}>
              <ArrowLeft className="h-4 w-4" /> Tanding
            </Button>
            <Button variant="outline" onClick={onRematch}>
              <RotateCcw className="h-4 w-4" /> Tanding Ulang
            </Button>
            <Button variant="ghost" onClick={() => downloadJSON(`tanding-${report.id}.json`, report)}>
              <Download className="h-4 w-4" /> JSON
            </Button>
          </>
        }
      />

      {/* Winner banner */}
      <Panel glow className="mb-5 overflow-hidden">
        <div className="grid grid-cols-[1fr_auto_1fr] items-center">
          {CORNERS.map((c) => {
            const f = c === 'merah' ? fm : fb;
            const won = report.winner === c;
            return (
              <div
                key={c}
                className={cn('p-5', c === 'merah' ? 'order-1' : 'order-3 text-right')}
                style={{
                  background: won
                    ? c === 'merah'
                      ? 'linear-gradient(90deg, rgba(220,38,38,0.22), transparent)'
                      : 'linear-gradient(270deg, rgba(37,99,235,0.22), transparent)'
                    : 'transparent',
                }}
              >
                <div className={cn('flex items-center gap-2', c === 'biru' && 'flex-row-reverse')}>
                  {won && <Trophy className="h-5 w-5 text-gold-300" />}
                  <span className="font-display text-2xl uppercase" style={{ color: CORNER_COLORS[c] }}>
                    {name(c)}
                  </span>
                </div>
                <div className="text-xs text-stone-500">
                  {(c === 'merah' ? report.config.merah.team : report.config.biru.team) ?? (c === 'merah' ? 'Sudut Merah' : 'Sudut Biru')}
                </div>
                <div className="mt-1 font-display text-6xl tabular-nums text-stone-50">{f.score}</div>
                <div className="mt-1 flex flex-wrap gap-1.5" style={{ justifyContent: c === 'biru' ? 'flex-end' : 'flex-start' }}>
                  <Badge color="#34d399">+{f.techniquePoints} poin teknik</Badge>
                  {f.penaltyPoints > 0 && <Badge color="#f87171">−{f.penaltyPoints} hukuman</Badge>}
                  <Badge color="#a8a29e">{f.totalSukses} teknik sukses</Badge>
                  {f.disqualified && <Badge color="#f87171">Diskualifikasi</Badge>}
                </div>
              </div>
            );
          })}
          <div className="order-2 px-4 text-center">
            <div className="font-display text-lg uppercase tracking-widest text-gold-300">{report.winBy}</div>
            <div className="mt-1 text-xs text-stone-500">
              {report.config.kelas ? `${report.config.kelas} · ` : ''}
              {report.roundsCompleted} babak · {fmtClock(report.duration)} · sumber {report.source}
              {report.avgFps > 0 ? ` · ${report.avgFps} fps` : ''}
              {report.visibility > 0 ? ` · visibilitas sendi ${Math.round(report.visibility * 100)}%` : ''}
            </div>
            <div className="mt-3 flex items-end justify-center gap-2">
              {Array.from({ length: roundsShown }, (_, i) => (
                <div key={i} className="text-center">
                  <div className="flex items-end gap-0.5">
                    <div className="w-3 rounded-t" style={{ height: 8 + Math.max(0, fm.byRound[i] ?? 0) * 5, background: CORNER_DEEP.merah }} />
                    <div className="w-3 rounded-t" style={{ height: 8 + Math.max(0, fb.byRound[i] ?? 0) * 5, background: CORNER_DEEP.biru }} />
                  </div>
                  <div className="mt-1 text-[10px] text-stone-500">
                    B{i + 1}: {fm.byRound[i] ?? 0}–{fb.byRound[i] ?? 0}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </Panel>

      {/* Technique tables — successful vs illegal counts */}
      <div className="grid gap-5 lg:grid-cols-2">
        {CORNERS.map((c) => {
          const f = c === 'merah' ? fm : fb;
          return (
            <Panel key={c} className="p-4">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="font-display text-lg uppercase" style={{ color: CORNER_COLORS[c] }}>
                  {name(c)}
                </span>
                <Badge color={CORNER_COLORS[c]}>{c === 'merah' ? 'Sudut Merah' : 'Sudut Biru'}</Badge>
                <span className="ml-auto flex flex-wrap gap-1.5">
                  <Badge color="#a8a29e">
                    <Target className="mr-1 inline h-3 w-3" />akurasi {Math.round(f.strikeAccuracy * 100)}%
                  </Badge>
                  <Badge color="#a8a29e">
                    <Shield className="mr-1 inline h-3 w-3" />jatuh {f.timesDropped}×
                  </Badge>
                  <Badge color={f.fouls ? '#f87171' : '#a8a29e'}>
                    <TriangleAlert className="mr-1 inline h-3 w-3" />ilegal {f.fouls}
                  </Badge>
                  <Badge color="#a8a29e">
                    <Lock className="mr-1 inline h-3 w-3" />kunci {f.lockSeconds.toFixed(1)} dtk
                  </Badge>
                </span>
              </div>
              {techTable(c)}
              <p className="mt-2 text-xs text-stone-500">
                “Sukses” = serangan <b>sah</b> yang mendarat & bernilai. “Ilegal” = serangan ke sasaran terlarang (kepala/leher/kemaluan/dsb.) yang
                memicu hukuman bertingkat. “Gagal” mencakup ditangkis, meleset, tidak jatuh, dan kuncian lepas.
              </p>
            </Panel>
          );
        })}
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-[1.6fr_1fr]">
        <Panel className="p-4">
          <div className="mb-2 font-display uppercase tracking-wide text-gold-200">Momentum Pertandingan</div>
          <MomentumChart report={report} />
          <div className="mt-4 border-t border-white/5 pt-3">
            <div className="mb-2 font-display uppercase tracking-wide text-gold-200">Wawasan Wasit Virtual</div>
            <ul className="space-y-1.5 text-sm leading-relaxed text-stone-300">
              {analysis.map((line, i) => (
                <li key={i} className="flex gap-2">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-gold-400" />
                  {line}
                </li>
              ))}
            </ul>
          </div>
        </Panel>
        <Panel className="p-4">
          <div className="mb-2 font-display uppercase tracking-wide text-gold-200">Profil Teknik (efektivitas %)</div>
          <div className="grid grid-cols-2 gap-2 text-center">
            {CORNERS.map((c) => (
              <div key={c}>
                <RadarChart axes={radarFor(c === 'merah' ? fm : fb)} size={210} />
                <div className="text-xs font-semibold" style={{ color: CORNER_COLORS[c] }}>
                  {name(c)}
                </div>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      {/* Fouls */}
      {fouls.length > 0 && (
        <Panel className="mt-5 overflow-hidden">
          <div className="border-b border-red-400/20 bg-red-500/10 px-4 py-3 font-display uppercase tracking-wide text-red-200">
            Pelanggaran & Serangan Ilegal ({fouls.length})
          </div>
          <div>
            {fouls.map((e) => {
              const pen = PENALTY_LADDER.find((p) => p.level === e.penaltyLevel);
              return (
                <div key={e.id} className="flex items-center gap-3 border-b border-white/5 px-4 py-2.5 text-sm last:border-0">
                  <TriangleAlert className="h-4 w-4 shrink-0 text-red-300" />
                  <span className="tabular-nums text-stone-500">
                    {fmtClock(e.t)} · B{e.round}
                  </span>
                  <Badge color={CORNER_COLORS[e.attacker]}>{name(e.attacker)}</Badge>
                  <span className="flex-1 text-stone-200">{e.note}</span>
                  <span className="text-red-300">{pen ? `${pen.label}${pen.points ? ` (−${pen.points})` : ''}` : ''}</span>
                </div>
              );
            })}
          </div>
        </Panel>
      )}

      {/* Full chronicle (editable) */}
      <Panel className="mt-5 overflow-hidden">
        <div className="flex items-center justify-between border-b border-white/5 px-4 py-3">
          <span className="font-display uppercase tracking-wide text-gold-200">Kronologi Kejadian</span>
          <span className="text-xs text-stone-500">{laddered.length} kejadian · klik status untuk mengoreksi & menghitung ulang</span>
        </div>
        <div className="max-h-[520px] overflow-y-auto">
          {laddered.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-stone-500">Tidak ada kejadian terekam.</p>
          ) : (
            laddered.map((e) => (
              <div key={e.id} className="flex gap-2.5 border-b border-white/5 px-4 py-2.5 last:border-0">
                <span
                  className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg"
                  style={{ background: `${TECHNIQUE_INFO[e.technique].color}1f`, color: TECHNIQUE_INFO[e.technique].color }}
                >
                  {TECH_ICON[e.technique]}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-stone-500">
                    <span className="tabular-nums">{fmtClock(e.t)}</span>
                    <span>B{e.round}</span>
                    <Badge color={CORNER_COLORS[e.attacker]}>{name(e.attacker)}</Badge>
                    <span>{ZONE_INFO[e.zone].label}</span>
                    {e.counterBonus && <Badge color="#f0cf6a">+1 balik</Badge>}
                    <span>{e.source === 'ai' ? `AI ${Math.round(e.confidence * 100)}%` : 'Wasit'}</span>
                  </div>
                  <div className="mt-0.5 text-sm text-stone-200">{e.note}</div>
                  {e.status === 'gagal' && e.failReason && (
                    <div className="text-xs text-stone-500">
                      {FAIL_INFO[e.failReason].label}
                      {e.duration ? ` · ${e.duration.toFixed(1)} dtk` : ''}
                    </div>
                  )}
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <button onClick={() => editStatus(e)} title="Ubah status (Sah → Ilegal → Gagal)">
                    <Badge color={STATUS_INFO[e.status].color}>{STATUS_INFO[e.status].label}</Badge>
                  </button>
                  {e.points > 0 && <span className="font-display text-sm tabular-nums text-emerald-300">+{e.points}</span>}
                  {e.penalty > 0 && <span className="font-display text-sm tabular-nums text-red-300">−{e.penalty}</span>}
                </div>
              </div>
            ))
          )}
        </div>
        <div className="flex items-center gap-2 border-t border-white/5 px-4 py-3 text-xs text-stone-500">
          <X className="h-3.5 w-3.5" />
          Koreksi status di atas langsung menghitung ulang skor, tangga hukuman, dan pemenang, lalu tersimpan ke SQLite.
        </div>
      </Panel>
    </div>
  );
}
