import { BaseGame } from '../base';
import { banner, shade } from '../draw';
import type { GameServices } from '../types';
import {
  addWallRuns,
  advance,
  type Apple,
  type BoardRect,
  type Cell,
  cellCentre,
  type Dir,
  fitBoard,
  Grid,
  gridSize,
  opposite,
  sameCell,
  sideways,
} from './board';
import {
  appleBlinkedOff,
  drawApple,
  drawBoard,
  drawFrame,
  drawHud,
  drawSnake,
  drawWalls,
  GOLDEN_SEC,
  type Palette,
} from './draw';

const START_LENGTH = 4;
const HEAD_START_LENGTH = 6;
const BASE_INTERVAL = 0.14;
const INTERVAL_STEP = 0.004;
const MIN_INTERVAL = 0.07;
const SLOW_FACTOR = 1.8;
const SLOW_SEC = 4;
const GOLDEN_EVERY = 7;
const RED_POINTS = 10;
const GOLDEN_POINTS = 50;
const APPLES_PER_LEVEL = 6;
const MAX_LEVEL = 9;
const WALL_RUNS_PER_LEVEL = 3;
const WALL_CAP = 90;
const WALL_MIN_HEAD_DIST = 5;
const INVULN_SEC = 1.5;
const BANNER_SEC = 2.2;
const DEATH_DELAY_SEC = 1.4;
const MAX_QUEUED_TURNS = 2;

const TURN_KEYS: readonly Dir[] = ['up', 'down', 'left', 'right'];

/** Level for a number of apples eaten: a new level every six apples, capped at 9. */
export function levelFor(applesEaten: number): number {
  return Math.min(MAX_LEVEL, 1 + Math.floor(applesEaten / APPLES_PER_LEVEL));
}

export class SnakeGame extends BaseGame {
  private readonly grid: Grid;
  /** Head first. Segments may overlap only while the snake is invulnerable. */
  private body: Cell[] = [];
  private heading: Dir = 'right';
  /** Turns waiting to be applied, one per move. */
  private readonly turns: Dir[] = [];
  private apple: Apple | null = null;
  private applesPlaced = 0;
  private applesEaten = 0;
  private level = 1;
  private moveT = 0;
  private slowT = 0;
  private invulnT = 0;
  private shieldUsed = false;
  private bannerT = 0;
  /** Scratch buffers reused by every spawn and level-up. */
  private readonly busy: Uint8Array;
  private readonly free: Int32Array;

  constructor(services: GameServices) {
    super(services);
    const { cols, rows } = gridSize(this.W, this.H);
    this.grid = new Grid(cols, rows);
    this.busy = new Uint8Array(this.grid.size);
    this.free = new Int32Array(this.grid.size);
    const length = this.hasBoost('head-start') ? HEAD_START_LENGTH : START_LENGTH;
    const y = Math.floor(rows / 2);
    const x = Math.floor(cols / 2) - 2;
    for (let i = 0; i < length; i++) this.body.push({ x: x - i, y });
    this.addStat('food', 0);
    this.addStat('golden', 0);
    this.maxStat('length', length);
    this.maxStat('level', 1);
    this.spawnApple();
  }

  private get head(): Cell {
    return this.body[0] as Cell;
  }

  protected tick(dt: number): void {
    if (this.isEnding) return;
    this.readTurns();
    this.invulnT = Math.max(0, this.invulnT - dt);
    this.slowT = Math.max(0, this.slowT - dt);
    this.bannerT = Math.max(0, this.bannerT - dt);
    const apple = this.apple;
    if (apple) {
      apple.age += dt;
      apple.left -= dt;
      if (apple.left <= 0) this.spawnApple();
    }
    this.moveT += dt;
    const interval = this.stepInterval();
    if (this.moveT >= interval) {
      this.moveT -= interval;
      this.move();
    }
  }

  render(): void {
    const ctx = this.ctx;
    const pal = this.palette();
    const rect = this.layout();
    ctx.fillStyle = shade(pal.board1, -0.5);
    ctx.fillRect(0, 0, this.W, this.H);
    ctx.save();
    ctx.translate(this.shake.x, this.shake.y);
    drawFrame(ctx, this.grid, rect, pal);
    drawBoard(ctx, this.grid, rect, pal);
    drawWalls(ctx, this.grid, rect, pal.wall);
    if (this.apple && !appleBlinkedOff(this.apple, this.time)) {
      drawApple(ctx, this.apple, rect, pal, this.time);
    }
    drawSnake(ctx, this.body, rect, pal, {
      heading: this.heading,
      thick: this.skinParam('thick', 0),
      ghost: this.invulnT > 0,
      dead: this.isEnding,
      time: this.time,
    });
    this.particles.render(ctx);
    this.texts.render(ctx);
    ctx.restore();
    if (!this.services.preview) {
      drawHud(ctx, this.W, this.insets, pal, {
        score: this.score,
        level: this.level,
        length: this.body.length,
        slow: this.slowT / SLOW_SEC,
      });
      if (this.bannerT > 0) {
        banner(
          ctx,
          this.W,
          this.H,
          `LEVEL ${this.level}`,
          'New walls!',
          1 - this.bannerT / BANNER_SEC,
          pal.gold,
        );
      }
    }
  }

