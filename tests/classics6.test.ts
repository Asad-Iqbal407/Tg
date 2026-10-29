import { describe, expect, it } from 'vitest';
import { golfGame } from '../src/games/golf';
import { bounceOff, HOLES, inRect } from '../src/games/golf/course';
import { holePoints } from '../src/games/golf/golf';
import { hoopsGame } from '../src/games/hoops';
import { shotTo } from '../src/games/hoops/hoops';
import { mazeGame } from '../src/games/maze';
import { COLS, MAP, open, ROWS } from '../src/games/maze/map';
import { ghostTarget } from '../src/games/maze/maze';
import type { GameInstance } from '../src/games/types';
import { createGame } from './helpers';

const DT = 1 / 60;

function run(game: GameInstance, seconds: number): void {
  for (let i = 0; i < seconds * 60 && !game.isOver(); i++) game.update(DT);
}

describe('Maze Chase map', () => {
  it('is 15 x 17 with every dot reachable and no dead ends', () => {
    expect(MAP).toHaveLength(ROWS);
    for (const row of MAP) expect(row).toHaveLength(COLS);
    const start = MAP.findIndex((r) => r.includes('P'));
    const seen = new Set<number>([start * COLS + (MAP[start] ?? '').indexOf('P')]);
    const queue = [...seen];
    while (queue.length > 0) {
      const k = queue.pop() as number;
      const c = k % COLS;
      const r = Math.floor(k / COLS);
      for (const [dc, dr] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        const nc = (c + dc + COLS) % COLS;
        const nr = r + dr;
        if (nr < 0 || nr >= ROWS || !open(nc, nr)) continue;
        const nk = nr * COLS + nc;
        if (!seen.has(nk)) {
          seen.add(nk);
          queue.push(nk);
        }
      }
    }
    MAP.forEach((row, r) =>
      [...row].forEach((ch, c) => {
        if (ch === '.' || ch === 'o') expect(seen.has(r * COLS + c), `${c},${r}`).toBe(true);
        if (open(c, r)) {
          const exits = [
            [1, 0],
            [-1, 0],
            [0, 1],
            [0, -1],
          ].filter(([dc, dr]) => open(c + (dc as number), r + (dr as number))).length;
          expect(exits, `dead end at ${c},${r}`).toBeGreaterThanOrEqual(2);
        }
      }),
    );
  });

  it('gives each ghost its own target', () => {
    const player = { c: 7, r: 14, dir: 'up' as const };
    expect(ghostTarget(0, player, false, () => 0)).toEqual([7, 14]);
    expect(ghostTarget(1, player, false, () => 0)).toEqual([7, 11]);
    expect(ghostTarget(0, player, true, () => 0)).not.toEqual([7, 14]);
  });
});

describe('Maze Chase game', () => {
  interface Peek {
    dots: Set<number>;
    power: Set<number>;
    lives: number;
    level: number;
    frightT: number;
    readyT: number;
    player: { c: number; r: number; p: number };
    ghosts: { c: number; r: number; p: number; out: boolean; wait: number }[];
    eat(): void;
    collide(): void;
  }

  it('eats dots and power pellets; a power pellet frightens the ghosts', () => {
    const { game } = createGame(mazeGame, { seed: 1 });
    const g = game as unknown as Peek;
    const k = [...g.dots][0] as number;
    Object.assign(g.player, { c: k % COLS, r: Math.floor(k / COLS), p: 0 });
    g.eat();
    expect(g.dots.has(k)).toBe(false);
    const pk = [...g.power][0] as number;
    Object.assign(g.player, { c: pk % COLS, r: Math.floor(pk / COLS), p: 0 });
    g.eat();
    expect(g.frightT).toBeGreaterThan(0);
    expect(game.getResult().score).toBe(60);
  });

  it('a ghost costs a life, but a frightened one is eaten', () => {
    const { game } = createGame(mazeGame, { seed: 1 });
    const g = game as unknown as Peek;
    const ghost = g.ghosts[0]!;
    Object.assign(ghost, { c: g.player.c, r: g.player.r, p: 0, out: true, wait: 0 });
    g.frightT = 3;
    g.collide();
    expect(g.lives).toBe(3);
    expect(game.getResult().stats.ghosts).toBe(1);
    g.frightT = 0;
    Object.assign(g.ghosts[1]!, { c: g.player.c, r: g.player.r, p: 0, out: true, wait: 0 });
    g.collide();
    expect(g.lives).toBe(2);
  });

  it('clears a maze when the last dot is eaten and starts the next level', () => {
    const { game } = createGame(mazeGame, { seed: 1 });
    const g = game as unknown as Peek;
    const k = [...g.dots][0] as number;
    g.dots = new Set([k]);
    g.power.clear();
    Object.assign(g.player, { c: k % COLS, r: Math.floor(k / COLS), p: 0 });
    g.eat();
    run(game, 2.5);
    expect(g.level).toBe(2);
    expect(g.dots.size).toBeGreaterThan(100);
  });

  it('ends after the last life', () => {
    const { game } = createGame(mazeGame, { seed: 1 });
    const g = game as unknown as Peek;
    g.lives = 1;
    Object.assign(g.ghosts[0]!, { c: g.player.c, r: g.player.r, p: 0, out: true, wait: 0 });
    g.collide();
    run(game, 3);
    expect(game.isOver()).toBe(true);
  });
});

