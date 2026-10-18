import { fillRoundRect, roundRectPath, shade, text, type TextOpts } from '../draw';
import { type Board, COLS, HIDDEN_ROWS, ROWS, VISIBLE_ROWS } from './board';
import { cellsOf, type Kind, KINDS, type Piece, pieceBounds } from './pieces';

const MARGIN = 16;
const GAP = 12;
/** Side panel width, in cells of the well. */
const PANEL_CELLS = 4.5;
/**
 * Narrowest side panel a touch layout keeps, in cells. A phone is narrow, so the well takes most of the width (the
 * panel ends up about 2.1 to 2.4 cells wide at P1 to P3); the panel widens back toward PANEL_CELLS when the width
 * leaves it room.
 */
const PANEL_CELLS_TOUCH = 2;
/**
 * Under touch the side panel's boxes sit this close to the panel's edges, and a stat's text this far inside its box
 * (logical px). The narrow panel needs the room for its values to keep 12 CSS px.
 */
const COMPACT_BOX_PAD = 2;
const COMPACT_TEXT_PAD = 6;
/** Where a compact stat's name and value sit in its box, measured from the box's top and bottom (logical px). */
const COMPACT_NAME_DY = 12;
const COMPACT_VALUE_DY = 14;
/** The smallest on-screen text, in CSS px, that the panel keeps on a touch screen (its labels, names and values). */
export const TEXT_MIN_CSS = 12;
/** Height of the strip above the well when there is no room for a side panel. */
const STRIP_PX = 104;
const LABEL_PX = 18;
/** Label room in a compact panel (under touch controls), where the labels are set larger. */
const LABEL_PX_COMPACT = 24;
/** Label and stat-name size in a compact panel: at a phone's scale it stays at least 12 CSS px. */
export const COMPACT_LABEL_PX = 19;
/** Shortest stat box that still has room for its name above its value. */
const STAT_TALL_PX = 36;
/** Narrowest logical width that leaves a side panel room beside a well of usable size. */
const SIDE_MIN_W = COLS * 24 + GAP + 112 + 2 * MARGIN;
/**
 * Smallest well cell whose side panel fits its labels, gaps and three stat boxes (about 200 px of a 22-row panel).
 * Below it the NEXT boxes would have no room, so the panel goes above the well instead.
 */
const SIDE_MIN_CELL = 10;

/** Top-left corner of the well (row 0, the top buffer row) and the size of a cell, in logical px. */
export interface Well {
  readonly x: number;
  readonly y: number;
  readonly cell: number;
}

/** The side panel, or the strip above the well when the width leaves no room beside it. */
export interface Panel {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  /** True beside the well; false above it. */
  readonly side: boolean;
  /**
   * Under touch controls on a phone the game is drawn small, so a side panel sets its labels and stat names larger
   * (at least 12 CSS px). Desktop keeps the smaller text.
   */
  readonly compact: boolean;
  /** Label and stat-name size of a compact panel, in logical px (see layoutTetris). */
  readonly text: number;
  /** The smallest text the panel keeps, in logical px: a stat value under touch never draws below it (see layoutTetris). */
  readonly minText: number;
}

export interface TetrisLayout {
  readonly well: Well;
  /** Null when there is no HUD to show (card previews). */
  readonly panel: Panel | null;
}

/**
 * Where the well and its panel go. The well is fitted with the largest whole cell, centred in the area above
 * the touch controls, buffer rows included, as on desktop. The panel sits to the right when the width allows,
 * otherwise above the well. Under touch controls the well's cell is capped by the height of the area above the
 * controls and by a narrow panel, which lets the well take about 55% of a phone's canvas.
 * `touch` selects the compact panel text; it is on under touch controls by default, and a touch screen passes it on
 * its own, so a canvas the controls do not reach keeps the larger text too. `minText` is the smallest text the panel
 * keeps, in logical px (12 CSS px at the canvas scale); its labels are never smaller than COMPACT_LABEL_PX.
 */
