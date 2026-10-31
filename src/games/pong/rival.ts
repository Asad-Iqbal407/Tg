import { clamp } from '../../core/math';
import type { Rng } from '../../core/rng';
import { type Ball, BALL_R, frontRight, meetY, type Table } from './geometry';

/** Seconds between the computer's looks at the ball. A shot that comes after a look waits for the next one. */
const PERCEIVE_SEC = 0.2;
/**
 * Top paddle speed in design px/s, scaled to the table. The player's keyboard speed is higher, so a well-timed
 * player can beat it.
 */
const RIVAL_SPEED = 470;
/** How far from the middle of its paddle the computer aims, as a share of half the paddle. */
const AIM_SPREAD = 0.7;
/** Share of shots the computer aims past the edge of its paddle on purpose. */
const MISS_CHANCE = 0.2;

/** The computer's paddle: it plans where to meet each shot, and moves toward that plan at a capped speed. */
export class Rival {
  /** Centre of the computer's paddle, in logical px. */
  y: number;
  private target: number;
  private timer = 0;
  /** Where on the paddle the computer will try to meet the current shot, from the ball's predicted position. */
  private offset = 0;
  /** Whether the current shot is a planned miss. A planned miss has to stay a miss at the walls, see `plan`. */
  private miss = false;

  constructor(
    private readonly rng: Rng,
    centre: number,
  ) {
    this.y = centre;
    this.target = centre;
  }

  /**
   * Picks the aim for a shot that is coming its way. Most shots aim near the middle of the paddle. Some aim past
   * the edge, so the computer misses them.
   */
  aim(half: number): void {
    this.miss = this.rng.chance(MISS_CHANCE);
    if (this.miss) {
      const side = this.rng.chance(0.5) ? 1 : -1;
      this.offset = side * half * this.rng.range(1.35, 1.7);
    } else {
      this.offset = this.rng.range(-AIM_SPREAD, AIM_SPREAD) * half;
    }
  }

  /**
   * One step. Every PERCEIVE_SEC the computer looks at an incoming ball and plans to meet it. Otherwise it drifts to
   * the middle. `u` sizes the ball and `k` scales speeds (see speedScale). The paddle moves toward the plan at
   * RIVAL_SPEED.
   */
  update(
    dt: number,
    ball: Readonly<Ball>,
    incoming: boolean,
    t: Table,
    half: number,
    u: number,
    k: number,
  ): void {
    const lo = t.top + half;
    const hi = t.bottom - half;
    this.timer -= dt;
    if (this.timer <= 0) {
      this.timer = PERCEIVE_SEC;
      if (incoming) {
        const r = BALL_R * u;
        this.target = this.plan(meetY(ball, frontRight(t, u) - r, t.top + r, t.bottom - r), lo, hi);
      } else {
        this.target = (t.top + t.bottom) / 2;
      }
    }
    const step = RIVAL_SPEED * k * dt;
    this.y = clamp(this.y + clamp(clamp(this.target, lo, hi) - this.y, -step, step), lo, hi);
  }

  /**
   * The paddle centre for a shot that arrives at `meet`. A planned miss must stay a miss: if it would run into a wall,
   * it goes to the other side instead, because clamping it to the wall would put the paddle back on the ball.
   */
  private plan(meet: number, lo: number, hi: number): number {
    const want = meet + this.offset;
    if (this.miss && (want < lo || want > hi)) return meet - this.offset;
    return want;
  }
}
