import { describe, expect, it } from 'vitest';
import { type Action, Input, type PointerState, type SwipeDir } from '../src/core/input';
import { NullAudio } from '../src/core/audio';
import { Rng } from '../src/core/rng';
import { Board, COLS, HIDDEN_ROWS, ROWS } from '../src/games/tetris/board';
import { layoutTetris } from '../src/games/tetris/draw';
import { cellsOf, type Kind, kickTests, type Piece, PieceQueue, type Rot } from '../src/games/tetris/pieces';
import { levelFor, secondsPerRow } from '../src/games/tetris/tetris';
import { TouchDrop } from '../src/games/tetris/touch';
import { tetrisGame } from '../src/games/tetris';
import { type BoostId, type GameInstance, type GameResult, NO_INSETS } from '../src/games/types';
import { defaultSkin, toSkinData } from '../src/meta/catalog';
import { cornerSizes, createGame, mockCtx } from './helpers';

const DT = 1 / 60;
const ACTIONS: Action[] = ['left', 'right', 'up', 'down', 'primary', 'secondary'];
const SWIPES: SwipeDir[] = ['left', 'right', 'up', 'down'];
/** Touch controls cover this much of the bottom of the canvas in these tests. */
const TOUCH_BOTTOM = 110;

/** The private state the tests set up and read. */
interface Internals {
  board: Board;
  active: Piece;
  hold: Kind | null;
  holdLocked: boolean;
  level: number;
  shieldUsed: boolean;
  queue: PieceQueue;
}

function peek(game: GameInstance): Internals {
  return game as unknown as Internals;
}

function start(seed = 1, boosts: BoostId[] = []) {
  return createGame(tetrisGame, { seed, boosts });
}

/** One fixed simulation step, as the shell runs it. */
function step(game: GameInstance, input: Input, n = 1): void {
  for (let i = 0; i < n; i++) {
    game.update(DT);
    input.postUpdate();
  }
}

/** A key tap: pressed and released within one step. */
function tap(game: GameInstance, input: Input, action: Action): void {
  input.setVirtual(action, true, 'test');
  step(game, input);
  input.setVirtual(action, false, 'test');
}

/**
 * A finger on the well, as the shell reports it in the step: `press` when it goes down, `lift` when it comes up,
 * otherwise `move` (still down, possibly moving).
 */
function finger(input: Input, x: number, y: number, edge: 'press' | 'move' | 'lift', touch: boolean): void {
  const p = input.pointer;
  p.x = x;
  p.y = y;
  p.inside = true;
  p.active = true;
  p.touch = touch;
  p.pressed = edge === 'press';
  p.released = edge === 'lift';
  p.down = edge !== 'lift';
}

/** Puts a finger down at (x, y) and runs one step. */
function press(game: GameInstance, input: Input, x: number, y: number, touch = true): void {
  finger(input, x, y, 'press', touch);
  step(game, input);
}

/** Drags the finger in a straight line to (x, y) over `sec` seconds, one step per frame. */
function dragTo(game: GameInstance, input: Input, x: number, y: number, sec: number): void {
  const { x: x0, y: y0, touch } = input.pointer;
  const frames = Math.max(1, Math.round(sec / DT));
  for (let i = 1; i <= frames; i++) {
    finger(input, x0 + ((x - x0) * i) / frames, y0 + ((y - y0) * i) / frames, 'move', touch);
    step(game, input);
  }
}

/** Keeps the finger still for `sec` seconds. */
function holdFinger(game: GameInstance, input: Input, sec: number): void {
  const { x, y, touch } = input.pointer;
  for (let i = 0; i < Math.round(sec / DT); i++) {
    finger(input, x, y, 'move', touch);
    step(game, input);
  }
}

function liftFinger(game: GameInstance, input: Input): void {
  const { x, y, touch } = input.pointer;
  finger(input, x, y, 'lift', touch);
  step(game, input);
}

function setActive(game: GameInstance, kind: Kind, rot: Rot, x: number, y: number): void {
  peek(game).active = { kind, rot, x, y };
}

/**
 * Fills the bottom of the well from text: '#' is a locked block and '.' is empty. The last string is the
 * bottom row. Rows are drawn in the visible well (row 2 is the top visible row).
 */