export function layoutTetris(
  W: number,
  H: number,
  bottom: number,
  withPanel: boolean,
  touch = bottom > 0,
  minText = COMPACT_LABEL_PX,
): TetrisLayout {
  const availW = W - 2 * MARGIN;
  const availH = H - 2 * MARGIN - bottom;
  /** Start of a block of `size` centred in `space`, never above or left of the margin. */
  const centred = (space: number, size: number): number =>
    MARGIN + Math.max(0, Math.floor((space - size) / 2));
  if (!withPanel) {
    const cell = Math.max(1, Math.floor(Math.min(availW / COLS, availH / ROWS)));
    return {
      well: { x: centred(availW, COLS * cell), y: centred(availH, ROWS * cell), cell },
      panel: null,
    };
  }
  if (W >= SIDE_MIN_W) {
    // The whole well, buffer rows included, is centred between the top margin and the touch band (or the bottom
    // margin when there is none), so the room above the buffer matches the room below the playfield.
    const minPanel = touch ? PANEL_CELLS_TOUCH : PANEL_CELLS;
    const cell = Math.max(1, Math.floor(Math.min(availH / ROWS, (availW - GAP) / (COLS + minPanel))));
    if (cell >= SIDE_MIN_CELL) {
      // The panel takes the width the well leaves, up to PANEL_CELLS.
      const panelW = Math.floor(Math.min(PANEL_CELLS * cell, availW - GAP - COLS * cell));
      const groupW = COLS * cell + GAP + panelW;
      const x = centred(availW, groupW);
      const y = centred(availH, ROWS * cell);
      return {
        well: { x, y, cell },
        panel: {
          x: x + COLS * cell + GAP,
          y,
          w: panelW,
          h: ROWS * cell,
          side: true,
          compact: touch,
          text: Math.max(COMPACT_LABEL_PX, minText),
          minText,
        },
      };
    }
  }
  const cell = Math.max(1, Math.floor(Math.min(availW / COLS, (availH - STRIP_PX - GAP) / ROWS)));
  const boardW = COLS * cell;
  const top = centred(availH, STRIP_PX + GAP + ROWS * cell);
  const x = centred(availW, boardW);
  return {
    well: { x, y: top + STRIP_PX + GAP, cell },
    panel: {
      x,
      y: top,
      w: boardW,
      h: STRIP_PX,
      side: false,
      compact: false,
      text: COMPACT_LABEL_PX,
      minText: COMPACT_LABEL_PX,
    },
  };
}

/** One piece's colours: the fill and the lighter and darker tones of its bevel. */
export interface Block {
  readonly fill: string;
  readonly light: string;
  readonly dark: string;
}

/** Colours for the whole game, read once from the equipped skin. */
export interface Look {
  readonly backdrop: string;
  readonly board: string;
  readonly grid: string;
  readonly frame: string;
  readonly ghost: string;
  readonly blocks: Record<Kind, Block>;
}

function makeBlock(fill: string): Block {
  return { fill, light: shade(fill, 0.5), dark: shade(fill, -0.4) };
}

/** Builds the look from a colour lookup (the skin palette, with a fallback per key). */
export function buildLook(color: (key: string, fallback: string) => string): Look {
  const board = color('board', '#0b1020');
  return {
    backdrop: shade(board, -0.4),
    board,
    grid: color('grid', '#16203a'),
    frame: color('frame', '#334155'),
    ghost: color('ghost', '#e2e8f0'),
    blocks: {
      I: makeBlock(color('I', '#22d3ee')),
      O: makeBlock(color('O', '#facc15')),
      T: makeBlock(color('T', '#a855f7')),
      S: makeBlock(color('S', '#22c55e')),
      Z: makeBlock(color('Z', '#ef4444')),
      J: makeBlock(color('J', '#3b82f6')),
      L: makeBlock(color('L', '#f97316')),
    },
  };
}

