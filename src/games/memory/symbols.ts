import { TAU } from '../../core/math';

/** Card faces: a shape and a colour each, all drawn in code. */
export const SYMBOLS: readonly { shape: string; colour: string }[] = [
  { shape: 'circle', colour: '#ef4444' },
  { shape: 'square', colour: '#3b82f6' },
  { shape: 'triangle', colour: '#22c55e' },
  { shape: 'star', colour: '#eab308' },
  { shape: 'heart', colour: '#ec4899' },
  { shape: 'diamond', colour: '#06b6d4' },
  { shape: 'moon', colour: '#8b5cf6' },
  { shape: 'bolt', colour: '#f97316' },
  { shape: 'ring', colour: '#14b8a6' },
  { shape: 'plus', colour: '#84cc16' },
  { shape: 'hexagon', colour: '#6366f1' },
  { shape: 'drop', colour: '#0ea5e9' },
];

function polygon(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  n: number,
  rot: number,
): void {
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const a = rot + (i / n) * TAU;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

/** Draws symbol `id` centred at (cx, cy), about `r` in radius. */
export function drawSymbol(
  ctx: CanvasRenderingContext2D,
  id: number,
  cx: number,
  cy: number,
  r: number,
): void {
  const sym = SYMBOLS[id % SYMBOLS.length];
  if (!sym) return;
  ctx.save();
  ctx.fillStyle = sym.colour;
  ctx.strokeStyle = sym.colour;
  switch (sym.shape) {
    case 'circle':
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, TAU);
      ctx.fill();
      break;
    case 'square':
      ctx.fillRect(cx - r * 0.85, cy - r * 0.85, r * 1.7, r * 1.7);
      break;
    case 'triangle':
      polygon(ctx, cx, cy + r * 0.15, r * 1.1, 3, -Math.PI / 2);
      ctx.fill();
      break;
    case 'star': {
      ctx.beginPath();
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i / 10) * TAU;
        const rr = i % 2 === 0 ? r * 1.1 : r * 0.45;
        const x = cx + Math.cos(a) * rr;
        const y = cy + Math.sin(a) * rr;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'heart':
      ctx.beginPath();
      ctx.moveTo(cx, cy + r * 0.9);
      ctx.bezierCurveTo(cx - r * 1.6, cy - r * 0.1, cx - r * 0.6, cy - r * 1.3, cx, cy - r * 0.4);
      ctx.bezierCurveTo(cx + r * 0.6, cy - r * 1.3, cx + r * 1.6, cy - r * 0.1, cx, cy + r * 0.9);
      ctx.fill();
      break;
    case 'diamond':
      polygon(ctx, cx, cy, r * 1.1, 4, -Math.PI / 2);
      ctx.fill();
      break;
    case 'moon':
      ctx.beginPath();
      ctx.arc(cx, cy, r, Math.PI * 0.3, Math.PI * 1.7);
      ctx.arc(cx + r * 0.45, cy, r * 0.75, Math.PI * 1.55, Math.PI * 0.45, true);
      ctx.closePath();
      ctx.fill();
      break;
    case 'bolt':
      ctx.beginPath();
      ctx.moveTo(cx + r * 0.25, cy - r * 1.1);
      ctx.lineTo(cx - r * 0.65, cy + r * 0.15);
      ctx.lineTo(cx - r * 0.05, cy + r * 0.15);
      ctx.lineTo(cx - r * 0.3, cy + r * 1.1);
      ctx.lineTo(cx + r * 0.7, cy - r * 0.2);
      ctx.lineTo(cx + r * 0.08, cy - r * 0.2);
      ctx.closePath();
      ctx.fill();
      break;
    case 'ring':
      ctx.lineWidth = r * 0.38;
      ctx.beginPath();
      ctx.arc(cx, cy, r * 0.8, 0, TAU);
      ctx.stroke();
      break;
    case 'plus':
      ctx.fillRect(cx - r * 0.3, cy - r, r * 0.6, r * 2);
      ctx.fillRect(cx - r, cy - r * 0.3, r * 2, r * 0.6);
      break;
    case 'hexagon':
      polygon(ctx, cx, cy, r, 6, 0);
      ctx.fill();
      break;
    case 'drop':
      ctx.beginPath();
      ctx.moveTo(cx, cy - r * 1.1);
      ctx.bezierCurveTo(cx + r * 0.9, cy - r * 0.1, cx + r * 0.9, cy + r * 0.9, cx, cy + r * 0.9);
      ctx.bezierCurveTo(cx - r * 0.9, cy + r * 0.9, cx - r * 0.9, cy - r * 0.1, cx, cy - r * 1.1);
      ctx.fill();
      break;
  }
  // A soft shine across the top of every symbol.
  ctx.globalAlpha = 0.25;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.ellipse(cx - r * 0.25, cy - r * 0.45, r * 0.35, r * 0.18, -0.4, 0, TAU);
  ctx.fill();
  ctx.restore();
}