function setStack(game: GameInstance, rows: readonly string[]): void {
  const { board } = peek(game);
  board.cells.fill(0);
  rows.forEach((row, i) => {
    const y = ROWS - rows.length + i;
    for (let x = 0; x < COLS; x++) if (row[x] === '#') board.cells[y * COLS + x] = 1;
  });
}

function statsOf(game: GameInstance): GameResult['stats'] {
  return game.getResult().stats;
}

/** A random but seeded session, with taps, held keys, swipes and renders. */
function play(seed: number, steps: number): { result: GameResult; cells: number[] } {
  const { game, input } = start(seed);
  const rng = new Rng(seed * 17 + 3);
  for (let i = 0; i < steps && !game.isOver(); i++) {
    if (i % 90 === 0) input.setVirtual('down', true, 'fuzz');
    if (i % 90 === 30) input.setVirtual('down', false, 'fuzz');
    if (i % 70 === 10) input.setVirtual('left', true, 'fuzz');
    if (i % 70 === 40) input.setVirtual('left', false, 'fuzz');
    const a = rng.pick(ACTIONS);
    if (rng.chance(0.3)) {
      input.setVirtual(a, true, 'fuzz');
      input.setVirtual(a, false, 'fuzz');
    }
    if (rng.chance(0.05)) input.pushSwipe(rng.pick(SWIPES));
    game.update(DT);
    input.postUpdate();
    if (i % 30 === 0) game.render();
  }
  game.render();
  const result = game.getResult();
  game.destroy();
  return { result, cells: Array.from(peek(game).board.cells) };
}

describe('determinism', () => {
  it('gives identical results and boards for the same seed and inputs', () => {
    const a = play(7, 4000);
    const b = play(7, 4000);
    expect(a.result).toEqual(b.result);
    expect(a.cells).toEqual(b.cells);
    expect(a.result.stats.pieces).toBeGreaterThan(10);
  });

  it('plays differently with another seed', () => {
    expect(play(7, 4000).cells).not.toEqual(play(8, 4000).cells);
  });
});

describe('piece queue', () => {
  it('deals every shape exactly once in each seven-piece bag', () => {
    const q = new PieceQueue(new Rng(99));
    for (let bag = 0; bag < 30; bag++) {
      const seen = new Set<Kind>();
      for (let i = 0; i < 7; i++) seen.add(q.next());
      expect(seen.size).toBe(7);
    }
  });

  it('shows the pieces that are dealt next', () => {
    const q = new PieceQueue(new Rng(5));
    for (let i = 0; i < 20; i++) {
      const preview = [q.peek(0), q.peek(1), q.peek(2)];
      expect(q.next()).toBe(preview[0]);
    }
  });
});

describe('rotation', () => {
  it('uses the standard SRS shapes for each state', () => {
    const cells = (kind: Kind, rot: Rot) =>
      cellsOf(kind, rot)
        .map((c) => `${c.x},${c.y}`)
        .sort();
    // T pointing right: a vertical bar with a nub on the right.
    expect(cells('T', 1)).toEqual(['1,0', '1,1', '1,2', '2,1'].sort());
    // I standing up in column 2 of its box.
    expect(cells('I', 1)).toEqual(['2,0', '2,1', '2,2', '2,3']);
    // Every shape has four cells in every state.
    for (const kind of ['I', 'O', 'T', 'S', 'Z', 'J', 'L'] as const) {
      for (const rot of [0, 1, 2, 3] as const) expect(cellsOf(kind, rot)).toHaveLength(4);
    }
  });

  it('has the standard wall-kick tests', () => {
    expect(kickTests('T', 0, 1)).toEqual([
      [0, 0],
      [-1, 0],
      [-1, 1],
      [0, -2],
      [-1, -2],
    ]);
    expect(kickTests('I', 1, 2)).toEqual([
      [0, 0],
      [-1, 0],
      [2, 0],
      [-1, 2],
      [2, -1],
    ]);
    expect(kickTests('O', 0, 1)).toEqual([[0, 0]]);
  });

  it('lets an I piece turn against the left wall by kicking inwards', () => {
    const { game, input } = start(1);
    // Standing against the wall: its column is column 0, so the half turn needs a kick to fit.
    setActive(game, 'I', 1, -2, 5);
    expect(peek(game).board.fitsAt('I', 2, -2, 5)).toBe(false);
    tap(game, input, 'up');
    expect(peek(game).active.rot).toBe(2);
    expect(peek(game).active.x).toBe(0);
  });

  it('lets a T piece turn against the left wall by kicking inwards', () => {
    const { game, input } = start(1);
    setActive(game, 'T', 1, -1, 5);
    expect(peek(game).board.fitsAt('T', 2, -1, 5)).toBe(false);
    tap(game, input, 'up');
    expect(peek(game).active.rot).toBe(2);
    expect(peek(game).active.x).toBe(0);
  });

  it('turns a piece with the up key and with an upward swipe', () => {
    const { game, input } = start(2);
    setActive(game, 'T', 0, 3, 0);
    tap(game, input, 'up');
    expect(peek(game).active.rot).toBe(1);
    input.pushSwipe('up');
    step(game, input);
    expect(peek(game).active.rot).toBe(2);
  });
});

