import type { Rng } from '../../core/rng';

/** 81 cells, row-major; 0 is empty. */
export type Grid = number[];

export function rowOf(i: number): number {
  return Math.floor(i / 9);
}

export function colOf(i: number): number {
  return i % 9;
}

export function boxOf(i: number): number {
  return Math.floor(rowOf(i) / 3) * 3 + Math.floor(colOf(i) / 3);
}

/** True when cells i and j share a row, a column or a box. */
export function sees(i: number, j: number): boolean {
  return i !== j && (rowOf(i) === rowOf(j) || colOf(i) === colOf(j) || boxOf(i) === boxOf(j));
}

/** Whether digit d can go in cell i without repeating in its row, column or box. */
export function allowed(g: Grid, i: number, d: number): boolean {
  const r = rowOf(i);
  const c = colOf(i);
  const br = r - (r % 3);
  const bc = c - (c % 3);
  for (let k = 0; k < 9; k++) {
    if (g[r * 9 + k] === d || g[k * 9 + c] === d) return false;
    if (g[(br + Math.floor(k / 3)) * 9 + bc + (k % 3)] === d) return false;
  }
  return true;
}

/** Counts the solutions of `g`, stopping at `limit`. It tries the cell with the fewest options first; `g` is restored. */
export function countSolutions(g: Grid, limit = 2): number {
  let best = -1;
  let bestOptions: number[] = [];
  for (let i = 0; i < 81; i++) {
    if (g[i] !== 0) continue;
    const options: number[] = [];
    for (let d = 1; d <= 9; d++) if (allowed(g, i, d)) options.push(d);
    if (options.length === 0) return 0;
    if (best < 0 || options.length < bestOptions.length) {
      best = i;
      bestOptions = options;
      if (options.length === 1) break;
    }
  }
  if (best < 0) return 1;
  let count = 0;
  for (const d of bestOptions) {
    g[best] = d;
    count += countSolutions(g, limit - count);
    if (count >= limit) break;
  }
  g[best] = 0;
  return count;
}

/** A complete, valid grid, filled in a random order. */
export function solvedGrid(rng: Rng): Grid {
  const g: Grid = Array<number>(81).fill(0);
  const fill = (i: number): boolean => {
    if (i === 81) return true;
    for (const d of rng.shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9])) {
      if (!allowed(g, i, d)) continue;
      g[i] = d;
      if (fill(i + 1)) return true;
    }
    g[i] = 0;
    return false;
  };
  fill(0);
  return g;
}

/** Numbers left showing on puzzle n: fewer on later puzzles, down to 26. */
export function givensFor(n: number): number {
  return Math.max(26, 42 - 4 * (n - 1));
}

/**
 * A puzzle with exactly one solution and about `givens` numbers showing: cells are emptied in a random order, and
 * any removal that would allow a second solution is put back.
 */
export function makePuzzle(rng: Rng, givens: number): { puzzle: Grid; solution: Grid } {
  const solution = solvedGrid(rng);
  const puzzle = [...solution];
  let shown = 81;
  for (const i of rng.shuffle(Array.from({ length: 81 }, (_, k) => k))) {
    if (shown <= givens) break;
    const keep = puzzle[i] as number;
    puzzle[i] = 0;
    if (countSolutions([...puzzle], 2) !== 1) puzzle[i] = keep;
    else shown--;
  }
  return { puzzle, solution };
}
