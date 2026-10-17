import { describe, expect, it } from 'vitest';
import { NullAudio } from '../src/core/audio';
import { chooseLogicalSize, fittedArea } from '../src/core/engine';
import { Input } from '../src/core/input';
import { Rng } from '../src/core/rng';
import { zoomFor } from '../src/games/platformer/platformer';
import type { GameInstance } from '../src/games/types';
import { defaultSkin, toSkinData } from '../src/meta/catalog';
import { gameById, mockCtx } from './helpers';

const def = gameById('platformer');
const DT = 1 / 60;
/** Collision height of the small hero in logical px (see loadLevel). */
const HERO_H = 32;

/** Play stage of each landscape phone in the test matrix: the viewport minus the 52 px play rail. */
const LANDSCAPE_STAGES: [string, number, number][] = [
  ['L1', 688, 360],
  ['L2', 792, 390],
  ['L3', 880, 430],
];

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
    const hero = HERO_H * scale * zoomFor(size.height * scale);
    expect(hero / Math.min(w, h)).toBeGreaterThanOrEqual(0.08);
  });

  it('keeps the design framing on desktops and tablets', () => {
    expect(zoomFor(744)).toBe(1); // 1280x800 desktop canvas
    expect(zoomFor(691)).toBe(1); // 1024x768 tablet canvas
    expect(zoomFor(0)).toBe(1); // size not known yet
  });

  it('zooms the world on phones held sideways', () => {
    expect(zoomFor(360)).toBeCloseTo(1.4);
    expect(zoomFor(430)).toBeCloseTo(1.4);
  });

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
});
