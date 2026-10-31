import type { Rng } from '../../core/rng';
import { BaseGame } from '../base';
import { banner, fillRoundRect, progressBar, roundRectPath, text } from '../draw';
import { drawStatBar, statBarHeight } from '../statbar';
import type { GameServices } from '../types';

/** Pipe ends as bits: north, east, south, west. */
export const N = 1;
export const E = 2;
export const S = 4;
export const W = 8;
const DIRS: readonly [number, number, number, number][] = [
  [N, 0, -1, S],
  [E, 1, 0, W],
  [S, 0, 1, N],
  [W, -1, 0, E],
];

/** A tile turned a quarter clockwise: north becomes east, and so on. */
export function rotate(t: number): number {
  return ((t << 1) | (t >> 3)) & 15;
}

/**
 * A random tree of pipes over an n x n grid, spreading from the source in the middle, so every tile is on it. It grows
 * from a random live tile (usually the newest, sometimes an older one), which mixes long runs with branches.
 */
export function makeTree(rng: Rng, n: number): number[] {
  const tiles = Array<number>(n * n).fill(0);
  const start = Math.floor(n / 2) * n + Math.floor(n / 2);
  const seen = new Set([start]);
  const live = [start];
  while (live.length > 0) {
    const k = rng.chance(0.7) ? live.length - 1 : rng.int(0, live.length - 1);
    const i = live[k] as number;
    const c = i % n;
    const r = Math.floor(i / n);
    const options = DIRS.filter(([, dc, dr]) => {
      const cc = c + dc;
      const rr = r + dr;
      return cc >= 0 && cc < n && rr >= 0 && rr < n && !seen.has(rr * n + cc);
    });
    if (options.length === 0) {
      live.splice(k, 1);
      continue;
    }
    const [bit, dc, dr, back] = rng.pick(options);
    const j = (r + dr) * n + c + dc;
    tiles[i] = (tiles[i] ?? 0) | bit;
    tiles[j] = (tiles[j] ?? 0) | back;
    seen.add(j);
    live.push(j);
  }
  return tiles;
}

/** The tiles joined to the source through ends that meet. */
export function connected(tiles: readonly number[], n: number): Set<number> {
  const start = Math.floor(n / 2) * n + Math.floor(n / 2);
  const seen = new Set([start]);
  const queue = [start];
  while (queue.length > 0) {
    const i = queue.pop() as number;
    const c = i % n;
    const r = Math.floor(i / n);
    for (const [bit, dc, dr, back] of DIRS) {
      const cc = c + dc;
      const rr = r + dr;
      if (cc < 0 || cc >= n || rr < 0 || rr >= n) continue;
      const j = rr * n + cc;
      if (seen.has(j) || !((tiles[i] ?? 0) & bit) || !((tiles[j] ?? 0) & back)) continue;
      seen.add(j);
      queue.push(j);
    }
  }
  return seen;
}

/** Grid size on puzzle n: 4, 5, 6, then 7. */
export function sizeFor(level: number): number {
  return Math.min(7, 3 + level);
}

const DESIGN_W = 600;
const LEVEL_POINTS = 150;
const TIME_POINTS = 5;
const CLEAR_SEC = 1.6;
const SHIELD_SECONDS = 20;
const TURN_SEC = 0.12;

/** Pipe Connect: turn the pipe tiles until water from the pump reaches every one. */
export class PipesGame extends BaseGame {
  private readonly u: number;
  private level = 1;
  private n = 4;
  private tiles: number[] = [];
  /** Quarter turns still animating, per tile. */
  private turning: number[] = [];
  private flowing = new Set<number>();
  private turns = 0;
  private timeLeft = 1;
  private levelTime = 1;
  private clearT = 0;
  private bannerT = 1.3;
  private cursor = 0;
  private keyboard = false;
  private shield = false;

  constructor(services: GameServices) {
    super(services);
    this.u = this.W / DESIGN_W;
    this.shield = this.hasBoost('shield');
    for (const key of ['puzzles', 'turns']) this.addStat(key, 0);
    this.startLevel(1);
  }

