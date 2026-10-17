import { describe, expect, it } from 'vitest';
import { chooseLogicalSize, fittedArea } from '../src/core/engine';
import type { Input } from '../src/core/input';
import { Rng } from '../src/core/rng';
import { bubbleGame } from '../src/games/bubble';
import { clampAim, coloursFor, comboFor, rowsFor, SHOTS_PER_DROP } from '../src/games/bubble/bubble';
import {
  type Cell,
  cellX,
  cellY,
  FLY_SPEED,
  type Flight,
  type Layout,
  makeLayout,
  neighbours,
  type Row,
  shiftOf,
  stepFlight,
  traceShot,
} from '../src/games/bubble/board';
import { type BoostId, type GameInstance, type Insets, NO_INSETS, type SkinData } from '../src/games/types';
import { cornerSizes, createGame } from './helpers';

const DT = 1 / 60;
const MIN_AIM = (15 * Math.PI) / 180;

/** The private state the tests set up scenarios with and read results from. */
interface Internals {
  rows: Row[];
  layout: Layout;
  level: number;
  sinceDrop: number;
  aim: number;
  loaded: number;
  upcoming: number;
  shot: (Flight & { colour: number }) | null;
  clearT: number;
  shieldUsed: boolean;
  version: number;
  readonly isEnding: boolean;
  land(at: Cell | null, colour: number): void;
}

function peek(game: GameInstance): Internals {
  return game as unknown as Internals;
}

/** The run's skin is passed explicitly: the palette is empty, so every colour falls back to its default. */
const SKIN: SkinData = { id: 'classic', palette: {}, params: {} };

function fresh(seed = 1, boosts: BoostId[] = [], width?: number, height?: number, insets?: Insets) {
  return createGame(bubbleGame, { seed, boosts, width, height, insets, skin: SKIN });
}

/** One fixed simulation step, as the shell runs it. */
function step(game: GameInstance, input: Input, n = 1): void {
  for (let i = 0; i < n; i++) {
    game.update(DT);
    input.postUpdate();
  }
}

/** Replaces the grid. Row 0 is the ceiling; each row's shift alternates, as in a real run. */
function setGrid(s: Internals, rows: number[][]): void {
  s.rows = rows.map((cells, r) => ({ shift: (r % 2) as 0 | 1, cells: Uint8Array.from(cells) }));
  s.version++;
}

function fullRow(colour: number): number[] {
  return Array.from({ length: 9 }, () => colour);
}

/** `count` full rows, alternating colours 1 and 2 down the grid. */
function fullRows(count: number): number[][] {
  return Array.from({ length: count }, (_, r) => fullRow(r % 2 ? 2 : 1));
}

/** Presses and releases the fire key: one step to fire. */
function fireTap(game: GameInstance, input: Input): void {
  input.setVirtual('primary', true, 'test');
  step(game, input);
  input.setVirtual('primary', false, 'test');
}

/** Steps until the shot in flight has settled. */
function settle(game: GameInstance, input: Input, max = 600): void {
  const s = peek(game);
  for (let i = 0; i < max && s.shot; i++) step(game, input);
  expect(s.shot).toBeNull();
}

function drag(input: Input, x: number, y: number): void {
  input.pointer.x = x;
  input.pointer.y = y;
  input.pointer.down = true;
  input.pointer.active = true;
  input.pointer.inside = true;
}

/**
 * Presses on the centre of a cell, lets the aim follow for one step, then releases. The drag aims and the
 * release fires, as a finger does on the stage.
 */
function dragFire(game: GameInstance, input: Input, row: number, col: number): void {
  const s = peek(game);
  const x = cellX(s.layout, col, shiftOf(s.rows, row));
  const y = cellY(s.layout, row);
  drag(input, x, y);
  step(game, input);
  // The target must be inside the aim range, or the shot would not go where the test expects.
  expect(s.aim).toBeCloseTo(Math.atan2(s.layout.shooterY - y, x - s.layout.shooterX), 9);
  input.pointer.down = false;
  input.pointer.released = true;
  step(game, input);
}

