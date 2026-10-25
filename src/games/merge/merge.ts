import { ease } from '../../core/math';
import { BaseGame } from '../base';
import { banner, fillRoundRect, text } from '../draw';
import { drawStatBar, mixHex, statBarHeight } from '../statbar';
import type { GameServices } from '../types';
import { canMove, type Dir, emptyCells, type Ghost, slide, type Tile } from './board';

const SIZE = 4;
const DESIGN_W = 600;
const SLIDE_SEC = 0.11;
const POP_SEC = 0.16;
const FOUR_CHANCE = 0.1;
/** A merge that makes a tile of at least this value pays a coin. */
const COIN_TILE = 128;
const GOAL_TILE = 2048;
const GOAL_COINS = 10;
const BANNER_SEC = 2.4;
/** Preview cards play this pattern so the frame shows a busy board. */
const PREVIEW_MOVES: readonly Dir[] = ['left', 'down', 'right', 'down'];
const PREVIEW_STEP_SEC = 0.16;
const KEYS: readonly Dir[] = ['left', 'right', 'up', 'down'];

interface Board {
  x: number;
  y: number;
  size: number;
  gap: number;
  cell: number;
}

/** 2048: slide the tiles, merge equal pairs, and build the biggest tile you can before the board locks. */
export class MergeGame extends BaseGame {
  private readonly u: number;
  private tiles: Tile[] = [];
  private ghosts: Ghost[] = [];
  private nextId = 1;
  /** Seconds since the last move, driving the slide and pop animations. */
  private animT = SLIDE_SEC + POP_SEC;
  private best = 0;
  private moves = 0;
  private shield = false;
  private reachedGoal = false;
  private bannerT = 0;
  private previewT = 0;
  private previewStep = 0;

  constructor(services: GameServices) {
    super(services);
    this.u = this.W / DESIGN_W;
    this.shield = this.hasBoost('shield');
    for (const key of ['merges', 'bestTile', 'moves']) this.addStat(key, 0);
    if (this.hasBoost('head-start')) {
      this.spawnValue(32);
      this.spawnValue(16);
    } else {
      this.spawn();
      this.spawn();
    }
    this.markBest();
  }

  protected tick(dt: number): void {
    this.animT += dt;
    this.bannerT = Math.max(0, this.bannerT - dt);
    if (this.isEnding) return;
    const dir = this.readMove(dt);
    if (dir) this.move(dir);
  }

