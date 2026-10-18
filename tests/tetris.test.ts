import { describe, expect, it, vi } from 'vitest';
import { type Action, Input, type PointerState, type SwipeDir } from '../src/core/input';
import { NullAudio } from '../src/core/audio';
import { chooseLogicalSize, fittedArea } from '../src/core/engine';
import { Rng } from '../src/core/rng';
import { Board, COLS, HIDDEN_ROWS, ROWS } from '../src/games/tetris/board';
import { buildLook, COMPACT_LABEL_PX, drawPanel, layoutTetris, panelSlots } from '../src/games/tetris/draw';
import {
  cellsOf,
  type Kind,
  KINDS,
  kickTests,
  type Piece,
  PieceQueue,
  type Rot,
  turnedBackRot,
} from '../src/games/tetris/pieces';
import { levelFor, secondsPerRow } from '../src/games/tetris/tetris';
import { TouchDrop } from '../src/games/tetris/touch';
import { tetrisGame } from '../src/games/tetris';
import { type BoostId, type GameInstance, type GameResult, NO_INSETS } from '../src/games/types';
import { defaultSkin, toSkinData } from '../src/meta/catalog';
import { cornerSizes, createGame, mockCtx } from './helpers';

const DT = 1 / 60;
const ACTIONS: Action[] = ['left', 'right', 'up', 'down', 'primary', 'secondary', 'tertiary'];
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
  texts: { items: { x: number; y: number; text: string; size: number }[] };
  fallT: number;
  clearRows: (rows: number[]) => void;
  cache: unknown;
  hud: { next: Kind[]; stats: [string, string][] };
  dragSoft: boolean;
  lines: number;
  bannerT: number;
  bannerText: string;
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

/** The rows of the well that hold any block, top first. */
function occupiedRows(game: GameInstance): number[] {
  const { cells } = peek(game).board;
  const rows: number[] = [];
  for (let y = 0; y < ROWS; y++) if (cells.slice(y * COLS, (y + 1) * COLS).some((c) => c !== 0)) rows.push(y);
  return rows;
}

/**
 * Points for `rows` rows of soft drop at `level`: each row is worth the share of a row that gravity would not have
 * moved in the same time, which is nothing once gravity is the quicker.
 */
