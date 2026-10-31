import type { Rng } from '../../core/rng';

export const SIZE = 8;
export const KINDS = 6;

/** Gem kinds 0..KINDS-1, row-major; -1 is a hole waiting to be filled. */
export type Grid = number[];

/** A board with no line of three anywhere and at least one swap that makes one. */
export function newBoard(rng: Rng): Grid {
  for (;;) {
    const g: Grid = [];
    for (let i = 0; i < SIZE * SIZE; i++) {
      const c = i % SIZE;
      let k = rng.int(0, KINDS - 1);
      for (let tries = 0; tries < KINDS && makesLine(g, i, c, k); tries++) k = (k + 1) % KINDS;
      g.push(k);
    }
    if (findMatches(g).size === 0 && hasMove(g)) return g;
  }
}

function makesLine(g: Grid, i: number, c: number, k: number): boolean {
  const left = c >= 2 && g[i - 1] === k && g[i - 2] === k;
  const up = i >= SIZE * 2 && g[i - SIZE] === k && g[i - SIZE * 2] === k;
  return left || up;
}

/** Every cell in a line of three or more of one kind, across or down. */
export function findMatches(g: Grid): Set<number> {
  const out = new Set<number>();
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const k = g[r * SIZE + c];
      if (k === undefined || k < 0) continue;
      let run = 1;
      while (c + run < SIZE && g[r * SIZE + c + run] === k) run++;
      if (run >= 3) for (let j = 0; j < run; j++) out.add(r * SIZE + c + j);
      run = 1;
      while (r + run < SIZE && g[(r + run) * SIZE + c] === k) run++;
      if (run >= 3) for (let j = 0; j < run; j++) out.add((r + j) * SIZE + c);
    }
  }
  return out;
}

export function adjacent(a: number, b: number): boolean {
  const dr = Math.abs(Math.floor(a / SIZE) - Math.floor(b / SIZE));
  const dc = Math.abs((a % SIZE) - (b % SIZE));
  return dr + dc === 1;
}

export function swap(g: Grid, a: number, b: number): void {
  const t = g[a] as number;
  g[a] = g[b] as number;
  g[b] = t;
}

/** Whether swapping a and b would make a line. */
export function swapMatches(g: Grid, a: number, b: number): boolean {
  if (!adjacent(a, b)) return false;
  swap(g, a, b);
  const any = findMatches(g).size > 0;
  swap(g, a, b);
  return any;
}

export function hasMove(g: Grid): boolean {
  for (let i = 0; i < SIZE * SIZE; i++) {
    if (i % SIZE < SIZE - 1 && swapMatches(g, i, i + 1)) return true;
    if (i + SIZE < SIZE * SIZE && swapMatches(g, i, i + SIZE)) return true;
  }
  return false;
}

/**
 * Gems drop down to fill the holes, and new gems fill from the top. Returns how many rows each cell's gem fell, for
 * the animation.
 */
export function collapse(g: Grid, rng: Rng): number[] {
  const fell = Array<number>(SIZE * SIZE).fill(0);
  for (let c = 0; c < SIZE; c++) {
    let write = SIZE - 1;
    for (let r = SIZE - 1; r >= 0; r--) {
      const k = g[r * SIZE + c] as number;
      if (k < 0) continue;
      g[write * SIZE + c] = k;
      fell[write * SIZE + c] = write - r;
      write--;
    }
    const fresh = write + 1;
    for (let r = write; r >= 0; r--) {
      g[r * SIZE + c] = rng.int(0, KINDS - 1);
      fell[r * SIZE + c] = fresh;
    }
  }
  return fell;
}
