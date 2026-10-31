import { describe, expect, it } from 'vitest';
import { chooseLogicalSize, fittedArea } from '../src/core/engine';
import { bannerBand, POWER_PILL_W } from '../src/games/runner/runner';
import { gameById } from './helpers';

const def = gameById('runner');

/** Play stage of each portrait phone in the test matrix: the viewport minus the 50 px play header. */
const PORTRAIT_STAGES: [string, number, number][] = [
  ['P1', 360, 690],
  ['P2', 390, 794],
  ['P3', 430, 882],
];

describe('Metro Dash layout', () => {
  it('is designed for portrait phones', () => {
    expect(def.orientation).toBe('portrait');
  });

  it.each(PORTRAIT_STAGES)('fills the %s phone stage', (_id, w, h) => {
    const size = chooseLogicalSize(def, w, h);
    expect(fittedArea(size, w, h) / (w * h)).toBeGreaterThanOrEqual(0.85);
    const v = def.viewport ?? {};
    expect(size.width).toBeGreaterThanOrEqual(v.minWidth ?? def.width);
    expect(size.width).toBeLessThanOrEqual(v.maxWidth ?? def.width);
    expect(size.height).toBeGreaterThanOrEqual(v.minHeight ?? def.height);
    expect(size.height).toBeLessThanOrEqual(v.maxHeight ?? def.height);
  });
});

describe('Metro Dash announcements', () => {
  // HUD scale and the horizon (minus the 40 px margin) of a P2 run, 540 x 1100.
  const s = 0.97;
  const top = 14 * s;
  const left = 14 * s;
  const skyBottom = 320;
  // Half width of a typical milestone subtitle ('HARBOR DUSK · SPEED UP · x2' at 19 px), about 150 px.
  const halfW = 150;

  it('draws the milestone banner below a full power-up stack (regression: it drew over the timers)', () => {
    // Four power-ups and the Guardian: five 40 px rows under the 54 px coin counter.
    const stackBottom = top + 54 * s + 5 * 40 * s;
    const band = bannerBand(540, top, left, stackBottom, s, skyBottom, halfW);
    const size = Math.min(54 * s, 540 / 8);
    // The title's ascent is about 0.7 of its size above the banner centre.
    expect(band.y - 0.7 * size).toBeGreaterThanOrEqual(stackBottom);
  });

  it('keeps the banner halfway down the sky when no power-up is running', () => {
    const band = bannerBand(540, top, left, top + 54 * s, s, skyBottom, halfW);
    expect(band.y).toBeCloseTo((top + 92 * s + skyBottom) / 2, 6);
  });

  it('moves the CAREFUL! warning clear of the power-up stack on a narrow, scaled-up HUD', () => {
    const big = 1.3;
    const band = bannerBand(540, 14 * big, 14 * big, 400, big, skyBottom, halfW);
    expect(band.carefulX - 70 * big).toBeGreaterThanOrEqual(14 * big + POWER_PILL_W * big);
    expect(band.carefulX + 70 * big).toBeLessThanOrEqual(540);
    // On a wide canvas it stays centred.
    expect(bannerBand(1280, top, left, 400, s, skyBottom, halfW).carefulX).toBe(640);
  });

  it('keeps the banner in the sky on a wide canvas with a full power-up stack (regression: it drew over the track)', () => {
    // D1 run, 1536 x 960 at HUD scale 1: the stack sits at x 14..184, far left of the centred banner.
    const hs = 1;
    const sky = 211;
    const stackBottom = 14 + 54 + 5 * 40;
    const band = bannerBand(1536, 14, 14, stackBottom, hs, sky, halfW);
    expect(band.y).toBeCloseTo((14 + 92 + sky) / 2, 6);
    const size = Math.min(54, 1536 / 8);
    expect(band.y + 0.62 * size).toBeLessThanOrEqual(sky);
    // A three-row stack must not push it either.
    expect(bannerBand(1536, 14, 14, 14 + 54 + 3 * 40, hs, sky, halfW).y).toBeCloseTo(band.y, 6);
  });

  it('still drops the banner below the stack when a wide banner reaches across it', () => {
    const stackBottom = 14 + 54 + 5 * 40;
    // A 1200 px wide banner on a 1536 px canvas starts at x 168, inside the 184 px stack.
    const band = bannerBand(1536, 14, 14, stackBottom, 1, 211, 600);
    expect(band.y - 0.7 * 54).toBeGreaterThanOrEqual(stackBottom);
  });
});
