let ctx: AudioContext | null = null;

function ac(): AudioContext | null {
  try {
    if (!ctx) {
      const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      ctx = new Ctor();
    }
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

/** Synthesised gong — used to start and end the performance like in a real gelanggang. */
export function playGong() {
  const c = ac();
  if (!c) return;
  const now = c.currentTime;
  const master = c.createGain();
  master.gain.setValueAtTime(0.0001, now);
  master.gain.exponentialRampToValueAtTime(0.55, now + 0.015);
  master.gain.exponentialRampToValueAtTime(0.0001, now + 4.5);
  master.connect(c.destination);
  const partials: [number, number][] = [
    [98, 1],
    [196.6, 0.55],
    [262, 0.35],
    [347, 0.25],
    [441, 0.16],
    [587, 0.1],
  ];
  for (const [f, g] of partials) {
    const o = c.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(f * 1.025, now);
    o.frequency.exponentialRampToValueAtTime(f, now + 1.4);
    const gn = c.createGain();
    gn.gain.value = g;
    o.connect(gn).connect(master);
    o.start(now);
    o.stop(now + 4.6);
  }
}

export function playBeep(freq = 880, dur = 0.12, vol = 0.25) {
  const c = ac();
  if (!c) return;
  const now = c.currentTime;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = 'triangle';
  o.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, now);
  g.gain.exponentialRampToValueAtTime(vol, now + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
  o.connect(g).connect(c.destination);
  o.start(now);
  o.stop(now + dur + 0.02);
}

/** Soft chime when a key pose is recognised. */
export function playDing() {
  playBeep(1318, 0.18, 0.12);
  setTimeout(() => playBeep(1760, 0.22, 0.08), 70);
}
