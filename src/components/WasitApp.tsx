'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Clapperboard, History as HistoryIcon, House, LoaderCircle, Settings, TriangleAlert, X } from 'lucide-react';
import { DEFAULT_SETTINGS, type Jurus, type RefereeSettings, type Report } from '../types';
import { PRESET_JURUS } from '../data/jurus';
import { bootstrapFromServer, clearHistory, persistJurus, persistReport, persistSettings, removeJurus, removeReport } from '../lib/storage';
import Home from '../views/Home';
import Arena from '../views/Arena';
import Results from '../views/Results';
import Studio from '../views/Studio';
import History from '../views/History';
import SettingsDialog from './SettingsDialog';
import { Logo } from './ui';
import { cn } from '../utils/cn';

type View =
  | { name: 'home' }
  | { name: 'arena'; jurus: Jurus; attempt: number }
  | { name: 'results'; report: Report; from: 'arena' | 'history' }
  | { name: 'studio'; edit: Jurus | null }
  | { name: 'history' };

function NavButton({ active, onClick, icon, label, badge }: { active: boolean; onClick: () => void; icon: ReactNode; label: string; badge?: number }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'relative flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition',
        active ? 'bg-gold-400/15 text-gold-200' : 'text-stone-400 hover:bg-white/5 hover:text-stone-200',
      )}
    >
      {icon}
      <span className="hidden sm:inline">{label}</span>
      {badge ? <span className="rounded-full bg-gold-400/20 px-1.5 text-[10px] text-gold-200">{badge}</span> : null}
    </button>
  );
}

