import ClientRoot from '@/components/ClientRoot';

/**
 * Wasit Virtual is a camera-first, single-screen application (Gelanggang →
 * Arena → Results, plus Studio and History). The interactive app is mounted
 * client-side only — see ClientRoot — while all persistence is handled by the
 * Route Handlers under /api/* backed by SQLite.
 */
export default function HomePage() {
  return <ClientRoot />;
}
