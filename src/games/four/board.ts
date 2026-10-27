import type { Rng } from '../../core/rng';

export const COLS = 7;
export const ROWS = 6;

/** 0 empty, 1 the player, 2 the computer. Cells are column-major, row 0 at the bottom. */
export type Grid = number[][];

export function emptyGrid(): Grid {
  return Array.from({ length: COLS }, () => Array<number>(ROWS).fill(0));
}

/** The row a disc dropped in column c lands on, or -1 when the column is full. */
export function landingRow(g: Grid, c: number): number {
  const col = g[c];
  if (!col) return -1;
  const r = col.indexOf(0);
  return r;
}

export function legalMoves(g: Grid): number[] {
  // Centre columns first: they are usually best, which makes alpha-beta prune far more.
  return [3, 2, 4, 1, 5, 0, 6].filter((c) => landingRow(g, c) >= 0);
}

const DIRS: readonly [number, number][] = [
  [1, 0],
  [0, 1],
  [1, 1],
  [1, -1],
];

/** The four cells of a winning line through any cell, or null. */
export function winLine(g: Grid): [number, number][] | null {
  for (let c = 0; c < COLS; c++) {
    for (let r = 0; r < ROWS; r++) {
      const who = g[c]?.[r] ?? 0;
      if (!who) continue;
      for (const [dc, dr] of DIRS) {
        const line: [number, number][] = [[c, r]];
        for (let k = 1; k < 4; k++) {
          const x = c + dc * k;
          const y = r + dr * k;
          if (g[x]?.[y] !== who) break;
          line.push([x, y]);
        }
        if (line.length === 4) return line;
      }
    }
  }
  return null;
}

export function full(g: Grid): boolean {
  return legalMoves(g).length === 0;
}

/** Heuristic value of the position for the computer: open lines of two and three, and the centre column. */
function evaluate(g: Grid): number {
  let score = 0;
  for (let r = 0; r < ROWS; r++) {
    if (g[3]?.[r] === 2) score += 3;
    else if (g[3]?.[r] === 1) score -= 3;
  }
  for (let c = 0; c < COLS; c++) {
    for (let r = 0; r < ROWS; r++) {
      for (const [dc, dr] of DIRS) {
        const ec = c + dc * 3;
        const er = r + dr * 3;
        if (ec < 0 || ec >= COLS || er < 0 || er >= ROWS) continue;
        let mine = 0;
        let theirs = 0;
        for (let k = 0; k < 4; k++) {
          const v = g[c + dc * k]?.[r + dr * k] ?? 0;
          if (v === 2) mine++;
          else if (v === 1) theirs++;
        }
        if (mine > 0 && theirs > 0) continue;
        if (mine === 3) score += 5;
        else if (mine === 2) score += 2;
        if (theirs === 3) score -= 6;
        else if (theirs === 2) score -= 2;
      }
    }
  }
  return score;
}

function minimax(g: Grid, depth: number, alpha: number, beta: number, cpu: boolean): number {
  const won = winLine(g);
  if (won) {
    const [c, r] = won[0] ?? [0, 0];
    const who = g[c]?.[r];
    // Sooner wins (and later losses) score better.
    return who === 2 ? 100000 + depth : -100000 - depth;
  }
  const moves = legalMoves(g);
  if (moves.length === 0) return 0;
  if (depth === 0) return evaluate(g);
  let a = alpha;
  let b = beta;
  if (cpu) {
    let best = -Infinity;
    for (const c of moves) {
      const r = landingRow(g, c);
      (g[c] as number[])[r] = 2;
      best = Math.max(best, minimax(g, depth - 1, a, b, false));
      (g[c] as number[])[r] = 0;
      a = Math.max(a, best);
      if (a >= b) break;
    }
    return best;
  }
  let best = Infinity;
  for (const c of moves) {
    const r = landingRow(g, c);
    (g[c] as number[])[r] = 1;
    best = Math.min(best, minimax(g, depth - 1, a, b, true));
    (g[c] as number[])[r] = 0;
    b = Math.min(b, best);
    if (a >= b) break;
  }
  return best;
}

/**
 * The computer's move: the best column found looking `depth` moves ahead, ties broken at random. With chance
 * `blunder` it plays a random legal column instead (the easiest levels).
 */
export function cpuMove(g: Grid, depth: number, rng: Rng, blunder = 0): number {
  const moves = legalMoves(g);
  if (moves.length === 0) return -1;
  if (rng.chance(blunder)) return rng.pick(moves);
  let best = -Infinity;
  let picks: number[] = [];
  for (const c of moves) {
    const r = landingRow(g, c);
    (g[c] as number[])[r] = 2;
    const v = minimax(g, depth - 1, -Infinity, Infinity, false);
    (g[c] as number[])[r] = 0;
    if (v > best) {
      best = v;
      picks = [c];
    } else if (v === best) picks.push(c);
  }
  return rng.pick(picks);
}
