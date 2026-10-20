import { TAU } from '../../core/math';
import { fillRoundRect, hudPill, shade, text } from '../draw';
import { type Ball, PADDLE_INSET, PADDLE_W, paddleHalf, type Table } from './geometry';

export interface Palette {
  table1: string;
  table2: string;
  line: string;
  rail: string;
  player: string;
  rival: string;
  ball: string;
}

export interface Score {
  player: number;
  rival: number;
  shots: number;
  serving: boolean;
  /** Whose serve it is, shown in the middle pill while the serve waits. */
  server: 'player' | 'computer';
}

/** Smallest score band text, in logical px: about 12 CSS px on the smallest landscape phone stage (L1). */
export const BAND_TEXT_MIN = 20;

/** The table surface, the centre line (the net) and the rails at the playfield's top and bottom. */
export function drawTable(ctx: CanvasRenderingContext2D, t: Table, u: number, pal: Palette): void {
  const w = t.right - t.left;
  ctx.fillStyle = 'rgba(255,255,255,0.05)';
  ctx.fillRect(t.left, t.top, w, t.bottom - t.top);
  const cx = (t.left + t.right) / 2;
  ctx.save();
  ctx.strokeStyle = pal.line;
  ctx.lineWidth = 3 * u;
  ctx.setLineDash([12 * u, 10 * u]);
  ctx.beginPath();
  ctx.moveTo(cx, t.top);
  ctx.lineTo(cx, t.bottom);
  ctx.stroke();
  ctx.restore();
  ctx.fillStyle = pal.rail;
  ctx.fillRect(t.left, t.top - 2 * u, w, 4 * u);
  ctx.fillRect(t.left, t.bottom - 2 * u, w, 4 * u);
}

/** Both paddles, centred on their heights. The player's is on the left. */
export function drawPaddles(
  ctx: CanvasRenderingContext2D,
  t: Table,
  u: number,
  pal: Palette,
  playerY: number,
  rivalY: number,
): void {
  const half = paddleHalf(t);
  const w = PADDLE_W * u;
  const xl = t.left + PADDLE_INSET * u;
  const xr = t.right - (PADDLE_INSET + PADDLE_W) * u;
  paddle(ctx, xl, playerY - half, w, half * 2, pal.player);
  paddle(ctx, xr, rivalY - half, w, half * 2, pal.rival);
}

function paddle(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  colour: string,
): void {
  const g = ctx.createLinearGradient(x, 0, x + w, 0);
  g.addColorStop(0, shade(colour, 0.25));
  g.addColorStop(1, shade(colour, -0.3));
  fillRoundRect(ctx, x, y, w, h, w / 2, g);
}

/** The ball with a short trail. While a serve waits, the ball pulses at the centre and has no trail. */
export function drawBall(
  ctx: CanvasRenderingContext2D,
  ball: Readonly<Ball>,
  trail: readonly { x: number; y: number }[],
  r: number,
  pal: Palette,
  time: number,
  serving: boolean,
): void {
  ctx.save();
  ctx.fillStyle = pal.ball;
  if (!serving) {
    for (let i = 0; i < trail.length; i++) {
      const p = trail[i];
      if (!p) continue;
      const f = (i + 1) / (trail.length + 1);
      ctx.globalAlpha = f * 0.3;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r * (0.4 + 0.6 * f), 0, TAU);
      ctx.fill();
    }
  }
  ctx.globalAlpha = serving ? 0.45 + 0.55 * Math.abs(Math.sin(time * 6)) : 1;
  ctx.beginPath();
  ctx.arc(ball.x, ball.y, r, 0, TAU);
  ctx.fill();
  ctx.restore();
}

/**
 * The score band above the table: the two scores on either side of the middle, and the rally counter in the middle.
 * It sits above the playfield, so nothing here touches the centre line.
 */
export function drawScoreBand(
  ctx: CanvasRenderingContext2D,
  W: number,
  y0: number,
  head: number,
  u: number,
  pal: Palette,
  s: Score,
): void {
  ctx.fillStyle = 'rgba(4, 8, 24, 0.55)';
  ctx.fillRect(0, y0, W, head);
  const cy = y0 + head / 2;
  const cx = W / 2;
  // Wide enough for YOUR SERVE at the smallest text size.
  const pillW = Math.max(Math.min(176 * u, W * 0.22), BAND_TEXT_MIN * 8);
  const pillH = head * 0.6;
  hudPill(ctx, cx - pillW / 2, cy - pillH / 2, pillW, pillH);
  const label = s.serving ? (s.server === 'player' ? 'YOUR SERVE' : 'CPU SERVE') : `RALLY ${s.shots}`;
  text(ctx, label, cx, cy, {
    size: Math.max(BAND_TEXT_MIN, Math.round(pillH * 0.5)),
    align: 'center',
    color: s.serving && s.server === 'player' ? pal.player : '#fff',
  });
  const sides: readonly [number, number, string, string][] = [
    [W * 0.26, s.player, 'YOU', pal.player],
    [W * 0.74, s.rival, 'CPU', pal.rival],
  ];
  for (const [x, value, label, colour] of sides) {
    text(ctx, String(value), x, cy - head * 0.13, {
      size: Math.round(head * 0.5),
      align: 'center',
      color: colour,
    });
    text(ctx, label, x, cy + head * 0.27, {
      size: Math.max(BAND_TEXT_MIN, Math.round(head * 0.3)),
      align: 'center',
      color: 'rgba(255,255,255,0.7)',
    });
  }
}
