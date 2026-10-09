import { FONT } from '../core/fx';
import { TAU } from '../core/math';

export { FONT };

export function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

export function fillRoundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  fill: string | CanvasGradient,
): void {
  roundRectPath(ctx, x, y, w, h, r);
  ctx.fillStyle = fill;
  ctx.fill();
}

export interface TextOpts {
  size?: number;
  align?: CanvasTextAlign;
  baseline?: CanvasTextBaseline;
  color?: string;
  weight?: number;
  stroke?: string | null;
  strokeWidth?: number;
}

export function text(
  ctx: CanvasRenderingContext2D,
  value: string,
  x: number,
  y: number,
  o: TextOpts = {},
): void {
  ctx.font = `${o.weight ?? 800} ${o.size ?? 20}px ${FONT}`;
  ctx.textAlign = o.align ?? 'left';
  ctx.textBaseline = o.baseline ?? 'middle';
  if (o.stroke !== null) {
    ctx.lineJoin = 'round';
    ctx.lineWidth = o.strokeWidth ?? Math.max(3, (o.size ?? 20) / 5);
    ctx.strokeStyle = o.stroke ?? 'rgba(0,0,0,0.55)';
    ctx.strokeText(value, x, y);
  }
  ctx.fillStyle = o.color ?? '#fff';
  ctx.fillText(value, x, y);
}

/** Translucent HUD pill. */
export function hudPill(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  fillRoundRect(ctx, x, y, w, h, h / 2, 'rgba(8, 10, 30, 0.55)');
  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.lineWidth = 1.5;
  roundRectPath(ctx, x, y, w, h, h / 2);
  ctx.stroke();
}

export function drawCoin(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, spin = 1): void {
  const sx = Math.max(0.12, Math.abs(spin));
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(sx, 1);
  const g = ctx.createRadialGradient(-r * 0.3, -r * 0.3, r * 0.1, 0, 0, r);
  g.addColorStop(0, '#fff6b0');
  g.addColorStop(0.5, '#ffd23f');
  g.addColorStop(1, '#d48a00');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = '#a86400';
  ctx.lineWidth = Math.max(1, r * 0.14);
  ctx.stroke();
  if (sx > 0.4) {
    ctx.fillStyle = 'rgba(168,100,0,0.8)';
    ctx.fillRect(-r * 0.12, -r * 0.5, r * 0.24, r);
  }
  ctx.restore();
}

export function progressBar(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  t: number,
  color: string,
  back = 'rgba(255,255,255,0.15)',
): void {
  fillRoundRect(ctx, x, y, w, h, h / 2, back);
  const fw = Math.max(0, Math.min(1, t)) * w;
  if (fw > 1) fillRoundRect(ctx, x, y, fw, h, h / 2, color);
}

/** Big centred announcement ("WAVE 3", "LEVEL CLEAR") that scales in and fades out over `t` ∈ [0,1]. */
export function banner(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  title: string,
  subtitle: string,
  t: number,
  color = '#fff',
): void {
  const a = t < 0.15 ? t / 0.15 : t > 0.8 ? (1 - t) / 0.2 : 1;
  const s = t < 0.15 ? 0.6 + 0.4 * (t / 0.15) : 1;
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, a));
  ctx.translate(w / 2, h * 0.38);
  ctx.scale(s, s);
  text(ctx, title, 0, 0, { size: Math.min(64, w / 9), align: 'center', color, strokeWidth: 8 });
  if (subtitle)
    text(ctx, subtitle, 0, Math.min(52, w / 11), {
      size: Math.min(24, w / 22),
      align: 'center',
      weight: 700,
    });
  ctx.restore();
}

/** Deterministic hash noise in [0,1) for stable procedural decoration. */
export function hash1(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

export function shade(hex: string, amount: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m || !m[1]) return hex;
  const v = parseInt(m[1], 16);
  const ch = (shift: number) => {
    const c = (v >> shift) & 255;
    const out = amount >= 0 ? c + (255 - c) * amount : c * (1 + amount);
    return Math.round(Math.max(0, Math.min(255, out)));
  };
  return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
}
