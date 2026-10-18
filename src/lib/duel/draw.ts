import type { Corner, JointName } from '../../types';
import { BONES } from '../pose/landmarks';
import type { Pt } from './geometry';

export const CORNER_COLORS: Record<Corner, string> = {
  merah: '#f87171',
  biru: '#60a5fa',
};
export const CORNER_DEEP: Record<Corner, string> = {
  merah: '#dc2626',
  biru: '#2563eb',
};

export interface DrawFighter {
  /** Aspect-corrected joints (x already multiplied by aspect). */
  joints: Record<JointName, Pt>;
  color: string;
  label: string;
}

/** Draw both fighters (togok target shading + skeleton + label) over the current canvas content. */
export function drawDuelFighters(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  aspect: number,
  mirror: boolean,
  fighters: (DrawFighter | null)[],
) {
  const P = (j: Pt) => {
    const rawX = j.x / aspect;
    return { x: (mirror ? 1 - rawX : rawX) * w, y: j.y * h };
  };
  const lw = Math.max(3, w / 210);
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  for (const f of fighters) {
    if (!f) continue;
    const j = f.joints;
    const vis = (k: JointName) => (j[k].v ?? 1) > 0.25;

    // Legal target (togok) shading.
    if (vis('lShoulder') && vis('rShoulder') && vis('lHip') && vis('rHip')) {
      const quad = [P(j.lShoulder), P(j.rShoulder), P(j.rHip), P(j.lHip)];
      ctx.beginPath();
      ctx.moveTo(quad[0].x, quad[0].y);
      for (let i = 1; i < quad.length; i++) ctx.lineTo(quad[i].x, quad[i].y);
      ctx.closePath();
      ctx.fillStyle = `${f.color}22`;
      ctx.fill();
      ctx.strokeStyle = `${f.color}66`;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    for (const [a, b] of BONES) {
      if (!vis(a) || !vis(b)) continue;
      const pa = P(j[a]);
      const pb = P(j[b]);
      ctx.strokeStyle = 'rgba(0,0,0,0.55)';
      ctx.lineWidth = lw + 4;
      ctx.beginPath();
      ctx.moveTo(pa.x, pa.y);
      ctx.lineTo(pb.x, pb.y);
      ctx.stroke();
      ctx.strokeStyle = f.color;
      ctx.lineWidth = lw;
      ctx.shadowColor = f.color;
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.moveTo(pa.x, pa.y);
      ctx.lineTo(pb.x, pb.y);
      ctx.stroke();
      ctx.shadowBlur = 0;
    }

    const joints: JointName[] = ['lShoulder', 'rShoulder', 'lElbow', 'rElbow', 'lWrist', 'rWrist', 'lHip', 'rHip', 'lKnee', 'rKnee', 'lAnkle', 'rAnkle'];
    for (const k of joints) {
      if (!vis(k)) continue;
      const p = P(j[k]);
      ctx.fillStyle = '#fff7e0';
      ctx.strokeStyle = 'rgba(20,14,8,0.9)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(p.x, p.y, lw * 0.85, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    if (vis('nose')) {
      const n = P(j.nose);
      const a = P(j.lShoulder);
      const b = P(j.rShoulder);
      const sw = Math.hypot(a.x - b.x, a.y - b.y);
      const r = Math.max(9, sw * 0.34);
      ctx.strokeStyle = f.color;
      ctx.lineWidth = lw * 0.7;
      ctx.beginPath();
      ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
      ctx.stroke();
      // Corner label above the head.
      ctx.font = `600 ${Math.max(12, w / 52)}px Oswald, Inter, sans-serif`;
      ctx.textAlign = 'center';
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(0,0,0,0.75)';
      const ly = Math.max(16, n.y - r - 9);
      ctx.strokeText(f.label, n.x, ly);
      ctx.fillStyle = f.color;
      ctx.fillText(f.label, n.x, ly);
    }
  }
  ctx.restore();
}
