import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { breakoutGame } from '../src/games/breakout';
import {
  bounceAxis,
  buildLevel,
  circleHitsRect,
  COLS,
  isCleared,
  LAYOUTS,
} from '../src/games/breakout/levels';
import { gapFor, nextGate } from '../src/games/flappy/course';
import { flappyGame } from '../src/games/flappy';
import { canMove, emptyCells, slide, type Tile } from '../src/games/merge/board';
import { mergeGame } from '../src/games/merge';
import type { GameInstance } from '../src/games/types';
import { mixHex } from '../src/games/statbar';
import { createGame } from './helpers';

const DT = 1 / 60;

function run(game: GameInstance, seconds: number): void {
  for (let i = 0; i < seconds * 60 && !game.isOver(); i++) game.update(DT);
}

/** Tiles from rows of numbers (0 is empty). */
function tilesOf(rows: number[][]): Tile[] {
  const out: Tile[] = [];
  let id = 1;
  rows.forEach((row, r) =>
    row.forEach((value, c) => {
      if (value) out.push({ id: id++, value, r, c, pr: r, pc: c, merged: false, born: false });
    }),
  );
  return out;
}

function rowsOf(tiles: readonly Tile[], size = 4): number[][] {
  const rows = Array.from({ length: size }, () => Array<number>(size).fill(0));
  for (const t of tiles) (rows[t.r] as number[])[t.c] = t.value;
  return rows;
}

