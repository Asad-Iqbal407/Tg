import { describe, expect, it } from 'vitest';
import { NullAudio } from '../src/core/audio';
import { chooseLogicalSize, fittedArea } from '../src/core/engine';
import { Input } from '../src/core/input';
import { Rng } from '../src/core/rng';
import {
  HERO_DRAW_H,
  HUD_H,
  type HudBox,
  hudFloorPx,
  hudLayout,
  zoomFor,
} from '../src/games/platformer/platformer';
import { ROWS, T } from '../src/games/platformer/level';
import { type GameInstance, NO_INSETS } from '../src/games/types';
import { defaultSkin, toSkinData } from '../src/meta/catalog';
import { gameById, mockCtx } from './helpers';

const def = gameById('platformer');
const DT = 1 / 60;

/** Play stage of each landscape phone in the test matrix: the viewport minus the 52 px play rail. */
const LANDSCAPE_STAGES: [string, number, number][] = [
  ['L1', 688, 360],
  ['L2', 792, 390],
  ['L3', 880, 430],
];

/** Play stage of each phone held upright ("Play anyway"): the viewport minus the 50 px header. */
const UPRIGHT_STAGES: [string, number, number][] = [
  ['P1', 360, 690],
  ['P2', 390, 794],
  ['P3', 430, 882],
];

/** Runs wider than the 800 px upright design (a landscape run turned to portrait), on each phone held upright. */
const WIDE_UPRIGHT: [string, number, number, number][] = UPRIGHT_STAGES.flatMap(([id, w, h]) =>
  [1032, 1096].map((runW): [string, number, number, number] => [`${id} ${runW} px run`, w, h, runW]),
);

/** Whether two HUD pills share any area. */
const overlap = (a: HudBox, b: HudBox): boolean =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + HUD_H && b.y < a.y + HUD_H;