  private palette(): Palette {
    return {
      body: this.skinColor('body', '#4ade80'),
      head: this.skinColor('head', '#bbf7d0'),
      food: this.skinColor('food', '#ef4444'),
      gold: this.skinColor('gold', '#fde047'),
      board1: this.skinColor('board1', '#0f2a1a'),
      board2: this.skinColor('board2', '#123421'),
      wall: this.skinColor('wall', '#64748b'),
    };
  }

  /** Board placement for the current logical size and live touch inset. */
  private layout(): BoardRect {
    return fitBoard(this.grid.cols, this.grid.rows, this.W, this.H, this.insets.bottom);
  }

  private stepInterval(): number {
    const base = Math.max(MIN_INTERVAL, BASE_INTERVAL - INTERVAL_STEP * this.applesEaten);
    return this.slowT > 0 ? base * SLOW_FACTOR : base;
  }

  /** Queue arrow and swipe turns. A reversal of the current heading is rejected outright. */
  private readTurns(): void {
    for (const d of TURN_KEYS) if (this.input.wasPressed(d)) this.queueTurn(d);
    for (let s = this.input.consumeSwipe(); s !== null; s = this.input.consumeSwipe()) this.queueTurn(s);
  }

  private queueTurn(dir: Dir): void {
    if (dir === opposite(this.heading)) return;
    const last = this.turns[this.turns.length - 1] ?? this.heading;
    if (dir === last || this.turns.length >= MAX_QUEUED_TURNS) return;
    this.turns.push(dir);
  }

  private move(): void {
    const turn = this.turns.shift();
    if (turn !== undefined && turn !== opposite(this.heading)) this.heading = turn;
    const next = advance(this.head, this.heading);
    const apple = this.apple;
    const eaten = apple !== null && sameCell(apple, next) ? apple : null;
    if (this.hits(next, eaten !== null)) {
      this.crash();
      return;
    }
    this.body.unshift(next);
    if (eaten) this.eat(eaten);
    else this.body.pop();
  }

  /**
   * Whether the head entering `c` crashes. The tail counts as free when the snake is about to move
   * off it (unless it is growing); body hits are ignored while invulnerable.
   */
  private hits(c: Cell, growing: boolean): boolean {
    if (this.grid.solid(c)) return true;
    if (this.invulnT > 0) return false;
    const limit = growing ? this.body.length : this.body.length - 1;
    for (let i = 0; i < limit; i++) {
      const s = this.body[i];
      if (s && sameCell(s, c)) return true;
    }
    return false;
  }

  /** A cell the head could move into next turn, ignoring invulnerability. */
  private isClear(d: Dir): boolean {
    const next = advance(this.head, d);
    if (this.grid.solid(next)) return false;
    return !this.body.some((s, i) => i < this.body.length - 1 && sameCell(s, next));
  }

  private crash(): void {
    if (!this.shieldUsed && this.hasBoost('shield')) {
      this.absorbCrash();
      return;
    }
    this.endGame(DEATH_DELAY_SEC);
    this.shake.add(0.8);
    const pal = this.palette();
    const at = cellCentre(this.layout(), this.head);
    this.particles.emit({
      x: at.x,
      y: at.y,
      count: 36,
      speed: 260,
      life: 0.8,
      size: 4,
      drag: 2,
      colors: [pal.body, pal.food, '#ffffff'],
    });
  }

  /** The Guardian boost: the move is cancelled, the snake turns if it can, and body hits pass for a while. */
  private absorbCrash(): void {
    this.shieldUsed = true;
    this.invulnT = INVULN_SEC;
    const turn = sideways(this.heading).find((d) => this.isClear(d));
    if (turn) this.heading = turn;
    this.shake.add(0.35);
    this.audio.play('bump');
    const rect = this.layout();
    const at = cellCentre(rect, this.head);
    this.particles.emit({
      x: at.x,
      y: at.y,
      count: 20,
      speed: 200,
      life: 0.6,
      size: 3.5,
      colors: ['#67e8f9', '#ffffff'],
    });
    this.popup(rect, this.head, 'GUARDIAN!', '#67e8f9', 18, 1.2);
  }

