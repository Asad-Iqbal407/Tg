import { clamp } from '../../core/math';
import type { Insets } from '../types';

/** Sizes are authored for a canvas this tall; a run scales them by its logical height. */
export const DESIGN_H = 600;
export const PADDLE_W = 12;
/** Gap between a paddle and the table's side edge. */
export const PADDLE_INSET = 22;
/** Paddle height as a share of the playfield height, so phones keep a reachable paddle. */
export const PADDLE_FRAC = 0.2;
export const BALL_R = 8;
const HEAD_FRAC = 0.1;
const HEAD_MIN = 44;
const HEAD_MAX = 64;

/** The ball's state in logical px and px/s. `speed` is the rally speed the velocity is scaled from. */
export interface Ball {
  x: number;
  y: number;
  vx: number;
  vy: number;
  speed: number;
}

/** The playfield in logical px: between the score band above and the on-screen controls below. */
export interface Table {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** Height of the score band above the playfield. */
export function headHeight(H: number): number {
  return clamp(H * HEAD_FRAC, HEAD_MIN, HEAD_MAX);
}

/** The playfield height the speeds are authored for: a design canvas less its score band. */
export const DESIGN_TABLE_H = DESIGN_H - headHeight(DESIGN_H);

/** Half the rail thickness, in design px: the bottom edge stays this far up so the whole rail shows. */
const RAIL_HALF = 2;

/** The playfield for a logical size and live insets. The bottom edge stops above touch controls. */
export function tableFor(W: number, H: number, ins: Readonly<Insets>): Table {
  const top = ins.top + headHeight(H);
  const bottom = Math.max(top + H * 0.3, H - ins.bottom - (RAIL_HALF * H) / DESIGN_H);
  return { left: ins.left, right: W - ins.right, top, bottom };
}

/**
 * How fast the ball and paddles move on this table, relative to the design table: 1 at the design size. Speeds
 * follow the table, not the canvas, so a rally takes the same time to cross on a phone as on the design canvas.
 */
export function speedScale(t: Table): number {
  return (t.bottom - t.top) / DESIGN_TABLE_H;
}

/** Half the paddle height for this playfield. */
export function paddleHalf(t: Table): number {
  return ((t.bottom - t.top) * PADDLE_FRAC) / 2;
}

/** The x of the left paddle's right face: a ball moving left stops here. */
export function frontLeft(t: Table, u: number): number {
  return t.left + (PADDLE_INSET + PADDLE_W) * u;
}

/** The x of the right paddle's left face: a ball moving right stops here. */
export function frontRight(t: Table, u: number): number {
  return t.right - (PADDLE_INSET + PADDLE_W) * u;
}

/**
 * Where a ball moving in a straight line with wall bounces will be when it reaches `contactX`, folded into the
 * band [lo, hi] (the walls, already inset by the ball radius). The ball must be moving toward `contactX`.
 */
export function meetY(ball: Readonly<Ball>, contactX: number, lo: number, hi: number): number {
  const span = hi - lo;
  if (span <= 0) return (lo + hi) / 2;
  const t = Math.max(0, (contactX - ball.x) / ball.vx);
  let m = (ball.y + ball.vy * t - lo) % (2 * span);
  if (m < 0) m += 2 * span;
  if (m > span) m = 2 * span - m;
  return lo + m;
}