describe('line clears and scoring', () => {
  it('clears a full line and scores 100 at level 1', () => {
    const { game, input } = start(3);
    setStack(game, ['....######']);
    setActive(game, 'I', 0, 0, 20);
    tap(game, input, 'primary');
    const r = game.getResult();
    expect(r.score).toBe(100);
    expect(r.coins).toBe(1);
    expect(r.stats.lines).toBe(1);
    expect(
      peek(game)
        .board.cells.slice((ROWS - 1) * COLS, ROWS * COLS)
        .every((c) => c === 0),
    ).toBe(true);
  });

  it('counts a four-line clear as a tetris worth 800', () => {
    const { game, input } = start(4);
    setStack(game, ['#########.', '#########.', '#########.', '#########.']);
    setActive(game, 'I', 1, 7, 18);
    tap(game, input, 'primary');
    const r = game.getResult();
    expect(r.score).toBe(800);
    expect(r.coins).toBe(4 + 3);
    expect(r.stats.tetrises).toBe(1);
    expect(r.stats.lines).toBe(4);
  });

  it('multiplies line points by the level at the time of the clear', () => {
    const { game, input } = start(3, ['head-start']);
    expect(peek(game).level).toBe(3);
    setStack(game, ['....######']);
    setActive(game, 'I', 0, 0, 20);
    tap(game, input, 'primary');
    expect(game.getResult().score).toBe(300);
  });

  it('scores 2 points per row on a hard drop', () => {
    const { game, input } = start(5);
    setActive(game, 'T', 0, 3, 0);
    tap(game, input, 'primary');
    // The T's bottom row lands on the floor 20 rows down.
    expect(game.getResult().score).toBe(40);
    expect(statsOf(game).pieces).toBe(1);
  });

  it('scores 1 point per row of soft drop, at 20 rows a second', () => {
    const { game, input } = start(6);
    setActive(game, 'T', 0, 3, 0);
    input.setVirtual('down', true, 'test');
    step(game, input, 30);
    const { active } = peek(game);
    expect(active.y).toBeGreaterThanOrEqual(9);
    expect(active.y).toBeLessThanOrEqual(11);
    expect(game.getResult().score).toBe(active.y);
  });

  it('falls one row a second under gravity without scoring', () => {
    const { game, input } = start(6);
    setActive(game, 'T', 0, 3, 0);
    step(game, input, 61);
    expect(peek(game).active.y).toBe(1);
    expect(game.getResult().score).toBe(0);
  });
});

describe('stats', () => {
  it('reports lines, tetrises, pieces and level with their exact meanings', () => {
    const { game, input } = start(7);
    expect(statsOf(game)).toEqual({ lines: 0, tetrises: 0, pieces: 0, level: 1 });
    setStack(game, ['....######']);
    setActive(game, 'I', 0, 0, 20);
    tap(game, input, 'primary');
    expect(statsOf(game)).toEqual({ lines: 1, tetrises: 0, pieces: 1, level: 1 });
    setStack(game, ['#########.', '#########.', '#########.', '#########.']);
    setActive(game, 'I', 1, 7, 18);
    tap(game, input, 'primary');
    expect(statsOf(game)).toEqual({ lines: 5, tetrises: 1, pieces: 2, level: 1 });
  });

  it('counts the level from the Power Start boost', () => {
    const { game } = start(8, ['head-start']);
    expect(statsOf(game).level).toBe(3);
  });
});

