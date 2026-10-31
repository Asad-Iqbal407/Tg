import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { cssPerPx, legibleSize, MIN_TEXT_CSS_PX, text } from '../src/games/draw';
import { cpuMove as fourMove, emptyGrid, type Grid, landingRow } from '../src/games/four/board';
import { hockeyGame } from '../src/games/hockey';
import { type Board, cpuMove as tttMove, winnerOf } from '../src/games/tictactoe/tictactoe';
import type { GameInstance } from '../src/games/types';
import { createGame } from './helpers';

const DT = 1 / 60;

/** A canvas as the browser sets it up: `cssW` CSS px wide, drawn at `dpr`, with logical size `logicalW`. */
function onScreen(cssW: number, dpr: number, logicalW: number) {
  const fonts: string[] = [];
  const ctx = {
    canvas: { clientWidth: cssW, width: cssW * dpr },
    getTransform: () => ({ a: (cssW * dpr) / logicalW }),
    save: () => undefined,
    restore: () => undefined,
    strokeText: () => undefined,
    fillText: () => undefined,
    set font(v: string) {
      fonts.push(v);
    },
  } as unknown as CanvasRenderingContext2D;
  return { ctx, fonts };
}

describe('text legibility', () => {
  it('works out how big a logical pixel is on screen', () => {
    // A 480 px wide game on a 360 CSS px phone at 2x: 0.75 CSS px per logical px.
    expect(cssPerPx(onScreen(360, 2, 480).ctx)).toBeCloseTo(0.75, 6);
    expect(cssPerPx(onScreen(720, 1, 720).ctx)).toBeCloseTo(1, 6);
  });

  it('raises small text to the floor on a small screen, and leaves big text and big screens alone', () => {
    const phone = onScreen(360, 2, 480).ctx;
    expect(legibleSize(phone, 8)).toBeCloseTo(MIN_TEXT_CSS_PX / 0.75, 6);
    expect(legibleSize(phone, 40)).toBe(40);
    expect(legibleSize(onScreen(1000, 1, 720).ctx, 8)).toBe(8);
  });

  it('does nothing for a canvas that is not on screen (card art, tests)', () => {
    const off = { canvas: { clientWidth: 0, width: 300 } } as unknown as CanvasRenderingContext2D;
    expect(cssPerPx(off)).toBe(0);
    expect(legibleSize(off, 9)).toBe(9);
  });

  it('draws text at the raised size', () => {
    const { ctx, fonts } = onScreen(360, 2, 480);
    text(ctx, 'SCORE', 0, 0, { size: 8 });
    expect(fonts[0]).toContain(`${MIN_TEXT_CSS_PX / 0.75}px`);
  });
});

describe('Air Hockey pinch', () => {
  interface Peek {
    puck: { x: number; y: number; vx: number; vy: number };
    me: { x: number; y: number; vx: number; vy: number };
    cpu: { x: number; y: number; vx: number; vy: number };
    faceT: number;
    rink(): { left: number; right: number; top: number; bottom: number };
  }

  function pinched(game: GameInstance, nearWall: boolean): Peek {
    const g = game as unknown as Peek;
    const r = g.rink();
    const mid = (r.top + r.bottom) / 2;
    const x = nearWall ? r.right - 26 : (r.left + r.right) / 2;
    g.faceT = 0;
    g.me = { x: x - 14, y: mid + 47, vx: 0, vy: 0 };
    g.cpu = { x: x - 8, y: mid - 47, vx: 0, vy: 0 };
    g.puck = { x, y: mid, vx: 0, vy: 0 };
    return g;
  }

  it('a puck squeezed between the mallets is put back in play, never held there', () => {
    for (const nearWall of [false, true]) {
      const { game } = createGame(hockeyGame, { seed: 3 });
      const g = pinched(game, nearWall) as Peek & { pinchT: number };
      const start = { x: g.puck.x, y: g.puck.y };
      let longestPinch = 0;
      let reset = false;
      for (let i = 0; i < 60 * 4; i++) {
        // The mallets keep pressing in on the puck, as a held finger would.
        g.me.y = Math.max(g.me.y, g.puck.y + 47);
        g.cpu.y = Math.min(g.cpu.y, g.puck.y - 47);
        game.update(DT);
        longestPinch = Math.max(longestPinch, g.pinchT);
        if (g.faceT > 0) reset = true;
      }
      const where = nearWall ? 'against the rail' : 'in the open';
      // Pinned for at most half a second (plus a step), and then the face-off restarts play.
      expect(longestPinch, where).toBeLessThan(0.55);
      expect(reset || Math.hypot(g.puck.x - start.x, g.puck.y - start.y) > 40, where).toBe(true);
    }
  });
});

describe('Connect Four search', () => {
  /** Plays the columns in turn, the player (1) first. */
  function play(cols: number[]): Grid {
    const g = emptyGrid();
    cols.forEach((c, i) => {
      (g[c] as number[])[landingRow(g, c)] = (i % 2) + 1;
    });
    return g;
  }

  it('still wins and blocks when it searches as deep as it ever does', () => {
    // The computer (2) has three on the bottom row and one to play: it takes the win at column 3.
    const win = play([6, 0, 6, 1, 5, 2]);
    expect(fourMove(win, 6, new Rng(1))).toBe(3);
    // The player threatens four across the bottom: the computer must block at column 3.
    const block = play([0, 6, 1, 6, 2]);
    expect(fourMove(block, 7, new Rng(1))).toBe(3);
  });

  it('gives the same answer every time for the same position and seed', () => {
    const g = play([3, 3, 2, 4, 2, 3, 4, 1]);
    expect(fourMove(g, 7, new Rng(5))).toBe(fourMove(g, 7, new Rng(5)));
  });
});

describe('Tic-Tac-Toe computer', () => {
  it('never loses at full strength, whatever the player does', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const rng = new Rng(seed);
      const b: Board = Array<number>(9).fill(0);
      let turn: 1 | 2 = seed % 2 === 0 ? 1 : 2;
      while (!winnerOf(b) && b.some((v) => v === 0)) {
        if (turn === 2) b[tttMove(b, 1, rng)] = 2;
        else {
          const empty = b.map((v, i) => (v ? -1 : i)).filter((i) => i >= 0);
          b[rng.pick(empty)] = 1;
        }
        turn = turn === 1 ? 2 : 1;
      }
      expect(winnerOf(b)?.who, `seed ${seed}`).not.toBe(1);
    }
  });
});
