import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { archeryGame } from '../src/games/archery';
import { ringScore } from '../src/games/archery/archery';
import { blasterGame } from '../src/games/blaster';
import { splitRock, waveRocks } from '../src/games/blaster/blaster';
import { dinoGame } from '../src/games/dino';
import { overlap, SIZES } from '../src/games/dino/dino';
import { gemsGame } from '../src/games/gems';
import {
  collapse,
  findMatches,
  hasMove,
  newBoard,
  SIZE as GEM_SIZE,
  swapMatches,
} from '../src/games/gems/board';
import { hockeyGame } from '../src/games/hockey';
import { cpuSpeedFor, strike } from '../src/games/hockey/hockey';
import { lightsGame } from '../src/games/lights';
import { makePuzzle, press, SIZE as LIGHTS } from '../src/games/lights/lights';
import { missileGame } from '../src/games/missile';
import { blastRadius, waveSpec } from '../src/games/missile/missile';
import { pipesGame } from '../src/games/pipes';
import { connected, makeTree, rotate } from '../src/games/pipes/pipes';
import { tictactoeGame } from '../src/games/tictactoe';
import { cpuMove, winnerOf } from '../src/games/tictactoe/tictactoe';
import { tilesGame } from '../src/games/tiles';
import { speedAfter } from '../src/games/tiles/tiles';
import type { GameInstance } from '../src/games/types';
import { createGame } from './helpers';

const DT = 1 / 60;

function run(game: GameInstance, seconds: number): void {
  for (let i = 0; i < seconds * 60 && !game.isOver(); i++) game.update(DT);
}

describe('Dino Run', () => {
  it('hits only when the shrunken boxes overlap', () => {
    expect(overlap(0, 0, 50, 50, 40, 0, 50, 50, 0)).toBe(true);
    expect(overlap(0, 0, 50, 50, 40, 0, 50, 50, 6)).toBe(false);
  });

  it('puts the birds at heights to jump, duck and run under', () => {
    // Standing, the dino is 62 tall and ducking 36: it must jump the low bird, duck the middle one and pass the high one.
    expect(SIZES.birdLow.lift).toBeLessThan(36);
    expect(SIZES.birdMid.lift).toBeGreaterThan(36);
    expect(SIZES.birdMid.lift).toBeLessThan(62);
    expect(SIZES.birdHigh.lift).toBeGreaterThan(62);
  });

  it('waits for the first jump, then ends on a crash unless the shield saves it', () => {
    for (const shield of [false, true]) {
      const { game, input } = createGame(dinoGame, { seed: 1, boosts: shield ? ['shield'] : [] });
      run(game, 3);
      expect(game.getResult().stats.distance).toBe(0);
      input.setVirtual('primary', true, 't');
      game.update(DT);
      input.postUpdate();
      input.setVirtual('primary', false, 't');
      const g = game as unknown as {
        obstacles: { kind: string; x: number }[];
        y: number;
        s: number;
        u: number;
      };
      g.y = 0;
      g.obstacles = [{ kind: 'bigCactus', x: 90 * g.u + 10 * g.s }];
      game.update(DT);
      run(game, 2);
      expect(game.isOver()).toBe(!shield);
    }
  });
});

describe('Piano Tiles', () => {
  it('speeds up with every tile, half as fast with the head start', () => {
    expect(speedAfter(50, false)).toBeGreaterThan(speedAfter(0, false));
    expect(speedAfter(50, true)).toBeLessThan(speedAfter(50, false));
  });

  it('plays the right lane and ends on a wrong one', () => {
    const { game } = createGame(tilesGame, { seed: 1 });
    const g = game as unknown as {
      rows: { lane: number }[];
      next: number;
      started: boolean;
      tap(l: number): void;
    };
    g.started = true;
    for (let i = 0; i < 5; i++) g.tap(g.rows[g.next]!.lane);
    expect(g.next).toBe(5);
    g.tap((g.rows[g.next]!.lane + 1) % 4);
    run(game, 2);
    expect(game.isOver()).toBe(true);
    expect(game.getResult().stats.tiles).toBe(5);
  });

  it('ends when a tile slips past', () => {
    const { game } = createGame(tilesGame, { seed: 2 });
    (game as unknown as { started: boolean }).started = true;
    run(game, 4);
    expect(game.isOver()).toBe(true);
  });
});