const PORTRAIT_PHONES: [string, number, number][] = [
  ['P1', 360, 740],
  ['P2', 390, 844],
  ['P3', 430, 932],
];

describe('bubble definition', () => {
  it('is a portrait stage with the brief’s copy and a flexible size range', () => {
    expect(bubbleGame.id).toBe('bubble');
    expect(bubbleGame.title).toBe('Bubble Shooter');
    expect(bubbleGame.genre).toBe('Classic Pop');
    expect(bubbleGame.tagline).toBe('Aim, shoot and pop matching bubbles.');
    expect(bubbleGame.orientation).toBe('portrait');
    expect(bubbleGame.viewport).toEqual({ minWidth: 480, maxWidth: 720, minHeight: 800, maxHeight: 1000 });
    expect(bubbleGame.pointerArea).toBe('stage');
    expect(bubbleGame.touchButtons).toEqual([]);
    expect(bubbleGame.touchHint).toBe('Drag to aim, let go to fire.');
  });

  it('labels every stat the run reports', () => {
    const { game } = fresh(2);
    expect(Object.keys(game.getResult().stats).sort()).toEqual(Object.keys(bubbleGame.statLabels).sort());
  });
});

describe('bubble layout', () => {
  it('fills the portrait phone stages', () => {
    for (const [name, w, h] of PORTRAIT_PHONES) {
      // The play stage is the viewport less the header, as on the snake layout test.
      const size = chooseLogicalSize(bubbleGame, w, h - 50);
      const fill = fittedArea(size, w, h - 50) / (w * (h - 50));
      expect(fill, name).toBeGreaterThanOrEqual(0.85);
    }
  });

  it('keeps the shooter above a bottom inset and one row below the shooter line', () => {
    for (const [width, height] of [
      [600, 880],
      [480, 800],
      [720, 1000],
      [720, 800],
      [492, 1000],
    ] as const) {
      const l = makeLayout(width, height, 110);
      expect(l.shooterY).toBeLessThanOrEqual(height - 110 - 48 + 1e-6);
      expect(l.shooterY - cellY(l, l.lineRow)).toBeCloseTo(l.rowH, 6);
      expect(l.lineRow).toBeGreaterThanOrEqual(6);
    }
  });

  it('keeps the playfield inside the walls and centred', () => {
    const l = makeLayout(720, 800);
    expect(l.left).toBeGreaterThan(0);
    expect(l.right).toBeLessThan(720);
    expect(l.left + l.right).toBeCloseTo(720, 6);
  });
});

