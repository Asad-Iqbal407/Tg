import type { Rng } from '../../core/rng';

export const COLS = 9;

export type LaneKind = 'grass' | 'road' | 'river';

/** A car or a log: its left edge and length, in columns. */
export interface Mover {
  x: number;
  len: number;
  hue: number;
}

export interface Lane {
  kind: LaneKind;
  /** Columns per second; the sign is the direction. 0 on grass. */
  speed: number;
  movers: Mover[];
  /** Columns holding a tree (grass only). */
  trees: Set<number>;
  /** Column holding a coin (grass only), or -1. */
  coin: number;
}

/** Lanes wrap a little past both edges, so a mover leaves one side and comes back on the other. */
export const WRAP = 3;
const SAFE_ROWS = 4;

/** True when column position x (a cell centre) is covered by a mover, with `slack` columns to spare each side. */
export function covered(lane: Lane, x: number, slack: number): boolean {
  return lane.movers.some((m) => x > m.x - slack && x < m.x + m.len + slack);
}

/** Moves every mover along its lane, wrapping round past the edges. */
export function stepLane(lane: Lane, dt: number): void {
  const span = COLS + WRAP * 2;
  for (const m of lane.movers) {
    m.x += lane.speed * dt;
    if (m.x > COLS + WRAP) m.x -= span;
    else if (m.x + m.len < -WRAP) m.x += span;
  }
}

/**
 * Builds the lane for world row `row`. The first rows are grass; after that roads and rivers come in runs, broken by
 * strips of grass, and both get faster further up. `prev` is the lane below, so runs continue and rivers never sit
 * directly on rivers moving the same way.
 */
export function makeLane(
  rng: Rng,
  row: number,
  prev: Lane | null,
  runLeft: number,
): { lane: Lane; runLeft: number } {
  if (row < SAFE_ROWS) return { lane: grass(rng, row, 0), runLeft: 0 };
  let kind: LaneKind;
  let left = runLeft;
  if (left > 0 && prev && prev.kind !== 'grass') {
    kind = prev.kind;
    left--;
  } else if (prev && prev.kind !== 'grass') {
    kind = 'grass';
  } else {
    kind = rng.chance(0.55) ? 'road' : 'river';
    left = rng.int(1, Math.min(4, 1 + Math.floor(row / 25)));
  }
  if (kind === 'grass') return { lane: grass(rng, row, 0.18), runLeft: 0 };
  const level = Math.min(1, row / 300);
  const dir = prev && prev.kind === kind ? -Math.sign(prev.speed) || 1 : rng.chance(0.5) ? 1 : -1;
  if (kind === 'road') {
    const speed = dir * rng.range(1.2 + level * 1.6, 2.2 + level * 2.6);
    return {
      lane: {
        kind,
        speed,
        movers: spread(rng, rng.int(2, 3), () => (rng.chance(0.25) ? 2 : 1)),
        trees: new Set(),
        coin: -1,
      },
      runLeft: left,
    };
  }
  const speed = dir * rng.range(0.9 + level * 0.8, 1.6 + level * 1.4);
  // Logs get shorter and rarer further up, so the river gets harder to cross.
  const count = level > 0.6 ? 2 : 3;
  return {
    lane: {
      kind,
      speed,
      movers: spread(rng, count, () => rng.int(level > 0.5 ? 2 : 3, 4)),
      trees: new Set(),
      coin: -1,
    },
    runLeft: left,
  };
}

function grass(rng: Rng, row: number, treeChance: number): Lane {
  const trees = new Set<number>();
  for (let c = 0; c < COLS; c++) {
    // The middle column stays clear near the start, so the first hops are never blocked.
    if (row < 2 && Math.abs(c - (COLS - 1) / 2) < 1) continue;
    if (rng.chance(treeChance)) trees.add(c);
  }
  if (trees.size >= COLS - 1) trees.clear();
  const free = Array.from({ length: COLS }, (_, c) => c).filter((c) => !trees.has(c));
  const coin = row >= 6 && rng.chance(0.2) ? rng.pick(free) : -1;
  return { kind: 'grass', speed: 0, movers: [], trees, coin };
}

/** `count` movers spaced evenly around the wrapped lane, each nudged a little, with lengths from `len`. */
function spread(rng: Rng, count: number, len: () => number): Mover[] {
  const span = COLS + WRAP * 2;
  const gap = span / count;
  return Array.from({ length: count }, (_, i) => ({
    x: -WRAP + i * gap + rng.range(0, gap * 0.4),
    len: len(),
    hue: rng.int(0, 359),
  }));
}
