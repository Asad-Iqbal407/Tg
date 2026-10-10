import { Rng } from '../../core/rng';
import { CHUNKS, END_CHUNK, START_CHUNK, type Chunk } from './chunks';
import { extraWalkerChance } from './tuning';

export const T = 36;
export const ROWS = 15;
/** First level row a chunk can use; the rows above it are open sky. */
export const CHUNK_TOP_ROW = 4;
/** Row whose top edge is the ground surface (rows 13–14 are ground). */
export const GROUND_ROW = 13;
/** A hero standing on row s can bump a block on row r when s - r is in this range. */
const BUMP_ROWS = { min: 2, max: 6 } as const;
/** Enemies spawned on a surface narrower than this turn around at ledges. */
const PATROL_MAX_SURFACE = 7;
/** A checkpoint this many columns from the nearest enemy counts as fully safe. */
const CHECKPOINT_CLEARANCE = 7;
/** Row of an added power block: four rows above the ground, like the usual block rows. */
const ADDED_BLOCK_ROW = GROUND_ROW - 4;

export const Tile = {
  Empty: 0,
  Ground: 1,
  Brick: 2,
  Question: 3,
  Used: 4,
  Hard: 5,
  PipeTL: 6,
  PipeTR: 7,
  PipeL: 8,
  PipeR: 9,
} as const;
export type TileId = (typeof Tile)[keyof typeof Tile];

export type BlockContent = 'coin' | 'power' | 'oneup';
export type EnemyKind = 'walker' | 'shellback' | 'spiky';

export interface Spawn {
  kind: EnemyKind;
  /** Centre x and feet y in px. */
  x: number;
  y: number;
  /** Turns around at ledges instead of walking off (set for enemies on islands and platforms). */
  patrol: boolean;
}

export interface LevelData {
  cols: number;
  tiles: Uint8Array;
  contents: Map<number, BlockContent>;
  spawns: Spawn[];
  coins: { x: number; y: number; taken: boolean }[];
  /** Hero spawn: left x and feet y. */
  start: { x: number; y: number };
  /** Checkpoint pole: centre x and the ground y it stands on. */
  checkpoint: { x: number; y: number };
  flagX: number;
  castleX: number;
  chunkNames: string[];
}

const TILE_CHARS: Record<string, TileId> = {
  '#': Tile.Ground,
  B: Tile.Brick,
  '?': Tile.Question,
  M: Tile.Question,
  '1': Tile.Question,
  X: Tile.Hard,
  '[': Tile.PipeTL,
  ']': Tile.PipeTR,
  '{': Tile.PipeL,
  '}': Tile.PipeR,
};

const ENEMY_CHARS: Record<string, EnemyKind> = { g: 'walker', k: 'shellback', s: 'spiky' };

export function chunkWidth(c: Chunk): number {
  return c.ground.length;
}

/** Character at level `row` of a chunk ('#' or '.' for the ground rows). */
function chunkChar(c: Chunk, col: number, row: number): string {
  if (row >= GROUND_ROW) return c.ground[col] === '#' ? '#' : '.';
  return c.rows[row - CHUNK_TOP_ROW]?.[col] ?? '.';
}

function solidChar(ch: string): boolean {
  return TILE_CHARS[ch] !== undefined;
}

/**
 * Can the question block at (`col`, `row`) be bumped? A hero must be able to stand on a surface
 * 2–6 rows below it, in its column or a neighbouring one (the hero straddles both), with nothing
 * solid in between.
 */
function blockBumpable(c: Chunk, col: number, row: number): boolean {
  const w = chunkWidth(c);
  for (const sc of [col, col - 1, col + 1]) {
    if (sc < 0 || sc >= w) continue;
    for (let s = row + 1; s <= GROUND_ROW; s++) {
      if (!solidChar(chunkChar(c, sc, s))) continue;
      const gap = s - row;
      let clear = gap >= BUMP_ROWS.min && gap <= BUMP_ROWS.max;
      for (let r = row + 1; clear && r < s; r++) clear = !solidChar(chunkChar(c, col, r));
      if (clear) return true;
      break;
    }
  }
  return false;
}

