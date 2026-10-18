import { describe, expect, it } from 'vitest';
import { chooseLogicalSize, fittedArea } from '../src/core/engine';
import { hudLayout, playfieldTop } from '../src/games/hill/hill';
import { GAMES } from '../src/games/registry';

/** Play-stage size (CSS px) for a browser window: a 52 px rail on short landscape screens, else a header. */
function stageFor(w: number, h: number): { w: number; h: number } {
  if (w > h && h <= 520) return { w: w - 52, h };
  return { w: w, h: h - (w <= 720 ? 50 : 56) };
}

const hill = GAMES.find((g) => g.id === 'hill')!;
const LANDSCAPE_PHONES: [string, number, number][] = [
  ['L1', 740, 360],
  ['L2', 844, 390],
  ['L3', 932, 430],
];

describe('hill layout', () => {
  it('is a landscape game whose viewport range fits every landscape phone and tablet', () => {
    expect(hill.orientation).toBe('landscape');
    const v = hill.viewport ?? {};
    for (const [name, w, h] of [...LANDSCAPE_PHONES, ['T2', 1024, 768] as const]) {
      const stage = stageFor(w, h);
      const size = chooseLogicalSize(hill, stage.w, stage.h);
      const fill = fittedArea(size, stage.w, stage.h) / (stage.w * stage.h);
      expect(fill, name).toBeGreaterThanOrEqual(0.85);
      expect(size.width, name).toBeGreaterThanOrEqual(v.minWidth ?? hill.width);
      expect(size.width, name).toBeLessThanOrEqual(v.maxWidth ?? hill.width);
      expect(size.height, name).toBeGreaterThanOrEqual(v.minHeight ?? hill.height);
      expect(size.height, name).toBeLessThanOrEqual(v.maxHeight ?? hill.height);
    }
  });

  it('keeps the desktop 1280 x 800 window at its design size', () => {
    const stage = stageFor(1280, 800);
    expect(chooseLogicalSize(hill, stage.w, stage.h)).toEqual({ width: 960, height: 558 });
  });

  it('keeps HUD text at 12 CSS px or more on landscape phones', () => {
    for (const [name, w, h] of LANDSCAPE_PHONES) {
      const stage = stageFor(w, h);
      const size = chooseLogicalSize(hill, stage.w, stage.h);
      const scale = Math.min(stage.w / size.width, stage.h / size.height);
      const { s } = hudLayout(size.width, true, true, 0);
      // The smallest HUD label is 13 px at the desktop scale (the "km/h" tag).
      expect(13 * s * scale, name).toBeGreaterThanOrEqual(12);
    }
  });

  it('starts the playfield just under the fuel chip on landscape phones, keeping the chip row whole', () => {
    for (const [name, w, h] of LANDSCAPE_PHONES) {
      const stage = stageFor(w, h);
      const size = chooseLogicalSize(hill, stage.w, stage.h);
      const lay = hudLayout(size.width, true, false, 0);
      const top = playfieldTop(size.width, true, false, 0);
      // The fuel chip ends 14 px from the top edge, plus the pill height, 6 s and the 26 s chip.
      const chipBottom = 14 + lay.ph + 32 * lay.s;
      expect(top, name).toBeGreaterThanOrEqual(chipBottom);
      expect(top - lay.bottom, name).toBeLessThanOrEqual(4);
      // The HUD used to reserve a top of 135 logical px on these screens.
      expect(top, name).toBeLessThan(130);
    }
  });

  it('keeps the desktop playfield at its original 80 px top', () => {
    expect(playfieldTop(960, false, false, 0)).toBe(80);
  });

  it('stacks the HUD into two rows only when one row does not fit the canvas', () => {
    expect(hudLayout(960, true, true, 0).stacked).toBe(false);
    expect(hudLayout(960, false, false, 0).stacked).toBe(false);
    expect(hudLayout(602, true, true, 0).stacked).toBe(true);
    expect(hudLayout(520, true, false, 0).stacked).toBe(true);
  });
});
