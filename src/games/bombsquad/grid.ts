import type { Rng } from '../../core/rng';

/** Logical tile size at the design width (960 x 600). */
export const TILE = 48;
export const FLOOR = 0;
export const BORDER = 1;
export const PILLAR = 2;
export const CRATE = 3;

/** Probability that an ordinary interior cell starts with a crate. */
const CRATE_CHANCE = 0.62;
/** Bot spawns are at least this many tiles (Manhattan) from the player. */
export const MIN_BOT_SPAWN_DIST = 6;

export interface Cell {
  x: number;
  y: number;
}

export const DIRECTIONS: readonly Cell[] = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
];

export function manhattan(ax: number, ay: number, bx: number, by: number): number {
  return Math.abs(ax - bx) + Math.abs(ay - by);
}

/** The largest odd integer not above `n`, and at least 5. */
function oddAtLeast5(n: number): number {
  const v = Math.max(5, n);
  return v % 2 === 1 ? v : v - 1;
}

/**
 * The arena tile grid: border walls, a lattice of unbreakable pillars, random crates and the
 * spawn points. Built once per run; only crates ever change afterwards.
 */
export class Arena {
  readonly cols: number;
  readonly rows: number;
  readonly playerSpawn: Cell = { x: 1, y: 1 };
  /** Bot spawn points, most preferred first (far corners, then edge midpoints). */
  readonly botSpawns: readonly Cell[];
  private readonly tiles: Uint8Array;
  private readonly dist: Int32Array;
  private readonly prev: Int32Array;
  private readonly done: Uint8Array;
  private readonly parent: Int32Array;
  private readonly seen: Uint32Array;
  private readonly queue: Int32Array;
  private stamp = 0;

  /** `tile` is the logical size of a tile: TILE for the design grid, larger where a phone needs bigger tiles. */
  constructor(width: number, height: number, rng: Rng, tile = TILE) {
    this.cols = oddAtLeast5(Math.floor((width - 32) / tile));
    this.rows = oddAtLeast5(Math.floor((height - 72) / tile));
    const n = this.cols * this.rows;
    this.tiles = new Uint8Array(n);
    this.dist = new Int32Array(n);
    this.prev = new Int32Array(n);
    this.done = new Uint8Array(n);
    this.parent = new Int32Array(n);
    this.seen = new Uint32Array(n);
    this.queue = new Int32Array(n);

    for (let y = 0; y < this.rows; y++) {
      for (let x = 0; x < this.cols; x++) {
        if (x === 0 || y === 0 || x === this.cols - 1 || y === this.rows - 1) {
          this.tiles[this.index(x, y)] = BORDER;
        } else if (this.isPillarCoord(x, y)) {
          this.tiles[this.index(x, y)] = PILLAR;
        }
      }
    }

    this.botSpawns = this.pickBotSpawns();

    // Keep the spawn points and their close neighbourhood free of crates.
    const reserved = new Uint8Array(n);
    for (const s of [this.playerSpawn, ...this.botSpawns]) {
      for (let y = s.y - 2; y <= s.y + 2; y++) {
        for (let x = s.x - 2; x <= s.x + 2; x++) {
          if (this.inBounds(x, y) && manhattan(x, y, s.x, s.y) <= 2) reserved[this.index(x, y)] = 1;
        }
      }
    }

    for (let y = 1; y < this.rows - 1; y++) {
      for (let x = 1; x < this.cols - 1; x++) {
        const k = this.index(x, y);
        if (this.tiles[k] !== FLOOR || reserved[k]) continue;
        if (rng.chance(CRATE_CHANCE)) this.tiles[k] = CRATE;
      }
    }

    // Crates are breakable, so every spawn is connected to the player by carving the cheapest route.
    for (const s of this.botSpawns) this.carveRoute(this.playerSpawn, s);
  }

  index(x: number, y: number): number {
    return y * this.cols + x;
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.cols && y < this.rows;
  }

  /** Kind of the tile at (x, y); anything outside the grid counts as border. */
  kindAt(x: number, y: number): number {
    if (!this.inBounds(x, y)) return BORDER;
    return this.tiles[this.index(x, y)] ?? BORDER;
  }

  /** Blocks movement and blasts: walls, pillars and crates. */
  isSolid(x: number, y: number): boolean {
    return this.kindAt(x, y) !== FLOOR;
  }

  isCrate(x: number, y: number): boolean {
    return this.kindAt(x, y) === CRATE;
  }

  /** Turns a crate into floor. Returns false if the tile holds no crate. */
  breakCrate(x: number, y: number): boolean {
    if (!this.isCrate(x, y)) return false;
    this.tiles[this.index(x, y)] = FLOOR;
    return true;
  }

