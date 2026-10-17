import { describe, expect, it } from 'vitest';
import { chooseLogicalSize, fittedArea } from '../src/core/engine';
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
