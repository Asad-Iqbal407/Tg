import { describe, expect, it } from 'vitest';
import { NullAudio } from '../src/core/audio';
import { Input } from '../src/core/input';
import { Rng } from '../src/core/rng';
import { snakeGame } from '../src/games/snake';
import {
  advance,
  type Apple,
  type Cell,
  type Dir,
  type Grid,
  manhattan,
  opposite,
  sameCell,
} from '../src/games/snake/board';
import { bodyShades, drawSnake, mixHex } from '../src/games/snake/draw';
import { levelFor, SnakeGame } from '../src/games/snake/snake';
import { type BoostId, type GameInstance, NO_INSETS } from '../src/games/types';
import { defaultSkin, toSkinData } from '../src/meta/catalog';
import { cornerSizes, createGame, mockCtx } from './helpers';

const DT = 1 / 60;
const DIRS: readonly Dir[] = ['up', 'down', 'left', 'right'];

/** The private state the tests need to set up scenarios and read results. */
interface Internals {
  body: Cell[];
  heading: Dir;
  turns: Dir[];
  apple: Apple | null;
  applesEaten: number;
  level: number;
  slowT: number;
  invulnT: number;
  readyT: number;
  shieldUsed: boolean;
  readonly isEnding: boolean;
  grid: Grid;
  stepInterval(): number;
  levelUp(level: number): void;
}

function peek(game: GameInstance): Internals {
  return game as unknown as Internals;
}

/** A fresh run, READY period included. */
function fresh(seed: number, boosts: BoostId[] = [], width?: number, height?: number) {
  return createGame(snakeGame, { seed, boosts, width, height });
}

/** A fresh run with READY already over, so a test drives the snake from its first move. */
function start(seed: number, boosts: BoostId[] = [], width?: number, height?: number) {
  const run = fresh(seed, boosts, width, height);
  while (peek(run.game).readyT > 0) step(run.game, run.input);
  return run;
}

/** One fixed simulation step, as the shell runs it. */
function step(game: GameInstance, input: Input, n = 1): void {
  for (let i = 0; i < n; i++) {
    game.update(DT);
    input.postUpdate();
  }
}

/** Press a direction during one step, the way a key tap does. */
function tap(game: GameInstance, input: Input, dir: Dir): void {
  input.setVirtual(dir, true, 'test');
  step(game, input);
  input.setVirtual(dir, false, 'test');
}

function headOf(game: GameInstance): Cell {
  return peek(game).body[0] as Cell;
}

/** Step until the head moves into a new cell, or the run ends. */
function untilMove(game: GameInstance, input: Input, max = 40): void {
  const before = headOf(game);
  for (let i = 0; i < max && !game.isOver(); i++) {
    step(game, input);
    if (!sameCell(headOf(game), before)) return;
  }
}

/** Step until the run is over; false when it takes more than `max` steps. */
function untilOver(game: GameInstance, input: Input, max = 900): boolean {
  for (let i = 0; i < max && !game.isOver(); i++) step(game, input);
  return game.isOver();
}

/** The cell straight ahead of the head. */
function front(s: Internals): Cell {
  return advance(s.body[0] as Cell, s.heading);
}

function placeApple(s: Internals, c: Cell, golden = false): void {
  s.apple = { x: c.x, y: c.y, golden, left: golden ? 6 : Number.POSITIVE_INFINITY, age: 0 };
}

/** Number of cells reachable from `from` through cells that are not solid (walls or border). */
function reachableCount(grid: Grid, from: Cell): number {
  const seen = new Set<number>([grid.index(from)]);
  const queue: Cell[] = [from];
  for (let q = 0; q < queue.length; q++) {
    const c = queue[q] as Cell;
    for (const d of DIRS) {
      const n = advance(c, d);
      if (grid.solid(n) || seen.has(grid.index(n))) continue;
      seen.add(grid.index(n));
      queue.push(n);
    }
  }
  return seen.size;
}