/** Centre of a cell of the well, in logical px. */
export function cellCentre(well: Well, x: number, y: number): { x: number; y: number } {
  return { x: well.x + (x + 0.5) * well.cell, y: well.y + (y + 0.5) * well.cell };
}

/** One square with a bevel: light on the top and left, dark on the bottom and right. */
function drawCell(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, b: Block): void {
  const e = Math.max(1, Math.round(s * 0.14));
  ctx.fillStyle = b.dark;
  ctx.fillRect(x, y, s, s);
  ctx.fillStyle = b.fill;
  ctx.fillRect(x, y, s - e, s - e);
  ctx.fillStyle = b.light;
  ctx.fillRect(x, y, s - e, e);
  ctx.fillRect(x, y, e, s - e);
}

/** The playfield: background, grid lines and frame. The buffer rows above it stay open for spawning. */
export function drawWell(ctx: CanvasRenderingContext2D, well: Well, look: Look): void {
  const { x, cell } = well;
  const top = well.y + HIDDEN_ROWS * cell;
  const w = COLS * cell;
  const h = VISIBLE_ROWS * cell;
  ctx.fillStyle = look.board;
  ctx.fillRect(x, top, w, h);
  ctx.beginPath();
  for (let c = 1; c < COLS; c++) {
    const gx = x + c * cell + 0.5;
    ctx.moveTo(gx, top);
    ctx.lineTo(gx, top + h);
  }
  for (let r = 1; r < VISIBLE_ROWS; r++) {
    const gy = top + r * cell + 0.5;
    ctx.moveTo(x, gy);
    ctx.lineTo(x + w, gy);
  }
  ctx.strokeStyle = look.grid;
  ctx.lineWidth = 1;
  ctx.stroke();
  const fw = Math.max(2, cell * 0.12);
  ctx.strokeStyle = look.frame;
  ctx.lineWidth = fw;
  ctx.strokeRect(x - fw / 2, top - fw / 2, w + fw, h + fw);
}

/** Every locked cell. */
export function drawStack(ctx: CanvasRenderingContext2D, board: Board, well: Well, look: Look): void {
  for (let i = 0; i < board.cells.length; i++) {
    const code = board.cells[i];
    if (!code) continue;
    const kind = KINDS[code - 1];
    if (!kind) continue;
    drawCell(
      ctx,
      well.x + (i % COLS) * well.cell,
      well.y + Math.floor(i / COLS) * well.cell,
      well.cell,
      look.blocks[kind],
    );
  }
}

/** A piece drawn `dy` rows below its position: 0 for the active piece, its landing distance for the ghost. */
export function drawPiece(ctx: CanvasRenderingContext2D, p: Piece, well: Well, look: Look, dy = 0): void {
  const b = look.blocks[p.kind];
  for (const o of cellsOf(p.kind, p.rot)) {
    drawCell(ctx, well.x + (p.x + o.x) * well.cell, well.y + (p.y + dy + o.y) * well.cell, well.cell, b);
  }
}

/** Outline of where the piece would land, `dy` rows below it. */
export function drawGhost(ctx: CanvasRenderingContext2D, p: Piece, dy: number, well: Well, look: Look): void {
  const lw = Math.max(1.5, well.cell * 0.07);
  const inset = lw / 2 + 1;
  ctx.save();
  ctx.globalAlpha = 0.5;
  ctx.strokeStyle = look.ghost;
  ctx.lineWidth = lw;
  for (const o of cellsOf(p.kind, p.rot)) {
    const x = well.x + (p.x + o.x) * well.cell;
    const y = well.y + (p.y + dy + o.y) * well.cell;
    ctx.strokeRect(x + inset, y + inset, well.cell - 2 * inset, well.cell - 2 * inset);
  }
  ctx.restore();
}