  /** Breadth-first search over walkable floor, avoiding `occupied` tiles (1 = blocked, goal included). */
  findPath(fromX: number, fromY: number, toX: number, toY: number, occupied: Uint8Array): number[] | null {
    const start = this.index(fromX, fromY);
    const goal = this.index(toX, toY);
    if (start === goal) return [];
    this.stamp++;
    let head = 0;
    let tail = 0;
    this.queue[tail++] = start;
    this.seen[start] = this.stamp;
    while (head < tail) {
      const cur = this.queue[head++] ?? start;
      if (cur === goal) break;
      const cx = cur % this.cols;
      const cy = (cur - cx) / this.cols;
      for (const d of DIRECTIONS) {
        const nx = cx + d.x;
        const ny = cy + d.y;
        if (!this.inBounds(nx, ny)) continue;
        const k = this.index(nx, ny);
        if (this.seen[k] === this.stamp) continue;
        if (this.tiles[k] !== FLOOR || occupied[k]) continue;
        this.seen[k] = this.stamp;
        this.parent[k] = cur;
        this.queue[tail++] = k;
      }
    }
    if (this.seen[goal] !== this.stamp) return null;
    const path: number[] = [];
    for (let c = goal; c !== start; c = this.parent[c] ?? start) path.push(c);
    path.reverse();
    return path;
  }

  private isPillarCoord(x: number, y: number): boolean {
    return x % 2 === 0 && y % 2 === 0 && x >= 2 && x <= this.cols - 3 && y >= 2 && y <= this.rows - 3;
  }

  private pickBotSpawns(): Cell[] {
    const { cols, rows, playerSpawn } = this;
    const midX = (cols - 1) / 2;
    const midY = (rows - 1) / 2;
    const preferred: Cell[] = [
      { x: cols - 2, y: 1 },
      { x: 1, y: rows - 2 },
      { x: cols - 2, y: rows - 2 },
      { x: midX, y: 1 },
      { x: midX, y: rows - 2 },
      { x: 1, y: midY },
      { x: cols - 2, y: midY },
    ];
    const ok = (c: Cell) =>
      this.inBounds(c.x, c.y) &&
      !this.isPillarCoord(c.x, c.y) &&
      manhattan(c.x, c.y, playerSpawn.x, playerSpawn.y) >= MIN_BOT_SPAWN_DIST;
    const out: Cell[] = [];
    for (const c of preferred) {
      if (ok(c) && !out.some((o) => o.x === c.x && o.y === c.y)) out.push(c);
    }
    if (out.length < 4) {
      // Tiny arenas: fall back to the farthest free interior cells.
      const extra: Cell[] = [];
      for (let y = 1; y < rows - 1; y++) {
        for (let x = 1; x < cols - 1; x++) {
          const c = { x, y };
          if (ok(c) && !out.some((o) => o.x === x && o.y === y)) extra.push(c);
        }
      }
      extra.sort(
        (a, b) =>
          manhattan(b.x, b.y, playerSpawn.x, playerSpawn.y) -
          manhattan(a.x, a.y, playerSpawn.x, playerSpawn.y),
      );
      for (const c of extra) {
        if (out.length >= 4) break;
        out.push(c);
      }
    }
    return out;
  }

  /** Clears the fewest crates needed to walk from `from` to `to` over non-wall tiles (0-1 BFS). */
  private carveRoute(from: Cell, to: Cell): void {
    const start = this.index(from.x, from.y);
    const goal = this.index(to.x, to.y);
    // Int32Array storage: use a large int32 sentinel (MAX_SAFE_INTEGER would wrap to -1).
    this.dist.fill(0x3fffffff);
    this.prev.fill(-1);
    this.done.fill(0);
    this.dist[start] = 0;
    let frontier: number[] = [start];
    let cost = 0;
    while (frontier.length > 0 && !this.done[goal]) {
      const next: number[] = [];
      for (let i = 0; i < frontier.length; i++) {
        const cur = frontier[i] ?? start;
        if (this.done[cur] || this.dist[cur] !== cost) continue;
        this.done[cur] = 1;
        if (cur === goal) break;
        const cx = cur % this.cols;
        const cy = (cur - cx) / this.cols;
        for (const d of DIRECTIONS) {
          const nx = cx + d.x;
          const ny = cy + d.y;
          if (!this.inBounds(nx, ny)) continue;
          const k = this.index(nx, ny);
          const kind = this.tiles[k] ?? BORDER;
          if (kind === BORDER || kind === PILLAR) continue;
          const step = kind === CRATE ? 1 : 0;
          const nd = cost + step;
          if (nd < (this.dist[k] ?? 0)) {
            this.dist[k] = nd;
            this.prev[k] = cur;
            if (step) next.push(k);
            else frontier.push(k);
          }
        }
      }
      frontier = next;
      cost++;
    }
    for (let c = goal; c !== start && c >= 0; c = this.prev[c] ?? -1) {
      if (this.tiles[c] === CRATE) this.tiles[c] = FLOOR;
    }
  }
}
