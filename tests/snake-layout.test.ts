import { describe, expect, it, vi } from 'vitest';
import { chooseLogicalSize, fittedArea } from '../src/core/engine';
import { GAMES } from '../src/games/registry';
import { bodyWidth, frameWidth, headRadius, touchHudSize } from '../src/games/snake/draw';
import { fitBoard, gridSize } from '../src/games/snake/board';
import { cornerSizes, createGame } from './helpers';
import { snakeGame } from '../src/games/snake';

/** Play-stage size (CSS px) for a browser window: a 52 px rail on short landscape screens, else a header. */
function stageFor(w: number, h: number): { w: number; h: number } {
  if (w > h && h <= 520) return { w: w - 52, h };
  return { w: w, h: h - (w <= 720 ? 50 : 56) };
}

const snake = GAMES.find((g) => g.id === 'snake')!;

/** A stage is sized like the play screen: a touch phone held landscape uses the landscape range. */
function sizeFor(w: number, h: number) {
  const def = w > h && snake.landscapeViewport ? { ...snake, viewport: snake.landscapeViewport } : snake;
  return chooseLogicalSize(def, w, h);
}
const PORTRAIT_PHONES: [string, number, number][] = [
  ['P1', 360, 740],
  ['P2', 390, 844],
  ['P3', 430, 932],
];
const LANDSCAPE_PHONES: [string, number, number][] = [
  ['L1', 740, 360],
  ['L2', 844, 390],
  ['L3', 932, 430],
];

describe('snake layout', () => {
  it('takes either orientation and keeps its viewport range', () => {
    expect(snake.orientation).toBe('any');
    expect(snake.viewport).toEqual({ minWidth: 380, maxWidth: 1000, minHeight: 640, maxHeight: 800 });
    expect(snake.landscapeViewport).toEqual({
      minWidth: 380,
      maxWidth: 900,
      minHeight: 360,
      maxHeight: 800,
    });
  });

  it('fills the landscape phone stages with the board (no sideways letterbox)', () => {
    for (const [name, w, h] of LANDSCAPE_PHONES) {
      const stage = stageFor(w, h);
      const size = sizeFor(stage.w, stage.h);
      const fill = fittedArea(size, stage.w, stage.h) / (stage.w * stage.h);
      expect(fill, name).toBeGreaterThanOrEqual(name === 'L1' ? 0.8 : 0.85);
    }
  });

  it('fills the portrait phone stages with a board as tall as the design', () => {
    for (const [name, w, h] of PORTRAIT_PHONES) {
      const stage = stageFor(w, h);
      const size = sizeFor(stage.w, stage.h);
      const fill = fittedArea(size, stage.w, stage.h) / (stage.w * stage.h);
      expect(fill, name).toBeGreaterThanOrEqual(0.85);
      expect(size.height, name).toBe(800);
      expect(gridSize(size.width, size.height).rows, name).toBe(29);
    }
  });

  // Regression: the landscape range once reached 1200 px wide, so a landscape phone drew a 48 x 21 board
  // whose head and body were under 7% of the short side.
  it('draws the head at least 8% of the short side on every phone stage', () => {
    for (const [name, w, h] of [...PORTRAIT_PHONES, ...LANDSCAPE_PHONES]) {
      const stage = stageFor(w, h);
      const size = sizeFor(stage.w, stage.h);
      const scale = Math.min(stage.w / size.width, stage.h / size.height);
      const grid = gridSize(size.width, size.height);
      const { cell } = fitBoard(grid.cols, grid.rows, size.width, size.height, 0);
      const diameter = 2 * headRadius(cell, 0, true) * scale;
      expect(diameter / Math.min(stage.w, stage.h), name).toBeGreaterThanOrEqual(0.08);
    }
  });

  // Regression: the landscape range once reached 1200 px wide, so a landscape phone drew a 48 x 21 board
  // whose head and body were under 7% of the short side.
  it('draws the body at least 8% of the short side on every phone stage', () => {
    for (const [name, w, h] of [...PORTRAIT_PHONES, ...LANDSCAPE_PHONES]) {
      const stage = stageFor(w, h);
      const size = sizeFor(stage.w, stage.h);
      const scale = Math.min(stage.w / size.width, stage.h / size.height);
      const grid = gridSize(size.width, size.height);
      const { cell } = fitBoard(grid.cols, grid.rows, size.width, size.height, 0);
      const width = bodyWidth(cell, 0, true) * scale;
      expect(width / Math.min(stage.w, stage.h), name).toBeGreaterThanOrEqual(0.08);
    }
  });

  it('keeps the desktop head at the body width, and draws a larger head on touch', () => {
    expect(headRadius(24, 0, false)).toBeCloseTo(24 * 0.78 * 0.7);
    expect(headRadius(24, 0, true)).toBeGreaterThan(headRadius(24, 0, false));
  });

  it('keeps the touch head wider than the touch body, and inside the frame at the board edge', () => {
    expect(2 * headRadius(24, 0, true)).toBeGreaterThan(bodyWidth(24, 0, true));
    expect(headRadius(24, 0, true) - 24 / 2).toBeLessThanOrEqual(frameWidth(24));
  });

  it('draws a wider body on touch and keeps the desktop body at 0.78 of a cell', () => {
    expect(bodyWidth(24, 0, false)).toBeCloseTo(24 * 0.78);
    expect(bodyWidth(24, 0, true)).toBeCloseTo(24 * 1.65);
    expect(bodyWidth(24, 1, false)).toBeCloseTo(24 * 0.84);
  });

  it('keeps the desktop board 640 px tall and fills a 1280 x 800 window to 85% or more', () => {
    const desk = stageFor(1280, 800);
    const size = chooseLogicalSize(snake, desk.w, desk.h);
    expect(size).toEqual({ width: 1000, height: 640 });
    expect(fittedArea(size, desk.w, desk.h) / (desk.w * desk.h)).toBeGreaterThanOrEqual(0.85);
    expect(gridSize(size.width, size.height)).toEqual({ cols: 40, rows: 22 });
  });

  it('keeps the landscape phone boards inside the landscape range, with cells of 18 CSS px or more', () => {
    for (const [name, w, h] of LANDSCAPE_PHONES) {
      const stage = stageFor(w, h);
      const size = sizeFor(stage.w, stage.h);
      expect(size.height, name).toBeGreaterThanOrEqual(360);
      expect(size.width, name).toBeLessThanOrEqual(900);
      const scale = Math.min(stage.w / size.width, stage.h / size.height);
      const grid = gridSize(size.width, size.height);
      const { cell } = fitBoard(grid.cols, grid.rows, size.width, size.height, 0);
      expect(cell * scale, name).toBeGreaterThanOrEqual(18);
    }
  });

  it('keeps the touch HUD labels at 12 CSS px or more on every phone stage', () => {
    for (const [name, w, h] of [...PORTRAIT_PHONES, ...LANDSCAPE_PHONES]) {
      const stage = stageFor(w, h);
      const size = sizeFor(stage.w, stage.h);
      const scale = Math.min(stage.w / size.width, stage.h / size.height);
      expect(touchHudSize(size.width, size.height).label * scale, name).toBeGreaterThanOrEqual(12);
    }
  });

  it('draws the touch HUD at every corner size on a coarse pointer', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    try {
      for (const size of cornerSizes(snakeGame)) {
        const { game, input } = createGame(snakeGame, { seed: 4, width: size.width, height: size.height });
        for (let i = 0; i < 120; i++) {
          game.update(1 / 60);
          input.postUpdate();
        }
        expect(() => game.render()).not.toThrow();
      }
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
