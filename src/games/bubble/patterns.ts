import type { Rng } from '../../core/rng';
import { COLS, emptyRow, flip, type Row, unanchored } from './board';

/**
 * Designed level boards. Each level hangs a shape (which cells hold a bubble) and paints it with a colour scheme
 * that keeps same-coloured bubbles together in bands, stripes or clumps, so shots pop and drop whole chunks the way
 * the classic game plays, instead of picking at a board of scattered singles.
 */

/** Whether the cell at (row, col) holds a bubble, for a board `depth` rows deep. */
type Shape = (row: number, col: number, depth: number) => boolean;
/** The colour group (0-based, before shuffling) of a cell. */
type Scheme = (row: number, col: number) => number;

const MID = (COLS - 1) / 2;

export const SHAPES: readonly { name: string; has: Shape }[] = [
  { name: 'wall', has: () => true },
  // Wide at the ceiling, narrowing to a point.
  {
    name: 'funnel',
    has: (r, c, d) => Math.abs(c - MID) <= MID - Math.floor((r * MID) / Math.max(1, d)) + 0.5,
  },
  // Three columns hanging from a full top row.
  { name: 'pillars', has: (r, c) => r < 2 || c <= 1 || (c >= 3 && c <= 5) || c >= 7 },
  // A wavy bottom edge.
  { name: 'wave', has: (r, c, d) => r < d - 2 + Math.round(2 * Math.sin((c / (COLS - 1)) * Math.PI * 2)) },
  // Deep at the sides, shallow in the middle.
  { name: 'arch', has: (r, c, d) => r < d - 3 + Math.round(Math.abs(c - MID) * 0.75) },
  // Deep in the middle, shallow at the sides.
  { name: 'drop', has: (r, c, d) => r < d - Math.round(Math.abs(c - MID) * 0.8) },
];

export const SCHEMES: readonly { name: string; paint: Scheme }[] = [
  // Two rows per colour.
  { name: 'bands', paint: (r) => Math.floor(r / 2) },
  // Vertical stripes, three columns wide (the odd rows' shift blends their edges).
  { name: 'stripes', paint: (_r, c) => Math.floor(c / 3) },
  // V shapes pointing down from the middle.
  { name: 'chevrons', paint: (r, c) => Math.floor((r + Math.abs(c - MID)) / 2) },
  // Diagonal stripes.
  { name: 'diagonal', paint: (r, c) => Math.floor((r + c) / 3) },
  // Blocks of three columns by two rows, like a quilt.
  { name: 'quilt', paint: (r, c) => Math.floor(r / 2) * 3 + Math.floor(c / 3) },
];

/** Share of cells repainted a random colour, so a pattern is never solved by reading it alone. */
const NOISE = 0.12;

/** The shape and colour scheme a level uses. They advance at different rates, so the pairs keep changing. */
export function designFor(level: number): { shape: number; scheme: number } {
  const i = level - 1;
  return { shape: i % SHAPES.length, scheme: (i * 2) % SCHEMES.length };
}

/**
 * The rows a level starts with, `depth` rows deep with colours 1..colours. Colour groups map to colours through
 * a shuffle, so a pattern looks different each time it comes round. Cells the shape leaves unconnected to the
 * ceiling are removed.
 */
export function buildBoard(rng: Rng, level: number, depth: number, colours: number): Row[] {
  const { shape, scheme } = designFor(level);
  const has = SHAPES[shape]?.has ?? (() => true);
  const paint = SCHEMES[scheme]?.paint ?? (() => 0);
  const order = rng.shuffle(Array.from({ length: colours }, (_, i) => i + 1));
  const rows: Row[] = [];
  let shift: 0 | 1 = 0;
  for (let r = 0; r < depth; r++) {
    const row = emptyRow(shift);
    for (let c = 0; c < COLS; c++) {
      if (r > 0 && !has(r, c, depth)) continue;
      const group = paint(r, c);
      row.cells[c] = order[group % colours] ?? 1;
      if (rng.chance(NOISE)) row.cells[c] = rng.int(1, colours);
    }
    rows.push(row);
    shift = flip(shift);
  }
  for (const cell of unanchored(rows)) {
    const row = rows[cell.row];
    if (row) row.cells[cell.col] = 0;
  }
  while (rows.length > 1 && rows[rows.length - 1]?.cells.every((v) => v === 0)) rows.pop();
  return rows;
}