describe('lock delay', () => {
  it('locks a grounded piece half a second after it lands', () => {
    const { game, input } = start(9);
    setActive(game, 'T', 0, 3, 20);
    step(game, input, 28);
    expect(statsOf(game).pieces).toBe(0);
    step(game, input, 5);
    expect(statsOf(game).pieces).toBe(1);
  });

  it('gives time to slide, because a move restarts the lock timer', () => {
    const { game, input } = start(4);
    setActive(game, 'T', 0, 3, 20);
    step(game, input, 24);
    tap(game, input, 'left');
    step(game, input, 24);
    expect(statsOf(game).pieces).toBe(0);
    step(game, input, 12);
    expect(statsOf(game).pieces).toBe(1);
  });
});

describe('hold', () => {
  it('swaps with the hold slot once per drop', () => {
    const { game, input } = start(10);
    const s = peek(game);
    const first = s.active.kind;
    tap(game, input, 'secondary');
    expect(s.hold).toBe(first);
    const second = s.active.kind;
    tap(game, input, 'secondary');
    expect(s.active.kind).toBe(second);
    expect(s.hold).toBe(first);
    tap(game, input, 'primary');
    expect(s.holdLocked).toBe(false);
    tap(game, input, 'secondary');
    expect(s.active.kind).toBe(first);
  });
});

describe('top-out and the Guardian boost', () => {
  /** Rows 2..21 are filled except the far right column, so a piece spawned at the top cannot come down. */
  function blockSpawn(game: GameInstance): void {
    setStack(
      game,
      Array.from({ length: ROWS - HIDDEN_ROWS }, () => '#########.'),
    );
    setActive(game, 'T', 0, 3, 0);
  }

  it('ends the run when a piece locks into the buffer rows', () => {
    const { game, input } = start(2);
    blockSpawn(game);
    step(game, input, 30);
    expect(game.isOver()).toBe(false);
    step(game, input, 120);
    expect(game.isOver()).toBe(true);
  });

  it('lets the Guardian absorb the first top-out and clears the highest rows', () => {
    const { game, input } = start(2, ['shield']);
    blockSpawn(game);
    step(game, input, 150);
    expect(game.isOver()).toBe(false);
    expect(peek(game).shieldUsed).toBe(true);
    const buffer = peek(game).board.cells.slice(0, HIDDEN_ROWS * COLS);
    expect(buffer.every((c) => c === 0)).toBe(true);
    blockSpawn(game);
    step(game, input, 150);
    expect(game.isOver()).toBe(true);
  });
});

describe('ghost', () => {
  it('lands on the first row where the piece cannot fall further', () => {
    const board = new Board();
    for (let x = 3; x <= 5; x++) board.cells[15 * COLS + x] = 1;
    const p: Piece = { kind: 'T', rot: 0, x: 3, y: 0 };
    const d = board.dropDistance(p);
    expect(d).toBe(13);
    expect(board.fits({ ...p, y: p.y + d })).toBe(true);
    expect(board.fits({ ...p, y: p.y + d + 1 })).toBe(false);
  });
});

describe('controls', () => {
  it('moves one column per tap and auto-repeats a held key after 0.17 s, then every 0.05 s', () => {
    const { game, input } = start(11);
    setActive(game, 'T', 0, 3, 0);
    const x = () => peek(game).active.x;
    input.setVirtual('right', true, 'test');
    step(game, input);
    expect(x()).toBe(4);
    step(game, input, 10);
    expect(x()).toBe(4);
    step(game, input);
    expect(x()).toBe(5);
    step(game, input, 2);
    expect(x()).toBe(5);
    step(game, input);
    expect(x()).toBe(6);
  });

  it('steers with swipes, and a down swipe on its own is not a drop', () => {
    const { game, input } = start(12);
    setActive(game, 'T', 0, 3, 0);
    input.pushSwipe('left');
    step(game, input);
    expect(peek(game).active.x).toBe(2);
    input.pushSwipe('down');
    step(game, input);
    expect(statsOf(game).pieces).toBe(0);
    expect(peek(game).active.y).toBeLessThanOrEqual(1);
  });
});