/** Validate chunk geometry; used by tests to guard hand-authored content. */
export function validateChunk(c: Chunk): string[] {
  const errors: string[] = [];
  const w = chunkWidth(c);
  if (c.rows.length !== GROUND_ROW - CHUNK_TOP_ROW)
    errors.push(`${c.name}: expected ${GROUND_ROW - CHUNK_TOP_ROW} rows`);
  c.rows.forEach((r, i) => {
    if (r.length !== w) errors.push(`${c.name}: row ${i} width ${r.length} != ${w}`);
  });
  if (c.ground[0] !== '#' || c.ground[w - 1] !== '#') errors.push(`${c.name}: must start and end on ground`);
  const hasPlatforms = c.rows.some((r) => /[XB]/.test(r));
  let pit = 0;
  let widest = 0;
  for (const ch of c.ground) {
    pit = ch === '.' ? pit + 1 : 0;
    widest = Math.max(widest, pit);
  }
  if (widest > 4 && !hasPlatforms) errors.push(`${c.name}: pit of ${widest} needs platforms`);
  c.rows.forEach((r, i) => {
    const row = CHUNK_TOP_ROW + i;
    for (let col = 0; col < r.length; col++) {
      const ch = r[col] as string;
      if ((ch === '?' || ch === 'M' || ch === '1') && !blockBumpable(c, col, row))
        errors.push(`${c.name}: block '${ch}' at row ${row}, col ${col} cannot be bumped`);
      if (ENEMY_CHARS[ch] && !solidChar(chunkChar(c, col, row + 1)))
        errors.push(`${c.name}: enemy at row ${row}, col ${col} spawns in mid-air`);
    }
  });
  return errors;
}

export function pickChunks(level: number, rng: Rng): Chunk[] {
  const count = 5 + Math.min(level, 6);
  const maxDiff = level <= 1 ? 2 : 3;
  const pool = CHUNKS.filter((c) => c.difficulty <= maxDiff);
  const out: Chunk[] = [];
  let prev: Chunk | null = null;
  for (let i = 0; i < count; i++) {
    const progress = i / count;
    const weighted = pool
      .filter((c) => c !== prev)
      .map((c) => {
        const target = 1 + Math.min(2, (level - 1) * 0.5 + progress * 1.2);
        return { value: c, weight: 1 / (1 + Math.abs(c.difficulty - target) * 1.5) };
      });
    const chunk = rng.weighted(weighted);
    out.push(chunk);
    prev = chunk;
  }
  return out;
}

/** Read-only tile access with the level's edge rules (walls left/right, open sky above). */
function tileIn(data: LevelData, col: number, row: number): TileId {
  if (col < 0 || col >= data.cols) return Tile.Hard;
  if (row < 0 || row >= ROWS) return Tile.Empty;
  return (data.tiles[row * data.cols + col] ?? Tile.Empty) as TileId;
}

/** Columns a walker can stand on around (`col`, `row`): floor below, nothing in the way. */
function surfaceWidth(data: LevelData, col: number, row: number): number {
  const standable = (c: number) =>
    tileIn(data, c, row) === Tile.Empty && tileIn(data, c, row + 1) !== Tile.Empty;
  let n = 1;
  for (let c = col - 1; standable(c); c--) n++;
  for (let c = col + 1; standable(c); c++) n++;
  return n;
}

/** Open ground column: solid floor, rows 10–12 empty and no enemy within two columns. */
function openGround(data: LevelData, col: number): boolean {
  if (tileIn(data, col, GROUND_ROW) !== Tile.Ground) return false;
  for (let r = GROUND_ROW - 3; r < GROUND_ROW; r++) if (tileIn(data, col, r) !== Tile.Empty) return false;
  return !data.spawns.some((s) => Math.abs(Math.floor(s.x / T) - col) <= 2);
}