/** White flash over the rows that just cleared, `alpha` running from 1 down to 0. */
export function drawFlash(
  ctx: CanvasRenderingContext2D,
  well: Well,
  rows: readonly number[],
  alpha: number,
): void {
  if (alpha <= 0) return;
  ctx.fillStyle = `rgba(255,255,255,${(0.85 * alpha).toFixed(3)})`;
  for (const r of rows) ctx.fillRect(well.x, well.y + r * well.cell, COLS * well.cell, well.cell);
}

/** What the panel shows: the held piece, the next pieces, and the stat lines (label and value) top to bottom. */
export interface PanelState {
  readonly hold: Kind | null;
  readonly holdLocked: boolean;
  readonly next: readonly Kind[];
  readonly stats: readonly (readonly [string, string])[];
}

interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** Where each box and label of a panel goes. It only changes with the layout, so it is built once per layout. */
export interface PanelSlots {
  /** The labels and stat names are set at the compact size (see Panel.compact). */
  readonly compact: boolean;
  /** The label and stat-name size, in logical px, when compact. */
  readonly text: number;
  /** The smallest a stat value draws, in logical px, when compact (see Panel.minText). */
  readonly minText: number;
  /** Largest stat value size, in logical px. */
  readonly valueMax: number;
  readonly holdLabel: { readonly x: number; readonly y: number };
  readonly hold: Rect;
  readonly nextLabel: { readonly x: number; readonly y: number };
  readonly next: readonly Rect[];
  readonly stats: readonly Rect[];
}

/** The slots of a panel: the side layout beside the well, or the strip above it. */
export function panelSlots(panel: Panel): PanelSlots {
  return panel.side ? sideSlots(panel) : stripSlots(panel);
}

/**
 * Side panel: the hold box, the next three pieces, then the stats stacked at the bottom. The stats keep the tall
 * form. The hold and next boxes get the room the labels, the gaps and the stats leave, so a short panel (a tall
 * touch inset) shrinks them together rather than running into the stats.
 */
function sideSlots(p: Panel): PanelSlots {
  const cellPx = p.h / ROWS;
  const pad = p.compact ? COMPACT_BOX_PAD : Math.max(6, Math.round(cellPx * 0.25));
  const x = p.x + pad;
  const w = p.w - 2 * pad;
  // A compact label row is as tall as its text needs (the 24 px row at the usual size), and its label sits just above its box.
  const labelPx = p.compact ? Math.max(LABEL_PX_COMPACT, p.text + 5) : LABEL_PX;
  const labelDy = p.compact ? Math.round(p.text * 0.63) : 9;
  const nextGap = 8;
  const statH = Math.max(STAT_TALL_PX, Math.round(cellPx * 1.6));
  const statGap = 8;
  const statsH = 3 * statH + 2 * statGap;
  const room = Math.max(0, p.h - 2 * labelPx - 2 * GAP - 2 * nextGap - statsH);
  const holdNatural = Math.round(w * 0.95);
  const nextNatural = Math.round(w * 0.8);
  const fit = Math.min(1, room / (holdNatural + 3 * nextNatural));
  const holdH = Math.floor(holdNatural * fit);
  const nextH = Math.floor(nextNatural * fit);
  const holdY = p.y + labelPx;
  const nextY = holdY + holdH + labelPx + GAP;
  const statsY = p.y + p.h - statsH;
  return {
    compact: p.compact,
    text: p.text,
    minText: p.minText,
    valueMax: p.compact ? Math.max(VALUE_MAX_PX_COMPACT, p.text + 2) : VALUE_MAX_PX,
    holdLabel: { x, y: holdY - labelDy },
    hold: { x, y: holdY, w, h: holdH },
    nextLabel: { x, y: nextY - labelDy },
    next: [0, 1, 2].map((i) => ({ x, y: nextY + i * (nextH + nextGap), w, h: nextH })),
    stats: [0, 1, 2].map((i) => ({ x, y: statsY + i * (statH + statGap), w, h: statH })),
  };
}