  private eat(apple: Apple): void {
    this.apple = null;
    const golden = apple.golden;
    const points = (golden ? GOLDEN_POINTS : RED_POINTS) * this.level;
    this.score += points;
    this.applesEaten++;
    this.addStat(golden ? 'golden' : 'food');
    if (golden) this.slowT = SLOW_SEC;
    this.coins = 2 * (this.stats['golden'] ?? 0) + Math.floor((this.stats['food'] ?? 0) / 5);
    this.maxStat('length', this.body.length);

    const pal = this.palette();
    const rect = this.layout();
    const at = cellCentre(rect, apple);
    const colour = golden ? pal.gold : pal.food;
    this.particles.emit({
      x: at.x,
      y: at.y,
      count: golden ? 28 : 14,
      speed: golden ? 210 : 150,
      life: 0.6,
      size: 3.5,
      drag: 2.4,
      colors: [colour, '#ffffff'],
    });
    this.popup(rect, apple, `+${points}`, golden ? pal.gold : '#ffffff', golden ? 22 : 18);
    this.audio.play(golden ? 'reward' : 'pop');
    if (golden) {
      this.shake.add(0.12);
      this.services.haptic(15);
    }

    const level = levelFor(this.applesEaten);
    if (level > this.level) this.levelUp(level);
    this.spawnApple();
  }

  private levelUp(level: number): void {
    this.level = level;
    this.maxStat('level', level);
    addWallRuns(
      this.grid,
      this.rng,
      this.head,
      this.markBusy(true),
      WALL_RUNS_PER_LEVEL,
      WALL_CAP,
      WALL_MIN_HEAD_DIST,
    );
    this.bannerT = BANNER_SEC;
    this.audio.play('levelup');
    const pal = this.palette();
    const at = cellCentre(this.layout(), this.head);
    this.particles.emit({
      x: at.x,
      y: at.y,
      count: 24,
      speed: 190,
      life: 0.7,
      size: 3,
      colors: [pal.gold, '#ffffff', pal.body],
    });
  }

  /** Floating text above a cell, or below it when the cell sits in the upper half so it stays on the board. */
  private popup(rect: BoardRect, c: Cell, text: string, colour: string, size: number, life?: number): void {
    const at = cellCentre(rect, c);
    const midY = rect.y + (this.grid.rows * rect.cell) / 2;
    const lift = rect.cell * 1.1;
    const y = at.y < midY ? at.y + lift : at.y - lift;
    this.texts.add(at.x, y, text, colour, size, life);
  }

  /** Every 7th apple is golden. An apple goes on a random open cell, never on the snake or a wall. */
  private spawnApple(): void {
    this.applesPlaced++;
    const golden = this.applesPlaced % GOLDEN_EVERY === 0;
    const count = this.openCells();
    if (count === 0) {
      // The snake fills the whole playfield.
      this.apple = null;
      this.endGame(2, false);
      this.audio.play('win');
      return;
    }
    const idx = this.free[this.rng.int(0, count - 1)] as number;
    const x = idx % this.grid.cols;
    this.apple = {
      x,
      y: (idx - x) / this.grid.cols,
      golden,
      left: golden ? GOLDEN_SEC : Number.POSITIVE_INFINITY,
      age: 0,
    };
  }

  /** Fills `free` with every cell that is neither a wall nor the snake; returns how many. */
  private openCells(): number {
    const busy = this.markBusy(false);
    let n = 0;
    for (let i = 0; i < this.grid.size; i++) {
      if (!this.grid.walls[i] && !busy[i]) this.free[n++] = i;
    }
    return n;
  }

  /** Marks the snake's cells (and, optionally, their edge neighbours) in the shared scratch buffer. */
  private markBusy(withNeighbours: boolean): Uint8Array {
    const { grid, busy } = this;
    busy.fill(0);
    const mark = (c: Cell): void => {
      if (grid.inside(c)) busy[grid.index(c)] = 1;
    };
    for (const c of this.body) {
      mark(c);
      if (!withNeighbours) continue;
      mark({ x: c.x + 1, y: c.y });
      mark({ x: c.x - 1, y: c.y });
      mark({ x: c.x, y: c.y + 1 });
      mark({ x: c.x, y: c.y - 1 });
    }
    return busy;
  }
}