/** Columns between `col` and the nearest enemy spawn, capped at `cap`. */
function enemyClearance(data: LevelData, col: number, cap: number): number {
  let d = cap;
  for (const s of data.spawns) d = Math.min(d, Math.abs(Math.floor(s.x / T) - col));
  return d;
}

/**
 * The checkpoint stands on open ground near the middle of the course (columns [from, to)), on the
 * column furthest from any enemy, up to CHECKPOINT_CLEARANCE columns; ties go to the column nearest
 * `pivot`. A respawn never starts next to a walker.
 */
function placeCheckpoint(data: LevelData, from: number, to: number, pivot: number): void {
  let best = pivot;
  let bestClear = -1;
  for (let col = from; col < to; col++) {
    if (!openGround(data, col)) continue;
    const clear = enemyClearance(data, col, CHECKPOINT_CLEARANCE);
    if (clear > bestClear || (clear === bestClear && Math.abs(col - pivot) < Math.abs(best - pivot))) {
      best = col;
      bestClear = clear;
    }
  }
  data.checkpoint = { x: best * T + T / 2, y: GROUND_ROW * T };
}

/**
 * A free spot for an extra block in columns [from, to): open ground under it and its neighbours,
 * and nothing else in that part of the sky, so it can be bumped from the floor and blocks no path.
 */
function freeBlockColumn(data: LevelData, from: number, to: number): number {
  const clearAbove = (col: number) => {
    for (let r = ADDED_BLOCK_ROW - 2; r < GROUND_ROW - 3; r++)
      if (tileIn(data, col, r) !== Tile.Empty) return false;
    return true;
  };
  for (let col = Math.max(1, from); col < to - 1; col++) {
    let ok = true;
    for (let c = col - 1; ok && c <= col + 1; c++) ok = openGround(data, c) && clearAbove(c);
    const cx = col * T + T / 2;
    const cy = ADDED_BLOCK_ROW * T + T / 2;
    if (ok && !data.coins.some((k) => Math.abs(k.x - cx) < T && Math.abs(k.y - cy) < T)) return col;
  }
  return -1;
}

/**
 * Make sure there is a power-up on each side of the checkpoint (so a respawn has one ahead too):
 * if a half has none, its first coin block becomes a power block, or, without one, a power block
 * is added over open ground. The start chunk's block gives the first half a candidate.
 */
function ensurePowerUps(data: LevelData, endCol: number): void {
  const cpCol = Math.floor(data.checkpoint.x / T);
  const blocks = [...data.contents.entries()]
    .map(([idx, content]) => ({ idx, content, col: idx % data.cols }))
    .sort((a, b) => a.col - b.col || a.idx - b.idx);
  const halves = [
    { from: 0, to: cpCol },
    { from: cpCol, to: endCol },
  ];
  for (const { from, to } of halves) {
    const inHalf = blocks.filter((b) => b.col >= from && b.col < to);
    if (inHalf.some((b) => b.content === 'power')) continue;
    const first = inHalf.find((b) => b.content === 'coin');
    if (first) {
      data.contents.set(first.idx, 'power');
      continue;
    }
    // A few steps past the checkpoint, so a respawned hero finds it straight away.
    const col = freeBlockColumn(data, from + 3, to);
    if (col < 0) continue;
    const idx = ADDED_BLOCK_ROW * data.cols + col;
    data.tiles[idx] = Tile.Question;
    data.contents.set(idx, 'power');
  }
}