/** Strip above the well: hold and next pieces on the left, the stats in three rows on the right. */
function stripSlots(p: Panel): PanelSlots {
  const gap = 6;
  const boxW = Math.floor(p.w * 0.14);
  const boxY = p.y + LABEL_PX;
  const boxH = p.h - LABEL_PX;
  const statsW = p.w - 4 * boxW - 4 * gap;
  const rowH = Math.floor(boxH / 3);
  const nextX = (i: number) => p.x + boxW + gap + i * (boxW + gap);
  const statsX = p.x + p.w - statsW;
  return {
    // The strip's labels sit in its own top band and keep the small text.
    compact: false,
    text: COMPACT_LABEL_PX,
    minText: p.minText,
    valueMax: VALUE_MAX_PX,
    holdLabel: { x: p.x, y: p.y + 8 },
    hold: { x: p.x, y: boxY, w: boxW, h: boxH },
    nextLabel: { x: nextX(0), y: p.y + 8 },
    next: [0, 1, 2].map((i) => ({ x: nextX(i), y: boxY, w: boxW, h: boxH })),
    stats: [0, 1, 2].map((i) => ({ x: statsX, y: boxY + i * rowH, w: statsW, h: rowH - 3 })),
  };
}

function box(ctx: CanvasRenderingContext2D, r: Rect): void {
  const radius = Math.min(12, r.h / 3);
  fillRoundRect(ctx, r.x, r.y, r.w, r.h, radius, 'rgba(8, 10, 30, 0.55)');
  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.lineWidth = 1.5;
  roundRectPath(ctx, r.x, r.y, r.w, r.h, radius);
  ctx.stroke();
}

/** Panel text options, built once so drawing the panel allocates nothing. */
const LABEL_TEXT: TextOpts = { size: 11, weight: 800, color: '#d8b4fe', stroke: null };
const NAME_TEXT: TextOpts = { size: 10, weight: 800, color: '#d8b4fe', stroke: null };
const NAME_SHORT_TEXT: TextOpts = { size: 9, weight: 800, color: '#d8b4fe', stroke: null };
const VALUE_SHORT_TEXT: TextOpts = { size: 13, align: 'right', stroke: null };
/** The tall stat value. Its size is set just before each value is drawn, so one object serves every stat. */
const VALUE_TEXT: TextOpts = { stroke: null };
/**
 * Compact panel (under touch controls): the same text, set so a phone's small scale still reads at 12 CSS px. Its size is
 * set from the panel at the start of each draw (see drawPanel), so one object serves every label.
 */
const LABEL_TEXT_COMPACT: TextOpts = { size: COMPACT_LABEL_PX, weight: 800, color: '#d8b4fe', stroke: null };
const NAME_TEXT_COMPACT: TextOpts = { size: COMPACT_LABEL_PX, weight: 800, color: '#d8b4fe', stroke: null };
const VALUE_MAX_PX = 18;
const VALUE_MAX_PX_COMPACT = 20;

function label(
  ctx: CanvasRenderingContext2D,
  value: string,
  at: { x: number; y: number },
  o: TextOpts,
): void {
  text(ctx, value, at.x, at.y, o);
}

/** A piece centred in a box, at the largest size that fits it. */
function drawPreview(ctx: CanvasRenderingContext2D, kind: Kind, r: Rect, look: Look, alpha: number): void {
  const b = pieceBounds(kind);
  const pad = 6;
  const mini = Math.max(2, Math.floor(Math.min((r.w - 2 * pad) / b.w, (r.h - 2 * pad) / b.h)));
  const ox = r.x + (r.w - b.w * mini) / 2;
  const oy = r.y + (r.h - b.h * mini) / 2;
  ctx.save();
  ctx.globalAlpha = alpha;
  for (const o of cellsOf(kind, 0)) {
    drawCell(ctx, ox + (o.x - b.x) * mini, oy + (o.y - b.y) * mini, mini, look.blocks[kind]);
  }
  ctx.restore();
}

