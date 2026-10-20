import { formatNumber, TAU } from '../../core/math';
import { fillRoundRect, shade, text } from '../draw';
import { cellX, cellY, type Layout, type Point, type Row, WALL_PAD } from './board';

/** Colours for the walls, the shooter, the bubbles and the text. A skin palette may override any of them. */
export interface Palette {
  top: string;
  bottom: string;
  panel: string;
  rail: string;
  gun: string;
  danger: string;
  text: string;
  /** Bubble colours; index 0 is colour 1 on the grid. */
  bubbles: readonly string[];
}

/** A bubble knocked loose by a drop. It only falls on screen; it never affects play. */
export interface Falling extends Point {
  vx: number;
  vy: number;
  colour: number;
  life: number;
}

export function colourOf(pal: Palette, k: number): string {
  return pal.bubbles[k - 1] ?? pal.text;
}

/** Drawn radius of a bubble: a hair smaller than half the spacing, so neighbours show a thin gap. */
export function bubbleRadius(l: Layout): number {
  return l.d / 2 - Math.max(1.5, l.d * 0.03);
}

/** A flat disc with a darker rim and a small highlight. */
export function drawBubble(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  fill: string,
): void {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = Math.max(1.5, r * 0.12);
  ctx.strokeStyle = shade(fill, -0.4);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x - r * 0.33, y - r * 0.33, r * 0.2, 0, TAU);
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.fill();
}

export function drawBackdrop(ctx: CanvasRenderingContext2D, W: number, H: number, pal: Palette): void {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, pal.top);
  g.addColorStop(1, pal.bottom);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}

/**
 * The playfield panel and the rails: the frame across the top, the two side walls, and the press between the
 * frame and the ceiling. The press grows a row each time the ceiling sinks; `slide` eases it down.
 */
export function drawWalls(
  ctx: CanvasRenderingContext2D,
  l: Layout,
  pal: Palette,
  H: number,
  slide = 0,
): void {
  // A rail never grows wider than the pad beside the playfield, so it stays on the canvas.
  const rail = Math.min(WALL_PAD, Math.max(4, l.d * 0.12));
  const w = l.right - l.left;
  const h = H - l.frame;
  ctx.globalAlpha = 0.35;
  ctx.fillStyle = pal.panel;
  ctx.fillRect(l.left, l.frame, w, h);
  ctx.globalAlpha = 1;
  const ceiling = l.top - slide;
  if (ceiling > l.frame + 1) {
    ctx.fillStyle = shade(pal.panel, -0.25);
    ctx.fillRect(l.left, l.frame, w, ceiling - l.frame);
    // Plates one row tall, from the ceiling up, so each sink adds one visibly.
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = pal.rail;
    for (let y = ceiling - l.rowH; y > l.frame; y -= l.rowH) ctx.fillRect(l.left, y - 1, w, 2);
    ctx.globalAlpha = 1;
    fillRoundRect(ctx, l.left, ceiling - rail, w, rail, rail / 2, pal.rail);
  }
  fillRoundRect(ctx, l.left - rail, l.frame - rail, w + rail * 2, rail, rail / 2, pal.rail);
  fillRoundRect(ctx, l.left - rail, l.frame, rail, h, rail / 2, pal.rail);
  fillRoundRect(ctx, l.right, l.frame, rail, h, rail / 2, pal.rail);
}

/** A dashed line on the boundary above the shooter line, where a bubble would end the run. */
export function drawDangerLine(ctx: CanvasRenderingContext2D, l: Layout, pal: Palette): void {
  const y = cellY(l, l.lineRow) - l.rowH / 2;
  ctx.save();
  ctx.globalAlpha = 0.5;
  ctx.strokeStyle = pal.danger;
  ctx.lineWidth = 2;
  ctx.setLineDash([8, 8]);
  ctx.beginPath();
  ctx.moveTo(l.left, y);
  ctx.lineTo(l.right, y);
  ctx.stroke();
  ctx.restore();
}