describe('Tic-Tac-Toe', () => {
  it('finds three in a row', () => {
    expect(winnerOf([1, 1, 1, 0, 2, 2, 0, 0, 0])?.who).toBe(1);
    expect(winnerOf([2, 1, 0, 1, 2, 0, 0, 0, 2])?.who).toBe(2);
    expect(winnerOf([1, 2, 1, 0, 0, 0, 0, 0, 0])).toBeNull();
  });

  it('the perfect computer wins when it can and blocks when it must', () => {
    expect(cpuMove([2, 2, 0, 1, 1, 0, 0, 0, 0], 1, new Rng(1))).toBe(2);
    expect(cpuMove([1, 1, 0, 0, 2, 0, 0, 0, 0], 1, new Rng(1))).toBe(2);
  });

  it('a win moves up a level; a loss ends the run', () => {
    const { game } = createGame(tictactoeGame, { seed: 1 });
    const g = game as unknown as { board: number[]; level: number; place(i: number, who: 1 | 2): void };
    g.board = [1, 1, 0, 2, 2, 0, 0, 0, 0];
    g.place(2, 1);
    run(game, 2.5);
    expect(g.level).toBe(2);
    g.board = [2, 2, 0, 1, 1, 0, 1, 0, 0];
    g.place(2, 2);
    run(game, 3);
    expect(game.isOver()).toBe(true);
  });
});

describe('Lights Out', () => {
  it('a press flips the light and its four neighbours', () => {
    const on = Array<boolean>(LIGHTS * LIGHTS).fill(false);
    press(on, 12);
    expect(on.filter(Boolean)).toHaveLength(5);
    press(on, 0);
    expect(on.filter(Boolean)).toHaveLength(8);
  });

  it('every puzzle is solved by pressing its solution again', () => {
    for (let k = 1; k <= 15; k += 2) {
      const { on, solution } = makePuzzle(new Rng(k), k);
      expect(on.some(Boolean)).toBe(true);
      for (const i of solution) press(on, i);
      expect(on.some(Boolean)).toBe(false);
    }
  });

  it('switching the board off solves the puzzle and deals the next', () => {
    const { game } = createGame(lightsGame, { seed: 1 });
    const g = game as unknown as { on: boolean[]; level: number; pressCell(i: number): void };
    g.on = Array<boolean>(25).fill(false);
    press(g.on, 7);
    g.pressCell(7);
    run(game, 2);
    expect(g.level).toBe(2);
    expect(game.getResult().stats.puzzles).toBe(1);
  });
});

describe('Pipe Connect', () => {
  it('turns a pipe a quarter clockwise', () => {
    expect(rotate(1)).toBe(2);
    expect(rotate(8)).toBe(1);
    expect(rotate(5)).toBe(10);
  });

  it('builds a tree that reaches every tile from the pump', () => {
    for (const n of [4, 5, 7]) {
      const tiles = makeTree(new Rng(n), n);
      expect(tiles.every((t) => t !== 0)).toBe(true);
      expect(connected(tiles, n).size).toBe(n * n);
    }
  });

  it('solving the grid deals the next, bigger one', () => {
    const { game } = createGame(pipesGame, { seed: 1 });
    const g = game as unknown as { tiles: number[]; n: number; level: number; turn(i: number): void };
    const solved = makeTree(new Rng(9), g.n);
    g.tiles = [...solved];
    // Undo one turn so the next tap finishes it.
    const i = solved.findIndex((t) => rotate(t) !== t);
    g.tiles[i] = rotate(rotate(rotate(solved[i]!)));
    g.turn(i);
    run(game, 2);
    expect(g.level).toBe(2);
    expect(g.n).toBe(5);
  });
});

describe('Gem Swap', () => {
  it('deals a board with no lines and at least one move', () => {
    for (const seed of [1, 2, 3]) {
      const g = newBoard(new Rng(seed));
      expect(findMatches(g).size).toBe(0);
      expect(hasMove(g)).toBe(true);
    }
  });

  it('finds lines across and down', () => {
    const g = Array<number>(GEM_SIZE * GEM_SIZE)
      .fill(0)
      .map((_, i) => (i % 3) + (Math.floor(i / GEM_SIZE) % 2) * 3);
    g[0] = 5;
    g[1] = 5;
    g[2] = 5;
    expect(findMatches(g).has(1)).toBe(true);
  });

  it('collapses holes and fills from the top', () => {
    const g = newBoard(new Rng(4));
    g[0] = -1;
    g[GEM_SIZE] = -1;
    const fell = collapse(g, new Rng(5));
    expect(g.every((k) => k >= 0)).toBe(true);
    expect(fell[GEM_SIZE]).toBeGreaterThan(0);
  });

  it('only swaps that make a line stand, and they score', () => {
    const { game } = createGame(gemsGame, { seed: 1 });
    const g = game as unknown as { grid: number[]; trySwap(a: number, b: number): void };
    let pair: [number, number] | null = null;
    for (let i = 0; i < GEM_SIZE * GEM_SIZE && !pair; i++) {
      if (i % GEM_SIZE < GEM_SIZE - 1 && swapMatches(g.grid, i, i + 1)) pair = [i, i + 1];
    }
    expect(pair).not.toBeNull();
    g.trySwap(pair![0], pair![1]);
    run(game, 2);
    expect(game.getResult().stats.gems).toBeGreaterThanOrEqual(3);
  });
});