  protected tick(dt: number): void {
    this.turning = this.turning.map((t) => Math.max(0, t - dt / TURN_SEC));
    this.bannerT = Math.max(0, this.bannerT - dt);
    if (this.isEnding) return;
    if (this.clearT > 0) {
      this.clearT -= dt;
      if (this.clearT <= 0) this.startLevel(this.level + 1);
      return;
    }
    this.timeLeft -= dt;
    if (this.timeLeft <= 0) {
      if (this.shield) {
        this.shield = false;
        this.timeLeft = SHIELD_SECONDS;
        this.levelTime = Math.max(this.levelTime, SHIELD_SECONDS);
        this.texts.add(this.W / 2, this.H * 0.5, `SHIELD +${SHIELD_SECONDS}s`, '#67e8f9', 26 * this.u, 1.2);
        this.audio.play('powerup');
      } else {
        this.timeLeft = 0;
        this.endGame(1.4);
        return;
      }
    }
    const i = this.readCell();
    if (i !== null) this.turn(i);
  }

  render(): void {
    const ctx = this.ctx;
    ctx.fillStyle = this.skinColor('bg', '#1c1917');
    ctx.fillRect(0, 0, this.W, this.H);
    const b = this.grid();
    ctx.save();
    ctx.translate(this.shake.x, this.shake.y);
    for (let i = 0; i < this.n * this.n; i++) this.drawTile(i, b);
    this.particles.render(ctx);
    this.texts.render(ctx);
    ctx.restore();
    if (this.services.preview) return;
    drawStatBar(ctx, this.W, this.insets.top, this.u, [
      ['SCORE', Math.floor(this.score).toLocaleString('en-US')],
      ['PUZZLE', String(this.level)],
      ['FLOWING', `${this.flowing.size}/${this.n * this.n}`],
    ]);
    const barY = this.H - this.insets.bottom - 34 * this.u;
    const t = Math.max(0, this.timeLeft) / this.levelTime;
    progressBar(
      ctx,
      24 * this.u,
      barY,
      this.W - 48 * this.u,
      12 * this.u,
      t,
      t < 0.2 ? '#ef4444' : this.skinColor('water', '#38bdf8'),
    );
    text(ctx, `${Math.ceil(Math.max(0, this.timeLeft))}s`, this.W / 2, barY - 18 * this.u, {
      size: Math.round(17 * this.u),
      align: 'center',
    });
    if (this.clearT > 0) {
      banner(
        ctx,
        this.W,
        this.H,
        'ALL CONNECTED!',
        `Puzzle ${this.level + 1} next`,
        1 - this.clearT / CLEAR_SEC,
        '#7dd3fc',
      );
    } else if (this.bannerT > 0) {
      banner(ctx, this.W, this.H, `PUZZLE ${this.level}`, 'Tap a pipe to turn it', 1 - this.bannerT / 1.3);
    }
  }

  private startLevel(level: number): void {
    this.level = level;
    this.n = sizeFor(level);
    const solved = makeTree(this.rng, this.n);
    // Scramble: turn every tile a random number of quarter turns, and make sure the puzzle does not start solved.
    this.tiles = solved.map((t) => {
      let k = t;
      for (let q = this.rng.int(0, 3); q > 0; q--) k = rotate(k);
      return k;
    });
    if (connected(this.tiles, this.n).size === this.n * this.n) {
      const i = this.tiles.findIndex((t) => rotate(t) !== t);
      if (i >= 0) this.tiles[i] = rotate(this.tiles[i] as number);
    }
    if (this.hasBoost('head-start')) {
      // The head start sets a quarter of the tiles right.
      for (const i of this.rng
        .shuffle(this.tiles.map((_, k) => k))
        .slice(0, Math.floor(this.tiles.length / 4)))
        this.tiles[i] = solved[i] as number;
    }
    if (this.services.preview)
      for (let i = 0; i < this.tiles.length; i += 2) this.tiles[i] = solved[i] as number;
    this.turning = Array<number>(this.n * this.n).fill(0);
    this.flowing = connected(this.tiles, this.n);
    this.turns = 0;
    this.levelTime = 20 + this.n * this.n * 2.5;
    this.timeLeft = this.levelTime;
    this.cursor = 0;
    this.bannerT = 1.3;
  }

  private grid(): { x: number; y: number; cell: number } {
    const top = this.insets.top + statBarHeight(this.u) + 16 * this.u;
    const bottom = this.H - this.insets.bottom - 80 * this.u;
    const size = Math.min(this.W - 30 * this.u, bottom - top);
    return { x: (this.W - size) / 2, y: top + (bottom - top - size) / 2, cell: size / this.n };
  }