describe('touch drops', () => {
  it('hard drops on a quick flick down, like the hard drop key', () => {
    const { game, input } = start(13);
    setActive(game, 'T', 0, 3, 0);
    const rows = peek(game).board.dropDistance(peek(game).active);
    press(game, input, 100, 300);
    dragTo(game, input, 100, 420, 0.12);
    liftFinger(game, input);
    expect(statsOf(game).pieces).toBe(1);
    expect(game.getResult().score).toBe(2 * rows);
  });

  it('reads a short downward drag as nothing, so a drift no longer drops the piece', () => {
    const { game, input } = start(14);
    setActive(game, 'J', 0, 3, 0);
    press(game, input, 100, 300);
    input.pushSwipe('down'); // the shell reports a 30 px drag as a down swipe
    dragTo(game, input, 100, 330, 0.3);
    liftFinger(game, input);
    expect(statsOf(game).pieces).toBe(0);
    expect(game.getResult().score).toBe(0);
    expect(peek(game).active.y).toBeLessThanOrEqual(1);
  });

  it('soft drops while a slow drag is held below where it began, and stops when the finger lifts', () => {
    const { game, input } = start(15);
    setActive(game, 'T', 0, 3, 0);
    press(game, input, 100, 300);
    dragTo(game, input, 100, 380, 0.5);
    holdFinger(game, input, 0.5);
    const held = peek(game).active.y;
    expect(held).toBeGreaterThanOrEqual(8);
    expect(game.getResult().score).toBe(held);
    expect(statsOf(game).pieces).toBe(0);
    liftFinger(game, input);
    step(game, input, 30);
    expect(peek(game).active.y).toBeLessThanOrEqual(held + 1);
  });

  it('drops once per touch: a finger still down after a flick does not drop or soft drop the next piece', () => {
    const { game, input } = start(16);
    setActive(game, 'T', 0, 3, 0);
    press(game, input, 100, 300);
    dragTo(game, input, 100, 420, 0.12);
    expect(statsOf(game).pieces).toBe(1);
    dragTo(game, input, 100, 520, 0.4);
    expect(statsOf(game).pieces).toBe(1);
    expect(peek(game).active.y).toBeLessThanOrEqual(1);
    liftFinger(game, input);
    press(game, input, 100, 300);
    dragTo(game, input, 100, 420, 0.12);
    expect(statsOf(game).pieces).toBe(2);
  });

  it('ignores mouse drags, which keep the keyboard and the mouse controls', () => {
    const { game, input } = start(17);
    setActive(game, 'T', 0, 3, 0);
    press(game, input, 100, 300, false);
    dragTo(game, input, 100, 500, 0.2);
    holdFinger(game, input, 0.5);
    liftFinger(game, input);
    expect(statsOf(game).pieces).toBe(0);
    expect(peek(game).active.y).toBeLessThanOrEqual(1);
  });

  it('ignores sideways drags, which only steer through swipes', () => {
    const { game, input } = start(18);
    setActive(game, 'T', 0, 3, 0);
    press(game, input, 100, 300);
    dragTo(game, input, 260, 360, 0.4);
    liftFinger(game, input);
    expect(statsOf(game).pieces).toBe(0);
    expect(peek(game).active.y).toBeLessThanOrEqual(1);
    expect(peek(game).active.x).toBe(3);
  });
});

describe('touch drop reader', () => {
  const at = (x: number, y: number, extra: Partial<PointerState> = {}): PointerState => ({
    x,
    y,
    down: true,
    pressed: false,
    released: false,
    touch: true,
    active: true,
    inside: true,
    ...extra,
  });

  it('scales the flick distance with the well height', () => {
    // 80 logical px is a flick on a 960-high well (77 px needed) but not on a 1100-high one (88 px needed).
    const short = new TouchDrop(960);
    short.update(at(100, 300, { pressed: true }), 0);
    expect(short.update(at(100, 380), 0.1)).toBe('hard');
    const tall = new TouchDrop(1100);
    tall.update(at(100, 300, { pressed: true }), 0);
    expect(tall.update(at(100, 380), 0.1)).toBe('none');
    expect(tall.update(at(100, 380), 0.4)).toBe('soft');
  });

  it('needs the flick to be fast: the same distance taken slowly is a soft drag', () => {
    const reader = new TouchDrop(960);
    reader.update(at(100, 300, { pressed: true }), 0);
    expect(reader.update(at(100, 396), 0.6)).toBe('soft');
  });

  it('waits for the flick window to close before a held drag soft drops, so a flick never soft drops first', () => {
    const reader = new TouchDrop(960);
    reader.update(at(100, 300, { pressed: true }), 0);
    expect(reader.update(at(100, 360), 0.1)).toBe('none');
    expect(reader.update(at(100, 360), 0.25)).toBe('none');
    expect(reader.update(at(100, 360), 0.35)).toBe('soft');
  });

  it('starts nothing when a touch lifts, or when a second finger takes over the pointer', () => {
    const reader = new TouchDrop(960);
    reader.update(at(100, 300, { pressed: true }), 0);
    expect(reader.update(at(100, 400, { released: true, down: true }), 0.1)).toBe('none');
    expect(reader.update(at(100, 500), 0.2)).toBe('none');
  });
});