describe('shooting', () => {
  it('a shot that lands in a group of three pops it and returns the score', () => {
    const { game, input } = fresh(3);
    const s = peek(game);
    setGrid(s, [[2, 2, 0, 0, 0, 0, 0, 0, 3]]);
    s.loaded = 2;
    dragFire(game, input, 0, 2);
    settle(game, input);
    expect(Array.from(s.rows[0]?.cells.slice(0, 3) ?? [])).toEqual([0, 0, 0]);
    expect(s.rows[0]?.cells[8]).toBe(3);
    const r = game.getResult();
    expect(r.score).toBe(30);
    expect(r.stats['pops']).toBe(3);
    expect(r.stats['drops']).toBe(0);
    expect(r.stats['shots']).toBe(1);
  });

  it('bubbles that lose their hold on the ceiling fall away and score as drops', () => {
    const { game } = fresh(4);
    const s = peek(game);
    setGrid(s, [
      [1, 1, 0, 0, 0, 0, 0, 0, 2],
      [3, 3, 0, 0, 0, 0, 0, 0, 0],
    ]);
    s.land({ row: 0, col: 2 }, 1);
    const r = game.getResult();
    expect(r.stats['pops']).toBe(3);
    expect(r.stats['drops']).toBe(2);
    // Five bubbles removed in one shot: the x2 combo applies to the pops and the drops.
    expect(r.score).toBe((30 + 40) * 2);
    expect(r.stats['combo']).toBe(2);
    // The dropped row is empty, so it is trimmed away; a missing row reads as empty.
    expect(s.rows[1]?.cells[0] ?? 0).toBe(0);
    expect(s.rows[1]?.cells[1] ?? 0).toBe(0);
    expect(s.rows[0]?.cells[8]).toBe(2);
  });

  it('a press and drag aims, and letting go fires along that aim', () => {
    const { game, input } = fresh(5);
    const s = peek(game);
    setGrid(s, [fullRow(1)]);
    s.loaded = 2;
    // Far left, level with the shooter: the aim clamps to 15 degrees short of pointing straight left.
    drag(input, 0, s.layout.shooterY);
    step(game, input);
    expect(s.aim).toBeCloseTo(Math.PI - MIN_AIM, 9);
    input.pointer.down = false;
    input.pointer.released = true;
    step(game, input);
    expect(s.shot).not.toBeNull();
    expect(s.shot?.vx).toBeCloseTo(FLY_SPEED * Math.cos(Math.PI - MIN_AIM), 6);
    expect(game.getResult().stats['shots']).toBe(1);
  });

  it('the arrow keys aim, but never closer than 15 degrees to the horizontal', () => {
    const { game, input } = fresh(6);
    const s = peek(game);
    input.setVirtual('left', true, 'test');
    step(game, input, 240);
    expect(s.aim).toBeCloseTo(Math.PI - MIN_AIM, 9);
    input.setVirtual('left', false, 'test');
    input.setVirtual('right', true, 'test');
    step(game, input, 240);
    expect(s.aim).toBeCloseTo(MIN_AIM, 9);
    input.setVirtual('right', false, 'test');
  });

  it('clamps aim angles into the 15 to 165 degree range', () => {
    expect(clampAim(0)).toBeCloseTo(MIN_AIM, 12);
    expect(clampAim(-1)).toBeCloseTo(MIN_AIM, 12);
    expect(clampAim(Math.PI)).toBeCloseTo(Math.PI - MIN_AIM, 12);
    expect(clampAim(Math.PI / 2)).toBe(Math.PI / 2);
  });

  it('a flying bubble bounces off the side walls and stays between them', () => {
    const l = makeLayout(600, 880);
    const f: Flight = {
      x: l.shooterX,
      y: l.shooterY,
      vx: FLY_SPEED * Math.cos(MIN_AIM),
      vy: -FLY_SPEED * Math.sin(MIN_AIM),
    };
    const startVx = f.vx;
    let flipped = false;
    for (let i = 0; i < 400; i++) {
      const hit = stepFlight(l, [], f, DT);
      if (f.vx !== startVx) flipped = true;
      expect(f.x).toBeGreaterThanOrEqual(l.left + l.d / 2 - 1e-6);
      expect(f.x).toBeLessThanOrEqual(l.right - l.d / 2 + 1e-6);
      if (hit) break;
    }
    expect(flipped).toBe(true);
  });

  it('the aim preview finds where a straight-up shot would settle', () => {
    const { game } = fresh(7);
    const s = peek(game);
    setGrid(s, [fullRow(1)]);
    const trace = traceShot(s.layout, s.rows, Math.PI / 2);
    expect(trace.at).not.toBeNull();
    expect(trace.at?.row).toBe(1);
  });

  it('does not fire again while a shot is still in flight', () => {
    const { game, input } = fresh(8);
    const s = peek(game);
    setGrid(s, [fullRow(1)]);
    fireTap(game, input);
    step(game, input, 5);
    fireTap(game, input);
    expect(s.shot).not.toBeNull();
    expect(game.getResult().stats['shots']).toBe(1);
  });
});

