import { clamp } from '../../core/math';

// World units are metres and seconds. Everything that decides fairness lives here so the
// simulation, the track generator and the tests agree on one set of numbers.

export const LANE_W = 2.4;
export const TRAIN_H = 3.3;
/** Half-width of a train or barrier, centred on its lane. */
export const TRAIN_HW = 1.05;
export const STAND_H = 1.8;
export const ROLL_H = 0.8;
/** Low barriers are jumped; high barriers (board between HIGH_BOTTOM and HIGH_TOP) are rolled under. */
export const LOW_TOP = 1.0;
export const HIGH_BOTTOM = 1.25;
export const HIGH_TOP = 2.6;
/** Altitude the jetpack holds (feet). Kept below the catenary gantries. */
export const JETPACK_Y = 5;

/** Obstacle-free run-in at the start of every run. */
export const WARMUP_M = 120;
/** Every milestone raises the multiplier, changes the zone palette and shows a banner. */
export const MILESTONE_M = 1000;
export const MAX_MULTIPLIER = 8;
/** The track is generated this far ahead of the runner (beyond the longest view distance). */
export const GEN_AHEAD = 215;

export const laneX = (lane: number): number => (lane - 1) * LANE_W;
export const laneOf = (x: number): number => clamp(Math.round(x / LANE_W) + 1, 0, 2);

/**
 * Eased run progress e(d) in [0, 1). One curve drives speed, pattern weights and spacing, so
 * difficulty rises quickly early on and keeps creeping up in long runs instead of freezing.
 */
export function progressAt(d: number): number {
  return 1 - Math.exp(-Math.max(0, d) / 2400);
}

/** Target running speed in m/s: 13 at the start, soft-capped just under 33. Independent of screen size. */
export function speedAt(d: number): number {
  return 13 + 20 * progressAt(d);
}

/** Visible track length: more lookahead at speed, so reaction time stays roughly constant. */
export function viewDistance(v: number): number {
  return clamp(5.5 * v, 110, 175);
}

/**
 * Movement tuning scaled by speed (k = v / 14) so moves cover similar track distances at any
 * speed: the jump apex stays the same while airtime shrinks, rolls get shorter and lane changes
 * snappier. Updated once per simulation step.
 */
export class Kinematics {
  speed = 14;
  gravity = 34;
  jumpV = 11.5;
  superJumpV = 15.5;
  slamV = -26;
  rollTime = 0.62;
  laneRate = 16;
  /** Run-cycle frequency in Hz (2.5 Hz at 13 m/s, 3.4 Hz at 33 m/s). */
  strideHz = 2.5;

  update(v: number): this {
    const k = clamp(v / 14, 0.85, 2.6);
    const k35 = Math.pow(k, 0.35);
    this.speed = v;
    this.gravity = 34 * Math.pow(k, 0.7);
    this.jumpV = 11.5 * k35;
    this.superJumpV = 15.5 * k35;
    this.slamV = -26 * k35;
    this.rollTime = 0.62 / k35;
    this.laneRate = 16 * Math.sqrt(k);
    this.strideHz = 1.9 + 0.045 * v;
    return this;
  }

  /** Time in the air for a normal jump from flat ground. */
  get airtime(): number {
    return (2 * this.jumpV) / this.gravity;
  }

  /** Take-off speed that clears a train roof from the track (used for vaults during grace). */
  get vaultV(): number {
    return Math.sqrt(2 * this.gravity * (TRAIN_H + 0.5));
  }
}

/** Airtime of a normal jump at speed v (used by the generator to space zigzag rows). */
export function airtimeAt(v: number): number {
  const k = clamp(v / 14, 0.85, 2.6);
  return ((2 * 11.5) / 34) * Math.pow(k, -0.35);
}