  private readCell(): number | null {
    const p = this.input.pointer;
    const n = this.n;
    if (p.pressed) {
      this.keyboard = false;
      const b = this.grid();
      const c = Math.floor((p.x - b.x) / b.cell);
      const r = Math.floor((p.y - b.y) / b.cell);
      return c >= 0 && c < n && r >= 0 && r < n ? r * n + c : null;
    }
    const before = this.cursor;
    const c = this.cursor % n;
    const r = Math.floor(this.cursor / n);
    if (this.input.wasPressed('left')) this.cursor = r * n + ((c + n - 1) % n);
    if (this.input.wasPressed('right')) this.cursor = r * n + ((c + 1) % n);
    if (this.input.wasPressed('up')) this.cursor = ((r + n - 1) % n) * n + c;
    if (this.input.wasPressed('down')) this.cursor = ((r + 1) % n) * n + c;
    if (this.cursor !== before) this.keyboard = true;
    if (!this.input.wasPressed('primary')) return null;
    this.keyboard = true;
    return this.cursor;
  }

  private turn(i: number): void {
    this.tiles[i] = rotate(this.tiles[i] ?? 0);
    this.turning[i] = 1;
    this.turns++;
    this.addStat('turns');
    const before = this.flowing.size;
    this.flowing = connected(this.tiles, this.n);
    this.audio.play(this.flowing.size > before ? 'pop' : 'click', { volume: 0.5 });
    if (this.flowing.size === this.n * this.n) this.clear();
  }

  private clear(): void {
    const bonus = LEVEL_POINTS * this.level + Math.ceil(this.timeLeft) * TIME_POINTS;
    this.score += bonus;
    this.coins++;
    this.addStat('puzzles');
    this.clearT = CLEAR_SEC;
    this.audio.play('levelup');
    const b = this.grid();
    this.particles.emit({
      x: this.W / 2,
      y: b.y + (b.cell * this.n) / 2,
      count: 40,
      speed: 280 * this.u,
      life: 0.9,
      size: 4,
      colors: ['#38bdf8', '#e0f2fe', '#ffffff'],
    });
    this.texts.add(this.W / 2, this.H * 0.6, `+${bonus}`, '#fde047', 28 * this.u, 1.3);
  }

  private drawTile(i: number, b: { x: number; y: number; cell: number }): void {
    const ctx = this.ctx;
    const n = this.n;
    const x = b.x + (i % n) * b.cell;
    const y = b.y + Math.floor(i / n) * b.cell;
    const s = b.cell;
    fillRoundRect(ctx, x + 2, y + 2, s - 4, s - 4, s * 0.12, this.skinColor('tile', '#292524'));
    const t = this.tiles[i] ?? 0;
    const wet = this.flowing.has(i);
    const source = i === Math.floor(n / 2) * n + Math.floor(n / 2);
    ctx.save();
    ctx.translate(x + s / 2, y + s / 2);
    // A tile mid-turn is drawn a little short of its new direction.
    ctx.rotate(-(this.turning[i] ?? 0) * (Math.PI / 2));
    ctx.lineCap = 'round';
    for (const [lineW, colour] of [
      [s * 0.3, this.skinColor('pipe', '#78716c')],
      [s * 0.16, wet ? this.skinColor('water', '#38bdf8') : this.skinColor('dry', '#44403c')],
    ] as const) {
      ctx.strokeStyle = colour;
      ctx.lineWidth = lineW;
      ctx.beginPath();
      for (const [bit, dc, dr] of DIRS) {
        if (!(t & bit)) continue;
        ctx.moveTo(0, 0);
        ctx.lineTo((dc * s) / 2, (dr * s) / 2);
      }
      ctx.stroke();
    }
    // A dead end gets a tap on it; the middle tile is the pump.
    const ends = DIRS.filter(([bit]) => t & bit).length;
    if (source || ends === 1) {
      ctx.fillStyle = source
        ? this.skinColor('pump', '#ef4444')
        : wet
          ? this.skinColor('water', '#38bdf8')
          : '#57534e';
      ctx.beginPath();
      ctx.arc(0, 0, s * (source ? 0.24 : 0.16), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    if (this.keyboard && this.cursor === i) {
      ctx.strokeStyle = '#fde047';
      ctx.lineWidth = 3 * this.u;
      roundRectPath(ctx, x + 3, y + 3, s - 6, s - 6, s * 0.12);
      ctx.stroke();
    }
  }
}
