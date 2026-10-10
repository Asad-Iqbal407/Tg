import type { Rng } from '../../core/rng';

// Everything that decides pacing, difficulty and fairness lives here, so the simulation and the
// tests agree on one set of numbers.

export type DuckKind = 'green' | 'blue' | 'red' | 'gold';
export type PowerKind = 'slowmo' | 'scatter' | 'ammo';
/** 'wander' turns at random; 'zigzag' flips its climb at a steady beat (readable, from round 6). */
export type FlightPattern = 'wander' | 'zigzag';

export const DUCK_INFO: Readonly<
  Record<DuckKind, { speed: number; points: number; head: string; body: string; wing: string; belly: string }>
> = {
  green: { speed: 190, points: 500, head: '#1a7f3c', body: '#7a4e2a', wing: '#c8a165', belly: '#e8d5b0' },
  blue: { speed: 250, points: 1000, head: '#2a6fdb', body: '#3d3d7a', wing: '#8fa9e8', belly: '#d5dcf0' },
  red: { speed: 310, points: 1500, head: '#c0392b', body: '#5a2d0c', wing: '#e58e6d', belly: '#f2d0b5' },
  gold: { speed: 340, points: 3000, head: '#ffd23f', body: '#e0a100', wing: '#fff1a8', belly: '#fff6d0' },
};

export const POWER_INFO: Readonly<
  Record<PowerKind, { label: string; badge: string; color: string; dur: number }>
> = {
  slowmo: { label: 'SLOW-MO', badge: 'S', color: '#4dd9ff', dur: 6 },
  scatter: { label: 'SCATTER', badge: 'W', color: '#ffb703', dur: 9 },
  ammo: { label: '+3 SHELLS', badge: '+3', color: '#7CFC00', dur: 0 },
};

export const DUCKS_PER_ROUND = 10;
/** Time scale applied to ducks (and the fly-away clock) while slow-mo is active. */
export const SLOWMO_SCALE = 0.45;

/** Pacing in seconds. Tuned so ducks are in the air for well over half of a typical session. */
export const PACE = {
  /** The round banner shows this long; the first pair takes off under it at `introWave`. */
  intro: 1.2,
  introWave: 0.7,
  /** Mid-air freeze after a hit, before the fall. */
  hitFreeze: 0.22,
  fallGravity: 2400,
  fallMaxSpeed: 1100,
  /** Climb speed of a duck that flies away. */
  escapeSpeed: 640,
  /** Full dog pop-up: rise, hold, sink. */
  dog: 1.0,
  dogRise: 0.18,
  dogSink: 0.3,
  /**
   * The next ducks take off this long after the last one of a wave was hit or fled, while the
   * shot ones are still falling; the dog pops up behind them once those have landed.
   */
  nextWave: 0.6,
  /** After the last wave of a round, the dog shows this long before the round result. */
  lastWaveHold: 0.45,
  roundEnd: 1.6,
  /** A click or Shoot press skips the round result banner after this long. */
  roundSkip: 0.6,
  /** With no shells left, the remaining ducks fly off this long after the last shot. */
  outOfShells: 0.3,
  /** "HURRY!" warning before the fly-away clock runs out. */
  hurry: 1.5,
  /** Ducks stay low and keep climbing for this long after leaving the grass. */
  emerge: 1.2,
} as const;

/** Keyboard / gamepad crosshair: accelerates while held, with light magnetism when slow. */
export const AIM = {
  minSpeed: 380,
  maxSpeed: 1100,
  /** Seconds of continuous hold to reach full speed. */
  ramp: 0.35,
  /** Velocity response (1/s): high enough to feel direct, low enough to feel analog. */
  response: 22,
  /** Magnetism radius around a flying duck (logical px). */
  assistRadius: 70,
  /** Magnetism only applies below this crosshair speed, so it never fights a deliberate move. */
  assistMaxSpeed: 520,
  /** Pull towards the duck (1/s) and the share of the duck's motion the crosshair follows. */
  assistPull: 6,
  assistFollow: 0.5,
} as const;

/** Extra hit radius for touch, where the finger hides the target. */
export const TOUCH_BONUS = 8;
export const SCATTER_RADIUS = 64;
/** Positions a duck remembers for lag-compensated hit tests (about 50 ms at 60 Hz). */
export const HISTORY = 3;

/**
 * Duck speed multiplier: eases in over the first dozen rounds (1.27x at round 4, 1.64x at 12),
 * then keeps creeping up by 2.5% a round so long runs still end, without ever jumping.
 */
export function roundSpeed(round: number): number {
  const r = Math.max(1, round);
  return 1 + 0.8 * (1 - Math.exp(-(r - 1) / 7)) + 0.025 * Math.max(0, r - 12);
}

/** Ducks to hit (of ten) to clear a round. */
export function requiredHits(round: number): number {
  return round <= 4 ? 6 : round <= 9 ? 7 : round <= 15 ? 8 : 9;
}

/** Rounds where the required hits step up get slightly slower ducks, so two ramps never stack. */
export function isStepRound(round: number): boolean {
  return round > 1 && requiredHits(round) > requiredHits(round - 1);
}

export function speedScale(round: number): number {
  return roundSpeed(round) * (isStepRound(round) ? 0.95 : 1);
}

/** Seconds a wave may fly before the ducks escape (triples get a little longer). */
export function flyTime(round: number, ducks: number): number {
  return Math.max(4.2, 7.4 - 0.2 * round) + (ducks > 2 ? 1 : 0);
}

/** Shells per wave: one spare per wave. */
export function shellsFor(ducks: number): number {
  return ducks + 1;
}

/** Hit radius (logical px) around the crosshair; also the radius the reticle ring is drawn at. */
export function hitRadius(round: number, touch: boolean, scatter: boolean): number {
  const base = scatter ? SCATTER_RADIUS : 36 + 6 * (roundSpeed(round) - 1);
  return base + (touch ? TOUCH_BONUS : 0);
}

/** Spawn weights per duck kind: fast kinds are capped and green ducks never drop below 15%. */
export function kindWeights(round: number): { value: DuckKind; weight: number }[] {
  const gold = Math.min(0.1, 0.04 + 0.003 * round);
  const red = Math.min(0.4, 0.15 + 0.02 * round);
  const blue = Math.min(0.4, 0.3 + 0.01 * round);
  const green = Math.max(0.15, 1 - gold - red - blue);
  return [
    { value: 'green', weight: green },
    { value: 'blue', weight: blue },
    { value: 'red', weight: red },
    { value: 'gold', weight: gold },
  ];
}

/** Chance that a duck flies the zig-zag pattern. */
export function zigzagChance(round: number): number {
  return round < 6 ? 0 : Math.min(0.3, 0.06 * (round - 5));
}

/** Ducks per wave for a round. From round 8, some rounds mix in triples (with four shells). */
export function wavePlan(round: number, rng: Rng): number[] {
  if (round >= 8 && rng.chance(Math.min(0.6, 0.15 * (round - 7)))) return rng.shuffle([3, 3, 2, 2]);
  return [2, 2, 2, 2, 2];
}

/** Seconds between random turns: faster ducks turn less often, so they stay fast but readable. */
export function turnInterval(round: number, kind: DuckKind, rng: Rng): number {
  return (rng.range(0.7, 1.6) * (0.8 + 0.4 * roundSpeed(round))) / (kind === 'gold' ? 1.4 : 1);
}

export function turnAngle(kind: DuckKind): number {
  return kind === 'gold' ? 1.3 : 1.0;
}
