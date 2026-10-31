import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { jumperGame } from '../src/games/jumper';
import { nextPad, type Pad, REACH } from '../src/games/jumper/jumper';
import { minesGame } from '../src/games/mines';
import { Board } from '../src/games/mines/board';
import { minesFor } from '../src/games/mines/mines';
import { sliceGame } from '../src/games/slice';
import { type Fruit, segmentDistance } from '../src/games/slice/slice';
import type { GameInstance } from '../src/games/types';
import { createGame } from './helpers';

const DT = 1 / 60;

function run(game: GameInstance, seconds: number): void {
  for (let i = 0; i < seconds * 60 && !game.isOver(); i++) game.update(DT);
}

describe('Minesweeper board', () => {
  it('never lays a mine on or next to the first dig', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const b = new Board(9, 12, 30);
      const first = b.index(4, 6);
      b.lay(new Rng(seed), first);
      expect(b.cells.filter((c) => c.mine)).toHaveLength(30);
      for (const k of [first, ...b.around(first)]) expect(b.cells[k]!.mine).toBe(false);
      expect(b.cells[first]!.near).toBe(0);
    }
  });

  it('counts the mines around every square', () => {
    const b = new Board(9, 12, 20);
    b.lay(new Rng(5), 0);
    b.cells.forEach((c, i) => {
      expect(c.near).toBe(b.around(i).filter((k) => b.cells[k]!.mine).length);
    });
  });

  it('opens an empty area in one dig, stopping at the numbers', () => {
    const b = new Board(9, 12, 10);
    b.lay(new Rng(2), b.index(4, 6));
    const opened = b.open(b.index(4, 6));
    expect(opened).not.toBeNull();
    expect(opened!.length).toBeGreaterThan(9);
    for (const k of opened!) {
      const c = b.cells[k]!;
      expect(c.mine).toBe(false);
      // Every opened square next to an unopened one shows a number.
      if (b.around(k).some((n) => !b.cells[n]!.open)) expect(c.near).toBeGreaterThan(0);
    }
  });

  it('reports a mine, and leaves flagged squares shut', () => {
    const b = new Board(9, 12, 10);
    b.lay(new Rng(3), 0);
    const mine = b.cells.findIndex((c) => c.mine);
    b.toggleFlag(mine);
    expect(b.open(mine)).toEqual([]);
    b.toggleFlag(mine);
    expect(b.open(mine)).toBeNull();
  });

  it('chords: a number with its mines flagged opens the rest of its neighbours', () => {
    const b = new Board(9, 12, 12);
    b.lay(new Rng(4), b.index(4, 6));
    b.open(b.index(4, 6));
    const n = b.cells.findIndex(
      (c, i) => c.open && c.near > 0 && b.around(i).some((k) => !b.cells[k]!.open && !b.cells[k]!.mine),
    );
    expect(n).toBeGreaterThanOrEqual(0);
    for (const k of b.around(n)) if (b.cells[k]!.mine) b.cells[k]!.flag = true;
    const opened = b.chord(n);
    expect(opened).not.toBeNull();
    expect(b.around(n).every((k) => b.cells[k]!.mine || b.cells[k]!.open)).toBe(true);
  });

  it('is cleared once every safe square is open', () => {
    const b = new Board(5, 5, 3);
    b.lay(new Rng(1), 12);
    b.cells.forEach((c) => {
      if (!c.mine) c.open = true;
    });
    expect(b.cleared()).toBe(true);
  });

  it('adds mines on later fields, up to a cap', () => {
    expect(minesFor(2)).toBeGreaterThan(minesFor(1));
    expect(minesFor(50)).toBe(minesFor(100));
  });
});

describe('Minesweeper game', () => {
  interface Peek {
    board: Board;
    dig(i: number): void;
    boardNum: number;
  }

  it('ends on a mine, unless the shield defuses it', () => {
    for (const shield of [false, true]) {
      const { game } = createGame(minesGame, { seed: 1, boosts: shield ? ['shield'] : [] });
      const g = game as unknown as Peek;
      g.dig(g.board.index(4, 6));
      const mine = g.board.cells.findIndex((c) => c.mine);
      g.dig(mine);
      run(game, 3);
      expect(game.isOver()).toBe(!shield);
      if (shield) expect(g.board.cells[mine]!.flag).toBe(true);
    }
  });

  it('clears a field and moves on to the next', () => {
    const { game } = createGame(minesGame, { seed: 2 });
    const g = game as unknown as Peek;
    g.dig(0);
    g.board.cells.forEach((c, i) => {
      if (!c.mine && !c.open) g.dig(i);
    });
    run(game, 2);
    expect(g.boardNum).toBe(2);
    const r = game.getResult();
    expect(r.stats.boards).toBe(1);
    expect(r.coins).toBe(2);
  });

  it('flags four mines on each field with the head start', () => {
    const { game } = createGame(minesGame, { seed: 3, boosts: ['head-start'] });
    const g = game as unknown as Peek;
    g.dig(g.board.index(4, 6));
    expect(g.board.cells.filter((c) => c.mine && c.flag)).toHaveLength(4);
  });
});

