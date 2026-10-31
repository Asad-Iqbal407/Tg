import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { memoryGame } from '../src/games/memory';
import { type Card, deal, rowsFor, timeFor } from '../src/games/memory/memory';
import { moleGame } from '../src/games/mole';
import { heightOf, type Mole, paceAt } from '../src/games/mole/mole';
import { stackGame } from '../src/games/stack';
import { cut, type Slab } from '../src/games/stack/stack';
import type { GameInstance } from '../src/games/types';
import { createGame } from './helpers';

const DT = 1 / 60;

function run(game: GameInstance, seconds: number): void {
  for (let i = 0; i < seconds * 60 && !game.isOver(); i++) game.update(DT);
}

describe('Stack Tower', () => {
  it('keeps the overlap and slices off the overhang', () => {
    const res = cut({ x: 130, w: 100 }, { x: 100, w: 100 }, 5);
    expect(res.kept).toEqual({ x: 130, w: 70 });
    expect(res.cutOff).toEqual({ x: 200, w: 30 });
    expect(res.perfect).toBe(false);
    const left = cut({ x: 60, w: 100 }, { x: 100, w: 100 }, 5);
    expect(left.kept).toEqual({ x: 100, w: 60 });
    expect(left.cutOff).toEqual({ x: 60, w: 40 });
  });

  it('snaps a drop within the tolerance onto the floor below', () => {
    const res = cut({ x: 103, w: 100 }, { x: 100, w: 100 }, 5);
    expect(res).toEqual({ kept: { x: 100, w: 100 }, cutOff: null, perfect: true });
  });

  it('misses when nothing overlaps', () => {
    const res = cut({ x: 300, w: 100 }, { x: 100, w: 100 }, 5);
    expect(res.kept).toBeNull();
  });

  /** Drops the sliding block at an offset from the floor below. */
  function dropAt(game: GameInstance, offset: number): void {
    const g = game as unknown as { floors: Slab[]; moving: Slab; drop(): void };
    const top = g.floors[g.floors.length - 1]!;
    g.moving.x = top.x + offset;
    g.drop();
  }

  it('stacks floors, scores perfect streaks and grows the block from the third perfect', () => {
    const { game } = createGame(stackGame, { seed: 1 });
    const g = game as unknown as { floors: Slab[] };
    dropAt(game, 40);
    const narrow = g.floors[1]!.w;
    for (let i = 0; i < 3; i++) dropAt(game, 0);
    expect(g.floors[g.floors.length - 1]!.w).toBeGreaterThan(narrow);
    const r = game.getResult();
    expect(r.stats.floors).toBe(4);
    expect(r.stats.perfects).toBe(3);
    expect(r.stats.combo).toBe(3);
  });

  it('ends on a miss, unless the shield gives the block back', () => {
    for (const shield of [false, true]) {
      const { game } = createGame(stackGame, { seed: 1, boosts: shield ? ['shield'] : [] });
      dropAt(game, 2000);
      run(game, 2);
      expect(game.isOver()).toBe(!shield);
    }
  });

  it('starts five floors up with the head start', () => {
    const { game } = createGame(stackGame, { seed: 1, boosts: ['head-start'] });
    expect((game as unknown as { floors: Slab[] }).floors).toHaveLength(6);
    expect(game.getResult().score).toBe(50);
  });
});

