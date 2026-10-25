import { clamp } from '../../core/math';
import type { Rng } from '../../core/rng';

export interface Gate {
  /** Left edge in world px (the course scrolls left, so x shrinks on screen). */
  x: number;
  gapY: number;
  gapH: number;
  coin: boolean;
  passed: boolean;
}

/** Design-px sizes, scaled by u. */
export const GATE_W = 92;
export const GATE_SPACING = 310;
const GAP_START = 290;
const GAP_MIN = 205;
/** The gap narrows by this much per gate until it reaches GAP_MIN (about gate 43). */
const GAP_STEP = 2;
/** Largest jump in gap height between neighbouring gates, so every gap can be reached in time. */
const MAX_SHIFT = 230;
const COIN_CHANCE = 0.4;

/** Gap height for the gate with this index (0 is the first). */
export function gapFor(index: number, u: number): number {
  return Math.max(GAP_MIN, GAP_START - GAP_STEP * index) * u;
}

/**
 * The next gate after one centred at `prevY`. Its gap stays between `minY` and `maxY` (the open sky between the
 * HUD and the ground) and within MAX_SHIFT of the previous gap.
 */
export function nextGate(
  rng: Rng,
  index: number,
  x: number,
  prevY: number,
  minY: number,
  maxY: number,
  u: number,
): Gate {
  const gapH = gapFor(index, u);
  const lo = minY + gapH / 2;
  const hi = Math.max(lo, maxY - gapH / 2);
  const shift = MAX_SHIFT * u;
  const from = clamp(prevY - shift, lo, hi);
  const to = clamp(prevY + shift, lo, hi);
  const gapY = rng.range(from, to);
  return { x, gapY, gapH, coin: rng.chance(COIN_CHANCE), passed: false };
}