  render(): void {
    const ctx = this.ctx;
    const g = ctx.createLinearGradient(0, 0, 0, this.H);
    g.addColorStop(0, this.skinColor('bg1', '#3b0764'));
    g.addColorStop(1, this.skinColor('bg2', '#0f172a'));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.W, this.H);
    const b = this.board();
    ctx.save();
    ctx.translate(this.shake.x, this.shake.y);
    fillRoundRect(ctx, b.x, b.y, b.size, b.size, 16 * this.u, this.skinColor('board', 'rgba(15,23,42,0.75)'));
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        const [x, y] = this.cellPos(b, r, c);
        fillRoundRect(
          ctx,
          x,
          y,
          b.cell,
          b.cell,
          10 * this.u,
          this.skinColor('cell', 'rgba(255,255,255,0.07)'),
        );
      }
    }
    const t = ease.outCubic(Math.min(1, this.animT / SLIDE_SEC));
    if (this.animT < SLIDE_SEC) {
      for (const gh of this.ghosts)
        this.drawTile(b, gh.value, gh.pr + (gh.r - gh.pr) * t, gh.pc + (gh.c - gh.pc) * t, 1);
    }
    for (const tile of this.tiles) {
      const r = tile.pr + (tile.r - tile.pr) * t;
      const c = tile.pc + (tile.c - tile.pc) * t;
      let scale = 1;
      const popT = (this.animT - SLIDE_SEC) / POP_SEC;
      if (tile.born) scale = this.animT < SLIDE_SEC ? 0 : Math.min(1, ease.outBack(Math.min(1, popT)));
      else if (tile.merged && popT >= 0 && popT < 1) scale = 1 + 0.18 * Math.sin(popT * Math.PI);
      // The merged tile shows its old value until it lands, so the merge reads as two tiles joining.
      const value = tile.merged && this.animT < SLIDE_SEC ? tile.value / 2 : tile.value;
      if (scale > 0) this.drawTile(b, value, r, c, scale);
    }
    this.particles.render(ctx);
    this.texts.render(ctx);
    ctx.restore();
    if (this.services.preview) return;
    drawStatBar(ctx, this.W, this.insets.top, this.u, [
      ['SCORE', Math.floor(this.score).toLocaleString('en-US')],
      ['BEST TILE', String(this.best)],
      ['MOVES', String(this.moves)],
    ]);
    if (this.moves === 0) {
      text(ctx, 'Swipe to slide the tiles', this.W / 2, b.y + b.size + 34 * this.u, {
        size: Math.round(20 * this.u),
        align: 'center',
        color: 'rgba(255,255,255,0.8)',
      });
    }
    if (this.bannerT > 0)
      banner(
        ctx,
        this.W,
        this.H,
        `${GOAL_TILE}!`,
        'Keep going for more',
        1 - this.bannerT / BANNER_SEC,
        '#fde047',
      );
  }

  private board(): Board {
    const u = this.u;
    const top = this.insets.top + statBarHeight(u);
    const bottom = this.H - this.insets.bottom;
    const size = Math.min(this.W - 48 * u, bottom - top - 90 * u);
    const gap = size * 0.03;
    return {
      x: (this.W - size) / 2,
      y: top + Math.max(10 * u, (bottom - top - size) * 0.4),
      size,
      gap,
      cell: (size - gap * (SIZE + 1)) / SIZE,
    };
  }

  private cellPos(b: Board, r: number, c: number): [number, number] {
    return [b.x + b.gap + c * (b.cell + b.gap), b.y + b.gap + r * (b.cell + b.gap)];
  }

  private readMove(dt: number): Dir | null {
    const swipe = this.input.consumeSwipe();
    if (swipe) return swipe;
    for (const k of KEYS) if (this.input.wasPressed(k)) return k;
    if (this.services.preview) {
      this.previewT += dt;
      if (this.previewT >= PREVIEW_STEP_SEC) {
        this.previewT = 0;
        return PREVIEW_MOVES[this.previewStep++ % PREVIEW_MOVES.length] ?? null;
      }
    }
    return null;
  }

  private move(dir: Dir): void {
    const res = slide(this.tiles, dir, SIZE);
    if (!res.moved) {
      this.audio.play('bump', { volume: 0.3 });
      return;
    }
    this.tiles = res.tiles;
    this.ghosts = res.ghosts;
    this.animT = 0;
    this.moves++;
    this.addStat('moves');
    this.score += res.gained;
    const b = this.board();
    for (const value of res.created) {
      this.addStat('merges');
      if (value >= COIN_TILE) this.coins++;
    }
    for (const tile of this.tiles) {
      if (!tile.merged) continue;
      const [x, y] = this.cellPos(b, tile.r, tile.c);
      this.particles.emit({
        x: x + b.cell / 2,
        y: y + b.cell / 2,
        count: tile.value >= COIN_TILE ? 14 : 6,
        speed: 140 * this.u,
        life: 0.45,
        size: 3,
        colors: [this.tileColour(tile.value), '#ffffff'],
      });
    }
    if (res.created.length > 0) {
      this.audio.play(res.created.some((v) => v >= COIN_TILE) ? 'coin' : 'pop');
      if (res.created.length >= 3)
        this.texts.add(
          this.W / 2,
          b.y - 8 * this.u,
          `x${res.created.length} MERGE`,
          '#fde047',
          22 * this.u,
          0.9,
        );
    } else {
      this.audio.play('whoosh', { volume: 0.4 });
    }
    this.spawn();
    this.markBest();
    if (!canMove(this.tiles, SIZE)) this.locked();
  }

  private markBest(): void {
    for (const t of this.tiles) this.best = Math.max(this.best, t.value);
    this.maxStat('bestTile', this.best);
    if (!this.reachedGoal && this.best >= GOAL_TILE) {
      this.reachedGoal = true;
      this.coins += GOAL_COINS;
      this.bannerT = BANNER_SEC;
      this.audio.play('win');
    }
  }

  /** No move is left. The shield clears the two smallest tiles once; otherwise the run ends. */
  private locked(): void {
    if (this.shield) {
      this.shield = false;
      const smallest = [...this.tiles].sort((a, b) => a.value - b.value || a.id - b.id).slice(0, 2);
      this.tiles = this.tiles.filter((t) => !smallest.includes(t));
      const b = this.board();
      this.texts.add(this.W / 2, b.y + b.size / 2, 'SHIELD', '#67e8f9', 30 * this.u, 1.2);
      this.audio.play('powerup');
      return;
    }
    this.shake.add(0.3);
    this.endGame(1.8);
  }

  private spawn(): void {
    this.spawnValue(this.rng.chance(FOUR_CHANCE) ? 4 : 2);
  }

  private spawnValue(value: number): void {
    const free = emptyCells(this.tiles, SIZE);
    if (free.length === 0) return;
    const [r, c] = this.rng.pick(free);
    this.tiles.push({ id: this.nextId++, value, r, c, pr: r, pc: c, merged: false, born: true });
  }

  private tileColour(value: number): string {
    const level = Math.log2(Math.max(2, value));
    const t = Math.min(1, (level - 1) / 10);
    const low = this.skinColor('low', '#fde68a');
    const mid = this.skinColor('mid', '#f97316');
    const high = this.skinColor('high', '#db2777');
    return t < 0.5 ? mixHex(low, mid, t * 2) : mixHex(mid, high, (t - 0.5) * 2);
  }

  private drawTile(b: Board, value: number, r: number, c: number, scale: number): void {
    const ctx = this.ctx;
    const [x, y] = this.cellPos(b, r, c);
    const s = b.cell * scale;
    const ox = x + (b.cell - s) / 2;
    const oy = y + (b.cell - s) / 2;
    fillRoundRect(ctx, ox, oy, s, s, 10 * this.u * scale, this.tileColour(value));
    if (value >= COIN_TILE) {
      ctx.strokeStyle = 'rgba(255,255,255,0.55)';
      ctx.lineWidth = 3 * this.u;
      ctx.strokeRect(ox + 4 * this.u, oy + 4 * this.u, s - 8 * this.u, s - 8 * this.u);
    }
    const digits = String(value).length;
    const size = s * (digits <= 2 ? 0.46 : digits === 3 ? 0.38 : 0.3);
    const dark = value <= 4;
    text(ctx, String(value), ox + s / 2, oy + s / 2 + s * 0.02, {
      size: Math.round(size),
      align: 'center',
      color: dark ? this.skinColor('ink', '#422006') : '#ffffff',
      stroke: dark ? null : 'rgba(0,0,0,0.35)',
    });
  }
}
