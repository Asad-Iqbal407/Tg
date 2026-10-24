import type { Insets } from '../types';

/** Camera height above the track and distance behind the runner (m). */
export const CAM_H = 8.4;
export const CAM_D = 9.4;
/** Focal length (px) at the 960 px design height: telephoto enough that 40-80 m threats read clearly. */
export const BASE_FOCAL = 600;
/** Nearest drawable z relative to the runner (1.4 m in front of the camera plane). */
export const NEAR = -CAM_D + 1.4;

/**
 * Fits the camera to any logical size: the projection centres on W/2, the world scales with the
 * height (or with the width on very tall screens, so all three lanes stay visible) and the
 * runner's feet sit at ~82% of the height, lifted above a bottom inset. Insets are live, so this
 * is refreshed every frame (in place, without allocating).
 */
export class Framing {
  /** Uniform scale of the world projection relative to the 540x960 design. */
  unit = 1;
  focal = BASE_FOCAL;
  /** Screen y of the runner's feet on flat ground. */
  feetY = 787;

  update(W: number, H: number, insets: Readonly<Insets>): this {
    this.unit = Math.min(H / 960, W / 520);
    this.focal = BASE_FOCAL * this.unit;
    this.feetY = Math.min(0.82 * H, H - insets.bottom - 0.1 * H);
    return this;
  }

  /** Horizon y for a focal length, keeping the feet where they are. */
  horizonFor(focal: number): number {
    return this.feetY - (CAM_H * focal) / CAM_D;
  }
}

/**
 * Perspective camera behind and above the runner. Projections write into fields and the path
 * helpers add sub-paths straight to the context, so drawing a frame allocates nothing.
 */
export class Camera {
  /** Screen x of the camera axis, horizon y and focal length (px). */
  cx = 270;
  hz = 251;
  f = BASE_FOCAL;
  /** Camera height (m, including the roof lift) and lateral position (m). */
  h = CAM_H;
  x = 0;
  /** Output of the last project() call. */
  px = 0;
  py = 0;
  ps = 0;

  /** Pixels per metre at depth z (relative to the runner). */
  scale(z: number): number {
    return this.f / Math.max(0.3, z + CAM_D);
  }

  project(x: number, y: number, z: number): this {
    const s = this.scale(z);
    this.ps = s;
    this.px = this.cx + (x - this.x) * s;
    this.py = this.hz + (this.h - y) * s;
    return this;
  }

  sx(x: number, s: number): number {
    return this.cx + (x - this.x) * s;
  }

  sy(y: number, s: number): number {
    return this.hz + (this.h - y) * s;
  }

  /** Quad on the vertical plane at `x` (a side face), spanning z0..z1 and y0..y1. */
  side(ctx: CanvasRenderingContext2D, x: number, y0: number, y1: number, z0: number, z1: number): void {
    this.sideTrap(ctx, x, z0, y0, y1, z1, y0, y1);
  }

  /** Trapezoid on the plane at `x`: bottom/top heights ya0..ya1 at za and yb0..yb1 at zb. */
  sideTrap(
    ctx: CanvasRenderingContext2D,
    x: number,
    za: number,
    ya0: number,
    ya1: number,
    zb: number,
    yb0: number,
    yb1: number,
  ): void {
    const sa = this.scale(za);
    const sb = this.scale(zb);
    const xa = this.cx + (x - this.x) * sa;
    const xb = this.cx + (x - this.x) * sb;
    ctx.moveTo(xa, this.hz + (this.h - ya0) * sa);
    ctx.lineTo(xb, this.hz + (this.h - yb0) * sb);
    ctx.lineTo(xb, this.hz + (this.h - yb1) * sb);
    ctx.lineTo(xa, this.hz + (this.h - ya1) * sa);
    ctx.closePath();
  }

  /** Quad on the horizontal plane at height y, spanning x0..x1 and z0..z1. */
  flat(ctx: CanvasRenderingContext2D, x0: number, x1: number, y: number, z0: number, z1: number): void {
    this.slope(ctx, x0, x1, y, z0, y, z1);
  }

  /** Inclined quad spanning x0..x1, rising from (ya at za) to (yb at zb). */
  slope(
    ctx: CanvasRenderingContext2D,
    x0: number,
    x1: number,
    ya: number,
    za: number,
    yb: number,
    zb: number,
  ): void {
    const sa = this.scale(za);
    const sb = this.scale(zb);
    const yA = this.hz + (this.h - ya) * sa;
    const yB = this.hz + (this.h - yb) * sb;
    ctx.moveTo(this.cx + (x0 - this.x) * sa, yA);
    ctx.lineTo(this.cx + (x1 - this.x) * sa, yA);
    ctx.lineTo(this.cx + (x1 - this.x) * sb, yB);
    ctx.lineTo(this.cx + (x0 - this.x) * sb, yB);
    ctx.closePath();
  }

  /** Axis-aligned rectangle on the plane at depth z (a front face). */
  front(ctx: CanvasRenderingContext2D, x0: number, x1: number, y0: number, y1: number, z: number): void {
    const s = this.scale(z);
    const left = this.cx + (x0 - this.x) * s;
    const top = this.hz + (this.h - y1) * s;
    ctx.rect(left, top, (x1 - x0) * s, (y1 - y0) * s);
  }

  /** Segment from (x, y0) to (x, y1) at depth z, e.g. a pole. */
  vline(ctx: CanvasRenderingContext2D, x: number, y0: number, y1: number, z: number): void {
    const s = this.scale(z);
    const sx = this.cx + (x - this.x) * s;
    ctx.moveTo(sx, this.hz + (this.h - y0) * s);
    ctx.lineTo(sx, this.hz + (this.h - y1) * s);
  }
}
