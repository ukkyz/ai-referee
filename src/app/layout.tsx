import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'Wasit Virtual · Pencak Silat AI Referee',
  description:
    'Wasit Virtual Pencak Silat — an AI referee that judges a whole Seni Tunggal jurus: pose sequence correctness, artistry (kemantapan, penghayatan, stamina) and timing, scored the IPSI way.',
  applicationName: 'Wasit Virtual Pencak Silat',
  keywords: ['pencak silat', 'seni tunggal', 'AI referee', 'wasit virtual', 'pose estimation', 'MediaPipe', 'IPSI'],
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#0b0908',
  colorScheme: 'dark',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/* Fonts are loaded at runtime (as before) so builds never block on a font CDN fetch. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Oswald:wght@400;500;600;700&display=swap" rel="stylesheet" />
        {/* MediaPipe Pose Landmarker (WASM + model weights, fetched in the browser). */}
        <link rel="preconnect" href="https://cdn.jsdelivr.net" crossOrigin="anonymous" />
        <link rel="preconnect" href="https://storage.googleapis.com" crossOrigin="anonymous" />
      </head>
      <body>{children}</body>
    </html>
  );
}