/** The hanging grid, clipped to the playfield so a row that is sliding in stays under the ceiling. */
export function drawGrid(
  ctx: CanvasRenderingContext2D,
  l: Layout,
  H: number,
  rows: readonly Row[],
  pal: Palette,
  r: number,
  slide: number,
): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(l.left, l.top - slide, l.right - l.left, H - l.top + slide);
  ctx.clip();
  rows.forEach((row, i) => {
    const y = cellY(l, i) - slide;
    row.cells.forEach((k, c) => {
      if (k) drawBubble(ctx, cellX(l, c, row.shift), y, r, colourOf(pal, k));
    });
  });
  ctx.restore();
}

export function drawFalling(
  ctx: CanvasRenderingContext2D,
  falling: readonly Falling[],
  pal: Palette,
  r: number,
): void {
  for (const f of falling) {
    ctx.globalAlpha = Math.min(1, f.life * 2);
    drawBubble(ctx, f.x, f.y, r, colourOf(pal, f.colour));
  }
  ctx.globalAlpha = 1;
}

/** A dotted path of the aim, with a ring where the shot would settle. */
export function drawAim(
  ctx: CanvasRenderingContext2D,
  l: Layout,
  points: readonly Point[],
  spot: Point | null,
  colour: string,
  pal: Palette,
  r: number,
): void {
  const dot = Math.max(2, l.d * 0.05);
  ctx.save();
  ctx.fillStyle = pal.text;
  ctx.globalAlpha = 0.6;
  ctx.beginPath();
  for (let i = 3; i < points.length; i += 4) {
    const p = points[i];
    if (!p) continue;
    ctx.moveTo(p.x + dot, p.y);
    ctx.arc(p.x, p.y, dot, 0, TAU);
  }
  ctx.fill();
  if (spot) {
    ctx.globalAlpha = 0.8;
    ctx.strokeStyle = colour;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(spot.x, spot.y, r, 0, TAU);
    ctx.stroke();
  }
  ctx.restore();
}

/** The cannon: a barrel along the aim, a base, and the loaded bubble on top. */
export function drawShooter(
  ctx: CanvasRenderingContext2D,
  l: Layout,
  pal: Palette,
  aim: number,
  colour: string,
  r: number,
): void {
  const { shooterX: x, shooterY: y, d } = l;
  ctx.save();
  ctx.strokeStyle = pal.gun;
  ctx.lineWidth = d * 0.2;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + Math.cos(aim) * d * 0.7, y - Math.sin(aim) * d * 0.7);
  ctx.stroke();
  ctx.restore();
  ctx.beginPath();
  ctx.arc(x, y, d * 0.5, 0, TAU);
  ctx.fillStyle = shade(pal.gun, -0.35);
  ctx.fill();
  drawBubble(ctx, x, y, r, colour);
}

/** The bubble waiting beside the shooter. */
export function drawNext(
  ctx: CanvasRenderingContext2D,
  l: Layout,
  pal: Palette,
  colour: string,
  r: number,
): void {
  const x = l.shooterX + l.d * 2.3;
  const y = l.shooterY;
  text(ctx, 'NEXT', x, y - l.d * 0.85, {
    size: Math.round(Math.max(HUD_MIN, l.d * 0.3)),
    align: 'center',
    color: pal.text,
    weight: 700,
  });
  drawBubble(ctx, x, y, r * 0.7, colour);
}

/** Smallest HUD text, in logical px: about 12 CSS px on the narrowest phone stage (a 522 px wide canvas). */
export const HUD_MIN = 18;
/** A HUD band at least this tall shows labels over values, on two lines. */
const TWO_LINE_HUD = 72;

export interface HudState {
  score: number;
  level: number;
  sinceDrop: number;
  perDrop: number;
}

