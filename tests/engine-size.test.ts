import { describe, expect, it } from 'vitest';
import { chooseLogicalSize, fittedArea } from '../src/core/engine';
import { GAMES } from '../src/games/registry';
import type { GameDefinition } from '../src/games/types';

/**
 * Play-stage size (CSS px) for a browser viewport of `w` x `h`: the header takes 50 px on phone
 * widths and 56 px otherwise, and short landscape screens move it to a 52 px rail on the left.
 */
function stageFor(w: number, h: number): { w: number; h: number } {
  const railed = w > h && h <= 520;
  if (railed) return { w: w - 52, h };
  return { w, h: h - (w <= 720 ? 50 : 56) };
}

/** The phone and tablet matrix (CSS px) the shell is checked at; `fill` is the minimum coverage. */
const MATRIX = {
  P1: { w: 360, h: 740, fill: 0.8 },
  P2: { w: 390, h: 844, fill: 0.85 },
  P3: { w: 430, h: 932, fill: 0.85 },
  L1: { w: 740, h: 360, fill: 0.8 },
  L2: { w: 844, h: 390, fill: 0.85 },
  L3: { w: 932, h: 430, fill: 0.85 },
  T1: { w: 768, h: 1024, fill: 0.85 },
  T2: { w: 1024, h: 768, fill: 0.85 },
} as const;

/** The orientation a game is designed for: its declared one, else the shape of its design size. */
function preferredOf(def: GameDefinition): 'landscape' | 'portrait' {
  if (def.orientation === 'landscape' || def.orientation === 'portrait') return def.orientation;
  return def.width > def.height ? 'landscape' : 'portrait';
}

const orientationOfScreen = (w: number, h: number) => (w > h ? 'landscape' : 'portrait');

describe('play stage sizing across the phone matrix', () => {
  it('fills at least the target share of the stage in each game’s preferred orientation', () => {
    for (const def of GAMES) {
      const preferred = preferredOf(def);
      for (const [name, screen] of Object.entries(MATRIX)) {
        if (orientationOfScreen(screen.w, screen.h) !== preferred) continue;
        const stage = stageFor(screen.w, screen.h);
        const size = chooseLogicalSize(def, stage.w, stage.h);
        const fill = fittedArea(size, stage.w, stage.h) / (stage.w * stage.h);
        expect(fill, `${def.id} on ${name}`).toBeGreaterThanOrEqual(screen.fill);
      }
    }
  });

  it('keeps every logical size inside the game’s viewport range, with even sides', () => {
    for (const def of GAMES) {
      const v = def.viewport ?? {};
      for (const [name, screen] of Object.entries(MATRIX)) {
        const stage = stageFor(screen.w, screen.h);
        const size = chooseLogicalSize(def, stage.w, stage.h);
        const where = `${def.id} on ${name}`;
        expect(size.width % 2, where).toBe(0);
        expect(size.height % 2, where).toBe(0);
        expect(size.width, where).toBeGreaterThanOrEqual(v.minWidth ?? def.width);
        expect(size.width, where).toBeLessThanOrEqual(v.maxWidth ?? def.width);
        expect(size.height, where).toBeGreaterThanOrEqual(v.minHeight ?? def.height);
        expect(size.height, where).toBeLessThanOrEqual(v.maxHeight ?? def.height);
      }
    }
  });
});

describe('desktop sizing is unchanged (D1 1280x800)', () => {
  // Logical sizes the desktop stage (1280 x 744) chose before the shell changes.
  const DESKTOP: Record<string, { width: number; height: number }> = {
    runner: { width: 1652, height: 960 },
    platformer: { width: 930, height: 540 },
    duck: { width: 930, height: 540 },
    hill: { width: 960, height: 558 },
    galaxy: { width: 720, height: 900 },
    snake: { width: 900, height: 640 },
    bombsquad: { width: 1032, height: 600 },
    tetris: { width: 900, height: 800 },
  };

  it.each(Object.entries(DESKTOP))('%s keeps its desktop logical size', (id, expected) => {
    const def = GAMES.find((g) => g.id === id);
    expect(def).toBeDefined();
    const stage = stageFor(1280, 800);
    expect(chooseLogicalSize(def!, stage.w, stage.h)).toEqual(expected);
  });
});