export default function WasitApp() {
  const [view, setView] = useState<View>({ name: 'home' });
  const [settings, setSettings] = useState<RefereeSettings>(DEFAULT_SETTINGS);
  const [customs, setCustoms] = useState<Jurus[]>([]);
  const [history, setHistory] = useState<Report[]>([]);
  const [showSettings, setShowSettings] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [dbError, setDbError] = useState<string | null>(null);
  const lastSavedSettings = useRef('');

  const load = useCallback(async () => {
    try {
      const data = await bootstrapFromServer();
      lastSavedSettings.current = JSON.stringify(data.settings);
      setSettings(data.settings);
      setCustoms(data.customs);
      setHistory(data.history);
      setDbError(null);
    } catch (e) {
      console.error('[app] failed to load data from SQLite API', e);
      setDbError('Could not load saved data from the server database. The referee still works, but changes may not be saved.');
    } finally {
      setHydrated(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Persist settings (debounced — sliders emit many changes per drag).
  useEffect(() => {
    if (!hydrated) return;
    const serialized = JSON.stringify(settings);
    if (serialized === lastSavedSettings.current) return;
    const timer = setTimeout(() => {
      persistSettings(settings)
        .then((saved) => {
          lastSavedSettings.current = JSON.stringify(saved);
        })
        .catch((e) => {
          console.warn('[app] failed to save settings', e);
          setDbError('Settings could not be saved to the database.');
        });
    }, 400);
    return () => clearTimeout(timer);
  }, [settings, hydrated]);

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [view.name]);

  const findJurus = (id: string) => [...PRESET_JURUS, ...customs].find((j) => j.id === id);

  const saveJurus = (j: Jurus) => {
    const prev = customs;
    const next = customs.some((x) => x.id === j.id) ? customs.map((x) => (x.id === j.id ? j : x)) : [...customs, j];
    setCustoms(next);
    persistJurus(j)
      .then((saved) => setCustoms((list) => list.map((x) => (x.id === saved.id ? saved : x))))
      .catch((e) => {
        console.warn('[app] failed to save jurus', e);
        setCustoms(prev);
        setDbError('The custom jurus could not be saved to the database.');
      });
  };

  const deleteJurus = (id: string) => {
    if (!window.confirm('Delete this custom jurus?')) return;
    const prev = customs;
    setCustoms(customs.filter((x) => x.id !== id));
    removeJurus(id).catch((e) => {
      console.warn('[app] failed to delete jurus', e);
      setCustoms(prev);
      setDbError('The custom jurus could not be deleted from the database.');
    });
  };

  const judge = (j: Jurus) => setView({ name: 'arena', jurus: j, attempt: Date.now() });

  const onFinish = (r: Report) => {
    if (r.source !== 'demo') {
      setHistory((prev) => [r, ...prev.filter((x) => x.id !== r.id)]);
      persistReport(r)
        .then((saved) => setHistory((prev) => prev.map((x) => (x.id === saved.id ? saved : x))))
        .catch((e) => {
          console.warn('[app] failed to save report', e);
          setHistory((prev) => prev.filter((x) => x.id !== r.id));
          setDbError('This verdict could not be saved to the database — export the JSON from the results page to keep it.');
        });
    }
    setView({ name: 'results', report: r, from: 'arena' });
  };

  const deleteReport = (id: string) => {
    const prev = history;
    setHistory(history.filter((r) => r.id !== id));
    removeReport(id).catch((e) => {
      console.warn('[app] failed to delete report', e);
      setHistory(prev);
      setDbError('The verdict could not be deleted from the database.');
    });
  };

  const clearAllReports = () => {
    const prev = history;
    setHistory([]);
    clearHistory().catch((e) => {
      console.warn('[app] failed to clear history', e);
      setHistory(prev);
      setDbError('History could not be cleared from the database.');
    });
  };

  if (!hydrated) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-4 text-center">
        <Logo className="h-14 w-14" />
        <div className="font-display text-2xl uppercase tracking-wider text-gold-100">Wasit Virtual</div>
        <div className="flex items-center gap-2 text-sm text-stone-400">
          <LoaderCircle className="h-4 w-4 animate-spin text-gold-400" />
          Memuat data… · Loading your jurus, settings & verdicts…
        </div>
      </div>
    );
  }

  let content: ReactNode;
  switch (view.name) {
    case 'home':
      content = <Home presets={PRESET_JURUS} customs={customs} onJudge={judge} onCreate={() => setView({ name: 'studio', edit: null })} onEdit={(j) => setView({ name: 'studio', edit: j })} onDelete={deleteJurus} />;
      break;
    case 'arena':
      content = <Arena key={view.attempt} jurus={view.jurus} settings={settings} onFinish={onFinish} onBack={() => setView({ name: 'home' })} />;
      break;
    case 'results': {
      const j = findJurus(view.report.jurusId);
      content = (
        <Results
          report={view.report}
          onRetry={j ? () => judge(j) : undefined}
          onHome={() => setView(view.from === 'history' ? { name: 'history' } : { name: 'home' })}
          backLabel={view.from === 'history' ? 'History' : 'Home'}
        />
      );
      break;
    }
    case 'studio':
      content = <Studio key={view.edit?.id ?? 'new'} initial={view.edit} settings={settings} onSave={saveJurus} onTest={judge} onBack={() => setView({ name: 'home' })} />;
      break;
    case 'history':
      content = (
        <History
          history={history}
          onOpen={(r) => setView({ name: 'results', report: r, from: 'history' })}
          onDelete={deleteReport}
          onClear={clearAllReports}
          onBack={() => setView({ name: 'home' })}
        />
      );
      break;
  }

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 border-b border-gold-500/10 bg-ink-950/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1400px] items-center gap-4 px-4 py-3 sm:px-6">
          <button onClick={() => setView({ name: 'home' })} className="flex items-center gap-2.5">
            <Logo className="h-9 w-9" />
            <div className="text-left leading-tight">
              <div className="font-display text-lg uppercase tracking-wider text-gold-100">Wasit Virtual</div>
              <div className="text-[10px] uppercase tracking-[0.3em] text-stone-500">Pencak Silat · AI</div>
            </div>
          </button>
          <nav className="ml-auto flex items-center gap-1">
            <NavButton active={view.name === 'home' || view.name === 'arena'} onClick={() => setView({ name: 'home' })} icon={<House className="h-4 w-4" />} label="Gelanggang" />
            <NavButton active={view.name === 'studio'} onClick={() => setView({ name: 'studio', edit: null })} icon={<Clapperboard className="h-4 w-4" />} label="Studio" />
            <NavButton active={view.name === 'history' || (view.name === 'results' && view.from === 'history')} onClick={() => setView({ name: 'history' })} icon={<HistoryIcon className="h-4 w-4" />} label="Riwayat" badge={history.length || undefined} />
            <NavButton active={showSettings} onClick={() => setShowSettings(true)} icon={<Settings className="h-4 w-4" />} label="Settings" />
          </nav>
        </div>
      </header>

      {dbError && (
        <div className="border-b border-amber-400/20 bg-amber-400/10">
          <div className="mx-auto flex max-w-[1400px] items-center gap-3 px-4 py-2.5 text-sm text-amber-200 sm:px-6">
            <TriangleAlert className="h-4 w-4 shrink-0" />
            <span className="flex-1">{dbError}</span>
            <button onClick={() => void load()} className="shrink-0 font-medium underline underline-offset-2 hover:text-amber-100">
              Retry
            </button>
            <button onClick={() => setDbError(null)} className="shrink-0 rounded p-0.5 hover:bg-white/10" title="Dismiss">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      <main>{content}</main>

      <footer className="border-t border-white/5 py-8 text-center text-xs text-stone-500">
        <div className="mx-auto max-w-3xl px-4 leading-relaxed">
          Pose estimation runs entirely in your browser (MediaPipe Pose Landmarker) — video never leaves your device. Custom jurus, settings and verdict history are stored on the server in SQLite. Scoring follows the IPSI Seni
          Tunggal structure: Nilai Kebenaran (100 − kesalahan), Nilai Kemantapan (50–60) and time penalties. A training aid, not an official competition result.
        </div>
      </footer>

      <SettingsDialog open={showSettings} settings={settings} onChange={setSettings} onClose={() => setShowSettings(false)} />
    </div>
  );
}