/** One pip per shot until the ceiling drops, in a row ending at `right`. Returns the x of the first pip. */
function drawPips(
  ctx: CanvasRenderingContext2D,
  pal: Palette,
  s: HudState,
  right: number,
  y: number,
  pip: number,
): number {
  const gap = pip * 2.6;
  const pipX = (i: number): number => right - pip - (s.perDrop - 1 - i) * gap;
  for (let i = 0; i < s.perDrop; i++) {
    ctx.beginPath();
    ctx.arc(pipX(i), y, pip, 0, TAU);
    if (i < s.sinceDrop) {
      ctx.fillStyle = s.sinceDrop === s.perDrop - 1 ? pal.danger : pal.rail;
      ctx.fill();
    } else {
      ctx.globalAlpha = 0.5;
      ctx.strokeStyle = pal.text;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }
  return pipX(0);
}

/**
 * The HUD. Across the top: score on the left, level in the middle, and the drop pips on the right. On a wide
 * canvas the score and level go in the left panel and the drop counter in the right one.
 */
export function drawHud(ctx: CanvasRenderingContext2D, W: number, l: Layout, pal: Palette, s: HudState): void {
  if (l.sideHud) {
    drawSideHud(ctx, W, l, pal, s);
    return;
  }
  const x0 = l.left + 4;
  const x1 = l.right - 2;
  if (l.frame < TWO_LINE_HUD) {
    // One line: SCORE 1,234 · LEVEL 2 · DROP and the pips.
    const y = l.frame / 2;
    const size = HUD_MIN;
    text(ctx, `SCORE ${formatNumber(s.score)}`, x0, y, { size, align: 'left', color: pal.text });
    text(ctx, `LEVEL ${s.level}`, W / 2, y, { size, align: 'center', color: pal.text });
    const pip = 5.5;
    const first = drawPips(ctx, pal, s, x1, y, pip);
    text(ctx, 'DROP', first - pip * 1.8, y, { size, align: 'right', color: pal.text, weight: 700 });
    return;
  }
  // Two lines on a tall band: small labels over bigger values.
  const ly = l.frame * 0.3;
  const vy = l.frame * 0.66;
  const big = Math.round(Math.min(32, l.frame * 0.34));
  const label = { size: HUD_MIN, color: pal.text, weight: 700 } as const;
  text(ctx, 'SCORE', x0, ly, { ...label, align: 'left' });
  text(ctx, formatNumber(s.score), x0, vy, { size: big, align: 'left', color: pal.text });
  text(ctx, 'LEVEL', W / 2, ly, { ...label, align: 'center' });
  text(ctx, String(s.level), W / 2, vy, { size: big, align: 'center', color: pal.text });
  text(ctx, 'DROP', x1, ly, { ...label, align: 'right' });
  drawPips(ctx, pal, s, x1, vy, Math.round(big * 0.26));
}

function drawSideHud(ctx: CanvasRenderingContext2D, W: number, l: Layout, pal: Palette, s: HudState): void {
  const panel = l.left - WALL_PAD;
  const big = Math.round(Math.min(56, Math.max(HUD_MIN + 8, panel * 0.2)));
  const small = Math.round(Math.max(HUD_MIN, big * 0.5));
  const lx = l.left / 2;
  const rx = (l.right + W) / 2;
  const y0 = l.frame + big;
  const label = { size: small, align: 'center', color: pal.text, weight: 700 } as const;
  text(ctx, 'SCORE', lx, y0, label);
  text(ctx, formatNumber(s.score), lx, y0 + big * 1.1, { size: big, align: 'center', color: pal.text });
  text(ctx, 'LEVEL', lx, y0 + big * 2.6, label);
  text(ctx, String(s.level), lx, y0 + big * 3.7, { size: big, align: 'center', color: pal.text });
  text(ctx, 'DROP IN', rx, y0, label);
  text(ctx, String(s.perDrop - s.sinceDrop), rx, y0 + big * 1.1, {
    size: big,
    align: 'center',
    color: s.sinceDrop === s.perDrop - 1 ? pal.danger : pal.text,
  });
  const pip = Math.max(6, small * 0.4);
  const span = (s.perDrop - 1) * pip * 2.6 + 2 * pip;
  drawPips(ctx, pal, s, rx + span / 2, y0 + big * 2.2, pip);
}
