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
/** Colour steps used to fade the snake body toward its tail. */
const FADE_STEPS = 8;
/** How much darker the tail is than the body colour, as a blend toward black. */
const TAIL_DIM = 0.35;
/** Head radius on a touch layout, in cells: about 1.36 cells across, so the head reads on a small screen. */
const TOUCH_HEAD_CELLS = 0.68;

const HEX = /^#?([0-9a-f]{6})$/i;

function channels(hex: string): [number, number, number] | null {
  const m = HEX.exec(hex);
  if (!m || !m[1]) return null;
  const v = parseInt(m[1], 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

/**
 * Linear blend of two colours: t = 0 gives `a`, t = 1 gives `b`. Both must be #rrggbb hex (a `shade()` result
 * is rgb() and is not parsed); the blend is returned as an rgb() string. Anything else is returned as `a`.
 */
export function mixHex(a: string, b: string, t: number): string {
  const ca = channels(a);
  const cb = channels(b);
  if (!ca || !cb) return a;
  const k = Math.max(0, Math.min(1, t));
  const mix = (i: 0 | 1 | 2): number => Math.round(ca[i] + (cb[i] - ca[i]) * k);
  return `rgb(${mix(0)},${mix(1)},${mix(2)})`;
}

const fadeCache = new Map<string, readonly string[]>();

/**
 * The body colour at each fade step, from the head (index 0) down to the tail (last index), darkening toward
 * black. Built once per colour, so no colour strings are made while drawing.
 */
export function bodyShades(body: string): readonly string[] {
  const cached = fadeCache.get(body);
  if (cached) return cached;
  const shades: string[] = [];
  for (let k = 0; k < FADE_STEPS; k++)
    shades.push(mixHex(body, '#000000', (TAIL_DIM * k) / (FADE_STEPS - 1)));
  fadeCache.set(body, shades);
  return shades;
}

/** Width of the stone frame around the playfield. */
export function frameWidth(cell: number): number {
  return Math.max(4, Math.round(cell * 0.4));
}

/**
 * A stone block: a dark rim, a lit face and a highlight bevel along the top. Used for the frame and for
 * every wall cell.
 */
function stone(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  base: string,
): void {
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
export function drawApple(
  ctx: CanvasRenderingContext2D,
  apple: Apple,
  rect: BoardRect,
  pal: Palette,
  time: number,
): void {
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

/**
 * Radius of the snake's head in logical px. Desktop keeps the head at 70% of the body width. A touch layout
 * draws a larger head, so the character is easy to find on a phone. The head is drawn only: the snake still
 * moves, eats and crashes on whole cells.
 */
export function headRadius(cell: number, thick: number, touch: boolean): number {
  const r = cell * (0.78 + 0.06 * thick) * 0.7;
  return touch ? Math.max(r, cell * TOUCH_HEAD_CELLS) : r;
}

export interface SnakeLook {
  heading: Dir;
  /** Extra body thickness from the skin (0 = classic). */
  thick: number;
  /** Semi-transparent while invulnerable after a shield absorb. */
  ghost: boolean;
  /** The run is over: the head flashes. */
  dead: boolean;
  /** Coarse pointer: draws the larger touch head (see headRadius). */
  touch: boolean;
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
  // The body fades toward the tail in a few steps: one stroke colour per step, from the cached shades.
  const shades = bodyShades(pal.body);
  const cx = (c: Cell): number => rect.x + (c.x + 0.5) * cell;
  const cy = (c: Cell): number => rect.y + (c.y + 0.5) * cell;
  ctx.save();
  if (look.ghost) ctx.globalAlpha = 0.45 + 0.25 * Math.sin(look.time * 18);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = width;
  for (let i = n - 1; i >= 1; i--) {
    const a = body[i] as Cell;
    const b = body[i - 1] as Cell;
    ctx.strokeStyle = shades[Math.floor(((FADE_STEPS - 1) * i) / Math.max(1, n - 1))] ?? pal.body;
    ctx.beginPath();
    ctx.moveTo(cx(a), cy(a));
    ctx.lineTo(cx(b), cy(b));
    ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(255,255,255,0.16)';
  ctx.lineWidth = width * 0.28;
  ctx.beginPath();
  for (let i = n - 1; i >= 0; i--) {
    const p = body[i] as Cell;
    if (i === n - 1) ctx.moveTo(cx(p), cy(p));
    else ctx.lineTo(cx(p), cy(p));
  }
  ctx.stroke();

  const headCell = body[0] as Cell;
  const hx = cx(headCell);
  const hy = cy(headCell);
  const d = delta(look.heading);
  const px = -d.y;
  const py = d.x;
  const r = headRadius(cell, look.thick, look.touch);
  // Tongue first, so the head covers its root.
  if (Math.sin(look.time * 10) > 0.55 && !look.dead) {
    const tx = hx + d.x * (r + cell * 0.32);
    const ty = hy + d.y * (r + cell * 0.32);
    ctx.strokeStyle = DEATH_FLASH;
    ctx.lineWidth = Math.max(1.5, cell * 0.07);
    ctx.beginPath();
    ctx.moveTo(hx + d.x * r, hy + d.y * r);
    ctx.lineTo(tx, ty);
    ctx.lineTo(tx + d.x * cell * 0.1 + px * cell * 0.12, ty + d.y * cell * 0.1 + py * cell * 0.12);
    ctx.moveTo(tx, ty);
    ctx.lineTo(tx + d.x * cell * 0.1 - px * cell * 0.12, ty + d.y * cell * 0.1 - py * cell * 0.12);
    ctx.stroke();
  }
  const flashOn = look.dead && Math.floor(look.time * 10) % 2 === 0;
  ctx.fillStyle = flashOn ? DEATH_FLASH : pal.head;
  ctx.beginPath();
  ctx.arc(hx, hy, r, 0, TAU);
  ctx.fill();
  for (const side of [-1, 1]) {
    const ex = hx + d.x * r * 0.3 + px * side * r * 0.5;
    const ey = hy + d.y * r * 0.3 + py * side * r * 0.5;
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

/** Touch HUD: a label over a value in each pill. Sizes depend on the canvas shape (see touchHudSize). */
interface TouchHudSize {
  label: number;
  value: number;
  /** Top of the pills and their height. */
  y: number;
  h: number;
  /** Widths of the score, level and length pills. */
  widths: readonly [number, number, number];
  /** Top and height of the slow-motion meter. */
  barY: number;
  barH: number;
}

/**
 * Phones show a portrait board at about 1x, but a landscape one (the same 900 x 640 canvas as the
 * desktop) at about 0.6x, so the landscape type is larger to keep it at 12 CSS px or more.
 */
export function touchHudSize(W: number, H: number): TouchHudSize {
  return W > H
    ? { label: 22, value: 26, y: 6, h: 58, widths: [200, 150, 170], barY: 67, barH: 4 }
    : { label: 14, value: 20, y: 8, h: 50, widths: [118, 96, 110], barY: 62, barH: 6 };
}

function drawTouchHud(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  insets: Readonly<Insets>,
  pal: Palette,
  v: HudValues,
): void {
  const z = touchHudSize(W, H);
  const y = z.y + insets.top;
  const [wScore, wLevel, wLength] = z.widths;
  const left = 10 + insets.left;
  const right = W - 10 - insets.right;
  const pills = [
    { x: left, w: wScore, label: 'SCORE', value: v.score.toLocaleString('en-US') },
    { x: W / 2 - wLevel / 2, w: wLevel, label: 'LEVEL', value: `${v.level}` },
    { x: right - wLength, w: wLength, label: 'LENGTH', value: `${v.length}` },
  ];
  for (const p of pills) {
    hudPill(ctx, p.x, y, p.w, z.h);
    text(ctx, p.label, p.x + p.w / 2, y + z.h * 0.28, { size: z.label, align: 'center', color: '#d1fae5' });
    text(ctx, p.value, p.x + p.w / 2, y + z.h * 0.74, { size: z.value, align: 'center' });
  }
  progressBar(ctx, left, z.barY + insets.top, W - 20 - insets.left - insets.right, z.barH, v.slow, pal.gold);
}

/**
 * Top strip: score, level and length pills, with the slow-motion meter under them. `touch` selects the
 * larger touch layout; desktop keeps its single-line pills.
 */
export function drawHud(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  insets: Readonly<Insets>,
  pal: Palette,
  v: HudValues,
  touch = false,
): void {
  if (touch) {
    drawTouchHud(ctx, W, H, insets, pal, v);
    return;
  }
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
