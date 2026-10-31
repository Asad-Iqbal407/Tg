import { describe, expect, it } from 'vitest';
import { chooseLogicalSize, fittedArea } from '../src/core/engine';
import { NullAudio } from '../src/core/audio';
import { Input } from '../src/core/input';
import { Rng } from '../src/core/rng';
import { bubbleGame } from '../src/games/bubble';
import { clampAim, coloursFor, comboFor, rowsFor, SHOTS_PER_DROP } from '../src/games/bubble/bubble';
import {
  type Cell,
  cellX,
  cellY,
  FLY_SPEED,
  type Flight,
  groupAt,
  type Layout,
  LINE_ROWS,
  makeLayout,
  type Row,
  shiftOf,
  stepFlight,
  traceShot,
  unanchored,
} from '../src/games/bubble/board';
import { buildBoard, designFor, SCHEMES, SHAPES } from '../src/games/bubble/patterns';
import { type BoostId, type GameInstance, type Insets, NO_INSETS, type SkinData } from '../src/games/types';
import { cornerSizes, createGame, mockCtx } from './helpers';

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

/** The aim angle that points the shooter at the centre of a cell. */
function aimAt(s: Internals, row: number, col: number): number {
  const x = cellX(s.layout, col, shiftOf(s.rows, row));
  const y = cellY(s.layout, row);
  return Math.atan2(s.layout.shooterY - y, x - s.layout.shooterX);
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
    expect(bubbleGame.touchHint).toBe('Drag to aim, let go to fire. Tap the NEXT bubble to swap.');
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

  it('plays the same depth on every screen: tall phones get no extra rows', () => {
    // Regression: the shooter line sat 19 rows down on a portrait phone but 11 on a desktop window, so the
    // same board was far easier on a phone.
    const sizes = [
      ...cornerSizes(bubbleGame),
      ...PORTRAIT_PHONES.map(([, w, h]) => chooseLogicalSize(bubbleGame, w, h - 50)),
      { width: 600, height: 880 },
    ];
    for (const { width, height } of sizes) {
      for (const inset of [0, 110]) {
        const l = makeLayout(width, height, inset);
        expect(l.lineRow, `${width}x${height}`).toBe(LINE_ROWS);
        expect(l.shooterY).toBeCloseTo(height - inset - 48, 6);
        expect(l.shooterY - cellY(l, l.lineRow)).toBeCloseTo(l.rowH, 6);
        // The ceiling never rises into the HUD band, and the press fills any height left over.
        expect(l.top).toBeGreaterThanOrEqual(l.frame - 1e-6);
        expect(l.frame).toBeGreaterThanOrEqual(Math.min(56, l.top) - 1e-6);
      }
    }
  });

  it('draws HUD text at least 12 CSS px tall on the portrait phones', () => {
    for (const [name, w, h] of PORTRAIT_PHONES) {
      const size = chooseLogicalSize(bubbleGame, w, h - 50);
      const scale = Math.min(w / size.width, (h - 50) / size.height);
      const drawn: { value: string; px: number }[] = [];
      const base = mockCtx();
      const ctx = new Proxy(base, {
        get(target, key) {
          if (key === 'fillText')
            return (value: string) =>
              drawn.push({ value, px: Number(/(\d+(?:\.\d+)?)px/.exec(String(target.font))?.[1]) });
          return Reflect.get(target, key);
        },
      });
      const game = bubbleGame.create({
        ctx,
        width: size.width,
        height: size.height,
        input: new Input(),
        audio: new NullAudio(),
        rng: new Rng(1),
        loadout: { skin: SKIN, boosts: new Set(), powerDuration: 1 },
        insets: NO_INSETS,
        reducedMotion: true,
        haptic: () => undefined,
      });
      game.render();
      for (const label of ['SCORE', 'LEVEL', 'DROP', 'NEXT']) {
        const hit = drawn.find((d) => d.value.startsWith(label));
        expect(hit, `${name} ${label}`).toBeDefined();
        expect((hit?.px ?? 0) * scale, `${name} ${label}`).toBeGreaterThanOrEqual(12);
      }
    }
  });

  it('moves the HUD beside the playfield on a wide canvas', () => {
    const wide = makeLayout(1200, 800);
    expect(wide.sideHud).toBe(true);
    expect(wide.lineRow).toBe(LINE_ROWS);
    expect(wide.left).toBeGreaterThanOrEqual(220);
    expect(makeLayout(720, 800).sideHud).toBe(false);
    const { game, input } = fresh(3, [], 1200, 800);
    step(game, input, 30);
    expect(() => game.render()).not.toThrow();
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

  it('swaps the loaded and waiting bubbles when a pop takes their colour off the grid', () => {
    const { game, input } = fresh(17);
    const s = peek(game);
    setGrid(s, [[1, 1, 0, 0, 0, 0, 0, 0, 2]]);
    s.loaded = 1;
    s.upcoming = 1;
    dragFire(game, input, 0, 2);
    settle(game, input);
    // Colour 1 is gone, so neither bubble in the shooter may still be colour 1.
    expect(game.getResult().stats['pops']).toBe(3);
    expect(s.loaded).toBe(2);
    expect(s.upcoming).toBe(2);
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

  it('a press below the shooter aims to the side of the finger, not always to the right', () => {
    for (const side of [-1, 1]) {
      const { game, input } = fresh(3);
      const s = peek(game);
      setGrid(s, [fullRow(1)]);
      s.loaded = 2;
      drag(input, s.layout.shooterX + side * 150, s.layout.shooterY + 25);
      step(game, input);
      expect(s.aim).toBeCloseTo(side < 0 ? Math.PI - MIN_AIM : MIN_AIM, 9);
      input.pointer.down = false;
      input.pointer.released = true;
      step(game, input);
      expect(s.shot).not.toBeNull();
      expect(Math.sign(s.shot?.vx ?? 0)).toBe(side);
      expect(s.shot?.vy ?? 0).toBeLessThan(0);
    }
  });

  it('a press straight below the shooter keeps the aim it had', () => {
    const { game, input } = fresh(3);
    const s = peek(game);
    const before = s.aim;
    drag(input, s.layout.shooterX, s.layout.shooterY + 30);
    step(game, input);
    expect(s.aim).toBeCloseTo(before, 9);
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

  it('a release made mid-flight fires once the shot lands, at the spot it was let go, and only once', () => {
    const { game, input } = fresh(12);
    const s = peek(game);
    setGrid(s, [fullRow(2), fullRow(3)]);
    s.loaded = 1;
    s.upcoming = 1;
    fireTap(game, input);
    step(game, input, 5);
    expect(s.shot).not.toBeNull();
    // A second drag, let go while the first shot is still flying.
    dragFire(game, input, 1, 7);
    expect(s.shot).not.toBeNull();
    expect(game.getResult().stats['shots']).toBe(1);
    settle(game, input);
    step(game, input);
    expect(game.getResult().stats['shots']).toBe(2);
    expect(Math.atan2(-(s.shot?.vy ?? 0), s.shot?.vx ?? 0)).toBeCloseTo(aimAt(s, 1, 7), 6);
    settle(game, input);
    step(game, input, 120);
    expect(game.getResult().stats['shots']).toBe(2);
  });

  it('a fire key pressed during a flight goes off once the shot lands', () => {
    const { game, input } = fresh(13);
    const s = peek(game);
    setGrid(s, [fullRow(2), fullRow(3)]);
    s.loaded = 1;
    s.upcoming = 1;
    fireTap(game, input);
    step(game, input, 5);
    fireTap(game, input);
    expect(game.getResult().stats['shots']).toBe(1);
    settle(game, input);
    step(game, input);
    expect(game.getResult().stats['shots']).toBe(2);
    settle(game, input);
    step(game, input, 120);
    expect(game.getResult().stats['shots']).toBe(2);
  });
});

describe('ceiling and shooter line', () => {
  it('the ceiling sinks one row on every sixth shot, pushing the grid down without adding bubbles', () => {
    const { game } = fresh(9);
    const s = peek(game);
    setGrid(s, [fullRow(1)]);
    const before = { ...s.layout };
    for (let shot = 1; shot <= 6; shot++) {
      // Alternating colours down row 1 never touch a same colour, so no shot pops anything.
      s.land({ row: 1, col: shot - 1 }, shot % 2 ? 2 : 3);
      if (shot < 6) {
        expect(s.layout.top).toBe(before.top);
        expect(s.sinceDrop).toBe(shot);
      }
    }
    expect(s.sinceDrop).toBe(0);
    expect(s.layout.top).toBeCloseTo(before.top + before.rowH, 9);
    expect(s.layout.lineRow).toBe(before.lineRow - 1);
    // The shooter and the danger line stay where they were; only the ceiling has come nearer.
    expect(s.layout.shooterY).toBe(before.shooterY);
    expect(cellY(s.layout, s.layout.lineRow)).toBeCloseTo(cellY(before, before.lineRow), 9);
    // Regression: a drop used to add a full row of new bubbles, so level 1 could not be cleared.
    expect(s.rows.length).toBe(2);
    const count = s.rows.reduce((n, r) => n + r.cells.filter((v) => v > 0).length, 0);
    expect(count).toBe(9 + 6);
  });

  it('a new level resets the sunken ceiling', () => {
    const { game, input } = fresh(16);
    const s = peek(game);
    const top = s.layout.top;
    setGrid(s, [[2, 2, 0, 0, 0, 0, 0, 0, 0]]);
    s.sinceDrop = SHOTS_PER_DROP - 1;
    s.land({ row: 1, col: 5 }, 4);
    expect(s.layout.top).toBeGreaterThan(top);
    s.loaded = 2;
    dragFire(game, input, 0, 2);
    settle(game, input);
    step(game, input, 130);
    expect(s.level).toBe(2);
    expect(s.layout.top).toBe(top);
    expect(s.layout.lineRow).toBe(LINE_ROWS);
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
    expect(s.rows.length).toBe(line);
    expect(s.layout.lineRow).toBe(line - 1);
    expect(s.isEnding).toBe(true);
  });
});

describe('levels', () => {
  it('starts level 1 as a full wall of 7 rows in 5 colours, painted in matching groups', () => {
    let grouped = 0;
    let total = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const s = peek(fresh(seed).game);
      expect(s.rows.length).toBe(7);
      s.rows.forEach((row, r) => {
        row.cells.forEach((k, c) => {
          expect(k).toBeGreaterThanOrEqual(1);
          expect(k).toBeLessThanOrEqual(5);
          total++;
          if (groupAt(s.rows, r, c).length >= 3) grouped++;
        });
      });
    }
    // Regression: boards used to be scattered singles and pairs, so almost no shot popped anything. Designed
    // boards keep colours together: most bubbles sit in a group a single matching shot can pop.
    expect(grouped / total).toBeGreaterThan(0.6);
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

  it('a release made during the level-clear pause fires once the next level starts', () => {
    const { game, input } = fresh(15);
    const s = peek(game);
    setGrid(s, [[2, 2, 0, 0, 0, 0, 0, 0, 0]]);
    s.loaded = 2;
    dragFire(game, input, 0, 2);
    settle(game, input);
    expect(s.clearT).toBeGreaterThan(0);
    // Drag up and let go during the pause. The shot waits for the new level, at the angle it was let go at.
    drag(input, s.layout.shooterX + 150, s.layout.shooterY - 300);
    step(game, input);
    input.pointer.down = false;
    input.pointer.released = true;
    step(game, input);
    expect(game.getResult().stats['shots']).toBe(1);
    for (let i = 0; i < 200 && !s.shot; i++) step(game, input);
    expect(s.level).toBe(2);
    expect(game.getResult().stats['shots']).toBe(2);
    expect(Math.atan2(-(s.shot?.vy ?? 0), s.shot?.vx ?? 0)).toBeCloseTo(Math.atan2(300, 150), 6);
  });

  it('a greedy player clears level 1 on most seeds (it used to be unclearable)', () => {
    /** Score of settling `colour` at `at`: a pop (and what it drops) beats a pair, which beats a single. */
    const value = (rows: Row[], at: Cell, colour: number): number => {
      const copy = rows.map((r) => ({ shift: r.shift, cells: Uint8Array.from(r.cells) }));
      while (copy.length <= at.row)
        copy.push({ shift: shiftOf(copy, copy.length), cells: new Uint8Array(9) });
      (copy[at.row] as Row).cells[at.col] = colour;
      const group = groupAt(copy, at.row, at.col);
      return group.length >= 3 ? 100 + group.length * 10 : group.length * 5 - at.row * 2;
    };
    let cleared = 0;
    for (let seed = 1; seed <= 6; seed++) {
      const { game, input } = fresh(seed);
      const s = peek(game);
      for (let shot = 0; shot < 200 && !s.isEnding && game.getResult().stats['levels'] === 0; shot++) {
        let best = -Infinity;
        let aim = Math.PI / 2;
        for (let deg = 16; deg <= 164; deg += 1) {
          const a = (deg * Math.PI) / 180;
          const at = traceShot(s.layout, s.rows, a).at;
          if (!at) continue;
          const v = value(s.rows, at, s.loaded);
          if (v > best) {
            best = v;
            aim = a;
          }
        }
        s.aim = aim;
        fireTap(game, input);
        settle(game, input);
      }
      if ((game.getResult().stats['levels'] ?? 0) > 0) cleared++;
    }
    expect(cleared).toBeGreaterThanOrEqual(4);
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

describe('designed boards', () => {
  it('hangs every bubble of every design from the ceiling, inside the colour range', () => {
    for (let level = 1; level <= SHAPES.length * SCHEMES.length; level++) {
      for (const seed of [1, 2, 3]) {
        const rows = buildBoard(new Rng(seed), level, rowsFor(level), coloursFor(level));
        expect(unanchored(rows), `level ${level}`).toEqual([]);
        expect(rows.length).toBeGreaterThan(0);
        expect(rows[0]?.cells.every((v) => v >= 1 && v <= coloursFor(level))).toBe(true);
        for (const row of rows) for (const v of row.cells) expect(v).toBeLessThanOrEqual(coloursFor(level));
        // Rows alternate their offset, starting flush.
        rows.forEach((row, i) => expect(row.shift).toBe(i % 2));
      }
    }
  });

  it('gives neighbouring levels different designs', () => {
    for (let level = 1; level < 12; level++) expect(designFor(level)).not.toEqual(designFor(level + 1));
  });

  it('swaps the loaded and the waiting bubble on X / Shift', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const { game, input } = fresh(seed);
      const s = game as unknown as { loaded: number; upcoming: number };
      if (s.loaded === s.upcoming) continue;
      const [a, b] = [s.loaded, s.upcoming];
      input.setVirtual('secondary', true, 'test');
      game.update(1 / 60);
      input.postUpdate();
      input.setVirtual('secondary', false, 'test');
      expect([s.loaded, s.upcoming]).toEqual([b, a]);
      return;
    }
    throw new Error('no seed loaded two different colours');
  });
});
