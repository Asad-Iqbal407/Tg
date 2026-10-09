import { Rng } from '../../core/rng';
import { CHUNKS, END_CHUNK, START_CHUNK, type Chunk } from './chunks';

export const T = 36;
export const ROWS = 15;
const CHUNK_TOP_ROW = 4;

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

export interface LevelData {
  cols: number;
  tiles: Uint8Array;
  contents: Map<number, BlockContent>;
  spawns: { kind: EnemyKind; x: number; y: number }[];
  coins: { x: number; y: number; taken: boolean }[];
  start: { x: number; y: number };
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

/** Validate chunk geometry; used by tests to guard hand-authored content. */
export function validateChunk(c: Chunk): string[] {
  const errors: string[] = [];
  const w = chunkWidth(c);
  if (c.rows.length !== ROWS - 2 - CHUNK_TOP_ROW)
    errors.push(`${c.name}: expected ${ROWS - 2 - CHUNK_TOP_ROW} rows`);
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
    start: { x: 2 * T, y: 12 * T },
    checkpoint: { x: 2 * T, y: 12 * T },
    flagX: (cols - 4) * T,
    castleX: (cols - 4) * T,
    chunkNames: chunks.map((c) => c.name),
  };
  const midIndex = Math.floor(chunks.length / 2);
  let x0 = 0;
  chunks.forEach((chunk, ci) => {
    const w = chunkWidth(chunk);
    if (ci === midIndex) data.checkpoint = { x: (x0 + 1) * T, y: 12 * T };
    for (let c = 0; c < w; c++) {
      const col = x0 + c;
      if (chunk.ground[c] === '#') {
        tiles[13 * cols + col] = Tile.Ground;
        tiles[14 * cols + col] = Tile.Ground;
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
        if (enemy) data.spawns.push({ kind: enemy, x: col * T + T / 2, y: (row + 1) * T });
        else if (ch === 'o') data.coins.push({ x: col * T + T / 2, y: row * T + T / 2, taken: false });
        else if (ch === 'S') data.start = { x: col * T, y: (row + 1) * T };
        else if (ch === 'F') {
          data.flagX = col * T + T / 2;
          data.castleX = data.flagX + 4 * T;
        }
      });
    }
    x0 += w;
  });
  return data;
}
