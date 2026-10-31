/** Hero physics, in logical px and seconds. Speeds stay constant across levels (muscle memory). */
export const PHYS = {
  accel: 1500,
  airAccel: 1050,
  friction: 1900,
  walkMax: 215,
  runMax: 335,
  jumpV: 800,
  /** Gravity while rising with jump held. */
  gHold: 1750,
  /** Gravity while rising after jump was released. */
  gRelease: 2600,
  gFall: 2600,
  maxFall: 950,
  /** Releasing jump caps the upward speed at this, so a quick tap gives a ~1.4 tile hop. */
  jumpCutV: 440,
  coyote: 0.09,
  buffer: 0.12,
  /** Max px the hero is nudged sideways around a ceiling corner instead of bonking. */
  cornerNudge: 8,
  /** After a stomp, overlaps from above keep counting as stomps for this long. */
  stompGrace: 0.1,
} as const;

/** Base enemy walking speeds and the kicked-shell speed at level 1. */
export const ENEMY_SPEED = { walker: 60, shellback: 60, spiky: 50, shell: 430 } as const;

/** Levels per world: courses are labelled 1-1 … 1-4, 2-1 … */
export const STAGES_PER_WORLD = 4;

/** Seconds left on the clock at which the HURRY UP warning fires. */
export const HURRY_TIME = 30;

/** World/stage label for a 1-based level number, e.g. level 5 is "2-1". */
export function worldLabel(level: number): string {
  const world = Math.ceil(level / STAGES_PER_WORLD);
  const stage = ((level - 1) % STAGES_PER_WORLD) + 1;
  return `${world}-${stage}`;
}

/** Enemy speed multiplier: +7% per level, capped at +45%. Kicked shells cap at +20%. */
export function enemySpeedScale(level: number, shell = false): number {
  return Math.min(shell ? 1.2 : 1.45, 1 + 0.07 * (level - 1));
}

/**
 * Seconds on the clock for a course `widthPx` wide: the time to walk it, times a slack factor that
 * shrinks from 2.6x (level 1) to 1.7x (level 9+), plus 20 s. About 80 s at level 1 and 90 s at
 * level 8, so dawdling (or dying late) actually costs something.
 */
export function levelTimeLimit(widthPx: number, level: number): number {
  const walkSeconds = widthPx / PHYS.walkMax;
  return Math.round(walkSeconds * Math.max(1.7, 2.6 - 0.12 * (level - 1)) + 20);
}

/** Probability that a long flat stretch gets an extra walker (level 4 onwards). */
export function extraWalkerChance(level: number): number {
  return level < 4 ? 0 : Math.min(0.6, 0.1 * (level - 3));
}