function softPoints(level: number, rows: number): number {
  return Math.floor(rows * Math.max(0, 1 - 0.05 / secondsPerRow(level)) + 1e-9);
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

  it('has the standard anticlockwise wall-kick tests for J, L, S, T and Z', () => {
    const standard: [Rot, Rot, [number, number][]][] = [
      [
        1,
        0,
        [
          [0, 0],
          [1, 0],
          [1, -1],
          [0, 2],
          [1, 2],
        ],
      ],
      [
        2,
        1,
        [
          [0, 0],
          [-1, 0],
          [-1, 1],
          [0, -2],
          [-1, -2],
        ],
      ],
      [
        3,
        2,
        [
          [0, 0],
          [-1, 0],
          [-1, -1],
          [0, 2],
          [-1, 2],
        ],
      ],
      [
        0,
        3,
        [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, -2],
          [1, -2],
        ],
      ],
    ];
    for (const kind of ['J', 'L', 'S', 'T', 'Z'] as const)
      for (const [from, to, kicks] of standard) expect(kickTests(kind, from, to)).toEqual(kicks);
  });

  it('has the standard anticlockwise wall-kick tests for the I piece in all four states', () => {
    const standard: [Rot, Rot, [number, number][]][] = [
      [
        1,
        0,
        [
          [0, 0],
          [2, 0],
          [-1, 0],
          [2, 1],
          [-1, -2],
        ],
      ],
      [
        2,
        1,
        [
          [0, 0],
          [1, 0],
          [-2, 0],
          [1, -2],
          [-2, 1],
        ],
      ],
      [
        3,
        2,
        [
          [0, 0],
          [-2, 0],
          [1, 0],
          [-2, -1],
          [1, 2],
        ],
      ],
      [
        0,
        3,
        [
          [0, 0],
          [-1, 0],
          [2, 0],
          [-1, 2],
          [2, -1],
        ],
      ],
    ];
    for (const [from, to, kicks] of standard) expect(kickTests('I', from, to)).toEqual(kicks);
  });

  it('takes each anticlockwise kick from the clockwise kick of the reverse turn, negated', () => {
    for (const kind of KINDS)
      for (const from of [0, 1, 2, 3] as const) {
        const to = turnedBackRot(from);
        const reverse = kickTests(kind, to, from).map(([dx, dy]) => [0 - dx, 0 - dy]);
        expect(kickTests(kind, from, to)).toEqual(reverse);
      }
  });

  it('turns counter-clockwise with the tertiary key, so the state drops by one', () => {
    const { game, input } = start(2);
    setActive(game, 'T', 1, 3, 0);
    tap(game, input, 'tertiary');
    expect(peek(game).active.rot).toBe(0);
    tap(game, input, 'tertiary');
    expect(peek(game).active.rot).toBe(3);
    tap(game, input, 'tertiary');
    expect(peek(game).active.rot).toBe(2);
  });

  it('reaches the same state with three clockwise turns as with one anticlockwise turn, in every state', () => {
    for (const kind of KINDS)
      for (const rot of [0, 1, 2, 3] as const) {
        const turns = start(3);
        setActive(turns.game, kind, rot, 3, 5);
        for (let i = 0; i < 3; i++) tap(turns.game, turns.input, 'up');
        const back = start(3);
        setActive(back.game, kind, rot, 3, 5);
        tap(back.game, back.input, 'tertiary');
        expect(peek(turns.game).active).toEqual(peek(back.game).active);
      }
  });

  it('lets an I piece turn counter-clockwise against the left wall by kicking inwards', () => {
    const { game, input } = start(1);
    setActive(game, 'I', 1, -2, 5);
    expect(peek(game).board.fitsAt('I', 0, -2, 5)).toBe(false);
    tap(game, input, 'tertiary');
    expect(peek(game).active.rot).toBe(0);
    expect(peek(game).active.x).toBe(0);
  });

  it('lets a T piece turn counter-clockwise against the left wall by kicking inwards', () => {
    const { game, input } = start(1);
    setActive(game, 'T', 1, -1, 5);
    expect(peek(game).board.fitsAt('T', 0, -1, 5)).toBe(false);
    tap(game, input, 'tertiary');
    expect(peek(game).active.rot).toBe(0);
    expect(peek(game).active.x).toBe(0);
  });

  it('lets an I piece turn counter-clockwise against the right wall by kicking inwards', () => {
    const { game, input } = start(1);
    setActive(game, 'I', 3, 8, 5);
    expect(peek(game).board.fitsAt('I', 2, 8, 5)).toBe(false);
    tap(game, input, 'tertiary');
    expect(peek(game).active.rot).toBe(2);
    expect(peek(game).active.x).toBe(6);
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

  it('falls at 20 rows a second under Down at level 1, and scores the rows gravity would not have moved', () => {
    const { game, input } = start(6);
    setActive(game, 'T', 0, 3, 0);
    input.setVirtual('down', true, 'test');
    step(game, input, 48);
    const { active } = peek(game);
    expect(active.y).toBeGreaterThanOrEqual(15);
    expect(active.y).toBeLessThanOrEqual(16);
    expect(game.getResult().score).toBe(softPoints(1, active.y));
    expect(game.getResult().score).toBe(15);
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

  it('lets the Guardian clear the four highest settled rows, and keeps the rows below them and the piece', () => {
    const { game, input } = start(2, ['shield']);
    const { board } = peek(game);
    board.cells.fill(0);
    // Rows 10 to 21 are full but for the last column, and row 2 is a sparse top of two blocks.
    for (let y = 10; y < ROWS; y++) for (let x = 0; x < COLS - 1; x++) board.cells[y * COLS + x] = 1;
    board.cells[2 * COLS] = 1;
    board.cells[2 * COLS + 1] = 1;
    setActive(game, 'O', 0, 0, 0);
    tap(game, input, 'primary');
    expect(game.isOver()).toBe(false);
    expect(peek(game).shieldUsed).toBe(true);
    // Settled rows 2, 10, 11 and 12 go. The O was never settled, so it is not cleared: it drops with the rows
    // above the gaps to rows 4 and 5, and rows 13 to 21 are untouched.
    expect(occupiedRows(game)).toEqual([4, 5, 13, 14, 15, 16, 17, 18, 19, 20, 21]);
    expect(board.cells[4 * COLS]).toBe(KINDS.indexOf('O') + 1);
    expect(board.cells[5 * COLS + 1]).toBe(KINDS.indexOf('O') + 1);
  });

  it('counts a settled row that the top-out piece completes as a cleared line, within the four', () => {
    const { game, input } = start(2, ['shield']);
    const { board } = peek(game);
    board.cells.fill(0);
    for (let y = 10; y < ROWS; y++) for (let x = 0; x < COLS - 1; x++) board.cells[y * COLS + x] = 1;
    // Row 2 is settled but for the last column, and a block sits at (9, 4) under the column the I piece lands in.
    for (let x = 0; x < COLS - 1; x++) board.cells[2 * COLS + x] = 1;
    board.cells[4 * COLS + 9] = 1;
    setActive(game, 'I', 1, 7, 0);
    tap(game, input, 'primary');
    expect(game.isOver()).toBe(false);
    // The piece completes row 2, a line clear worth 100 at level 1. The Guardian takes the rest of the four
    // highest settled rows (4, 10 and 11), and the piece's cells fall to rows 4 to 6.
    expect(statsOf(game).lines).toBe(1);
    expect(game.getResult().score).toBe(100);
    expect(occupiedRows(game)).toEqual([4, 5, 6, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21]);
    expect(board.cells[4 * COLS + 9]).toBe(KINDS.indexOf('I') + 1);
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

describe('soft drop scoring', () => {
  /** Holds Down for `sec` seconds with a T piece at the top of an empty well, at `level`. */
  function holdDown(level: number, sec: number): { rows: number; score: number } {
    const { game, input } = start(20);
    setActive(game, 'T', 0, 3, 0);
    peek(game).level = level;
    input.setVirtual('down', true, 'test');
    step(game, input, Math.round(sec / DT));
    return { rows: peek(game).active.y, score: game.getResult().score };
  }

  /**
   * Drags a finger down until the touch reads as a soft drop, then holds it there for `sec` more seconds. Returns the
   * row the soft drop began on, and the rows and points counted from that step, so the rows gravity moved before
   * it are left out.
   */
  function touchSoft(level: number, sec: number): { from: number; rows: number; score: number } {
    const { game, input } = start(21);
    setActive(game, 'T', 0, 3, 0);
    peek(game).level = level;
    press(game, input, 100, 300);
    let fromY = 0;
    let fromScore = 0;
    for (let i = 1; !peek(game).dragSoft && i < 120; i++) {
      fromY = peek(game).active.y;
      fromScore = game.getResult().score;
      finger(input, 100, 300 + i * 4, 'move', true);
      step(game, input);
    }
    holdFinger(game, input, sec);
    return { from: fromY, rows: peek(game).active.y - fromY, score: game.getResult().score - fromScore };
  }

  // Down is held for 0.8 s (0.2 s at level 15, where gravity alone reaches the floor within about 0.4 s).
  for (const level of [1, 10, 11, 15]) {
    const sec = level === 15 ? 0.2 : 0.8;
    // Soft drop is 20 rows a second, or gravity where gravity is quicker.
    const rate = 1 / Math.min(secondsPerRow(level), 0.05);

    it(`falls at max(gravity, 20 rows a second) with Down held at level ${level}`, () => {
      const { rows } = holdDown(level, sec);
      expect(Math.abs(rows - sec * rate)).toBeLessThanOrEqual(1);
    });

    it(`pays only the rows Down adds beyond gravity with Down held at level ${level}`, () => {
      const { rows, score } = holdDown(level, sec);
      expect(score).toBe(softPoints(level, rows));
    });

    it(`scores a touch drag soft drop by the same rule at level ${level}`, () => {
      // The touch only soft drops once its flick window has closed, by which time gravity has moved the piece on.
      // The floor caps how far it can go.
      const { from, rows, score } = touchSoft(level, sec);
      expect(Math.abs(rows - Math.min(sec * rate, 20 - from))).toBeLessThanOrEqual(1);
      expect(score).toBe(softPoints(level, rows));
    });
  }

  it('does not spend the gravity time it has banked as a burst of rows when Down is pressed', () => {
    const { game, input } = start(6);
    setActive(game, 'T', 0, 3, 0);
    // Three quarters of a second of gravity: the piece is nearly a row down, one row short at level 1.
    step(game, input, 45);
    expect(peek(game).active.y).toBe(0);
    input.setVirtual('down', true, 'test');
    step(game, input);
    expect(peek(game).active.y).toBeLessThanOrEqual(1);
    expect(game.getResult().score).toBe(0);
  });

  it('pays a tap of Down for its own time, not for each row the tap happens to finish', () => {
    const { game, input } = start(21);
    setActive(game, 'T', 0, 3, 0);
    const s = peek(game);
    const taps = 10;
    for (let i = 0; i < taps; i++) {
      // Waits until gravity is nearly due a row, then taps Down for one step, so the tap finishes that row.
      for (let guard = 0; s.fallT < 0.95 && guard < 2000; guard++) step(game, input);
      tap(game, input, 'down');
      step(game, input);
    }
    expect(s.active.y).toBeGreaterThanOrEqual(taps);
    // Ten steps of Down are a sixth of a second, worth 19 extra rows a second at level 1: three points, not nine.
    expect(game.getResult().score).toBeLessThanOrEqual(Math.floor(taps * DT * 19 + 1e-9));
  });

  it('pays a share of each row at level 10, where gravity is only a little slower than soft drop', () => {
    const { score } = holdDown(10, 0.8);
    expect(score).toBeGreaterThan(0);
  });

  it('pays nothing at levels 11 and 15, where gravity already falls at least as fast as soft drop', () => {
    expect(holdDown(11, 0.8).score).toBe(0);
    expect(holdDown(15, 0.2).score).toBe(0);
    expect(touchSoft(11, 0.5).score).toBe(0);
    expect(touchSoft(15, 0.2).score).toBe(0);
  });
});

describe('score popups', () => {
  it('moves each score popup to the next column, so consecutive clears do not pile up', () => {
    const { game, input } = start(3);
    for (let i = 0; i < 3; i++) {
      setStack(game, ['....######']);
      setActive(game, 'I', 0, 0, 20);
      tap(game, input, 'primary');
    }
    const { well } = layoutTetris(tetrisGame.width, tetrisGame.height, 0, true);
    const xs = peek(game).texts.items.map((t) => t.x);
    expect(xs).toHaveLength(3);
    for (let i = 0; i < xs.length; i++)
      for (let j = i + 1; j < xs.length; j++)
        expect(Math.abs((xs[i] ?? 0) - (xs[j] ?? 0))).toBeGreaterThanOrEqual(2 * well.cell);
  });

  /** Two singles in columns 2 and 5, then a four-line TETRIS! in column 8, on the bottom rows. */
  function clearThree(game: GameInstance): void {
    const s = peek(game);
    s.level = 15;
    const fill = (gap: number) => {
      for (let y = HIDDEN_ROWS + 10; y < ROWS; y++)
        for (let x = 0; x < COLS; x++) s.board.cells[y * COLS + x] = x === gap ? 0 : 1;
    };
    fill(1);
    s.clearRows([21]);
    fill(4);
    s.clearRows([21]);
    fill(9);
    s.clearRows([18, 19, 20, 21]);
  }

  it('keeps every popup inside the well, and sets its text smaller in a small well', () => {
    const { game } = createGame(tetrisGame, {
      seed: 3,
      width: 480,
      height: 800,
      insets: { top: 0, right: 0, bottom: 400, left: 0 },
    });
    clearThree(game);
    const { well } = layoutTetris(480, 800, 400, true);
    const items = peek(game).texts.items;
    expect(items).toHaveLength(3);
    expect(items.find((t) => t.text === 'TETRIS!')?.size).toBeLessThanOrEqual(well.cell);
    for (const t of items) {
      expect(t.x).toBeGreaterThanOrEqual(well.x);
      expect(t.x).toBeLessThanOrEqual(well.x + COLS * well.cell);
      expect(t.size).toBeLessThanOrEqual(well.cell);
    }
  });

  it('keeps the popup text at its full size in the usual well', () => {
    const { game } = start(3);
    clearThree(game);
    const items = peek(game).texts.items;
    expect(items.find((t) => t.text === 'TETRIS!')?.size).toBe(24);
    expect(items.filter((t) => t.text !== 'TETRIS!').map((t) => t.size)).toEqual([20, 20]);
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

  it('lists Q as counter-clockwise on the keyboard, and gives touch no counter-clockwise button', () => {
    expect(tetrisGame.controls).toContainEqual(['Q', 'Rotate counter-clockwise']);
    expect((tetrisGame.touchButtons ?? []).map((b) => b.action)).toEqual([
      'left',
      'right',
      'up',
      'secondary',
    ]);
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
    expect(game.getResult().score).toBe(softPoints(1, held));
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
  it('names the new level on the banner when a clear raises it', () => {
    const { game, input } = start(3);
    const s = peek(game);
    s.lines = 9;
    setStack(game, ['....######']);
    setActive(game, 'I', 0, 0, 20);
    tap(game, input, 'primary');
    expect(s.level).toBe(2);
    expect(s.bannerText).toBe('LEVEL 2');
    expect(s.bannerT).toBeGreaterThan(0);
  });

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

describe('side panel boxes', () => {
  type Box = { x: number; y: number; w: number; h: number };

  /**
   * The clear space between two boxes, along the axis that separates them. Negative when they overlap. The panel's
   * boxes share a column, so this is the vertical gap between them.
   */
  const gapOf = (a: Box, b: Box): number =>
    Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w), b.y - (a.y + a.h), a.y - (b.y + b.h));

  it('keeps every box apart by a visible gap, inside the panel and with the stats tall, at every size and inset', () => {
    const problems: string[] = [];
    for (let width = 480; width <= 900; width += 10) {
      for (let height = 800; height <= 1100; height += 10) {
        // updateInsets caps the bottom inset at half the canvas height, rounded up to a whole logical px.
        for (let bottom = 0; bottom <= Math.ceil(height / 2); bottom += 5) {
          const { panel } = layoutTetris(width, height, bottom, true);
          const where = `${width}x${height} inset ${bottom}`;
          if (!panel) {
            problems.push(`${where}: no panel`);
            continue;
          }
          const s = panelSlots(panel);
          const boxes = [s.hold, ...s.next, ...s.stats];
          boxes.forEach((b, i) => {
            if (
              b.x < panel.x ||
              b.y < panel.y ||
              b.x + b.w > panel.x + panel.w ||
              b.y + b.h > panel.y + panel.h
            )
              problems.push(`${where}: box ${i} leaves the panel`);
          });
          for (let i = 0; i < boxes.length; i++)
            for (let j = i + 1; j < boxes.length; j++) {
              const a = boxes[i] ?? s.hold;
              const b = boxes[j] ?? s.hold;
              if (gapOf(a, b) < 6) problems.push(`${where}: boxes ${i} and ${j} are ${gapOf(a, b)} px apart`);
            }
          for (const r of s.stats) if (r.h < 36) problems.push(`${where}: a stat box is short`);
          // The NEXT label sits between the hold box and the first next box.
          if (s.nextLabel.y - 6 < s.hold.y + s.hold.h) problems.push(`${where}: NEXT label meets HOLD`);
        }
      }
    }
    expect(problems.slice(0, 20)).toEqual([]);
  });

  it('keeps the third NEXT box clear of the SCORE box at 900 by 800 with a 400 px bottom inset', () => {
    const { panel } = layoutTetris(900, 800, 400, true);
    if (!panel) throw new Error('no panel');
    const s = panelSlots(panel);
    expect(s.stats.every((r) => r.h >= 36)).toBe(true);
    const lastNext = s.next[2];
    const firstStat = s.stats[0];
    if (!lastNext || !firstStat) throw new Error('missing boxes');
    expect(gapOf(lastNext, firstStat)).toBeGreaterThanOrEqual(6);
  });

  it('keeps the NEXT boxes clear of the stats at the design size, with the stats tall', () => {
    const { panel } = layoutTetris(tetrisGame.width, tetrisGame.height, 0, true);
    if (!panel) throw new Error('no panel');
    const s = panelSlots(panel);
    expect(s.stats.every((r) => r.h >= 36)).toBe(true);
    const lastNext = s.next[2];
    const firstStat = s.stats[0];
    if (!lastNext || !firstStat) throw new Error('missing boxes');
    expect(lastNext.y + lastNext.h).toBeLessThan(firstStat.y);
  });

  it('puts the panel above the well when a side panel would be too short for its boxes', () => {
    // A 240 px canvas leaves a 9 px well cell: the side panel would have no room for its NEXT boxes.
    const short = layoutTetris(540, 240, 0, true);
    expect(short.panel?.side).toBe(false);
    expect(short.panel ? short.panel.y + short.panel.h : Infinity).toBeLessThanOrEqual(short.well.y);
    // From a 10 px cell up, the side panel is used and its boxes keep their gaps.
    for (let height = 252; height <= 800; height += 2) {
      const { panel } = layoutTetris(540, height, 0, true);
      if (!panel) throw new Error('no panel');
      expect(panel.side).toBe(true);
      const s = panelSlots(panel);
      const boxes = [s.hold, ...s.next, ...s.stats];
      for (let i = 0; i < boxes.length; i++)
        for (let j = i + 1; j < boxes.length; j++) {
          const a = boxes[i] ?? s.hold;
          const b = boxes[j] ?? s.hold;
          expect(gapOf(a, b), `${height} px`).toBeGreaterThanOrEqual(6);
        }
    }
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

  it('reuses the layout until the touch inset changes', () => {
    const insets = { top: 0, right: 0, bottom: TOUCH_BOTTOM, left: 0 };
    const { game } = createGame(tetrisGame, { seed: 4, insets });
    game.render();
    const first = peek(game).cache;
    game.render();
    expect(peek(game).cache).toBe(first);
    insets.bottom = 200;
    game.render();
    expect(peek(game).cache).not.toBe(first);
  });

  it('reuses the panel lists between frames, and rebuilds the stat lines only when a number moves', () => {
    const { game, input } = start(4);
    const s = peek(game);
    game.render();
    const { next, stats } = s.hud;
    game.render();
    step(game, input, 30);
    game.render();
    expect(s.hud.next).toBe(next);
    expect(s.hud.stats).toBe(stats);
    tap(game, input, 'primary');
    game.render();
    expect(s.hud.next).toBe(next);
    expect(s.hud.stats).not.toBe(stats);
    expect(s.hud.stats[0]).toEqual(['SCORE', game.getResult().score.toLocaleString('en-US')]);
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

/**
 * The phone test matrix as browser viewports, in CSS px. A short landscape phone keeps a 52 px rail on its left;
 * every other size has the 56 px header on top.
 */
const PHONE_MATRIX: readonly [string, number, number][] = [
  ['P1', 360, 740],
  ['P2', 390, 844],
  ['P3', 430, 932],
  ['L1', 740, 360],
  ['L2', 844, 390],
  ['L3', 932, 430],
  ['T1', 768, 1024],
  ['T2', 1024, 768],
  ['D1', 1280, 800],
];

/** The play stage (CSS px) that a browser viewport leaves for the canvas. */
function stageOf(width: number, height: number): { w: number; h: number } {
  return height <= 520 ? { w: width - 52, h: height } : { w: width, h: height - 56 };
}

describe('phone layout', () => {
  it('is played in portrait, and its range fills a portrait stage at every size in the phone matrix', () => {
    expect(tetrisGame.orientation).toBe('portrait');
    const range = tetrisGame.viewport ?? {};
    for (const [name, width, height] of PHONE_MATRIX) {
      const stage = stageOf(width, height);
      const size = chooseLogicalSize(tetrisGame, stage.w, stage.h);
      expect(size.width, name).toBeGreaterThanOrEqual(range.minWidth ?? tetrisGame.width);
      expect(size.width, name).toBeLessThanOrEqual(range.maxWidth ?? tetrisGame.width);
      expect(size.height, name).toBeGreaterThanOrEqual(range.minHeight ?? tetrisGame.height);
      expect(size.height, name).toBeLessThanOrEqual(range.maxHeight ?? tetrisGame.height);
      if (height > width) {
        expect(fittedArea(size, stage.w, stage.h) / (stage.w * stage.h), name).toBeGreaterThanOrEqual(0.85);
      }
    }
  });

  it('centres the whole well, buffer rows included, between the top margin and the touch controls at P1 to P3', () => {
    // The logical canvas and the touch band of each phone, as the play screen reports them.
    const cases: [number, number, number][] = [
      [540, 1036, 111],
      [540, 1100, 109],
      [536, 1100, 106],
    ];
    for (const [width, height, bottom] of cases) {
      const { well } = layoutTetris(width, height, bottom, true);
      const wellBottom = well.y + ROWS * well.cell;
      // The room above the buffer rows matches the room between the playfield and the touch band, to within a logical pixel.
      expect(Math.abs(well.y - (height - bottom - wellBottom)), `${width}x${height}`).toBeLessThanOrEqual(2);
      expect(well.y).toBeGreaterThanOrEqual(16);
    }
  });

  it('keeps the panel labels and stat names at least 12 CSS px at P1, where the canvas is scaled to 0.666', () => {
    // A 360 x 740 phone draws the 540 x 1036 logical canvas at the smaller of its two scales.
    const scale = Math.min(360 / 540, 690 / 1036);
    expect(COMPACT_LABEL_PX * scale).toBeGreaterThanOrEqual(12);
  });

  it('keeps the side panel beside the well, clear of the touch controls, at P1 and P2', () => {
    // The canvas of a 360 or 390 px phone is 540 logical px wide. The bottom inset is the touch band the shell reports.
    const cases: [number, number, number][] = [
      [540, 1036, 111],
      [540, 1100, 109],
    ];
    for (const [width, height, bottom] of cases) {
      const { well, panel } = layoutTetris(width, height, bottom, true);
      if (!panel) throw new Error('no panel');
      expect(panel.side).toBe(true);
      expect(panelSlots(panel).compact).toBe(true);
      // The stat strip is beside the well, not over it, and both sit above the control band.
      expect(panel.x).toBeGreaterThanOrEqual(well.x + COLS * well.cell);
      expect(panel.x + panel.w).toBeLessThanOrEqual(width - 16);
      expect(well.y + ROWS * well.cell).toBeLessThanOrEqual(height - bottom);
      expect(panel.y + panel.h).toBeLessThanOrEqual(height - bottom);
    }
  });
});

describe('touch layout', () => {
  it('sets the compact panel text on a touch screen even when no button covers the canvas', () => {
    // A touch screen keeps the larger labels when the controls do not reach the canvas (bottom inset 0).
    expect(layoutTetris(540, 900, 0, true, true).panel?.compact).toBe(true);
    expect(layoutTetris(540, 900, 0, true).panel?.compact).toBe(false);
    const compact = `800 ${COMPACT_LABEL_PX}px`;
    expect(fontsDrawn(true).some((f) => f.startsWith(compact))).toBe(true);
    expect(fontsDrawn(false).some((f) => f.startsWith(compact))).toBe(false);
  });
});

/**
 * The font of every text draw in one frame of Block Drop, for a run with no touch controls on the canvas. A coarse
 * pointer makes the run a touch screen, as a phone's browser reports it.
 */
function fontsDrawn(coarsePointer: boolean): string[] {
  const fonts: string[] = [];
  const ctx = new Proxy(mockCtx(), {
    set(target, key, value) {
      if (key === 'font') fonts.push(String(value));
      return Reflect.set(target, key, value);
    },
  });
  if (coarsePointer) vi.stubGlobal('matchMedia', () => ({ matches: true }));
  try {
    const game = tetrisGame.create({
      ctx,
      width: tetrisGame.width,
      height: tetrisGame.height,
      input: new Input(),
      audio: new NullAudio(),
      rng: new Rng(1),
      loadout: { skin: toSkinData(defaultSkin('tetris')), boosts: new Set(), powerDuration: 1 },
      insets: NO_INSETS,
      reducedMotion: false,
      haptic: () => undefined,
    });
    game.render();
  } finally {
    vi.unstubAllGlobals();
  }
  return fonts;
}

describe('phone panel', () => {
  it('gives the well at least 55% of a phone canvas at P1 to P3, with a narrow touch panel beside it', () => {
    const cases: [number, number, number][] = [
      [540, 1036, 111],
      [540, 1100, 109],
      [536, 1100, 106],
    ];
    for (const [width, height, bottom] of cases) {
      const { well, panel } = layoutTetris(width, height, bottom, true);
      if (!panel) throw new Error('no panel');
      expect(panel.side, `${width}x${height}`).toBe(true);
      expect((200 * well.cell * well.cell) / (width * height), `${width}x${height}`).toBeGreaterThanOrEqual(
        0.55,
      );
      expect(panel.x + panel.w, `${width}x${height}`).toBeLessThanOrEqual(width - 16);
    }
  });

  it('keeps the full side panel on desktop, where no touch band covers the canvas', () => {
    const { well, panel } = layoutTetris(900, 800, 0, true, false);
    if (!panel) throw new Error('no panel');
    expect(panel.w).toBe(Math.floor(4.5 * well.cell));
  });

  it('draws the panel text at least 12 CSS px on a turned phone, where the canvas is scaled to 0.4874', () => {
    const scale = 0.4874;
    const fonts: string[] = [];
    const ctx = new Proxy(mockCtx(), {
      set(target, key, value) {
        if (key === 'font') fonts.push(String(value));
        return Reflect.set(target, key, value);
      },
    });
    Object.assign(ctx, {
      canvas: { getBoundingClientRect: () => ({ width: 900 * scale, height: 800 * scale }) },
    });
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    try {
      const game = tetrisGame.create({
        ctx,
        width: 900,
        height: 800,
        input: new Input(),
        audio: new NullAudio(),
        rng: new Rng(1),
        loadout: { skin: toSkinData(defaultSkin('tetris')), boosts: new Set(), powerDuration: 1 },
        insets: NO_INSETS,
        reducedMotion: false,
        haptic: () => undefined,
      });
      game.render();
    } finally {
      vi.unstubAllGlobals();
    }
    const sizes = fonts.map((f) => Number(/(\d+)px/.exec(f)?.[1]));
    expect(sizes.length).toBeGreaterThan(0);
    expect(Math.min(...sizes) * scale).toBeGreaterThanOrEqual(12);
  });
});

describe('panel values', () => {
  /** The P1 to P3 phones: the logical canvas, its touch band, and the scale the canvas is drawn at (CSS px per logical px). */
  const PHONES: [string, number, number, number, number][] = [
    ['P1', 540, 1036, 111, 360 / 540],
    ['P2', 540, 1100, 109, 390 / 540],
    ['P3', 536, 1100, 106, 430 / 536],
  ];

  /**
   * Draws the side panel of a touch layout with the given stat lines, as the game does (its text is at least 12 CSS px at
   * the canvas scale). Returns the smallest text drawn in CSS px and every string drawn.
   */
  function drawnPanel(
    width: number,
    height: number,
    bottom: number,
    scale: number,
    stats: [string, string][],
  ): { smallestCss: number; strings: string[] } {
    const { panel } = layoutTetris(width, height, bottom, true, true, Math.ceil(12 / scale));
    if (!panel) throw new Error('no panel');
    const fonts: string[] = [];
    const strings: string[] = [];
    const ctx = new Proxy(mockCtx(), {
      get(target, key) {
        if (key === 'fillText') return (t: string) => strings.push(t);
        return Reflect.get(target, key);
      },
      set(target, key, value) {
        if (key === 'font') fonts.push(String(value));
        return Reflect.set(target, key, value);
      },
    });
    const state = { hold: null, holdLocked: false, next: [], stats };
    drawPanel(
      ctx,
      panelSlots(panel),
      buildLook((_key, fallback) => fallback),
      state,
    );
    const sizes = fonts.map((f) => Number(/(\d+)px/.exec(f)?.[1]));
    return { smallestCss: Math.min(...sizes) * scale, strings };
  }

  it('keeps every stat value at least 12 CSS px at P1 to P3, with a score of six figures', () => {
    for (const [name, width, height, bottom, scale] of PHONES) {
      const stats: [string, string][] = [
        ['SCORE', '123,456'],
        ['LEVEL', '12'],
        ['LINES', '345'],
      ];
      const { smallestCss, strings } = drawnPanel(width, height, bottom, scale, stats);
      expect(smallestCss, name).toBeGreaterThanOrEqual(12);
      expect(strings, name).toContain('123,456');
    }
  });

  it('shortens a score of a million or more, so its text stays at least 12 CSS px at P1 to P3', () => {
    for (const [name, width, height, bottom, scale] of PHONES) {
      const { smallestCss, strings } = drawnPanel(width, height, bottom, scale, [['SCORE', '1,234,567']]);
      expect(smallestCss, name).toBeGreaterThanOrEqual(12);
      expect(strings, name).toContain('1.2M');
    }
  });

  it('keeps the stat values at least 12 CSS px on a turned phone, where the canvas is scaled to 0.4333', () => {
    const scale = 390 / 900;
    const { smallestCss, strings } = drawnPanel(900, 800, 0, scale, [['SCORE', '123,456']]);
    expect(smallestCss).toBeGreaterThanOrEqual(12);
    expect(strings).toContain('123,456');
  });
});
