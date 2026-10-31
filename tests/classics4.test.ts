import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { fourGame } from '../src/games/four';
import { cpuMove, emptyGrid, type Grid, landingRow, winLine } from '../src/games/four/board';
import { cpuSkill } from '../src/games/four/four';
import { hopperGame } from '../src/games/hopper';
import { COLS, covered, type Lane, makeLane } from '../src/games/hopper/lanes';
import { sortGame } from '../src/games/sort';
import { coloursFor } from '../src/games/sort/sort';
import { CAPACITY, canPour, dealTubes, pour, solvable, solved, type Tubes } from '../src/games/sort/tubes';
import type { GameInstance } from '../src/games/types';
import { createGame } from './helpers';

const DT = 1 / 60;

function run(game: GameInstance, seconds: number): void {
  for (let i = 0; i < seconds * 60 && !game.isOver(); i++) game.update(DT);
}

describe('Road Hopper lanes', () => {
  it('starts on grass, then mixes roads and rivers with grass between runs', () => {
    const rng = new Rng(4);
    let prev: Lane | null = null;
    let left = 0;
    const kinds: string[] = [];
    for (let r = 0; r < 200; r++) {
      const made = makeLane(rng, r, prev, left);
      kinds.push(made.lane.kind);
      if (made.lane.kind === 'grass') expect(made.lane.trees.size).toBeLessThan(COLS - 1);
      else expect(made.lane.speed).not.toBe(0);
      prev = made.lane;
      left = made.runLeft;
    }
    expect(kinds.slice(0, 4)).toEqual(['grass', 'grass', 'grass', 'grass']);
    expect(kinds).toContain('road');
    expect(kinds).toContain('river');
    // A run of roads or rivers always ends on grass before the other kind starts.
    for (let i = 1; i < kinds.length; i++) {
      if (kinds[i] !== 'grass' && kinds[i - 1] !== 'grass') expect(kinds[i]).toBe(kinds[i - 1]);
    }
  });

  it('tells when a column is covered by a car or a log', () => {
    const lane: Lane = {
      kind: 'road',
      speed: 1,
      movers: [{ x: 2, len: 2, hue: 0 }],
      trees: new Set(),
      coin: -1,
    };
    expect(covered(lane, 3, 0)).toBe(true);
    expect(covered(lane, 4.5, 0)).toBe(false);
    expect(covered(lane, 4.2, 0.3)).toBe(true);
  });
});

describe('Road Hopper game', () => {
  interface Peek {
    col: number;
    row: number;
    lanes: Map<number, Lane>;
    hop(dir: 'up' | 'down' | 'left' | 'right'): void;
    hopT: number;
  }

  /** Puts a lane at row 1 and hops onto it. */
  function hopOnto(game: GameInstance, lane: Lane): Peek {
    const g = game as unknown as Peek;
    g.lanes.set(1, lane);
    g.hop('up');
    return g;
  }

  it('a car squashes the hopper, unless the shield puts it back on the grass', () => {
    for (const shield of [false, true]) {
      const { game } = createGame(hopperGame, { seed: 1, boosts: shield ? ['shield'] : [] });
      const col = (game as unknown as Peek).col;
      const g = hopOnto(game, {
        kind: 'road',
        speed: 0,
        movers: [{ x: col, len: 1, hue: 0 }],
        trees: new Set(),
        coin: -1,
      });
      run(game, 2.5);
      expect(game.isOver()).toBe(!shield);
      if (shield) expect(g.lanes.get(g.row)?.kind).toBe('grass');
    }
  });

  it('water drowns the hopper, but a log carries it', () => {
    const wet = createGame(hopperGame, { seed: 1 }).game;
    hopOnto(wet, { kind: 'river', speed: 1, movers: [{ x: 7, len: 1, hue: 0 }], trees: new Set(), coin: -1 });
    run(wet, 2);
    expect(wet.isOver()).toBe(true);
    const { game } = createGame(hopperGame, { seed: 1 });
    const start = (game as unknown as Peek).col;
    const g = hopOnto(game, {
      kind: 'river',
      speed: 1,
      movers: [{ x: start - 1, len: 3, hue: 0 }],
      trees: new Set(),
      coin: -1,
    });
    for (let i = 0; i < 30; i++) game.update(DT);
    expect(game.isOver()).toBe(false);
    expect(g.col).toBeGreaterThan(start + 0.2);
  });

  it('a tree blocks the way', () => {
    const { game } = createGame(hopperGame, { seed: 1 });
    const g = game as unknown as Peek;
    g.lanes.set(1, { kind: 'grass', speed: 0, movers: [], trees: new Set([Math.round(g.col)]), coin: -1 });
    g.hop('up');
    expect(g.row).toBe(0);
  });

  it('the eagle takes a hopper that stops moving forward', () => {
    const { game } = createGame(hopperGame, { seed: 1 });
    run(game, 12);
    expect(game.isOver()).toBe(true);
  });

  it('scores the furthest row reached', () => {
    const { game } = createGame(hopperGame, { seed: 1 });
    const g = game as unknown as Peek;
    for (let r = 1; r <= 3; r++) {
      g.lanes.set(r, { kind: 'grass', speed: 0, movers: [], trees: new Set(), coin: -1 });
      g.hop('up');
      run(game, 0.2);
    }
    g.hop('down');
    run(game, 0.2);
    const res = game.getResult();
    expect(res.score).toBe(3);
    expect(res.stats.rows).toBe(3);
    expect(res.stats.hops).toBe(4);
  });
});