/** Heading of the first step on a shortest path to the apple over open cells. Null when there is none. */
function planStep(s: Internals): Dir | null {
  const { grid, body, apple } = s;
  if (!apple) return null;
  const head = body[0] as Cell;
  const occupied = new Set<number>(body.slice(0, -1).map((c) => grid.index(c)));
  const open = (c: Cell): boolean => !grid.solid(c) && !occupied.has(grid.index(c));
  const target = grid.index(apple);
  const firstStep = new Map<number, Dir>();
  const queue: Cell[] = [];
  for (const d of DIRS) {
    const n = advance(head, d);
    if (!open(n)) continue;
    if (grid.index(n) === target) return d;
    if (firstStep.has(grid.index(n))) continue;
    firstStep.set(grid.index(n), d);
    queue.push(n);
  }
  for (let q = 0; q < queue.length; q++) {
    const c = queue[q] as Cell;
    const d0 = firstStep.get(grid.index(c)) as Dir;
    for (const d of DIRS) {
      const n = advance(c, d);
      if (!open(n) || firstStep.has(grid.index(n))) continue;
      if (grid.index(n) === target) return d0;
      firstStep.set(grid.index(n), d0);
      queue.push(n);
    }
  }
  return null;
}

/** A test autopilot: presses the next turn of the shortest path to the apple, one pending turn at a time. */
function autoSteer(game: GameInstance, input: Input): void {
  const s = peek(game);
  if (s.turns.length > 0) return;
  const want = planStep(s);
  if (!want || want === s.heading || want === opposite(s.heading)) return;
  input.setVirtual(want, true, 'auto');
  input.setVirtual(want, false, 'auto');
}

function autoplay(seed: number, maxSteps = 6000) {
  const { game, input } = start(seed);
  let maxLevel = 1;
  for (let i = 0; i < maxSteps && !game.isOver(); i++) {
    autoSteer(game, input);
    step(game, input);
    maxLevel = Math.max(maxLevel, peek(game).level);
  }
  return { maxLevel, result: game.getResult(), over: game.isOver() };
}

/** A default-size game drawing on `ctx`; `preview` drops the HUD and banners, as on card art. */
function gameOn(
  ctx: CanvasRenderingContext2D,
  seed: number,
  preview: boolean,
): { game: GameInstance; input: Input } {
  const input = new Input();
  const game = snakeGame.create({
    ctx,
    width: snakeGame.width,
    height: snakeGame.height,
    input,
    audio: new NullAudio(),
    rng: new Rng(seed),
    loadout: { skin: toSkinData(defaultSkin('snake')), boosts: new Set(), powerDuration: 1 },
    insets: NO_INSETS,
    reducedMotion: false,
    haptic: () => undefined,
    preview,
  });
  return { game, input };
}

/** Preview services (card art): no HUD or banner is drawn. */
function previewGame(seed = 2): GameInstance {
  return gameOn(mockCtx(), seed, true).game;
}

/**
 * From the start position (head at (9, 14), six long with head-start), a down-left-up loop makes the third
 * move bite the body at (8, 14). Steps until that crash is absorbed by the shield, or the run ends.
 */
function biteOwnBody(game: GameInstance, input: Input): void {
  tap(game, input, 'down');
  untilMove(game, input);
  tap(game, input, 'left');
  untilMove(game, input);
  tap(game, input, 'up');
  for (let i = 0; i < 40 && !peek(game).shieldUsed && !game.isOver(); i++) step(game, input);
}

/** A canvas stand-in that records every strokeStyle the drawing code sets, in order. */
function recordStrokes(): { ctx: CanvasRenderingContext2D; strokes: string[] } {
  const strokes: string[] = [];
  const ctx = new Proxy(mockCtx(), {
    set(target, key, value) {
      if (key === 'strokeStyle') strokes.push(String(value));
      return Reflect.set(target, key, value);
    },
  });
  return { ctx, strokes };
}

/** A canvas stand-in that records every line of text the drawing code fills, in order. */
function recordTexts(): { ctx: CanvasRenderingContext2D; texts: string[] } {
  const texts: string[] = [];
  const ctx = new Proxy(mockCtx(), {
    get(target, key) {
      if (key === 'fillText') return (value: string) => texts.push(value);
      return Reflect.get(target, key);
    },
  });
  return { ctx, texts };
}