/** From level 4 on, long flat stretches sometimes get an extra walker. */
function addExtraWalkers(data: LevelData, chunks: Chunk[], xs: number[], level: number, rng: Rng): void {
  const chance = extraWalkerChance(level);
  if (chance <= 0) return;
  const cpCol = Math.floor(data.checkpoint.x / T);
  // Skip the start, the first chunk (time to warm up) and the end.
  for (let ci = 2; ci < chunks.length - 1; ci++) {
    if (!rng.chance(chance)) continue;
    const chunk = chunks[ci] as Chunk;
    const x0 = xs[ci] as number;
    let best = { start: 0, len: 0 };
    let run = { start: 0, len: 0 };
    for (let col = x0 + 1; col < x0 + chunkWidth(chunk) - 1; col++) {
      const ok = openGround(data, col) && (col < cpCol - 2 || col > cpCol + 8);
      run = ok ? { start: run.len ? run.start : col, len: run.len + 1 } : { start: 0, len: 0 };
      if (run.len > best.len) best = { ...run };
    }
    if (best.len < 6) continue;
    const col = best.start + Math.floor(best.len / 2);
    data.spawns.push({ kind: 'walker', x: col * T + T / 2, y: GROUND_ROW * T, patrol: false });
  }
}

export function buildLevel(level: number, seed: number): LevelData {
  const rng = new Rng(seed + level * 7919);
  const middle = pickChunks(level, rng);
  const chunks = [START_CHUNK, ...middle, END_CHUNK];
  const cols = chunks.reduce((s, c) => s + chunkWidth(c), 0);
  const tiles = new Uint8Array(cols * ROWS);
  const data: LevelData = {
    cols,
    tiles,
    contents: new Map(),
    spawns: [],
    coins: [],
    start: { x: 2 * T, y: GROUND_ROW * T },
    checkpoint: { x: 2 * T, y: GROUND_ROW * T },
    flagX: (cols - 4) * T,
    castleX: (cols - 4) * T,
    chunkNames: chunks.map((c) => c.name),
  };
  const xs: number[] = [];
  let x0 = 0;
  for (const chunk of chunks) {
    xs.push(x0);
    const w = chunkWidth(chunk);
    for (let c = 0; c < w; c++) {
      const col = x0 + c;
      if (chunk.ground[c] === '#') {
        tiles[GROUND_ROW * cols + col] = Tile.Ground;
        tiles[(GROUND_ROW + 1) * cols + col] = Tile.Ground;
      }
      chunk.rows.forEach((rowStr, ri) => {
        const row = CHUNK_TOP_ROW + ri;
        const ch = rowStr[c] ?? '.';
        const tile = TILE_CHARS[ch];
        const idx = row * cols + col;
        if (tile !== undefined) {
          tiles[idx] = tile;
          if (ch === '?') data.contents.set(idx, 'coin');
          else if (ch === 'M') data.contents.set(idx, 'power');
          else if (ch === '1') data.contents.set(idx, 'oneup');
          return;
        }
        const enemy = ENEMY_CHARS[ch];
        if (enemy) data.spawns.push({ kind: enemy, x: col * T + T / 2, y: (row + 1) * T, patrol: false });
        else if (ch === 'o') data.coins.push({ x: col * T + T / 2, y: row * T + T / 2, taken: false });
        else if (ch === 'S') data.start = { x: col * T, y: (row + 1) * T };
        else if (ch === 'F') {
          data.flagX = col * T + T / 2;
          data.castleX = data.flagX + 4 * T;
        }
      });
    }
    x0 += w;
  }
  for (const s of data.spawns) {
    s.patrol = surfaceWidth(data, Math.floor(s.x / T), Math.floor(s.y / T) - 1) < PATROL_MAX_SURFACE;
  }
  // Around the seam between the two middle chunks.
  const mid = Math.floor(chunks.length / 2);
  const midX = xs[mid] as number;
  placeCheckpoint(data, (xs[mid - 1] as number) + 1, midX + chunkWidth(chunks[mid] as Chunk) - 1, midX);
  ensurePowerUps(data, xs[chunks.length - 1] as number);
  addExtraWalkers(data, chunks, xs, level, rng);
  return data;
}
