import type { SwipeDir } from '../../core/input';
import type { Rng } from '../../core/rng';

/** A heading. Named like the swipe and arrow directions. */
export type Dir = SwipeDir;

export interface Cell {
  x: number;
  y: number;
}

/** An apple on the board. A golden apple counts down `left` seconds; a red one never expires. */
export interface Apple extends Cell {
  golden: boolean;
  left: number;
  /** Seconds since it appeared, for the pop-in. */
  age: number;
}

/** Where the board sits on the canvas, in logical px: the top-left of cell (0, 0) and the cell size. */
export interface BoardRect {
  x: number;
  y: number;
  cell: number;
}

/** Cell size at the design size, side margins and the HUD strip above the board, in logical px. */
export const CELL_PX = 24;
export const MARGIN_PX = 16;
export const HUD_PX = 72;

const DELTA: Readonly<Record<Dir, Cell>> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};
const OPPOSITE: Readonly<Record<Dir, Dir>> = { up: 'down', down: 'up', left: 'right', right: 'left' };
const NEIGHBOURS: readonly Cell[] = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
];

const WALL_RUN_MIN = 2;
const WALL_RUN_MAX = 4;
const WALL_TRIES = 200;

/** Column and row step for a heading. */
export function delta(d: Dir): Cell {
  return DELTA[d];
}

export function advance(c: Cell, d: Dir): Cell {
  const s = DELTA[d];
  return { x: c.x + s.x, y: c.y + s.y };
}

export function opposite(d: Dir): Dir {
  return OPPOSITE[d];
}

/** The two headings a snake moving in `d` can turn to. */
export function sideways(d: Dir): readonly [Dir, Dir] {
  return d === 'up' || d === 'down' ? ['left', 'right'] : ['up', 'down'];
}

export function sameCell(a: Cell, b: Cell): boolean {
  return a.x === b.x && a.y === b.y;
}

export function manhattan(a: Cell, b: Cell): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

/** Grid dimensions for a logical size. Fixed for the whole run. */
export function gridSize(width: number, height: number): { cols: number; rows: number } {
  return {
    cols: Math.floor((width - 2 * MARGIN_PX) / CELL_PX),
    rows: Math.floor((height - HUD_PX - 2 * MARGIN_PX) / CELL_PX),
  };
}

/**
 * The largest whole-pixel cell that fits the grid into the play area (below the HUD, above the touch
 * inset), centred. Only the drawing uses this, so a live inset change never alters the simulation.
 */
export function fitBoard(cols: number, rows: number, width: number, height: number, bottom: number): BoardRect {
  const availW = width - 2 * MARGIN_PX;
  const availH = height - MARGIN_PX - bottom - HUD_PX;
  const cell = Math.max(1, Math.floor(Math.min(availW / cols, availH / rows)));
  return {
    cell,
    x: Math.floor(MARGIN_PX + (availW - cols * cell) / 2),
    y: Math.floor(HUD_PX + (availH - rows * cell) / 2),
  };
}

/** Canvas position (logical px) of the centre of a board cell. */
export function cellCentre(rect: BoardRect, c: Cell): Cell {
  return { x: rect.x + (c.x + 0.5) * rect.cell, y: rect.y + (c.y + 0.5) * rect.cell };
}

/** Playfield occupancy: the size of the grid and the wall blocks standing on it. */
export class Grid {
  readonly size: number;
  /** 1 where a wall block stands. */
  readonly walls: Uint8Array;
  wallCount = 0;
  private readonly seen: Uint8Array;
  private readonly queue: Int32Array;

  constructor(
    readonly cols: number,
    readonly rows: number,
  ) {
    this.size = cols * rows;
    this.walls = new Uint8Array(this.size);
    this.seen = new Uint8Array(this.size);
    this.queue = new Int32Array(this.size);
  }

  inside(c: Cell): boolean {
    return c.x >= 0 && c.y >= 0 && c.x < this.cols && c.y < this.rows;
  }

  index(c: Cell): number {
    return c.y * this.cols + c.x;
  }

  /** The border and walls both stop the head. */
  solid(c: Cell): boolean {
    return !this.inside(c) || this.walls[this.index(c)] === 1;
  }

  /** True when every non-wall cell can be reached from `from` through non-wall cells. */
  allOpenReachable(from: Cell): boolean {
    const { cols, rows, walls, seen, queue } = this;
    seen.fill(0);
    const start = this.index(from);
    seen[start] = 1;
    queue[0] = start;
    let head = 0;
    let tail = 1;
    while (head < tail) {
      const i = queue[head++] as number;
      const x = i % cols;
      const y = (i - x) / cols;
      for (const s of NEIGHBOURS) {
        const nx = x + s.x;
        const ny = y + s.y;
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
        const j = ny * cols + nx;
        if (seen[j] || walls[j]) continue;
        seen[j] = 1;
        queue[tail++] = j;
      }
    }
    return tail === this.size - this.wallCount;
  }
}

function runFits(
  grid: Grid,
  reserved: Uint8Array,
  head: Cell,
  minHeadDist: number,
  x0: number,
  y0: number,
  dx: number,
  dy: number,
  len: number,
): boolean {
  for (let i = 0; i < len; i++) {
    const c = { x: x0 + dx * i, y: y0 + dy * i };
    if (!grid.inside(c)) return false;
    const k = grid.index(c);
    if (grid.walls[k] || reserved[k] || manhattan(c, head) < minHeadDist) return false;
  }
  return true;
}

function paintRun(grid: Grid, x0: number, y0: number, dx: number, dy: number, len: number, on: boolean): void {
  for (let i = 0; i < len; i++) grid.walls[grid.index({ x: x0 + dx * i, y: y0 + dy * i })] = on ? 1 : 0;
  grid.wallCount += on ? len : -len;
}

/**
 * Adds up to `runs` straight wall runs of 2 to 4 cells, never more than `cap` walls in total. A run is
 * kept only when it avoids `reserved` cells and every cell within `minHeadDist` of the head, and when every
 * open cell stays reachable from the head. Returns the number of runs added.
 */
export function addWallRuns(
  grid: Grid,
  rng: Rng,
  head: Cell,
  reserved: Uint8Array,
  runs: number,
  cap: number,
  minHeadDist: number,
): number {
  let added = 0;
  for (let t = 0; t < WALL_TRIES && added < runs; t++) {
    const len = Math.min(rng.int(WALL_RUN_MIN, WALL_RUN_MAX), cap - grid.wallCount);
    if (len < WALL_RUN_MIN) break;
    const across = rng.chance(0.5);
    const dx = across ? 1 : 0;
    const dy = across ? 0 : 1;
    const x0 = rng.int(0, grid.cols - 1);
    const y0 = rng.int(0, grid.rows - 1);
    if (!runFits(grid, reserved, head, minHeadDist, x0, y0, dx, dy, len)) continue;
    paintRun(grid, x0, y0, dx, dy, len, true);
    if (grid.allOpenReachable(head)) added++;
    else paintRun(grid, x0, y0, dx, dy, len, false);
  }
  return added;
}
