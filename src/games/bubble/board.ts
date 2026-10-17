import type { Rng } from '../../core/rng';

/** Bubbles per row. Odd rows are offset half a bubble to the right, so the playfield is COLS + 1/2 bubbles wide. */
export const COLS = 9;
/** Speed of a shot, in logical px per second. */
export const FLY_SPEED = 1400;

/** Band above the ceiling, for the score line. */
const HUD_H = 56;
/** Gap between the canvas edge and the side walls, so the rails and the HUD stay on screen. */
export const WALL_PAD = 12;
/** Band below the grid, where the shooter and the next bubble sit. */
const BOTTOM_H = 96;
/** Height of the shooter centre above the bottom edge. */
const SHOOTER_LIFT = 48;
/** Rows that fit the height at the design size. Bubbles shrink when the height is the tighter limit. */
const ROWS_IN_VIEW = 12;
/** The shooter line is never nearer the ceiling than this many rows. */
const MIN_LINE_ROWS = 6;
/** A flying bubble moves in steps no longer than this, so it cannot pass through a neighbour. */
const SUB_PX = 4;
/** Aim preview: sample step and length cap, in simulated seconds. */
const TRACE_DT = 1 / 120;
const TRACE_STEPS = 480;
const SQRT3_2 = Math.sqrt(3) / 2;

export interface Cell {
  row: number;
  col: number;
}

export interface Point {
  x: number;
  y: number;
}

/** A bubble in flight. */
export interface Flight extends Point {
  vx: number;
  vy: number;
}

/** One row of the hanging grid. `shift` 1 offsets the row half a bubble right. Colour 0 is empty. */
export interface Row {
  shift: 0 | 1;
  cells: Uint8Array;
}

/** Playfield geometry for one run, in logical px. */
export interface Layout {
  /** Bubble diameter: the distance between the centres of touching bubbles. */
  d: number;
  /** Vertical distance between rows. */
  rowH: number;
  /** Walls of the playfield. */
  left: number;
  right: number;
  /** The ceiling: the top edge of row 0. */
  top: number;
  shooterX: number;
  shooterY: number;
  /** The shooter line: a bubble settling in this row ends the run. It is the row just above the shooter. */
  lineRow: number;
}

export interface Trace {
  points: Point[];
  /** The cell the shot settles in, or null when it does not settle within the trace. */
  at: Cell | null;
}

/** Fits the playfield to a logical size. Walls span the full width when the width is the tighter limit. */
export function makeLayout(width: number, height: number, bottomInset = 0): Layout {
  const span = Math.max(1, height - HUD_H - BOTTOM_H - bottomInset);
  const d = Math.min((width - 2 * WALL_PAD) / (COLS + 0.5), span / (ROWS_IN_VIEW * SQRT3_2));
  const rowH = d * SQRT3_2;
  const wide = (COLS + 0.5) * d;
  const left = (width - wide) / 2;
  // The shooter sits one row below the shooter line, the lowest row that still fits above the bottom band.
  const lineRow = Math.max(
    MIN_LINE_ROWS,
    Math.floor((height - bottomInset - SHOOTER_LIFT - rowH - HUD_H - d / 2) / rowH),
  );
  const shooterY = HUD_H + d / 2 + (lineRow + 1) * rowH;
  return { d, rowH, left, right: left + wide, top: HUD_H, shooterX: width / 2, shooterY, lineRow };
}

export function emptyRow(shift: 0 | 1): Row {
  return { shift, cells: new Uint8Array(COLS) };
}

export function flip(shift: 0 | 1): 0 | 1 {
  return shift === 1 ? 0 : 1;
}

/** Centre x of a cell. Shifted rows sit half a bubble further right. */
export function cellX(l: Layout, col: number, shift: 0 | 1): number {
  return l.left + l.d / 2 + col * l.d + shift * (l.d / 2);
}

/** Centre y of a row. */
export function cellY(l: Layout, row: number): number {
  return l.top + l.d / 2 + row * l.rowH;
}

/** Shift of a row. The row just below the grid alternates with the last row, as every row does. */
export function shiftOf(rows: readonly Row[], row: number): 0 | 1 {
  const r = rows[row];
  if (r) return r.shift;
  const last = rows[rows.length - 1];
  return last ? flip(last.shift) : 0;
}

/** Colour at a cell: 0 for empty (or outside the grid), 1 and up for the palette. */
export function colourAt(rows: readonly Row[], row: number, col: number): number {
  return rows[row]?.cells[col] ?? 0;
}

function key(row: number, col: number): number {
  return row * COLS + col;
}

/**
 * The cells touching (row, col). A row's neighbours in the rows above and below sit at the columns its shift
 * puts them over, so they depend on the row's own shift.
 */
export function neighbours(rows: readonly Row[], row: number, col: number): [number, number][] {
  const out: [number, number][] = [];
  if (col > 0) out.push([row, col - 1]);
  if (col < COLS - 1) out.push([row, col + 1]);
  const cols = shiftOf(rows, row) === 0 ? [col - 1, col] : [col, col + 1];
  for (const r of [row - 1, row + 1]) {
    if (r < 0) continue;
    for (const c of cols) if (c >= 0 && c < COLS) out.push([r, c]);
  }
  return out;
}

function touchesPlaced(rows: readonly Row[], row: number, col: number): boolean {
  return neighbours(rows, row, col).some(([r, c]) => colourAt(rows, r, c) !== 0);
}