describe('2048 board', () => {
  it('slides and merges toward the edge', () => {
    const res = slide(
      tilesOf([
        [2, 2, 0, 4],
        [0, 0, 0, 0],
        [0, 0, 0, 0],
        [0, 0, 0, 0],
      ]),
      'left',
      4,
    );
    expect(rowsOf(res.tiles)[0]).toEqual([4, 4, 0, 0]);
    expect(res.gained).toBe(4);
    expect(res.created).toEqual([4]);
    expect(res.moved).toBe(true);
  });

  it('merges each tile at most once per move', () => {
    const res = slide(
      tilesOf([
        [2, 2, 2, 2],
        [4, 4, 8, 0],
        [0, 0, 0, 0],
        [0, 0, 0, 0],
      ]),
      'left',
      4,
    );
    expect(rowsOf(res.tiles)[0]).toEqual([4, 4, 0, 0]);
    expect(rowsOf(res.tiles)[1]).toEqual([8, 8, 0, 0]);
  });

  it('merges the pair nearest the edge first', () => {
    const res = slide(
      tilesOf([
        [2, 2, 2, 0],
        [0, 0, 0, 0],
        [0, 0, 0, 0],
        [0, 0, 0, 0],
      ]),
      'right',
      4,
    );
    expect(rowsOf(res.tiles)[0]).toEqual([0, 0, 2, 4]);
  });

  it('slides columns up and down', () => {
    const board = [
      [2, 0, 0, 0],
      [0, 0, 0, 0],
      [2, 0, 0, 0],
      [4, 0, 0, 0],
    ];
    expect(rowsOf(slide(tilesOf(board), 'up', 4).tiles).map((r) => r[0])).toEqual([4, 4, 0, 0]);
    expect(rowsOf(slide(tilesOf(board), 'down', 4).tiles).map((r) => r[0])).toEqual([0, 0, 4, 4]);
  });

  it('reports a move that changes nothing', () => {
    const res = slide(
      tilesOf([
        [2, 4, 0, 0],
        [0, 0, 0, 0],
        [0, 0, 0, 0],
        [0, 0, 0, 0],
      ]),
      'left',
      4,
    );
    expect(res.moved).toBe(false);
  });

  it('knows when the board is locked', () => {
    const locked = tilesOf([
      [2, 4, 2, 4],
      [4, 2, 4, 2],
      [2, 4, 2, 4],
      [4, 2, 4, 2],
    ]);
    expect(canMove(locked, 4)).toBe(false);
    expect(emptyCells(locked, 4)).toEqual([]);
    const open = tilesOf([
      [2, 4, 2, 4],
      [4, 2, 4, 2],
      [2, 4, 2, 4],
      [4, 2, 4, 4],
    ]);
    expect(canMove(open, 4)).toBe(true);
  });

  it('starts with two tiles, or a 32 and a 16 with the head start', () => {
    const plain = createGame(mergeGame, { seed: 2 }).game as unknown as { tiles: Tile[] };
    expect(plain.tiles).toHaveLength(2);
    const boosted = createGame(mergeGame, { seed: 2, boosts: ['head-start'] }).game as unknown as {
      tiles: Tile[];
    };
    expect(boosted.tiles.map((t) => t.value).sort((a, b) => a - b)).toEqual([16, 32]);
  });

  it('ends a locked board, unless the shield clears the two smallest tiles', () => {
    const locked = [
      [2, 4, 2, 4],
      [4, 2, 4, 2],
      [2, 4, 2, 4],
      [4, 2, 8, 8],
    ];
    for (const shield of [false, true]) {
      const { game } = createGame(mergeGame, { seed: 1, boosts: shield ? ['shield'] : [] });
      const g = game as unknown as { tiles: Tile[]; move(d: string): void };
      g.tiles = tilesOf(locked);
      g.move('left');
      run(game, 3);
      expect(game.isOver()).toBe(!shield);
    }
  });

  it('scores merges and pays a coin for a 128 tile', () => {
    const { game } = createGame(mergeGame, { seed: 1 });
    const g = game as unknown as { tiles: Tile[]; move(d: string): void };
    g.tiles = tilesOf([
      [64, 64, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ]);
    g.move('left');
    const r = game.getResult();
    expect(r.score).toBe(128);
    expect(r.coins).toBe(1);
    expect(r.stats.bestTile).toBe(128);
    expect(r.stats.merges).toBe(1);
  });
});

describe('Brick Breaker levels', () => {
  it('builds every layout ten columns wide, with bricks to break', () => {
    for (const layout of LAYOUTS) for (const line of layout) expect(line).toHaveLength(COLS);
    for (let level = 1; level <= LAYOUTS.length; level++) {
      const bricks = buildLevel(level);
      expect(bricks.some((b) => !b.steel)).toBe(true);
      expect(isCleared(bricks)).toBe(false);
    }
  });

  it('adds a hit to every brick on the second loop, up to three', () => {
    const first = buildLevel(1);
    const second = buildLevel(1 + LAYOUTS.length);
    expect(second.map((b) => b.hp)).toEqual(first.map((b) => Math.min(3, b.hp + 1)));
  });

  it('counts a level with only steel left as cleared', () => {
    expect(isCleared(buildLevel(3).filter((b) => b.steel))).toBe(true);
  });

  it('bounces off the side it hits', () => {
    // A ball just left of a 40x20 brick at (100, 100), level with its middle.
    expect(circleHitsRect(95, 110, 8, 100, 100, 40, 20)).toBe(true);
    expect(bounceAxis(95, 110, 8, 100, 100, 40, 20)).toBe('x');
    // The same ball just below the brick.
    expect(bounceAxis(120, 125, 8, 100, 100, 40, 20)).toBe('y');
    expect(circleHitsRect(80, 80, 8, 100, 100, 40, 20)).toBe(false);
  });

  it('ends after three missed balls, and the shield saves one', () => {
    const plain = createGame(breakoutGame, { seed: 4 }).game;
    run(plain, 120);
    expect(plain.isOver()).toBe(true);
    const lives = (g: GameInstance) => (g as unknown as { lives: number }).lives;
    const shielded = createGame(breakoutGame, { seed: 4, boosts: ['shield'] }).game;
    // Left alone, the ball launches itself and falls past the paddle; the shield sends the first one back.
    let missedBeforeShield = false;
    for (let i = 0; i < 60 * 20 && !missedBeforeShield; i++) {
      shielded.update(DT);
      if ((shielded as unknown as { shield: boolean }).shield === false)
        missedBeforeShield = lives(shielded) === 3;
    }
    expect(missedBeforeShield).toBe(true);
  });

  it('clears a level and moves on to the next', () => {
    const { game } = createGame(breakoutGame, { seed: 1 });
    const g = game as unknown as {
      bricks: ReturnType<typeof buildLevel>;
      level: number;
      breakBrick(b: ReturnType<typeof buildLevel>[number], x: number, y: number): void;
    };
    const last = g.bricks.find((b) => !b.steel)!;
    g.bricks = [];
    g.breakBrick(last, 100, 100);
    run(game, 2.5);
    expect(g.level).toBe(2);
    expect(g.bricks.length).toBe(buildLevel(2).length);
    expect(game.getResult().stats.levels).toBe(1);
  });
});

describe('Sky Hopper', () => {
  it('narrows the gaps to a floor', () => {
    expect(gapFor(0, 1)).toBeGreaterThan(gapFor(20, 1));
    expect(gapFor(500, 1)).toBe(gapFor(1000, 1));
  });

  it('keeps every gap inside the open sky and within reach of the last one', () => {
    const rng = new Rng(9);
    let y = 400;
    for (let i = 0; i < 300; i++) {
      const g = nextGate(rng, i, 0, y, 100, 760, 1);
      expect(g.gapY - g.gapH / 2).toBeGreaterThanOrEqual(100 - 1e-6);
      expect(g.gapY + g.gapH / 2).toBeLessThanOrEqual(760 + 1e-6);
      expect(Math.abs(g.gapY - y)).toBeLessThanOrEqual(230 + 1e-6);
      y = g.gapY;
    }
  });

  it('waits for the first flap, then falls to the ground if left alone', () => {
    const { game, input } = createGame(flappyGame, { seed: 1 });
    run(game, 5);
    expect(game.isOver()).toBe(false);
    input.setVirtual('primary', true, 'test');
    game.update(DT);
    input.postUpdate();
    input.setVirtual('primary', false, 'test');
    run(game, 10);
    expect(game.isOver()).toBe(true);
    expect(game.getResult().stats.flaps).toBe(1);
  });

  it('scores a gate the bird passes and a coin it touches', () => {
    const { game } = createGame(flappyGame, { seed: 1 });
    const g = game as unknown as {
      phase: string;
      gates: { x: number; gapY: number; gapH: number; coin: boolean; passed: boolean }[];
      birdX: number;
      birdY: number;
      vy: number;
      checkGates(): void;
    };
    g.phase = 'flying';
    const gate = g.gates[0]!;
    gate.coin = true;
    gate.gapY = g.birdY;
    gate.x = g.birdX - 46;
    g.checkGates();
    expect(game.getResult().coins).toBe(1);
    gate.x = g.birdX - 400;
    g.checkGates();
    const r = game.getResult();
    expect(r.stats.gates).toBe(1);
    expect(r.score).toBe(15);
  });

  it('lets the shield survive the first crash', () => {
    for (const shield of [false, true]) {
      const { game } = createGame(flappyGame, { seed: 1, boosts: shield ? ['shield'] : [] });
      const g = game as unknown as { phase: string; crash(ground: boolean): void };
      g.phase = 'flying';
      g.crash(false);
      expect(g.phase).toBe(shield ? 'flying' : 'falling');
    }
  });

  it('counts the head start in the score but not in the gate stats', () => {
    const r = createGame(flappyGame, { seed: 1, boosts: ['head-start'] }).game.getResult();
    expect(r.score).toBe(50);
    expect(r.stats.gates).toBe(0);
  });
});

describe('colour mixing', () => {
  it('blends two colours', () => {
    expect(mixHex('#000000', '#ffffff', 0)).toBe('#000000');
    expect(mixHex('#000000', '#ffffff', 1)).toBe('#ffffff');
    expect(mixHex('#000000', '#ffffff', 0.5)).toBe('#808080');
  });
});
