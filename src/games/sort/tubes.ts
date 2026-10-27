import type { Rng } from '../../core/rng';

/** Balls per tube. */
export const CAPACITY = 4;

/** Tubes hold colours bottom first; colours are 1-based. */
export type Tubes = number[][];

/** A move from `from` to `to` is allowed when `to` has room and is empty or has the same colour on top. */
export function canPour(tubes: Tubes, from: number, to: number): boolean {
  const a = tubes[from];
  const b = tubes[to];
  if (!a || !b || from === to || a.length === 0 || b.length >= CAPACITY) return false;
  const top = b[b.length - 1];
  return top === undefined || top === a[a.length - 1];
}

/** Moves the top ball of `from` to `to` (one ball, as the classic game). Returns false when not allowed. */
export function pour(tubes: Tubes, from: number, to: number): boolean {
  if (!canPour(tubes, from, to)) return false;
  const ball = tubes[from]?.pop();
  if (ball === undefined) return false;
  tubes[to]?.push(ball);
  return true;
}

/** Solved when every tube is empty or full of a single colour. */
export function solved(tubes: Tubes): boolean {
  return tubes.every((t) => t.length === 0 || (t.length === CAPACITY && t.every((c) => c === t[0])));
}

function key(tubes: Tubes): string {
  return tubes
    .map((t) => t.join(''))
    .sort()
    .join('|');
}

/**
 * Whether the position can be solved, by a depth-first search over distinct positions. Returns true when a solution
 * is found, false when every position was tried, and null when the search gave up after `budget` positions.
 */
export function solvable(start: Tubes, budget = 40000): boolean | null {
  const seen = new Set<string>();
  const stack: Tubes[] = [start.map((t) => [...t])];
  while (stack.length > 0) {
    const tubes = stack.pop() as Tubes;
    if (solved(tubes)) return true;
    const k = key(tubes);
    if (seen.has(k)) continue;
    seen.add(k);
    if (seen.size > budget) return null;
    for (let a = 0; a < tubes.length; a++) {
      const from = tubes[a] as number[];
      // A tube already holding one colour from the bottom up is never worth emptying into another single-colour stack.
      for (let b = 0; b < tubes.length; b++) {
        if (!canPour(tubes, a, b)) continue;
        const to = tubes[b] as number[];
        if (to.length === 0 && from.every((c) => c === from[0])) continue;
        const next = tubes.map((t) => [...t]);
        pour(next, a, b);
        stack.push(next);
      }
    }
  }
  return false;
}

/**
 * Deals `colours` colours of CAPACITY balls each into `colours` tubes, plus `empty` empty tubes, shuffled. A deal is
 * kept only once the solver proves it can be solved (or runs out of budget, which on these sizes means it almost
 * certainly can), and never when it starts solved.
 */
export function dealTubes(rng: Rng, colours: number, empty: number): Tubes {
  for (let attempt = 0; attempt < 30; attempt++) {
    const balls: number[] = [];
    for (let c = 1; c <= colours; c++) for (let k = 0; k < CAPACITY; k++) balls.push(c);
    rng.shuffle(balls);
    const tubes: Tubes = [];
    for (let i = 0; i < colours; i++) tubes.push(balls.slice(i * CAPACITY, (i + 1) * CAPACITY));
    for (let i = 0; i < empty; i++) tubes.push([]);
    if (solved(tubes)) continue;
    if (solvable(tubes, 20000) !== false) return tubes;
  }
  // Fallback: a deal made by legal moves backwards from the solved position is always solvable.
  const tubes: Tubes = [];
  for (let c = 1; c <= colours; c++) tubes.push(Array<number>(CAPACITY).fill(c));
  for (let i = 0; i < empty; i++) tubes.push([]);
  for (let n = 0; n < 200; n++) {
    const a = rng.int(0, tubes.length - 1);
    const b = rng.int(0, tubes.length - 1);
    const from = tubes[a] as number[];
    const to = tubes[b] as number[];
    if (a === b || from.length === 0 || to.length >= CAPACITY) continue;
    // Reversing a legal move: the ball lifted must have sat on its own colour (or alone).
    const top = from[from.length - 1];
    const under = from[from.length - 2];
    if (under !== undefined && under !== top) continue;
    to.push(from.pop() as number);
  }
  return tubes;
}