/** Rough width of a stat value, in ems: a digit about 0.62, a thousands comma or point about 0.3, a letter about 0.75. */
function valueEm(value: string): number {
  let em = 0;
  for (const ch of value) em += /\d/.test(ch) ? 0.62 : ch === ',' || ch === '.' ? 0.3 : 0.75;
  return em;
}

/** A score in a short form for a box too narrow for its full digits: 123456 as 123K, 1234567 as 1.2M. */
function shortValue(value: string): string {
  const n = Number(value.replace(/,/g, ''));
  if (!Number.isFinite(n) || n < 1000) return value;
  if (n < 1e6) return `${Math.floor(n / 1000)}K`;
  return `${(Math.floor(n / 1e5) / 10).toFixed(1)}M`;
}

/** The largest size, in logical px, at which a value fits `inner` wide (capped at the panel's largest value size). */
function valueSize(value: string, inner: number, slots: PanelSlots): number {
  const em = slots.compact ? valueEm(value) : 0.62 * value.length;
  return Math.min(slots.valueMax, Math.floor(inner / em));
}

/** One stat: the name above its value in a tall box, the name beside the value in a short one. */
function stat(ctx: CanvasRenderingContext2D, name: string, value: string, r: Rect, slots: PanelSlots): void {
  const pad = slots.compact ? COMPACT_TEXT_PAD : Math.min(10, Math.round(r.w * 0.12));
  if (r.h >= STAT_TALL_PX) {
    // The value shrinks in a narrow box rather than spilling out of it. Under touch it never shrinks below the panel's
    // text size, so a value too wide for its box at that size is shortened instead (a score of a million or more).
    const inner = r.w - 2 * pad;
    let shown = value;
    let size = valueSize(shown, inner, slots);
    if (slots.compact && size < slots.minText) {
      shown = shortValue(value);
      size = Math.max(slots.minText, valueSize(shown, inner, slots));
    }
    VALUE_TEXT.size = size;
    text(
      ctx,
      name,
      r.x + pad,
      r.y + (slots.compact ? COMPACT_NAME_DY : 11),
      slots.compact ? NAME_TEXT_COMPACT : NAME_TEXT,
    );
    text(ctx, shown, r.x + pad, r.y + r.h - (slots.compact ? COMPACT_VALUE_DY : 12), VALUE_TEXT);
    return;
  }
  const mid = r.y + r.h / 2;
  text(ctx, name, r.x + 6, mid, NAME_SHORT_TEXT);
  text(ctx, value, r.x + r.w - 6, mid, VALUE_SHORT_TEXT);
}

/** Hold box, the next three pieces, and the stat lines. Works from slots built once, so it allocates nothing. */
export function drawPanel(ctx: CanvasRenderingContext2D, slots: PanelSlots, look: Look, s: PanelState): void {
  LABEL_TEXT_COMPACT.size = slots.text;
  NAME_TEXT_COMPACT.size = slots.text;
  const labelOpts = slots.compact ? LABEL_TEXT_COMPACT : LABEL_TEXT;
  label(ctx, 'HOLD', slots.holdLabel, labelOpts);
  box(ctx, slots.hold);
  if (s.hold) drawPreview(ctx, s.hold, slots.hold, look, s.holdLocked ? 0.4 : 1);
  label(ctx, 'NEXT', slots.nextLabel, labelOpts);
  for (let i = 0; i < slots.next.length; i++) {
    const r = slots.next[i];
    if (!r) continue;
    box(ctx, r);
    const kind = s.next[i];
    if (kind) drawPreview(ctx, kind, r, look, 1);
  }
  for (let i = 0; i < slots.stats.length; i++) {
    const r = slots.stats[i];
    if (!r) continue;
    box(ctx, r);
    const v = s.stats[i];
    if (v) stat(ctx, v[0], v[1], r, slots);
  }
}
