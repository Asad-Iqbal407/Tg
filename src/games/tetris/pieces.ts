import type { Rng } from '../../core/rng';

/** The seven tetrominoes, named after their letters. */
export const KINDS = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'] as const;
export type Kind = (typeof KINDS)[number];

/** SRS rotation state: 0 spawn, 1 one clockwise turn (R), 2 a half turn, 3 one anticlockwise turn (L). */
export type Rot = 0 | 1 | 2 | 3;

/** A cell relative to the top-left corner of its piece's bounding box. y grows downwards. */
export interface Offset {
  readonly x: number;
  readonly y: number;
}

/** A falling piece: its shape, its rotation state and the board position of its bounding box. */
export interface Piece {
  kind: Kind;
  rot: Rot;
  x: number;
  y: number;
}

/** A wall-kick offset [dx, dy] in the SRS convention, where dy is positive upwards. */
export type Kick = readonly [number, number];

interface Shape {
  /** Side of the square bounding box the rotations turn inside. */
  readonly size: number;
  /** Cells of each rotation state, in state order 0, R, 2, L. */
  readonly states: readonly [readonly Offset[], readonly Offset[], readonly Offset[], readonly Offset[]];
  /** Extent of the spawn orientation, for centring previews. */
  readonly bounds: { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
}

function parse(rows: readonly string[]): Offset[] {
  const cells: Offset[] = [];
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) if (row[x] !== '.') cells.push({ x, y });
  });
  return cells;
}

/** One clockwise quarter turn inside a size x size box: (x, y) becomes (size - 1 - y, x). */
function turn(cells: readonly Offset[], size: number): Offset[] {
  return cells.map(({ x, y }) => ({ x: size - 1 - y, y: x }));
}

/** Builds all four rotation states from the spawn orientation, one clockwise turn at a time. */
function shapeOf(rows: readonly string[]): Shape {
  const size = rows.length;
  const s0 = parse(rows);
  const s1 = turn(s0, size);
  const s2 = turn(s1, size);
  const s3 = turn(s2, size);
  const xs = s0.map((c) => c.x);
  const ys = s0.map((c) => c.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return {
    size,
    states: [s0, s1, s2, s3],
    bounds: { x, y, w: Math.max(...xs) - x + 1, h: Math.max(...ys) - y + 1 },
  };
}

/** Spawn orientation of each piece, one string per row of its box ('.' is empty). */
const SHAPES: Readonly<Record<Kind, Shape>> = {
  I: shapeOf(['....', 'IIII', '....', '....']),
  O: shapeOf(['OO', 'OO']),
  T: shapeOf(['.T.', 'TTT', '...']),
  S: shapeOf(['.SS', 'SS.', '...']),
  Z: shapeOf(['ZZ.', '.ZZ', '...']),
  J: shapeOf(['J..', 'JJJ', '...']),
  L: shapeOf(['..L', 'LLL', '...']),
};

/** Standard SRS kicks for J, L, S, T and Z, keyed "from>to" by rotation state. */
const JLSTZ_KICKS: Readonly<Record<string, readonly Kick[]>> = {
  '0>1': [
    [0, 0],
    [-1, 0],
    [-1, 1],
    [0, -2],
    [-1, -2],
  ],
  '1>0': [
    [0, 0],
    [1, 0],
    [1, -1],
    [0, 2],
    [1, 2],
  ],
  '1>2': [
    [0, 0],
    [1, 0],
    [1, -1],
    [0, 2],
    [1, 2],
  ],
  '2>1': [
    [0, 0],
    [-1, 0],
    [-1, 1],
    [0, -2],
    [-1, -2],
  ],
  '2>3': [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, -2],
    [1, -2],
  ],
  '3>2': [
    [0, 0],
    [-1, 0],
    [-1, -1],
    [0, 2],
    [-1, 2],
  ],
  '3>0': [
    [0, 0],
    [-1, 0],
    [-1, -1],
    [0, 2],
    [-1, 2],
  ],
  '0>3': [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, -2],
    [1, -2],
  ],
};

/** Standard SRS kicks for the I piece, keyed "from>to" by rotation state. */
const I_KICKS: Readonly<Record<string, readonly Kick[]>> = {
  '0>1': [
    [0, 0],
    [-2, 0],
    [1, 0],
    [-2, -1],
    [1, 2],
  ],
  '1>0': [
    [0, 0],
    [2, 0],
    [-1, 0],
    [2, 1],
    [-1, -2],
  ],
  '1>2': [
    [0, 0],
    [-1, 0],
    [2, 0],
    [-1, 2],
    [2, -1],
  ],
  '2>1': [
    [0, 0],
    [1, 0],
    [-2, 0],
    [1, -2],
    [-2, 1],
  ],
  '2>3': [
    [0, 0],
    [2, 0],
    [-1, 0],
    [2, 1],
    [-1, -2],
  ],
  '3>2': [
    [0, 0],
    [-2, 0],
    [1, 0],
    [-2, -1],
    [1, 2],
  ],
  '3>0': [
    [0, 0],
    [1, 0],
    [-2, 0],
    [1, -2],
    [-2, 1],
  ],
  '0>3': [
    [0, 0],
    [-1, 0],
    [2, 0],
    [-1, 2],
    [2, -1],
  ],
};

/** The O piece is symmetric, so turning it never needs a kick. */
const NO_KICK: readonly Kick[] = [[0, 0]];

/** The cells of a piece in rotation state `rot`, relative to its bounding box. */
export function cellsOf(kind: Kind, rot: Rot): readonly Offset[] {
  return SHAPES[kind].states[rot];
}

/** Side of the bounding box a piece turns inside (4 for I, 2 for O, 3 otherwise). */
export function pieceSize(kind: Kind): number {
  return SHAPES[kind].size;
}

/** Extent of the spawn orientation, for drawing a piece centred in a box. */
export function pieceBounds(kind: Kind): {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
} {
  return SHAPES[kind].bounds;
}

/** The state one clockwise turn away from `rot`. */
export function turnedRot(rot: Rot): Rot {
  return ((rot + 1) % 4) as Rot;
}

/** The wall-kick offsets to try, in order, when a piece turns from state `from` to the adjacent state `to`. */
export function kickTests(kind: Kind, from: Rot, to: Rot): readonly Kick[] {
  if (kind === 'O') return NO_KICK;
  const table = kind === 'I' ? I_KICKS : JLSTZ_KICKS;
  return table[`${from}>${to}`] ?? NO_KICK;
}

/** How many upcoming pieces the queue keeps visible. */
export const PREVIEW_COUNT = 3;

/**
 * Seven-bag randomiser: every bag holds each shape exactly once, and bags are dealt in order. The queue
 * always keeps enough pieces ahead to show the next few.
 */
export class PieceQueue {
  private readonly queue: Kind[] = [];

  constructor(private readonly rng: Rng) {
    this.fill();
  }

  /** Deals the next piece. */
  next(): Kind {
    this.fill();
    return this.queue.shift() ?? KINDS[0];
  }

  /** The piece `i` places ahead (0 is the next one dealt). Read-only, so rendering may call it. */
  peek(i: number): Kind {
    return this.queue[i] ?? KINDS[0];
  }

  private fill(): void {
    while (this.queue.length <= PREVIEW_COUNT) this.queue.push(...this.rng.shuffle([...KINDS]));
  }
}