describe('level and gravity', () => {
  it('raises the level every ten lines, up to 15', () => {
    expect(levelFor(0)).toBe(1);
    expect(levelFor(9)).toBe(1);
    expect(levelFor(10)).toBe(2);
    expect(levelFor(149)).toBe(15);
    expect(levelFor(1000)).toBe(15);
    expect(levelFor(0, 3)).toBe(3);
  });

  it('speeds gravity up with the level, never faster than 0.02 s a row', () => {
    expect(secondsPerRow(1)).toBe(1);
    expect(secondsPerRow(2)).toBeCloseTo(0.793, 3);
    expect(secondsPerRow(15)).toBe(0.02);
    for (let level = 2; level <= 15; level++)
      expect(secondsPerRow(level)).toBeLessThanOrEqual(secondsPerRow(level - 1));
  });
});

describe('layout and rendering', () => {
  it('keeps the well above the touch controls and inside the margins at every size', () => {
    const sizes = [{ width: tetrisGame.width, height: tetrisGame.height }, ...cornerSizes(tetrisGame)];
    for (const { width, height } of sizes) {
      const { well, panel } = layoutTetris(width, height, TOUCH_BOTTOM, true);
      expect(well.x).toBeGreaterThanOrEqual(16);
      expect(well.y).toBeGreaterThanOrEqual(16);
      expect(well.y + ROWS * well.cell).toBeLessThanOrEqual(height - 16 - TOUCH_BOTTOM);
      expect(well.x + COLS * well.cell).toBeLessThanOrEqual(width - 16);
      expect(panel).not.toBeNull();
      if (!panel) continue;
      expect(panel.side).toBe(true);
      expect(panel.x).toBeGreaterThanOrEqual(well.x + COLS * well.cell);
      expect(panel.x + panel.w).toBeLessThanOrEqual(width - 16);
      expect(panel.y + panel.h).toBeLessThanOrEqual(height - 16 - TOUCH_BOTTOM);
    }
  });

  it('puts the panel above the well when the width is too small beside it', () => {
    const { well, panel } = layoutTetris(360, 900, TOUCH_BOTTOM, true);
    expect(panel?.side).toBe(false);
    expect(panel ? panel.y + panel.h : 0).toBeLessThanOrEqual(well.y);
    expect(well.x + COLS * well.cell).toBeLessThanOrEqual(360 - 16);
  });

  it('renders the card preview without a panel and without throwing', () => {
    const game = tetrisGame.create({
      ctx: mockCtx(),
      width: tetrisGame.width,
      height: tetrisGame.height,
      input: new Input(),
      audio: new NullAudio(),
      rng: new Rng(3),
      loadout: { skin: toSkinData(defaultSkin('tetris')), boosts: new Set(), powerDuration: 1 },
      insets: NO_INSETS,
      reducedMotion: false,
      haptic: () => undefined,
      preview: true,
    });
    expect(() => game.render()).not.toThrow();
  });

  it('renders through play at every corner size, with touch insets', () => {
    for (const size of cornerSizes(tetrisGame)) {
      const { game, input } = createGame(tetrisGame, {
        seed: 4,
        width: size.width,
        height: size.height,
        insets: { top: 0, right: 0, bottom: TOUCH_BOTTOM, left: 0 },
      });
      for (let i = 0; i < 600; i++) {
        if (i % 40 === 0) input.setVirtual('down', i % 80 === 0, 'test');
        if (i % 25 === 0) tap(game, input, 'secondary');
        step(game, input);
        if (i % 20 === 0) game.render();
      }
      expect(() => game.render()).not.toThrow();
    }
  });
});
