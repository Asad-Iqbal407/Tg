import { TAU } from '../../core/math';
import type { Insets } from '../types';
import { fillRoundRect, hudPill, progressBar, shade, text } from '../draw';
import { type Apple, type BoardRect, type Cell, type Dir, type Grid, cellCentre, delta } from './board';

export interface Palette {
  body: string;
  head: string;
  food: string;
  gold: string;
  board1: string;
  board2: string;
  wall: string;
}

/** Seconds a golden apple lasts, and the blink window before it goes. */
export const GOLDEN_SEC = 6;
const GOLDEN_BLINK_SEC = 1.5;
const DEATH_FLASH = '#fb7185';

const HEX = /^#?([0-9a-f]{6})$/i;

function channels(hex: string): [number, number, number] | null {
  const m = HEX.exec(hex);
  if (!m || !m[1]) return null;
  const v = parseInt(m[1], 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

/** Linear blend of two hex colours: t = 0 gives `a`, t = 1 gives `b`. Non-hex input is returned as `a`. */
export function mixHex(a: string, b: string, t: number): string {
  const ca = channels(a);
  const cb = channels(b);
  if (!ca || !cb) return a;
  const k = Math.max(0, Math.min(1, t));
  const mix = (i: 0 | 1 | 2): number => Math.round(ca[i] + (cb[i] - ca[i]) * k);
  return `rgb(${mix(0)},${mix(1)},${mix(2)})`;
}

/** Width of the stone frame around the playfield. */
export function frameWidth(cell: number): number {
  return Math.max(4, Math.round(cell * 0.4));
}

/**
 * A stone block: a dark rim, a lit face and a highlight bevel along the top. Used for the frame and for
 * every wall cell.
 */
function stone(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number, base: string) {
  fillRoundRect(ctx, x, y, w, h, r, shade(base, -0.45));
  fillRoundRect(ctx, x + 1, y + 1, w - 2, h - 3, Math.max(0, r - 1), base);
  fillRoundRect(ctx, x + 2, y + 2, w - 4, Math.min(3, h * 0.18), 1.5, shade(base, 0.4));
}

export function drawFrame(ctx: CanvasRenderingContext2D, grid: Grid, rect: BoardRect, pal: Palette): void {
  const f = frameWidth(rect.cell);
  const w = grid.cols * rect.cell + 2 * f;
  const h = grid.rows * rect.cell + 2 * f;
  stone(ctx, rect.x - f, rect.y - f, w, h, f * 0.8, pal.wall);
}

export function drawBoard(ctx: CanvasRenderingContext2D, grid: Grid, rect: BoardRect, pal: Palette): void {
  const { cell } = rect;
  ctx.fillStyle = pal.board1;
  ctx.fillRect(rect.x, rect.y, grid.cols * cell, grid.rows * cell);
  ctx.fillStyle = pal.board2;
  for (let y = 0; y < grid.rows; y++) {
    for (let x = y & 1; x < grid.cols; x += 2) {
      ctx.fillRect(rect.x + x * cell, rect.y + y * cell, cell, cell);
    }
  }
}

export function drawWalls(ctx: CanvasRenderingContext2D, grid: Grid, rect: BoardRect, wall: string): void {
  const { cell } = rect;
  for (let i = 0; i < grid.size; i++) {
    if (!grid.walls[i]) continue;
    const x = i % grid.cols;
    const y = (i - x) / grid.cols;
    stone(ctx, rect.x + x * cell + 1, rect.y + y * cell + 1, cell - 2, cell - 2, cell * 0.2, wall);
  }
}

/** Four-point star used for the golden apple's sparkle. */
function sparkle(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x, y - r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.quadraticCurveTo(x, y, x, y + r);
  ctx.quadraticCurveTo(x, y, x - r, y);
  ctx.quadraticCurveTo(x, y, x, y - r);
  ctx.closePath();
  ctx.fill();
}

/** Red or golden apple. A golden one sparkles, shows its time left and blinks at the end. */
export function drawApple(ctx: CanvasRenderingContext2D, apple: Apple, rect: BoardRect, pal: Palette, time: number): void {
  const c = cellCentre(rect, apple);
  const pop = Math.min(1, 0.3 + apple.age * 4);
  const r = rect.cell * 0.36 * pop;
  if (apple.golden) {
    ctx.fillStyle = `rgba(253,224,71,${0.2 + 0.1 * Math.sin(time * 5)})`;
    ctx.beginPath();
    ctx.arc(c.x, c.y, r * 1.7, 0, TAU);
    ctx.fill();
  }
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.beginPath();
  ctx.ellipse(c.x + r * 0.12, c.y + r * 0.95, r * 0.85, r * 0.3, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = apple.golden ? pal.gold : pal.food;
  ctx.beginPath();
  ctx.arc(c.x, c.y + r * 0.08, r, 0, TAU);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ctx.beginPath();
  ctx.ellipse(c.x - r * 0.38, c.y - r * 0.2, r * 0.22, r * 0.13, -0.6, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = '#6b3d12';
  ctx.lineWidth = Math.max(1.5, r * 0.16);
  ctx.beginPath();
  ctx.moveTo(c.x, c.y - r * 0.7);
  ctx.quadraticCurveTo(c.x + r * 0.05, c.y - r * 1.15, c.x + r * 0.25, c.y - r * 1.25);
  ctx.stroke();
  ctx.fillStyle = '#22c55e';
  ctx.beginPath();
  ctx.ellipse(c.x + r * 0.45, c.y - r * 0.95, r * 0.34, r * 0.17, -0.5, 0, TAU);
  ctx.fill();
  if (apple.golden) {
    if (Number.isFinite(apple.left)) {
      ctx.strokeStyle = pal.gold;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(c.x, c.y, r * 1.45, -Math.PI / 2, -Math.PI / 2 + TAU * Math.max(0, apple.left / GOLDEN_SEC));
      ctx.stroke();
    }
    const s = r * (0.28 + 0.12 * Math.sin(time * 7));
    sparkle(ctx, c.x + r * 0.62, c.y - r * 0.62, s, '#ffffff');
    sparkle(ctx, c.x - r * 0.75, c.y + r * 0.45, s * 0.5, '#fef9c3');
  }
}

/** True while a golden apple is in its blink window (drawn hidden every other tick of 0.1 s). */
export function appleBlinkedOff(apple: Apple, time: number): boolean {
  return apple.golden && apple.left < GOLDEN_BLINK_SEC && Math.floor(time * 10) % 2 === 0;
}

export interface SnakeLook {
  heading: Dir;
  /** Extra body thickness from the skin (0 = classic). */
  thick: number;
  /** Semi-transparent while invulnerable after a shield absorb. */
  ghost: boolean;
  /** The run is over: the head flashes. */
  dead: boolean;
  time: number;
}

/**
 * The snake as one rounded body through the segment centres, fading slightly toward the tail, with a
 * larger head, two eyes along the heading and a tongue that flickers.
 */
export function drawSnake(
  ctx: CanvasRenderingContext2D,
  body: readonly Cell[],
  rect: BoardRect,
  pal: Palette,
  look: SnakeLook,
): void {
  const { cell } = rect;
  const n = body.length;
  const width = cell * (0.78 + 0.06 * look.thick);
  const tailColour = shade(pal.body, -0.35);
  ctx.save();
  if (look.ghost) ctx.globalAlpha = 0.45 + 0.25 * Math.sin(look.time * 18);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = width;
  for (let i = n - 1; i >= 1; i--) {
    const a = cellCentre(rect, body[i] as Cell);
    const b = cellCentre(rect, body[i - 1] as Cell);
    ctx.strokeStyle = mixHex(pal.body, tailColour, (0.8 * i) / Math.max(1, n - 1));
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(255,255,255,0.16)';
  ctx.lineWidth = width * 0.28;
  ctx.beginPath();
  for (let i = n - 1; i >= 0; i--) {
    const p = cellCentre(rect, body[i] as Cell);
    if (i === n - 1) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  }
  ctx.stroke();

  const head = cellCentre(rect, body[0] as Cell);
  const d = delta(look.heading);
  const px = -d.y;
  const py = d.x;
  const r = width * 0.62;
  // Tongue first, so the head covers its root.
  if (Math.sin(look.time * 10) > 0.55 && !look.dead) {
    const tx = head.x + d.x * (r + cell * 0.32);
    const ty = head.y + d.y * (r + cell * 0.32);
    ctx.strokeStyle = DEATH_FLASH;
    ctx.lineWidth = Math.max(1.5, cell * 0.07);
    ctx.beginPath();
    ctx.moveTo(head.x + d.x * r, head.y + d.y * r);
    ctx.lineTo(tx, ty);
    ctx.lineTo(tx + d.x * cell * 0.1 + px * cell * 0.12, ty + d.y * cell * 0.1 + py * cell * 0.12);
    ctx.moveTo(tx, ty);
    ctx.lineTo(tx + d.x * cell * 0.1 - px * cell * 0.12, ty + d.y * cell * 0.1 - py * cell * 0.12);
    ctx.stroke();
  }
  const flashOn = look.dead && Math.floor(look.time * 10) % 2 === 0;
  ctx.fillStyle = flashOn ? DEATH_FLASH : pal.head;
  ctx.beginPath();
  ctx.arc(head.x, head.y, r, 0, TAU);
  ctx.fill();
  for (const side of [-1, 1]) {
    const ex = head.x + d.x * r * 0.3 + px * side * r * 0.5;
    const ey = head.y + d.y * r * 0.3 + py * side * r * 0.5;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(ex, ey, r * 0.28, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#0b1020';
    ctx.beginPath();
    ctx.arc(ex + d.x * r * 0.1, ey + d.y * r * 0.1, r * 0.14, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}

export interface HudValues {
  score: number;
  level: number;
  length: number;
  /** Remaining slow-motion time as a fraction of its full duration. */
  slow: number;
}

/** Top strip: score, level and length pills, with the slow-motion meter under them. */
export function drawHud(
  ctx: CanvasRenderingContext2D,
  W: number,
  insets: Readonly<Insets>,
  pal: Palette,
  v: HudValues,
): void {
  const y = 10 + insets.top;
  hudPill(ctx, 12 + insets.left, y, 164, 34);
  text(ctx, 'SCORE', 24 + insets.left, y + 17, { size: 11, color: '#d1fae5' });
  text(ctx, v.score.toLocaleString('en-US'), 164 + insets.left, y + 17, { size: 18, align: 'right' });
  hudPill(ctx, W / 2 - 56, y, 112, 34);
  text(ctx, `LEVEL ${v.level}`, W / 2, y + 17, { size: 15, align: 'center' });
  hudPill(ctx, W - 144 - insets.right, y, 132, 34);
  text(ctx, 'LENGTH', W - 132 - insets.right, y + 17, { size: 11, color: '#d1fae5' });
  text(ctx, `${v.length}`, W - 24 - insets.right, y + 17, { size: 18, align: 'right' });
  progressBar(
    ctx,
    12 + insets.left,
    52 + insets.top,
    W - 24 - insets.left - insets.right,
    6,
    v.slow,
    pal.gold,
  );
}
