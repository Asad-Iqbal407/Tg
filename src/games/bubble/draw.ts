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

/** The playfield panel and the rails: the ceiling across the top and the two side walls. */
export function drawWalls(ctx: CanvasRenderingContext2D, l: Layout, pal: Palette, H: number): void {
  // A rail never grows wider than the pad beside the playfield, so it stays on the canvas.
  const rail = Math.min(WALL_PAD, Math.max(4, l.d * 0.12));
  const h = H - l.top;
  ctx.globalAlpha = 0.35;
  ctx.fillStyle = pal.panel;
  ctx.fillRect(l.left, l.top, l.right - l.left, h);
  ctx.globalAlpha = 1;
  fillRoundRect(ctx, l.left - rail, l.top - rail, l.right - l.left + rail * 2, rail, rail / 2, pal.rail);
  fillRoundRect(ctx, l.left - rail, l.top, rail, h, rail / 2, pal.rail);
  fillRoundRect(ctx, l.right, l.top, rail, h, rail / 2, pal.rail);
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
  ctx.rect(l.left, l.top, l.right - l.left, H - l.top);
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
  text(ctx, 'NEXT', x, y - l.d * 0.8, {
    size: Math.round(Math.max(11, l.d * 0.22)),
    align: 'center',
    color: pal.text,
    weight: 700,
  });
  drawBubble(ctx, x, y, r * 0.7, colour);
}

/** Score on the left, level in the middle, and one pip per shot until the ceiling drops. */
export function drawHud(
  ctx: CanvasRenderingContext2D,
  W: number,
  l: Layout,
  pal: Palette,
  s: { score: number; level: number; sinceDrop: number; perDrop: number },
): void {
  const size = Math.round(Math.min(22, Math.max(14, l.d * 0.34)));
  const y = l.top / 2;
  text(ctx, `SCORE ${formatNumber(s.score)}`, l.left + 4, y, { size, align: 'left', color: pal.text });
  text(ctx, `LEVEL ${s.level}`, W / 2, y, { size, align: 'center', color: pal.text });
  const pip = Math.max(4, l.d * 0.11);
  const gap = pip * 2.6;
  const pipX = (i: number): number => l.right - pip - (s.perDrop - 1 - i) * gap;
  text(ctx, 'DROP', pipX(0) - pip * 1.6, y, {
    size: Math.round(size * 0.8),
    align: 'right',
    color: pal.text,
    weight: 700,
  });
  for (let i = 0; i < s.perDrop; i++) {
    ctx.beginPath();
    ctx.arc(pipX(i), y, pip, 0, TAU);
    if (i < s.sinceDrop) {
      ctx.fillStyle = pal.rail;
      ctx.fill();
    } else {
      ctx.globalAlpha = 0.5;
      ctx.strokeStyle = pal.text;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }
}