describe('Fruit Slice', () => {
  it('measures the distance from a point to the blade stroke', () => {
    expect(segmentDistance(5, 5, 0, 0, 10, 0)).toBe(5);
    expect(segmentDistance(-3, 4, 0, 0, 10, 0)).toBe(5);
    expect(segmentDistance(5, 0, 0, 0, 10, 0)).toBe(0);
  });

  interface Peek {
    fruits: Fruit[];
    lives: number;
    stroke: number;
    cut(f: Fruit, dx: number, dy: number): void;
    finishStroke(): void;
  }

  const fruit = (kind: Fruit['kind'], x = 300, y = 400): Fruit => ({
    kind,
    x,
    y,
    vx: 0,
    vy: 0,
    r: 36,
    angle: 0,
    spin: 0,
  });

  it('scores fruit, pays a combo for three in one swipe, and a coin for gold', () => {
    const { game } = createGame(sliceGame, { seed: 1 });
    const g = game as unknown as Peek;
    g.cut(fruit('apple'), 10, 0);
    g.cut(fruit('melon'), 10, 0);
    g.cut(fruit('gold'), 10, 0);
    g.finishStroke();
    const r = game.getResult();
    expect(r.score).toBe(10 + 10 + 50 + 30);
    expect(r.coins).toBe(1);
    expect(r.stats.combo).toBe(3);
  });

  it('costs a life for every fruit that falls uncut, and ends after the last', () => {
    const { game } = createGame(sliceGame, { seed: 1 });
    const g = game as unknown as Peek & { volleyT: number };
    for (let i = 0; i < 3; i++) g.fruits.push({ ...fruit('apple', 300, 2000), vy: 10 });
    g.volleyT = 99;
    run(game, 3);
    expect(g.lives).toBe(0);
    expect(game.isOver()).toBe(true);
  });

  it('a bomb ends the run, unless the shield defuses it', () => {
    for (const shield of [false, true]) {
      const { game } = createGame(sliceGame, { seed: 1, boosts: shield ? ['shield'] : [] });
      const g = game as unknown as Peek & { volleyT: number };
      g.volleyT = 99;
      g.cut(fruit('bomb'), 10, 0);
      run(game, 2);
      expect(game.isOver()).toBe(!shield);
    }
  });

  it('starts with an extra life with the head start', () => {
    const g = createGame(sliceGame, { seed: 1, boosts: ['head-start'] }).game as unknown as Peek;
    expect(g.lives).toBe(4);
  });
});

describe('Sky Jumper', () => {
  it('never puts the next pad out of reach of a bounce', () => {
    const rng = new Rng(7);
    let y = 0;
    for (let i = 0; i < 2000; i++) {
      const pad = nextPad(rng, y, i * 150, 600, 1);
      expect(y - pad.y).toBeGreaterThan(0);
      expect(y - pad.y).toBeLessThanOrEqual(REACH);
      expect(pad.kind).not.toBe('breaking');
      expect(pad.x).toBeGreaterThanOrEqual(0);
      expect(pad.x).toBeLessThanOrEqual(600 - 96);
      y = pad.y;
    }
  });

  interface Peek {
    x: number;
    y: number;
    vy: number;
    pads: Pad[];
    camY: number;
  }

  it('climbs when steered onto the pads, and scores metres climbed', () => {
    const { game, input } = createGame(jumperGame, { seed: 2 });
    const g = game as unknown as Peek;
    for (let i = 0; i < 60 * 25 && !game.isOver(); i++) {
      // Rising: line up under the next pad up. Falling: land on the highest pad below the feet.
      const feet = g.y + 25;
      const solid = g.pads.filter((q) => !q.broken && q.kind !== 'breaking');
      const target =
        g.vy < 0
          ? solid.filter((q) => q.y < feet).sort((a, b) => b.y - a.y)[0]
          : solid.filter((q) => q.y >= feet - 1).sort((a, b) => a.y - b.y)[0];
      const d = target ? target.x + 48 - g.x : 0;
      input.setVirtual('right', d > 8, 'bot');
      input.setVirtual('left', d < -8, 'bot');
      game.update(DT);
      input.postUpdate();
    }
    expect(game.getResult().score).toBeGreaterThan(200);
    expect(game.getResult().stats.height).toBe(game.getResult().score);
  });

  it('ends when the jumper falls off the bottom, unless the shield bounces it back', () => {
    for (const shield of [false, true]) {
      const { game } = createGame(jumperGame, { seed: 1, boosts: shield ? ['shield'] : [] });
      const g = game as unknown as Peek;
      g.pads = [];
      run(game, 2.5);
      expect(game.isOver()).toBe(!shield);
    }
  });

  it('a spring bounces far higher than a pad', () => {
    const { game } = createGame(jumperGame, { seed: 1 });
    const g = game as unknown as Peek;
    const below = g.y + 25 + 4;
    g.pads = [{ kind: 'spring', x: g.x - 48, y: below, vx: 0, broken: false, vy: 0, coin: false }];
    g.vy = 300;
    game.update(DT);
    expect(g.vy).toBeLessThan(-1300);
    expect(game.getResult().stats.springs).toBe(1);
  });
});

describe('Sky Jumper wooden pads', () => {
  it('a wooden pad gives one bounce, then crumbles', () => {
    const { game } = createGame(jumperGame, { seed: 1 });
    const g = game as unknown as { x: number; y: number; vy: number; pads: Pad[] };
    const pad: Pad = {
      kind: 'breaking',
      x: g.x - 48,
      y: g.y + 25 + 4,
      vx: 0,
      broken: false,
      vy: 0,
      coin: false,
    };
    g.pads = [pad];
    g.vy = 300;
    game.update(DT);
    expect(g.vy).toBeLessThan(-800);
    expect(pad.broken).toBe(true);
    // Falling back down, the broken pad no longer holds.
    g.y = pad.y - 30;
    g.vy = 300;
    game.update(DT);
    expect(g.vy).toBeGreaterThan(0);
  });
});