/** Every pill of a layout, and a check that each is inside the view and none touches another. */
function expectTidyHud(layout: ReturnType<typeof hudLayout>, left: number, right: number): void {
  const boxes = [layout.score, layout.coins, layout.clock, layout.lives, layout.world];
  for (const b of boxes) {
    expect(b.x).toBeGreaterThanOrEqual(left - 1e-9);
    expect(b.x + b.w).toBeLessThanOrEqual(right + 1e-9);
  }
  boxes.forEach((a, i) => boxes.slice(i + 1).forEach((b) => expect(overlap(a, b)).toBe(false)));
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Framed extends GameInstance {
  player: Box;
  camY: number;
  enemies: unknown[];
  vw: number;
  vh: number;
}

describe('Pixel Quest layout', () => {
  it('is designed for landscape', () => {
    expect(def.orientation).toBe('landscape');
  });

  it.each(LANDSCAPE_STAGES)('fills the %s phone stage', (_id, w, h) => {
    const size = chooseLogicalSize(def, w, h);
    expect(fittedArea(size, w, h) / (w * h)).toBeGreaterThanOrEqual(0.85);
  });

  it.each(LANDSCAPE_STAGES)('draws the hero at least 8 percent of the short side on %s', (_id, w, h) => {
    const size = chooseLogicalSize(def, w, h);
    const scale = Math.min(w / size.width, h / size.height);
    const hero = HERO_DRAW_H * scale * zoomFor(size.height * scale);
    expect(hero / Math.min(w, h)).toBeGreaterThanOrEqual(0.08);
  });

  it.each(UPRIGHT_STAGES)(
    'draws the hero at least 8 percent of the short side held upright on %s',
    (_id, w, h) => {
      const size = chooseLogicalSize(def, w, h);
      const scale = Math.min(w / size.width, h / size.height);
      const hero = HERO_DRAW_H * scale * zoomFor(size.height * scale);
      expect(hero / Math.min(w, h)).toBeGreaterThanOrEqual(0.08);
    },
  );

  it('keeps the design framing on desktops and tablets', () => {
    expect(zoomFor(744)).toBe(1); // 1280x800 desktop canvas
    expect(zoomFor(691)).toBe(1); // 1024x768 tablet canvas
    expect(zoomFor(0)).toBe(1); // size not known yet
  });

  it('zooms the world on phones held sideways', () => {
    expect(zoomFor(360)).toBeCloseTo(1.4);
    expect(zoomFor(430)).toBeCloseTo(1.4);
  });

  it('zooms a phone held upright more, easing back to the sideways zoom', () => {
    for (const cssH of [243, 263, 290]) expect(zoomFor(cssH)).toBeCloseTo(1.9);
    expect(zoomFor(330)).toBeGreaterThan(1.4);
    expect(zoomFor(330)).toBeLessThan(1.9);
  });

  it('keeps every HUD pill inside and apart on a wide view (one row, the world pill below)', () => {
    // L1: 1032 logical px at the 1.4 sideways zoom leaves a 737 px view; the HUD sits 12 px in.
    const left = 12;
    const right = 1032 / 1.4 - 12;
    const layout = hudLayout(left, right, 12);
    expectTidyHud(layout, left, right);
    expect(layout.score.y).toBe(layout.coins.y);
    expect(layout.clock.y).toBe(layout.lives.y);
  });

  it('stacks the HUD into two rows that fit the view of a phone held upright', () => {
    // 800 logical px at the 1.9 upright zoom leaves a 421 px view.
    const left = 12;
    const right = 800 / 1.9 - 12;
    const layout = hudLayout(left, right, 12);
    expectTidyHud(layout, left, right);
    expect(layout.score.y).toBe(layout.clock.y);
    expect(layout.world.y).toBe(layout.lives.y);
    expect(layout.world.y).toBeGreaterThan(layout.score.y);
    expect(layout.bottom).toBe(12 + 2 * HUD_H + 8);
  });

  it('leaves the HUD at its design size on desktops, tablets and landscape phones', () => {
    expect(hudFloorPx(744, 1)).toBeLessThan(18); // 1280x800 desktop canvas
    expect(hudFloorPx(691, 1)).toBeLessThan(18); // 1024x768 tablet canvas
    expect(hudFloorPx(360, zoomFor(360))).toBeLessThan(18); // L1 canvas
    expect(hudFloorPx(0, 1)).toBe(0); // size not known yet
  });

  it.each([243, 263, 290])(
    'draws the smallest HUD label at least 12.5 CSS px on a %s px tall portrait canvas',
    (cssH) => {
      const zoom = zoomFor(cssH);
      const cssPerPx = (cssH / (ROWS * T)) * zoom;
      expect(Math.max(18, hudFloorPx(cssH, zoom)) * cssPerPx).toBeGreaterThanOrEqual(12.5 - 1e-9);
    },
  );

  it('frames the hero and the ground above the touch controls while zoomed', () => {
    // An L1 canvas: 1032x540 logical, 360 CSS px tall, so the world is drawn 1.4x bigger.
    const ctx = mockCtx();
    (ctx as unknown as { canvas: { clientHeight: number } }).canvas = { clientHeight: 360 };
    const input = new Input();
    const bottom = 120; // logical px covered by the touch buttons
    const g = def.create({
      ctx,
      width: 1032,
      height: 540,
      insets: { top: 0, right: 0, bottom, left: 0 },
      input,
      audio: new NullAudio(),
      rng: new Rng(1),
      loadout: { skin: toSkinData(defaultSkin('platformer')), boosts: new Set(), powerDuration: 1 },
      reducedMotion: false,
      haptic: () => undefined,
    }) as unknown as Framed;
    expect(g.vh).toBeCloseTo(540 / 1.4);
    g.enemies.length = 0;
    input.setVirtual('right', true, 'test');
    for (let i = 0; i < Math.round(2.5 * 60); i++) {
      g.update(DT);
      input.postUpdate();
    }
    g.render();
    const p = g.player;
    const feet = p.y + p.h - g.camY;
    // Feet and a strip of floor stay above the covered strip (bottom inset in virtual px).
    expect(feet).toBeLessThanOrEqual(g.vh - bottom / 1.4 - 16);
    expect(p.y - g.camY).toBeGreaterThan(60 / 1.4);
  });

  it('keeps the upright hero under the two-row HUD and the ground in view while running', () => {
    // A phone held upright ("Play anyway"): an 800 x 540 run on a 263 CSS px tall canvas, so 1.9x zoom.
    const ctx = mockCtx();
    (ctx as unknown as { canvas: { clientHeight: number } }).canvas = { clientHeight: 263 };
    const input = new Input();
    const g = def.create({
      ctx,
      width: 800,
      height: 540,
      insets: NO_INSETS,
      input,
      audio: new NullAudio(),
      rng: new Rng(1),
      loadout: { skin: toSkinData(defaultSkin('platformer')), boosts: new Set(), powerDuration: 1 },
      reducedMotion: false,
      haptic: () => undefined,
    }) as unknown as Framed;
    expect(g.vh).toBeCloseTo(540 / 1.9);
    g.enemies.length = 0;
    input.setVirtual('right', true, 'test');
    for (let i = 0; i < Math.round(2.5 * 60); i++) {
      g.update(DT);
      input.postUpdate();
    }
    g.render();
    const p = g.player;
    // The hero is below both HUD rows (12 px padding, two 40 px rows, an 8 px gap) and its feet are in view.
    const hudBottom = 12 + 2 * HUD_H + 8;
    expect(p.y - g.camY).toBeGreaterThanOrEqual(hudBottom);
    expect(p.y + p.h - g.camY).toBeLessThanOrEqual(g.vh - 16);
  });

  it('shows the same view width held upright, whatever the run is wide', () => {
    expect(800 / zoomFor(263, 800)).toBeCloseTo(800 / 1.9, 6);
    expect(1096 / zoomFor(192, 1096)).toBeCloseTo(800 / 1.9, 6);
  });

  it.each(WIDE_UPRIGHT)('keeps the hero at least 8 percent of the short side on %s', (_name, w, h, runW) => {
    const scale = Math.min(w / runW, h / (ROWS * T));
    const hero = HERO_DRAW_H * scale * zoomFor(ROWS * T * scale, runW);
    expect(hero / Math.min(w, h)).toBeGreaterThanOrEqual(0.08);
  });

  it.each(WIDE_UPRIGHT)('draws the smallest HUD label at least 12.5 CSS px on %s', (_name, w, h, runW) => {
    const scale = Math.min(w / runW, h / (ROWS * T));
    const cssH = ROWS * T * scale;
    const zoom = zoomFor(cssH, runW);
    expect(Math.max(18, hudFloorPx(cssH, zoom)) * scale * zoom).toBeGreaterThanOrEqual(12.5 - 1e-9);
  });

  it('keeps the hero under the two-row HUD and the ground in view on a wide run held upright', () => {
    // A 1096 px run turned upright: its 192 CSS px tall canvas gets the same 421 px view as an 800 px run.
    const ctx = mockCtx();
    (ctx as unknown as { canvas: { clientHeight: number } }).canvas = { clientHeight: 192 };
    const input = new Input();
    const g = def.create({
      ctx,
      width: 1096,
      height: 540,
      insets: NO_INSETS,
      input,
      audio: new NullAudio(),
      rng: new Rng(1),
      loadout: { skin: toSkinData(defaultSkin('platformer')), boosts: new Set(), powerDuration: 1 },
      reducedMotion: false,
      haptic: () => undefined,
    }) as unknown as Framed;
    expect(g.vw).toBeCloseTo(800 / 1.9, 0);
    g.enemies.length = 0;
    input.setVirtual('right', true, 'test');
    for (let i = 0; i < Math.round(2.5 * 60); i++) {
      g.update(DT);
      input.postUpdate();
    }
    g.render();
    const p = g.player;
    const hudBottom = 12 + 2 * HUD_H + 8;
    expect(p.y - g.camY).toBeGreaterThanOrEqual(hudBottom);
    expect(p.y + p.h - g.camY).toBeLessThanOrEqual(g.vh - 16);
  });
});