describe('ceiling and shooter line', () => {
  it('the ceiling drops one row on every sixth shot', () => {
    const { game } = fresh(9);
    const s = peek(game);
    setGrid(s, [fullRow(1)]);
    for (let shot = 1; shot <= 6; shot++) {
      // Alternating colours down row 1 never touch a same colour, so no shot pops anything.
      s.land({ row: 1, col: shot - 1 }, shot % 2 ? 2 : 3);
      if (shot < 6) {
        expect(s.rows.length).toBe(2);
        expect(s.sinceDrop).toBe(shot);
      }
    }
    expect(s.rows.length).toBe(3);
    expect(s.sinceDrop).toBe(0);
    // The new ceiling row is a full row of colours.
    expect(s.rows[0]?.cells.every((v) => v > 0)).toBe(true);
  });

  it('a bubble that settles on the shooter line ends the run', () => {
    const { game, input } = fresh(10);
    const s = peek(game);
    setGrid(s, fullRows(s.layout.lineRow));
    s.loaded = 3;
    fireTap(game, input);
    settle(game, input);
    expect(s.isEnding).toBe(true);
    step(game, input, 120);
    expect(game.isOver()).toBe(true);
  });

  it('the shield boost clears the shooter line once instead of ending the run', () => {
    const { game, input } = fresh(10, ['shield']);
    const s = peek(game);
    setGrid(s, fullRows(s.layout.lineRow));
    s.loaded = 3;
    fireTap(game, input);
    settle(game, input);
    expect(s.isEnding).toBe(false);
    expect(s.shieldUsed).toBe(true);
    expect(s.rows.length).toBe(s.layout.lineRow);
    step(game, input, 120);
    expect(game.isOver()).toBe(false);
  });

  it('a ceiling drop that pushes the grid onto the shooter line ends the run', () => {
    const { game } = fresh(12);
    const s = peek(game);
    const line = s.layout.lineRow;
    // The grid stops one row short of the line, so the shot itself does not end the run.
    setGrid(s, fullRows(line - 1));
    s.sinceDrop = SHOTS_PER_DROP - 1;
    // A shot that pops nothing: it is the sixth since the last drop, so the ceiling sinks onto the line.
    s.land({ row: line - 1, col: 0 }, 3);
    expect(s.rows.length).toBe(line + 1);
    expect(s.isEnding).toBe(true);
  });
});

describe('levels', () => {
  it('starts level 1 with 7 full rows of 5 colours, with no two touching bubbles alike', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const s = peek(fresh(seed).game);
      expect(s.rows.length).toBe(7);
      s.rows.forEach((row, r) => {
        row.cells.forEach((k, c) => {
          expect(k).toBeGreaterThanOrEqual(1);
          expect(k).toBeLessThanOrEqual(5);
          for (const [nr, nc] of neighbours(s.rows, r, c)) {
            expect(s.rows[nr]?.cells[nc] ?? 0).not.toBe(k);
          }
        });
      });
    }
  });

  it('clearing the grid starts the next level after a short pause', () => {
    const { game, input } = fresh(11);
    const s = peek(game);
    setGrid(s, [[2, 2, 0, 0, 0, 0, 0, 0, 0]]);
    s.loaded = 2;
    dragFire(game, input, 0, 2);
    settle(game, input);
    expect(s.clearT).toBeGreaterThan(0);
    expect(s.level).toBe(1);
    expect(game.getResult().score).toBe(30 + 100);
    step(game, input, 130);
    expect(s.level).toBe(2);
    expect(s.rows.length).toBe(rowsFor(2));
    expect(game.getResult().stats['levels']).toBe(1);
  });

  it('head-start begins on level 2, with an extra row and a sixth colour', () => {
    const s = peek(fresh(1, ['head-start']).game);
    expect(s.level).toBe(2);
    expect(s.rows.length).toBe(8);
    expect(coloursFor(s.level)).toBe(6);
  });

  it('sizes levels by the rows and colours they start with', () => {
    expect(rowsFor(1)).toBe(7);
    expect(rowsFor(2)).toBe(8);
    expect(rowsFor(9)).toBe(9);
    expect(coloursFor(1)).toBe(5);
    expect(coloursFor(2)).toBe(6);
  });

  it('scores combos by how many bubbles one shot removed', () => {
    expect(comboFor(3)).toBe(1);
    expect(comboFor(4)).toBe(1);
    expect(comboFor(5)).toBe(2);
    expect(comboFor(7)).toBe(3);
    expect(comboFor(40)).toBe(5);
  });
});

