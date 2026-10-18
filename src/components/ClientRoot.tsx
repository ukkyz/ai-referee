'use client';

import dynamic from 'next/dynamic';
import { LoaderCircle } from 'lucide-react';
import { Logo } from './ui';

/**
 * The whole referee UI depends on browser-only APIs (getUserMedia, canvas,
 * Web Audio, MediaPipe WASM), so it is loaded with `ssr: false`. Next.js only
 * allows that option inside a Client Component — hence this thin wrapper.
 */
const WasitApp = dynamic(() => import('./WasitApp'), {
  ssr: false,
  loading: () => (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-4 text-center">
      <Logo className="h-14 w-14" />
      <div className="font-display text-2xl uppercase tracking-wider text-gold-100">Wasit Virtual</div>
      <div className="flex items-center gap-2 text-sm text-stone-400">
        <LoaderCircle className="h-4 w-4 animate-spin text-gold-400" />
        Memuat gelanggang… · Loading the arena…
      </div>
    </div>
  ),
});

export default function ClientRoot() {
  return <WasitApp />;
}
