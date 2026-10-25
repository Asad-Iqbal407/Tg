export type Dir = 'left' | 'right' | 'up' | 'down';

export interface Tile {
  id: number;
  value: number;
  r: number;
  c: number;
  /** Where the tile was before the last move, for the slide animation. */
  pr: number;
  pc: number;
  /** True for one move when the tile was made by merging two tiles. */
  merged: boolean;
  /** True for one move when the tile was just spawned. */
  born: boolean;
}

/** A tile swallowed by a merge: drawn sliding into its partner, then gone. */
export interface Ghost {
  value: number;
  pr: number;
  pc: number;
  r: number;
  c: number;
}

export interface SlideResult {
  tiles: Tile[];
  ghosts: Ghost[];
  moved: boolean;
  /** Points scored: the sum of every merged tile's new value. */
  gained: number;
  /** Values of the tiles that merges made, in order. */
  created: number[];
}

/**
 * Slides every tile as far as it goes toward `dir`. Two equal tiles that meet merge into one tile of double the
 * value, and a tile made by a merge does not merge again in the same move (so 2 2 2 2 becomes 4 4, not 8).
 */
export function slide(tiles: readonly Tile[], dir: Dir, size: number): SlideResult {
  const grid: (Tile | null)[][] = Array.from({ length: size }, () => Array<Tile | null>(size).fill(null));
  for (const t of tiles) {
    const row = grid[t.r];
    if (row) row[t.c] = t;
  }
  const out: Tile[] = [];
  const ghosts: Ghost[] = [];
  const created: number[] = [];
  let gained = 0;
  let moved = false;
  for (let line = 0; line < size; line++) {
    // Cells of this line from the edge the tiles slide toward.
    const cells: [number, number][] = [];
    for (let i = 0; i < size; i++) {
      const k = dir === 'left' || dir === 'up' ? i : size - 1 - i;
      cells.push(dir === 'left' || dir === 'right' ? [line, k] : [k, line]);
    }
    const lineTiles = cells.map(([r, c]) => grid[r]?.[c] ?? null).filter((t): t is Tile => t !== null);
    let slot = 0;
    let last: Tile | null = null;
    for (const t of lineTiles) {
      if (last && !last.merged && last.value === t.value) {
        last.value *= 2;
        last.merged = true;
        gained += last.value;
        created.push(last.value);
        ghosts.push({ value: t.value, pr: t.r, pc: t.c, r: last.r, c: last.c });
        moved = true;
        continue;
      }
      const cell = cells[slot];
      if (!cell) continue;
      const [r, c] = cell;
      slot++;
      const next: Tile = { id: t.id, value: t.value, r, c, pr: t.r, pc: t.c, merged: false, born: false };
      if (r !== t.r || c !== t.c) moved = true;
      out.push(next);
      last = next;
    }
  }
  return { tiles: out, ghosts, moved, gained, created };
}

/** True when some move would change the board: an empty cell, or two equal tiles side by side. */
export function canMove(tiles: readonly Tile[], size: number): boolean {
  if (tiles.length < size * size) return true;
  const at = new Map<string, number>();
  for (const t of tiles) at.set(`${t.r},${t.c}`, t.value);
  for (const t of tiles) {
    if (at.get(`${t.r},${t.c + 1}`) === t.value) return true;
    if (at.get(`${t.r + 1},${t.c}`) === t.value) return true;
  }
  return false;
}

/** Empty cells in reading order. */
export function emptyCells(tiles: readonly Tile[], size: number): [number, number][] {
  const used = new Set(tiles.map((t) => t.r * size + t.c));
  const out: [number, number][] = [];
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) if (!used.has(r * size + c)) out.push([r, c]);
  return out;
}