describe('Color Sort tubes', () => {
  it('pours only onto the same colour or into an empty tube with room', () => {
    const t: Tubes = [[1, 2], [2], [1, 1, 1, 1], []];
    expect(canPour(t, 0, 1)).toBe(true);
    expect(canPour(t, 1, 0)).toBe(true);
    expect(canPour(t, 0, 2)).toBe(false);
    expect(canPour(t, 2, 3)).toBe(true);
    expect(pour(t, 0, 1)).toBe(true);
    expect(t).toEqual([[1], [2, 2], [1, 1, 1, 1], []]);
  });

  it('knows a sorted position', () => {
    expect(solved([[1, 1, 1, 1], [2, 2, 2, 2], []])).toBe(true);
    expect(solved([[1, 1, 1], [1, 2, 2, 2], [2]])).toBe(false);
  });

  it('deals every level unsorted and solvable', () => {
    for (let level = 1; level <= 5; level++) {
      const c = coloursFor(level);
      const tubes = dealTubes(new Rng(level * 7), c, 2);
      expect(tubes).toHaveLength(c + 2);
      expect(tubes.flat()).toHaveLength(c * CAPACITY);
      expect(solved(tubes)).toBe(false);
      if (c <= 5) expect(solvable(tubes)).toBe(true);
    }
  });

  it('proves a stuck position cannot be solved', () => {
    expect(
      solvable([
        [1, 2, 1, 2],
        [2, 1, 2, 1],
      ]),
    ).toBe(false);
  });
});

describe('Color Sort game', () => {
  interface Peek {
    tubes: Tubes;
    level: number;
    history: [number, number][];
    choose(i: number): void;
    undo(): void;
  }

  it('lifts with one tap, pours with the next, and undoes', () => {
    const { game } = createGame(sortGame, { seed: 1 });
    const g = game as unknown as Peek;
    g.tubes = [[1, 2], [2], [1, 1, 1], [2, 2]];
    g.choose(0);
    g.choose(1);
    expect(g.tubes[1]).toEqual([2, 2]);
    expect(g.history).toHaveLength(1);
    g.undo();
    expect(g.tubes[0]).toEqual([1, 2]);
    expect(g.history).toHaveLength(0);
  });

  it('solving a puzzle deals the next level with more colours', () => {
    const { game } = createGame(sortGame, { seed: 1 });
    const g = game as unknown as Peek;
    g.tubes = [[1, 1, 1], [2, 2, 2, 2], [3, 3, 3, 3], [1], []];
    g.choose(3);
    g.choose(0);
    run(game, 2);
    expect(g.level).toBe(2);
    expect(g.tubes.flat()).toHaveLength(coloursFor(2) * CAPACITY);
    expect(game.getResult().stats.levels).toBe(1);
  });

  it('ends when time runs out, with 20 more seconds from the shield', () => {
    const plain = createGame(sortGame, { seed: 1 }).game;
    run(plain, 100);
    expect(plain.isOver()).toBe(true);
    const shielded = createGame(sortGame, { seed: 1, boosts: ['shield'] }).game;
    run(shielded, 90);
    expect(shielded.isOver()).toBe(false);
  });

  it('adds an empty tube with the head start', () => {
    const g = createGame(sortGame, { seed: 1, boosts: ['head-start'] }).game as unknown as Peek;
    expect(g.tubes.filter((t) => t.length === 0)).toHaveLength(3);
  });
});

describe('Connect Four board', () => {
  function play(cols: number[]): Grid {
    const g = emptyGrid();
    cols.forEach((c, i) => {
      (g[c] as number[])[landingRow(g, c)] = i % 2 === 0 ? 1 : 2;
    });
    return g;
  }

  it('finds lines across, up and diagonally', () => {
    expect(winLine(play([0, 6, 1, 6, 2, 6, 3]))).toHaveLength(4);
    expect(winLine(play([0, 1, 0, 1, 0, 1, 0]))).toHaveLength(4);
    expect(winLine(play([0, 1, 1, 2, 2, 3, 2, 3, 3, 6, 3]))).toHaveLength(4);
    expect(winLine(play([0, 1, 2]))).toBeNull();
  });

  it('the computer takes a win and blocks one', () => {
    // The computer (2) has three in column 6: it should finish the line.
    const take = play([0, 6, 1, 6, 5, 6]);
    expect(cpuMove(take, 2, new Rng(1))).toBe(6);
    // The player (1) threatens four along the bottom: it must block at column 3.
    const block = play([0, 6, 1, 6, 2]);
    expect(cpuMove(block, 2, new Rng(1))).toBe(3);
  });

  it('gets sharper with each level', () => {
    expect(cpuSkill(5).depth).toBeGreaterThan(cpuSkill(1).depth);
    expect(cpuSkill(1).blunder).toBeGreaterThan(cpuSkill(4).blunder);
  });
});

describe('Connect Four game', () => {
  interface Peek {
    grid: Grid;
    level: number;
    phase: string;
    drop(col: number, who: number): void;
  }

  it('a win moves up a level; a loss ends the run unless the shield forgives it', () => {
    const won = createGame(fourGame, { seed: 1 }).game;
    const w = won as unknown as Peek;
    w.grid = play([0, 6, 1, 6, 2, 5]);
    w.drop(3, 1);
    run(won, 4);
    expect(w.level).toBe(2);
    expect(won.getResult().stats.wins).toBe(1);
    for (const shield of [false, true]) {
      const { game } = createGame(fourGame, { seed: 1, boosts: shield ? ['shield'] : [] });
      const g = game as unknown as Peek;
      g.grid = play([0, 6, 1, 6, 0, 6, 1]);
      g.drop(6, 2);
      run(game, 4);
      expect(game.isOver()).toBe(!shield);
    }
  });

  function play(cols: number[]): Grid {
    const g = emptyGrid();
    cols.forEach((c, i) => {
      (g[c] as number[])[landingRow(g, c)] = i % 2 === 0 ? 1 : 2;
    });
    return g;
  }
});