describe('snake rules', () => {
  it('is deterministic for the same seed and inputs', () => {
    const run = (seed: number) => {
      const { game, input } = start(seed);
      const pick = new Rng(seed * 7 + 1);
      for (let i = 0; i < 1500 && !game.isOver(); i++) {
        if (i % 25 === 0) tap(game, input, pick.pick(DIRS));
        else step(game, input);
      }
      return {
        result: game.getResult(),
        body: peek(game)
          .body.map((c) => `${c.x},${c.y}`)
          .join(';'),
      };
    };
    expect(run(5)).toEqual(run(5));
  });

  it('grows the snake by one segment per apple', () => {
    const { game, input } = start(3);
    const s = peek(game);
    for (let n = 1; n <= 3; n++) {
      const before = s.body.length;
      placeApple(s, front(s));
      untilMove(game, input);
      expect(s.body.length).toBe(before + 1);
      expect(game.getResult().stats['food']).toBe(n);
      // One red apple at a time, never on the snake or a wall.
      expect(s.apple).not.toBeNull();
      expect(s.body.some((c) => sameCell(c, s.apple as Cell))).toBe(false);
      expect(s.grid.solid(s.apple as Cell)).toBe(false);
    }
  });

  it('rejects a 180-degree reversal of the current heading', () => {
    const { game, input } = start(4);
    const s = peek(game);
    const x0 = headOf(game).x;
    tap(game, input, 'left');
    expect(s.turns).toEqual([]);
    untilMove(game, input);
    expect(s.heading).toBe('right');
    expect(headOf(game).x).toBe(x0 + 1);
    expect(game.isOver()).toBe(false);
  });

  it('queues at most two turns, applies one per move, and drops a reversal of the last queued turn', () => {
    const { game, input } = start(4);
    const s = peek(game);
    // Up, down, left and right in one step: down reverses the queued up, and right reverses the queued left.
    input.setVirtual('up', true, 'test');
    input.setVirtual('down', true, 'test');
    input.setVirtual('left', true, 'test');
    input.setVirtual('right', true, 'test');
    step(game, input);
    expect(s.turns).toEqual(['up', 'left']);
    untilMove(game, input);
    expect(s.heading).toBe('up');
    untilMove(game, input);
    expect(s.heading).toBe('left');
    expect(s.turns).toEqual([]);
    expect(game.isOver()).toBe(false);
  });

  it('turns on swipes as well as keys', () => {
    const { game, input } = start(4);
    const s = peek(game);
    input.pushSwipe('up');
    step(game, input);
    expect(s.turns).toEqual(['up']);
  });

  it('ends the run when the snake drives into the border', () => {
    const { game, input } = start(6);
    expect(untilOver(game, input)).toBe(true);
    // The head stopped on the last column, the move into the border was the crash.
    expect(headOf(game).x).toBe(peek(game).grid.cols - 1);
    expect(headOf(game).y).toBe(Math.floor(peek(game).grid.rows / 2));
  });

  it('ends the run when the snake bites its body', () => {
    const { game, input } = start(7, ['head-start']);
    biteOwnBody(game, input);
    expect(game.isOver()).toBe(false);
    expect(untilOver(game, input)).toBe(true);
    // The crash cancelled the last move, so the head stayed in the cell it bit from.
    expect(headOf(game)).toEqual({ x: 8, y: 15 });
  });

  it('lets the shield absorb the first crash and turn the snake', () => {
    const { game, input } = start(7, ['head-start', 'shield']);
    const s = peek(game);
    biteOwnBody(game, input);
    expect(game.isOver()).toBe(false);
    expect(s.shieldUsed).toBe(true);
    expect(s.invulnT).toBeGreaterThan(0);
    expect(headOf(game)).toEqual({ x: 8, y: 15 });
    // Up was blocked by the body, so the snake turns to the free side (left).
    expect(s.heading).toBe('left');
  });

  it('lets the snake pass its body while invulnerable, but a later crash is fatal', () => {
    const { game, input } = start(7, ['head-start', 'shield']);
    const s = peek(game);
    biteOwnBody(game, input);
    tap(game, input, 'up');
    untilMove(game, input);
    expect(headOf(game)).toEqual({ x: 8, y: 14 });
    expect(s.invulnT).toBeGreaterThan(0);
    expect(game.isOver()).toBe(false);
    // Once invulnerability has run out, the column above leads to the north border.
    expect(untilOver(game, input)).toBe(true);
    expect(headOf(game).y).toBe(0);
  });

  it('makes golden apples slow the snake for four seconds', () => {
    const { game, input } = start(8);
    const s = peek(game);
    expect(s.stepInterval()).toBeCloseTo(0.14, 6);
    placeApple(s, front(s), true);
    untilMove(game, input);
    expect(s.slowT).toBeCloseTo(4, 1);
    expect(s.stepInterval()).toBeCloseTo((0.14 - 0.004) * 1.8, 6);
    // Walk a bent path (down, then left) so the snake stays on the board while the timer runs out.
    tap(game, input, 'down');
    for (let i = 0; i < 8 && s.slowT > 0; i++) untilMove(game, input);
    tap(game, input, 'left');
    for (let i = 0; i < 9 && s.slowT > 0 && !game.isOver(); i++) untilMove(game, input);
    expect(game.isOver()).toBe(false);
    expect(s.slowT).toBe(0);
    expect(s.stepInterval()).toBeCloseTo(Math.max(0.07, 0.14 - 0.004 * s.applesEaten), 6);
  });

  it('moves fewer times per second in slow motion', () => {
    const movesIn = (eatGolden: boolean): number => {
      const { game, input } = start(11);
      const s = peek(game);
      if (eatGolden) {
        placeApple(s, front(s), true);
        untilMove(game, input);
      }
      let moves = 0;
      let last = headOf(game);
      for (let i = 0; i < 60; i++) {
        step(game, input);
        if (!sameCell(headOf(game), last)) {
          moves++;
          last = headOf(game);
        }
      }
      return moves;
    };
    expect(movesIn(true)).toBeLessThan(movesIn(false));
  });

  it('speeds up with apples eaten, never below 0.07 s per move', () => {
    const { game } = start(12);
    const s = peek(game);
    s.applesEaten = 10;
    expect(s.stepInterval()).toBeCloseTo(0.1, 6);
    s.applesEaten = 30;
    expect(s.stepInterval()).toBeCloseTo(0.07, 6);
  });

  it('maps apples eaten to levels: one per six apples, capped at 9', () => {
    expect([0, 5, 6, 11, 12, 47, 48, 500].map(levelFor)).toEqual([1, 1, 2, 2, 3, 8, 9, 9]);
  });

  it('adds walls at each level-up that keep every open cell reachable from the head (200 seeds)', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const { game } = start(seed);
      const s = peek(game);
      const head = headOf(game);
      for (let level = 2; level <= 9; level++) {
        s.levelUp(level);
        const { grid } = s;
        expect(grid.wallCount).toBeLessThanOrEqual(90);
        const walls: Cell[] = [];
        for (let i = 0; i < grid.size; i++) {
          if (!grid.walls[i]) continue;
          const x = i % grid.cols;
          walls.push({ x, y: (i - x) / grid.cols });
        }
        expect(walls.length).toBe(grid.wallCount);
        expect(reachableCount(grid, head)).toBe(grid.size - grid.wallCount);
        for (const w of walls) {
          expect(manhattan(w, head)).toBeGreaterThanOrEqual(5);
          expect(s.body.some((b) => manhattan(b, w) <= 1)).toBe(false);
        }
      }
      expect(s.level).toBe(9);
    }
  });

  it('reports food, golden, length and level stats, with score and coins', () => {
    const { game, input } = start(9);
    const s = peek(game);
    for (let i = 0; i < 5; i++) {
      placeApple(s, front(s));
      untilMove(game, input);
    }
    // The sixth apple is golden and takes the snake to level 2 after it is eaten.
    placeApple(s, front(s), true);
    untilMove(game, input);
    const r = game.getResult();
    expect(r.stats).toMatchObject({ food: 5, golden: 1, length: 10, level: 2 });
    expect(r.score).toBe(5 * 10 + 50);
    expect(r.coins).toBe(2 * 1 + Math.floor(5 / 5));
  });

  it('scores apples by the current level', () => {
    const { game, input } = start(10);
    const s = peek(game);
    s.applesEaten = 6;
    s.level = 2;
    placeApple(s, front(s));
    untilMove(game, input);
    expect(game.getResult().score).toBe(20);
    placeApple(s, front(s), true);
    untilMove(game, input);
    expect(game.getResult().score).toBe(20 + 100);
  });

  it('plays a simple autopilot through the early levels in some seeds', () => {
    const runs = [1, 2, 3, 4, 5].map((seed) => autoplay(seed));
    expect(Math.max(...runs.map((r) => r.maxLevel))).toBeGreaterThanOrEqual(3);
    for (const r of runs) expect(r.result.stats['food'] ?? 0).toBeGreaterThanOrEqual(0);
  });

  it('draws in preview mode without throwing, at every corner size and with a touch inset', () => {
    const game = previewGame();
    for (let i = 0; i < 300; i++) game.update(DT);
    expect(() => game.render()).not.toThrow();
    for (const size of cornerSizes(snakeGame)) {
      const { game: g, input } = createGame(snakeGame, {
        seed: 3,
        width: size.width,
        height: size.height,
        insets: { top: 0, right: 0, bottom: 110, left: 0 },
      });
      for (let i = 0; i < 200; i++) {
        g.update(DT);
        input.postUpdate();
      }
      expect(() => g.render()).not.toThrow();
    }
    expect(() => previewGame(9).render()).not.toThrow();
  });

  it('keeps the grid fixed at construction: 24 px cells at the design size', () => {
    const { game } = start(1);
    const s = peek(game);
    expect(s.grid.cols).toBe(23);
    expect(s.grid.rows).toBe(29);
    expect(game).toBeInstanceOf(SnakeGame);
  });

  it('fades the body from its colour at the head to a darker tail', () => {
    expect(mixHex('#000000', '#ffffff', 0.5)).toBe('rgb(128,128,128)');
    const shades = bodyShades('#4ade80');
    expect(shades).toHaveLength(8);
    expect(shades[0]).toBe('rgb(74,222,128)');
    expect(shades[7]).toBe('rgb(48,144,83)');
    const sums = shades.map((c) => (c.match(/\d+/g) ?? []).reduce((sum, v) => sum + Number(v), 0));
    for (let k = 1; k < sums.length; k++) expect(sums[k]).toBeLessThan(sums[k - 1] as number);
  });

  it('draws the body as fading strokes, tail darkest, not one flat colour', () => {
    const palette = {
      body: '#4ade80',
      head: '#bbf7d0',
      food: '#ef4444',
      gold: '#fde047',
      board1: '#0f2a1a',
      board2: '#123421',
      wall: '#64748b',
    };
    const { ctx, strokes } = recordStrokes();
    const body: Cell[] = Array.from({ length: 10 }, (_, i) => ({ x: 10 - i, y: 5 }));
    drawSnake(ctx, body, { x: 0, y: 0, cell: 24 }, palette, {
      heading: 'right',
      thick: 0,
      ghost: false,
      dead: false,
      time: 0,
    });
    const shades = bodyShades(palette.body);
    const bodyStrokes = strokes.filter((s) => shades.includes(s));
    // One stroke per segment, drawn from the tail forward: the first is the darkest step, the last the body colour.
    expect(bodyStrokes).toHaveLength(9);
    expect(bodyStrokes[0]).toBe(shades[7]);
    expect(bodyStrokes[8]).toBe(shades[0]);
    expect(new Set(bodyStrokes).size).toBeGreaterThan(4);
  });
});

