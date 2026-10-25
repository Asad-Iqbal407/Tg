import { hudPill, text } from './draw';

/**
 * A row of HUD pills across the top of the canvas, each with a small label above its value. Used by the games
 * whose HUD is a few numbers (Brick Breaker, 2048, Sky Hopper). `u` scales sizes; `top` is the inset to stay under.
 */
export function drawStatBar(
  ctx: CanvasRenderingContext2D,
  W: number,
  top: number,
  u: number,
  items: readonly (readonly [string, string])[],
  labelColor = 'rgba(255,255,255,0.7)',
): void {
  const n = items.length;
  if (n === 0) return;
  const pad = 12 * u;
  const gap = 10 * u;
  const h = 46 * u;
  const w = (W - pad * 2 - gap * (n - 1)) / n;
  const y = top + 10 * u;
  items.forEach(([label, value], i) => {
    const x = pad + i * (w + gap);
    hudPill(ctx, x, y, w, h);
    text(ctx, label, x + w / 2, y + h * 0.3, {
      size: Math.max(11, 11 * u),
      align: 'center',
      color: labelColor,
      stroke: null,
    });
    text(ctx, value, x + w / 2, y + h * 0.66, { size: Math.max(16, 20 * u), align: 'center' });
  });
}

/** Height the stat bar takes below `top`, including its margins. */
export function statBarHeight(u: number): number {
  return 66 * u;
}

/** Mix two #rrggbb colours: t = 0 gives `a`, t = 1 gives `b`. */
export function mixHex(a: string, b: string, t: number): string {
  const pa = parseHex(a);
  const pb = parseHex(b);
  const k = Math.max(0, Math.min(1, t));
  const c = pa.map((v, i) => Math.round(v + ((pb[i] ?? v) - v) * k));
  return `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

function parseHex(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? [...h].map((ch) => ch + ch).join('') : h.padEnd(6, '0').slice(0, 6);
  const n = Number.parseInt(full, 16);
  if (!Number.isFinite(n)) return [255, 255, 255];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