describe('bubble game contract', () => {
  it('is deterministic: the same seed and the same pointer input give the same run', () => {
    const play = (seed: number) => {
      const { game, input } = fresh(seed);
      const s = peek(game);
      const pick = new Rng(seed * 7 + 1);
      for (let shot = 0; shot < 12 && !game.isOver(); shot++) {
        drag(input, pick.range(80, 520), pick.range(120, 500));
        step(game, input, 2);
        input.pointer.down = false;
        input.pointer.released = true;
        step(game, input);
        settle(game, input);
      }
      const grid = s.rows.map((r) => ({ shift: r.shift, cells: Array.from(r.cells) }));
      return { result: game.getResult(), grid };
    };
    expect(play(21)).toEqual(play(21));
  });

  it('plays the same with and without reduced motion (effects never touch gameplay RNG)', () => {
    const play = (reducedMotion: boolean) => {
      const { game, input } = createGame(bubbleGame, { seed: 31, skin: SKIN, reducedMotion });
      const s = peek(game);
      const pick = new Rng(5);
      for (let shot = 0; shot < 10 && !game.isOver(); shot++) {
        drag(input, pick.range(80, 520), pick.range(120, 500));
        step(game, input, 2);
        input.pointer.down = false;
        input.pointer.released = true;
        step(game, input);
        settle(game, input);
      }
      return { result: game.getResult(), rows: s.rows.map((r) => Array.from(r.cells)) };
    };
    expect(play(true)).toEqual(play(false));
  });

  it('survives 90 seconds of random input and reports a sane result', () => {
    for (const [seed, boosts] of [
      [1, []],
      [2, ['shield', 'head-start']],
      [3, ['shield']],
    ] as [number, BoostId[]][]) {
      const { game, input } = createGame(bubbleGame, { seed, boosts, skin: SKIN });
      const rng = new Rng(seed * 31 + 7);
      const held = new Set<'left' | 'right' | 'primary'>();
      for (let i = 0; i < 90 * 60 && !game.isOver(); i++) {
        if (i % 6 === 0) {
          for (const a of ['left', 'right', 'primary'] as const) {
            const want = rng.chance(0.25);
            if (want && !held.has(a)) {
              held.add(a);
              input.setVirtual(a, true, 'fuzz');
            } else if (!want && held.has(a)) {
              held.delete(a);
              input.setVirtual(a, false, 'fuzz');
            }
          }
          input.pointer.x = rng.range(0, bubbleGame.width);
          input.pointer.y = rng.range(0, bubbleGame.height);
          input.pointer.active = true;
          input.pointer.inside = true;
          input.pointer.down = rng.chance(0.5);
          input.pointer.released = rng.chance(0.1);
        }
        game.update(DT);
        input.postUpdate();
        if (i % 30 === 0) game.render();
      }
      game.render();
      const r = game.getResult();
      expect(Number.isFinite(r.score)).toBe(true);
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.stats['shots']).toBeGreaterThan(0);
      for (const v of Object.values(r.stats)) expect(v).toBeGreaterThanOrEqual(0);
      game.destroy();
    }
  });

  it('renders at every corner of its viewport range, with and without a bottom inset', () => {
    const sizes = [...cornerSizes(bubbleGame), { width: 600, height: 880 }];
    const insets: Insets[] = [NO_INSETS, { top: 0, right: 0, bottom: 110, left: 0 }];
    for (const size of sizes) {
      for (const inset of insets) {
        const { game, input } = createGame(bubbleGame, {
          seed: 4,
          width: size.width,
          height: size.height,
          insets: inset,
          skin: SKIN,
        });
        for (let i = 0; i < 120; i++) {
          game.update(DT);
          input.postUpdate();
        }
        expect(() => game.render()).not.toThrow();
      }
    }
  });
});