describe('Mini Golf course', () => {
  it('scores strokes against par, with a bonus for a hole in one', () => {
    expect(holePoints(3, 3)).toBe(300);
    expect(holePoints(1, 3)).toBe(500 + 500);
    expect(holePoints(9, 3)).toBe(0);
  });

  it('puts every tee and cup on the green, clear of water', () => {
    const inside = (poly: readonly (readonly [number, number])[], x: number, y: number) => {
      let c = false;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const [xi, yi] = poly[i] as readonly [number, number];
        const [xj, yj] = poly[j] as readonly [number, number];
        if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
      }
      return c;
    };
    for (const h of HOLES) {
      for (const p of [h.tee, h.cup]) {
        expect(inside(h.outline, p[0], p[1]), h.name).toBe(true);
        expect(
          h.water.some((r) => inRect(r, p[0], p[1])),
          h.name,
        ).toBe(false);
      }
    }
  });

  it('bounces a ball off a wall', () => {
    const hit = bounceOff(0.5, 0.01, 0, -1, 0.02, [0, 0], [1, 0], 1);
    expect(hit?.vy).toBeCloseTo(1);
    expect(bounceOff(0.5, 0.5, 0, -1, 0.02, [0, 0], [1, 0], 1)).toBeNull();
  });
});

describe('Mini Golf game', () => {
  interface Peek {
    x: number;
    y: number;
    holeIndex: number;
    strokes: number;
    putt(angle: number, power: number): void;
    moving(): boolean;
  }

  it('a straight putt sinks on the first hole and moves on to the second', () => {
    const { game } = createGame(golfGame, { seed: 1 });
    const g = game as unknown as Peek;
    g.putt(-Math.PI / 2, 0.75);
    run(game, 6);
    expect(g.holeIndex).toBe(1);
    const r = game.getResult();
    expect(r.stats.holes).toBe(1);
    expect(r.stats.aces).toBe(1);
  });

  it('water adds a stroke and puts the ball back, but the shield waives the first', () => {
    for (const shield of [false, true]) {
      const { game } = createGame(golfGame, { seed: 1, boosts: shield ? ['shield'] : [] });
      const g = game as unknown as Peek & { startHole(i: number): void };
      g.startHole(4);
      const [tx, ty] = [g.x, g.y];
      // Straight at the left pond.
      g.putt(Math.atan2(0.7 - ty, 0.25 - tx), 0.7);
      run(game, 4);
      expect(g.strokes).toBe(shield ? 1 : 2);
      expect([g.x, g.y]).toEqual([tx, ty]);
    }
  });

  it('ends after the ninth hole', () => {
    const { game } = createGame(golfGame, { seed: 1 });
    const g = game as unknown as Peek & { startHole(i: number): void; finishHole(n: number): void };
    g.startHole(8);
    g.finishHole(4);
    run(game, 3);
    expect(game.isOver()).toBe(true);
  });
});

describe('Hoops', () => {
  interface Peek {
    restX: number;
    restY(): number;
    hoop(): [number, number];
    launch(vx: number, vy: number): void;
    timeLeft: number;
    streak: number;
    ball: unknown;
  }

  /** Shoots a perfect shot at the hoop and lets it land. */
  function swish(game: GameInstance): void {
    const g = game as unknown as Peek & { u: number };
    const [hx, hy] = g.hoop();
    const v = shotTo(g.restX, g.restY(), hx, hy, 140 * g.u, 1900 * g.u);
    g.launch(v.vx, v.vy);
    for (let i = 0; i < 60 * 4 && g.ball; i++) game.update(DT);
  }

  it('a perfect shot is a swish: points, a streak and two extra seconds', () => {
    const { game } = createGame(hoopsGame, { seed: 1 });
    const g = game as unknown as Peek;
    const before = g.timeLeft;
    swish(game);
    const r = game.getResult();
    expect(r.stats.baskets).toBe(1);
    expect(r.stats.swishes).toBe(1);
    expect(g.streak).toBe(1);
    expect(g.timeLeft).toBeGreaterThan(before - 4 + 1.5);
  });

  it('streaks multiply the points, and a miss resets the streak', () => {
    const { game } = createGame(hoopsGame, { seed: 2 });
    const g = game as unknown as Peek;
    for (let i = 0; i < 4; i++) swish(game);
    expect(g.streak).toBe(4);
    // Four swishes at 15 each; the third and fourth are in a streak of three or more, at x2.
    expect(game.getResult().score).toBe(15 + 15 + 30 + 30);
    g.launch(0, -300);
    for (let i = 0; i < 60 * 4 && g.ball; i++) game.update(DT);
    expect(g.streak).toBe(0);
  });

  it('ends when the clock runs out, ten seconds later with the shield', () => {
    const plain = createGame(hoopsGame, { seed: 1 }).game;
    run(plain, 47);
    expect(plain.isOver()).toBe(true);
    const shielded = createGame(hoopsGame, { seed: 1, boosts: ['shield'] }).game;
    run(shielded, 50);
    expect(shielded.isOver()).toBe(false);
  });
});