describe('snake start and death delay', () => {
  it('holds the snake still for the READY period, then lets it move', () => {
    const { game, input } = fresh(4);
    const s = peek(game);
    const head = headOf(game);
    let frames = 0;
    while (s.readyT > 0) {
      step(game, input);
      frames++;
      expect(headOf(game)).toEqual(head);
    }
    // READY lasts 1.2 seconds at 60 steps a second.
    expect(frames * DT).toBeCloseTo(1.2, 1);
    expect(game.isOver()).toBe(false);
    // The first apple pops in during READY, so it is full size before the snake moves.
    expect(s.apple?.age ?? 0).toBeGreaterThan(0.2);
    untilMove(game, input);
    expect(headOf(game)).not.toEqual(head);
  });

  it('queues turns and swipes pressed during READY, and applies them one per move afterwards', () => {
    const { game, input } = fresh(4);
    const s = peek(game);
    const head = headOf(game);
    tap(game, input, 'up');
    input.pushSwipe('right');
    step(game, input);
    expect(s.turns).toEqual(['up', 'right']);
    while (s.readyT > 0) step(game, input);
    expect(s.turns).toEqual(['up', 'right']);
    expect(headOf(game)).toEqual(head);
    untilMove(game, input);
    expect(s.heading).toBe('up');
    expect(headOf(game)).toEqual({ x: head.x, y: head.y - 1 });
    untilMove(game, input);
    expect(s.heading).toBe('right');
    expect(s.turns).toEqual([]);
    expect(game.isOver()).toBe(false);
  });

  it('keeps a turn that follows a queued turn during READY, so the snake makes both turns', () => {
    const { game, input } = fresh(4);
    const s = peek(game);
    tap(game, input, 'up');
    tap(game, input, 'left');
    expect(s.turns).toEqual(['up', 'left']);
    while (s.readyT > 0) step(game, input);
    untilMove(game, input);
    expect(s.heading).toBe('up');
    untilMove(game, input);
    expect(s.heading).toBe('left');
    expect(game.isOver()).toBe(false);
  });

  it('cannot crash during READY, even when the first move would drive into the border', () => {
    const { game, input } = fresh(6);
    const s = peek(game);
    // Head on the east edge facing the border: the first move would be fatal.
    const edge = s.grid.cols - 1;
    s.body = [0, 1, 2, 3].map((i) => ({ x: edge - i, y: 14 }));
    s.heading = 'right';
    placeApple(s, { x: 3, y: 3 });
    while (s.readyT > 0) {
      step(game, input);
      expect(s.isEnding).toBe(false);
    }
    expect(headOf(game)).toEqual({ x: edge, y: 14 });
    expect(untilOver(game, input)).toBe(true);
    expect(headOf(game)).toEqual({ x: edge, y: 14 });
  });

  it('shows a READY line only while READY runs, and never on card art', () => {
    const shown = recordTexts();
    const { game, input } = gameOn(shown.ctx, 3, false);
    const s = peek(game);
    game.render();
    expect(shown.texts).toContain('READY');
    while (s.readyT > 0) step(game, input);
    shown.texts.length = 0;
    game.render();
    expect(shown.texts).not.toContain('READY');
    const card = recordTexts();
    gameOn(card.ctx, 3, true).game.render();
    expect(card.texts).not.toContain('READY');
  });

  it('starts card art moving at once, since card art has no READY banner', () => {
    const { game, input } = gameOn(mockCtx(), 4, true);
    const s = peek(game);
    expect(s.readyT).toBe(0);
    const before = headOf(game);
    // Card art shows 1.6 seconds of play, which is about eleven moves at the base speed.
    step(game, input, 96);
    expect(headOf(game).x).toBeGreaterThan(before.x + 6);
  });

  it('leaves READY out of the run duration, so a run is not credited with it', () => {
    const { game, input } = fresh(6);
    let frames = 0;
    for (; !game.isOver() && frames < 900; frames++) step(game, input);
    expect(game.isOver()).toBe(true);
    // Only READY (1.2 seconds) is left out; the 1.4-second death delay counts, as it always has.
    expect(game.getResult().durationSec).toBeCloseTo(frames * DT - 1.2, 6);
  });

  it('reports no run time for a run quit during READY', () => {
    const { game, input } = fresh(6);
    step(game, input, 30);
    expect(game.getResult().durationSec).toBeCloseTo(0, 6);
  });

  it('ignores turns and swipes pressed during the death delay, so they cannot change the outcome', () => {
    const dieAtBorder = (presses: boolean) => {
      const { game, input } = start(6);
      const s = peek(game);
      for (let i = 0; i < 900 && !s.isEnding; i++) step(game, input);
      expect(s.isEnding).toBe(true);
      let frames = 0;
      for (; !game.isOver() && frames < 300; frames++) {
        if (!presses) {
          step(game, input);
          continue;
        }
        const d = DIRS[frames % DIRS.length] as Dir;
        input.setVirtual(d, true, 'test');
        input.pushSwipe(d);
        step(game, input);
        input.setVirtual(d, false, 'test');
      }
      expect(game.isOver()).toBe(true);
      return {
        frames,
        heading: s.heading,
        turns: [...s.turns],
        body: s.body.map((c) => ({ ...c })),
        result: game.getResult(),
      };
    };
    const quiet = dieAtBorder(false);
    expect(dieAtBorder(true)).toEqual(quiet);
    // The death delay is 1.4 seconds at 60 steps a second.
    expect(quiet.frames * DT).toBeCloseTo(1.4, 1);
  });
});