describe('Memory Match', () => {
  it('deals each symbol exactly twice', () => {
    const cards = deal(new Rng(3), 8);
    expect(cards).toHaveLength(16);
    const counts = new Map<number, number>();
    for (const c of cards) counts.set(c.symbol, (counts.get(c.symbol) ?? 0) + 1);
    expect([...counts.values()].every((n) => n === 2)).toBe(true);
    expect(counts.size).toBe(8);
  });

  it('grows the board and the clock with the level', () => {
    expect([1, 2, 3, 4, 9].map(rowsFor)).toEqual([3, 4, 5, 6, 6]);
    expect(timeFor(12)).toBeGreaterThan(timeFor(6));
  });

  interface Peek {
    cards: Card[];
    flip(i: number): void;
    level: number;
  }

  it('keeps a matching pair up, turns a wrong pair back, and scores the match', () => {
    const { game } = createGame(memoryGame, { seed: 2 });
    const g = game as unknown as Peek;
    const first = g.cards[0]!.symbol;
    const twin = g.cards.findIndex((c, i) => i > 0 && c.symbol === first);
    g.flip(0);
    g.flip(twin);
    expect(g.cards[0]!.matched && g.cards[twin]!.matched).toBe(true);
    const a = g.cards.findIndex((c) => !c.matched);
    const b = g.cards.findIndex((c, i) => i > a && !c.matched && c.symbol !== g.cards[a]!.symbol);
    g.flip(a);
    g.flip(b);
    run(game, 1);
    expect(g.cards[a]!.up || g.cards[b]!.up).toBe(false);
    expect(game.getResult().stats.pairs).toBe(1);
    expect(game.getResult().score).toBe(50);
  });

  it('clears a board and deals the next, bigger one', () => {
    const { game } = createGame(memoryGame, { seed: 4 });
    const g = game as unknown as Peek;
    const done = new Set<number>();
    g.cards.forEach((c, i) => {
      if (done.has(i)) return;
      const twin = g.cards.findIndex((d, j) => j !== i && d.symbol === c.symbol);
      done.add(i).add(twin);
      g.flip(i);
      g.flip(twin);
    });
    run(game, 2);
    expect(g.level).toBe(2);
    expect(g.cards).toHaveLength(16);
    expect(game.getResult().stats.levels).toBe(1);
  });

  it('ends when the clock runs out, with 15 more seconds from the shield', () => {
    const plain = createGame(memoryGame, { seed: 1 }).game;
    run(plain, 60);
    expect(plain.isOver()).toBe(true);
    const shielded = createGame(memoryGame, { seed: 1, boosts: ['shield'] }).game;
    run(shielded, timeFor(6) + 2);
    expect(shielded.isOver()).toBe(false);
    run(shielded, 20);
    expect(shielded.isOver()).toBe(true);
  });
});

describe('Whack-a-Mole', () => {
  it('speeds up as the round goes on', () => {
    expect(paceAt(1).gap).toBeLessThan(paceAt(0).gap);
    expect(paceAt(1).up).toBeLessThan(paceAt(0).up);
  });

  it('rises, stays out, then sinks', () => {
    const m: Mole = { hole: 0, kind: 'mole', t: 0, up: 1, hit: false };
    expect(heightOf(m)).toBe(0);
    expect(heightOf({ ...m, t: 0.5 })).toBe(1);
    expect(heightOf({ ...m, t: 0.95 })).toBeLessThan(1);
  });

  interface Peek {
    moles: Mole[];
    whack(hole: number): void;
    timeLeft: number;
    combo: number;
  }

  it('scores whacks, pays a coin for gold, and charges time for a bomb', () => {
    const { game } = createGame(moleGame, { seed: 1 });
    const g = game as unknown as Peek;
    g.moles = [
      { hole: 0, kind: 'mole', t: 0.5, up: 2, hit: false },
      { hole: 1, kind: 'gold', t: 0.5, up: 2, hit: false },
      { hole: 2, kind: 'bomb', t: 0.5, up: 2, hit: false },
    ];
    g.whack(0);
    g.whack(1);
    expect(game.getResult().score).toBe(60);
    expect(game.getResult().coins).toBe(1);
    expect(g.combo).toBe(2);
    const before = g.timeLeft;
    g.whack(2);
    expect(g.timeLeft).toBeCloseTo(before - 5, 6);
    expect(g.combo).toBe(0);
  });

  it('the shield takes the first bomb', () => {
    const { game } = createGame(moleGame, { seed: 1, boosts: ['shield'] });
    const g = game as unknown as Peek;
    g.moles = [{ hole: 4, kind: 'bomb', t: 0.5, up: 2, hit: false }];
    const before = g.timeLeft;
    g.whack(4);
    expect(g.timeLeft).toBe(before);
  });

  it('a whack on an empty hole breaks the combo', () => {
    const { game } = createGame(moleGame, { seed: 1 });
    const g = game as unknown as Peek;
    g.moles = [{ hole: 0, kind: 'mole', t: 0.5, up: 2, hit: false }];
    g.whack(0);
    g.whack(8);
    expect(g.combo).toBe(0);
  });

  it('ends after 60 seconds, or 70 with the head start', () => {
    const plain = createGame(moleGame, { seed: 1 }).game;
    run(plain, 59);
    expect(plain.isOver()).toBe(false);
    run(plain, 4);
    expect(plain.isOver()).toBe(true);
    const boosted = createGame(moleGame, { seed: 1, boosts: ['head-start'] }).game;
    run(boosted, 65);
    expect(boosted.isOver()).toBe(false);
  });
});