/** Whether a flying bubble centred at (x, y) overlaps a placed bubble. */
export function touching(l: Layout, rows: readonly Row[], x: number, y: number): boolean {
  const reach = l.d * l.d;
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    if (!row) continue;
    const dy = cellY(l, r) - y;
    if (dy * dy >= reach) continue;
    for (let c = 0; c < COLS; c++) {
      if (!row.cells[c]) continue;
      const dx = cellX(l, c, row.shift) - x;
      if (dx * dx + dy * dy < reach) return true;
    }
  }
  return false;
}

/**
 * The empty cell a shot settles in when its centre is at (x, y): the nearest empty cell in the ceiling row, or
 * beside a bubble already placed. Null only when there is no room at all.
 */
export function landingCell(l: Layout, rows: readonly Row[], x: number, y: number): Cell | null {
  let best: Cell | null = null;
  let bestD = Infinity;
  for (let r = 0; r <= rows.length; r++) {
    const shift = shiftOf(rows, r);
    for (let c = 0; c < COLS; c++) {
      if (colourAt(rows, r, c) !== 0) continue;
      if (r > 0 && !touchesPlaced(rows, r, c)) continue;
      const dx = cellX(l, c, shift) - x;
      const dy = cellY(l, r) - y;
      if (dx * dx + dy * dy < bestD) {
        bestD = dx * dx + dy * dy;
        best = { row: r, col: c };
      }
    }
  }
  return best;
}

/**
 * Moves a flying bubble forward by `dt` seconds, bouncing off the side walls. Returns null while it flies. Once it
 * touches a bubble or the ceiling it returns the cell it settles in (`at` is null only when there is no room).
 */
export function stepFlight(
  l: Layout,
  rows: readonly Row[],
  f: Flight,
  dt: number,
): { at: Cell | null } | null {
  const steps = Math.max(1, Math.ceil((Math.hypot(f.vx, f.vy) * dt) / SUB_PX));
  const h = dt / steps;
  const rad = l.d / 2;
  for (let i = 0; i < steps; i++) {
    f.x += f.vx * h;
    f.y += f.vy * h;
    if (f.x - rad < l.left) {
      f.x = 2 * (l.left + rad) - f.x;
      f.vx = -f.vx;
    } else if (f.x + rad > l.right) {
      f.x = 2 * (l.right - rad) - f.x;
      f.vx = -f.vx;
    }
    if (f.y - rad <= l.top || touching(l, rows, f.x, f.y)) {
      return { at: landingCell(l, rows, f.x, f.y) };
    }
  }
  return null;
}

/** Where a shot fired at `angle` would go, with its wall bounces, for the aim preview. */
export function traceShot(l: Layout, rows: readonly Row[], angle: number): Trace {
  const f: Flight = {
    x: l.shooterX,
    y: l.shooterY,
    vx: Math.cos(angle) * FLY_SPEED,
    vy: -Math.sin(angle) * FLY_SPEED,
  };
  const points: Point[] = [{ x: f.x, y: f.y }];
  for (let i = 0; i < TRACE_STEPS; i++) {
    const hit = stepFlight(l, rows, f, TRACE_DT);
    points.push({ x: f.x, y: f.y });
    if (hit) return { points, at: hit.at };
  }
  return { points, at: null };
}

/** The same-colour cells connected to (row, col), including it. Empty when the cell is empty. */
export function groupAt(rows: readonly Row[], row: number, col: number): Cell[] {
  const colour = colourAt(rows, row, col);
  if (colour === 0) return [];
  const seen = new Set<number>([key(row, col)]);
  const group: Cell[] = [{ row, col }];
  for (let i = 0; i < group.length; i++) {
    const cur = group[i] as Cell;
    for (const [r, c] of neighbours(rows, cur.row, cur.col)) {
      if (colourAt(rows, r, c) !== colour || seen.has(key(r, c))) continue;
      seen.add(key(r, c));
      group.push({ row: r, col: c });
    }
  }
  return group;
}

/** Bubbles that no longer connect to the ceiling (row 0) through other bubbles. These fall away. */
export function unanchored(rows: readonly Row[]): Cell[] {
  const top = rows[0];
  if (!top) return [];
  const seen = new Set<number>();
  const queue: Cell[] = [];
  top.cells.forEach((v, col) => {
    if (v) {
      seen.add(key(0, col));
      queue.push({ row: 0, col });
    }
  });
  for (let i = 0; i < queue.length; i++) {
    const cur = queue[i] as Cell;
    for (const [r, c] of neighbours(rows, cur.row, cur.col)) {
      if (colourAt(rows, r, c) === 0 || seen.has(key(r, c))) continue;
      seen.add(key(r, c));
      queue.push({ row: r, col: c });
    }
  }
  const lost: Cell[] = [];
  rows.forEach((row, r) => {
    row.cells.forEach((v, c) => {
      if (v && !seen.has(key(r, c))) lost.push({ row: r, col: c });
    });
  });
  return lost;
}

/** Drops empty rows from the bottom. Rows only ever change at the ends, so neighbours keep alternating. */
export function trimRows(rows: Row[]): void {
  while (rows.length > 0 && rows[rows.length - 1]?.cells.every((v) => v === 0)) rows.pop();
}

/**
 * A colour in 1..colours that differs from every colour already touching (row, col), so a freshly made row
 * never starts with a group of three.
 */
export function freeColour(
  rng: Rng,
  rows: readonly Row[],
  row: number,
  col: number,
  colours: number,
): number {
  const taken = new Set<number>();
  for (const [r, c] of neighbours(rows, row, col)) taken.add(colourAt(rows, r, c));
  const free: number[] = [];
  for (let k = 1; k <= colours; k++) if (!taken.has(k)) free.push(k);
  return free.length > 0 ? rng.pick(free) : rng.int(1, colours);
}