describe('Air Hockey', () => {
  it('bounces the puck off a mallet and adds its push', () => {
    const v = strike(0, -100, 0, 0, 0, 1, 1);
    expect(v.vy).toBeCloseTo(100);
    const pushed = strike(0, 0, 0, -500, 0, -1, 1);
    expect(pushed.vy).toBeLessThan(-500);
    expect(strike(0, 100, 0, 0, 0, 1, 1)).toEqual({ vx: 0, vy: 100 });
  });

  it('the computer gets quicker each level, up to a cap', () => {
    expect(cpuSpeedFor(3)).toBeGreaterThan(cpuSpeedFor(1));
    expect(cpuSpeedFor(50)).toBe(1350);
  });

  it('seven goals win the match and bring the next level', () => {
    const { game } = createGame(hockeyGame, { seed: 1 });
    const g = game as unknown as { myGoals: number; level: number; goal(forMe: boolean): void };
    for (let i = 0; i < 7; i++) g.goal(true);
    run(game, 3);
    expect(g.level).toBe(2);
    expect(game.getResult().stats.wins).toBe(1);
    expect(game.getResult().stats.goals).toBe(7);
  });
});

describe('Missile Command', () => {
  it('blasts grow, hold and shrink away', () => {
    expect(blastRadius(0, 50)).toBe(0);
    expect(blastRadius(0.4, 50)).toBe(50);
    expect(blastRadius(5, 50)).toBe(0);
  });

  it('later waves send more, faster missiles', () => {
    expect(waveSpec(5).count).toBeGreaterThan(waveSpec(1).count);
    expect(waveSpec(5).speed).toBeGreaterThan(waveSpec(1).speed);
  });

  it('an interceptor blast destroys the missiles in it', () => {
    const { game } = createGame(missileGame, { seed: 1 });
    const g = game as unknown as {
      missiles: {
        x: number;
        y: number;
        vx: number;
        vy: number;
        x0: number;
        y0: number;
        target: number;
        split: number;
      }[];
      blasts: { x: number; y: number; age: number; ours: boolean }[];
      checkBlasts(): void;
    };
    g.missiles = [{ x: 300, y: 300, vx: 0, vy: 50, x0: 300, y0: 0, target: 0, split: 0 }];
    g.blasts = [{ x: 305, y: 300, age: 0.4, ours: true }];
    g.checkBlasts();
    expect(g.missiles).toHaveLength(0);
    expect(game.getResult().stats.missiles).toBe(1);
  });

  it('ends when every city is gone', () => {
    const { game } = createGame(missileGame, { seed: 1 });
    const g = game as unknown as { cities: boolean[]; impact(m: { x: number; target: number }): void };
    for (let i = 0; i < 6; i++) g.impact({ x: 100, target: i });
    run(game, 3);
    expect(game.isOver()).toBe(true);
  });
});

describe('Asteroid Blaster', () => {
  it('splits a rock into two smaller ones, and the smallest into nothing', () => {
    const parts = splitRock(3, 0, 0, 100, 0, 1.3);
    expect(parts).toHaveLength(2);
    expect(parts.every((p) => p.size === 2)).toBe(true);
    expect(splitRock(1, 0, 0, 100, 0, 1.3)).toEqual([]);
  });

  it('sends more rocks each wave', () => {
    expect(waveRocks(4).count).toBeGreaterThan(waveRocks(1).count);
  });

  it('a rock hitting the ship costs a life; the last life ends the run', () => {
    const { game } = createGame(blasterGame, { seed: 1 });
    const g = game as unknown as { lives: number; hurt(): void };
    g.hurt();
    expect(g.lives).toBe(2);
    g.hurt();
    g.hurt();
    run(game, 2);
    expect(game.isOver()).toBe(true);
  });
});

describe('Archery', () => {
  it('scores 10 in the gold down to 1 at the edge', () => {
    expect(ringScore(0, 75)).toBe(10);
    expect(ringScore(70, 75)).toBe(1);
    expect(ringScore(80, 75)).toBe(0);
  });

  it('three misses end the contest; the shield allows a fourth', () => {
    for (const shield of [false, true]) {
      const { game } = createGame(archeryGame, { seed: 1, boosts: shield ? ['shield'] : [] });
      const g = game as unknown as { miss(): void; loose(a: number, p: number): void };
      for (let i = 0; i < 3; i++) {
        g.loose(0.5, 0.2);
        g.miss();
        run(game, 1);
      }
      run(game, 2);
      expect(game.isOver()).toBe(!shield);
    }
  });
});
