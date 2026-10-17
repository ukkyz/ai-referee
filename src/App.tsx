import { useEffect, useState, type ReactNode } from 'react';
import { Clapperboard, History as HistoryIcon, House, Settings } from 'lucide-react';
import type { Jurus, RefereeSettings, Report } from './types';
import { PRESET_JURUS } from './data/jurus';
import { loadCustomJurus, loadHistory, loadSettings, saveCustomJurus, saveHistory, saveSettings } from './lib/storage';
import Home from './views/Home';
import Arena from './views/Arena';
import Results from './views/Results';
import Studio from './views/Studio';
import History from './views/History';
import SettingsDialog from './components/SettingsDialog';
import { Logo } from './components/ui';
import { cn } from './utils/cn';

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

export default function App() {
  const [view, setView] = useState<View>({ name: 'home' });
  const [settings, setSettings] = useState<RefereeSettings>(() => loadSettings());
  const [customs, setCustoms] = useState<Jurus[]>(() => loadCustomJurus());
  const [history, setHistory] = useState<Report[]>(() => loadHistory());
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => {
    saveSettings(settings);
  }, [settings]);

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [view.name]);

  const findJurus = (id: string) => [...PRESET_JURUS, ...customs].find((j) => j.id === id);

  const saveJurus = (j: Jurus) => {
    const next = customs.some((x) => x.id === j.id) ? customs.map((x) => (x.id === j.id ? j : x)) : [...customs, j];
    setCustoms(next);
    saveCustomJurus(next);
  };

  const deleteJurus = (id: string) => {
    if (!window.confirm('Delete this custom jurus?')) return;
    const next = customs.filter((x) => x.id !== id);
    setCustoms(next);
    saveCustomJurus(next);
  };

  const judge = (j: Jurus) => setView({ name: 'arena', jurus: j, attempt: Date.now() });

  const onFinish = (r: Report) => {
    if (r.source !== 'demo') setHistory((prev) => saveHistory([r, ...prev.filter((x) => x.id !== r.id)]));
    setView({ name: 'results', report: r, from: 'arena' });
  };

  const deleteReport = (id: string) => {
    const next = history.filter((r) => r.id !== id);
    setHistory(saveHistory(next));
  };

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
          onClear={() => setHistory(saveHistory([]))}
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

      <main>{content}</main>

      <footer className="border-t border-white/5 py-8 text-center text-xs text-stone-500">
        <div className="mx-auto max-w-3xl px-4 leading-relaxed">
          Pose estimation runs entirely in your browser (MediaPipe Pose Landmarker) — video never leaves your device. Scoring follows the IPSI Seni Tunggal structure: Nilai Kebenaran (100 − kesalahan), Nilai Kemantapan (50–60) and time penalties. A
          training aid, not an official competition result.
        </div>
      </footer>

      <SettingsDialog open={showSettings} settings={settings} onChange={setSettings} onClose={() => setShowSettings(false)} />
    </div>
  );
}
