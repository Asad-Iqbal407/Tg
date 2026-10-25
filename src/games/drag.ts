/**
 * Relative touch steering along one axis, like a trackpad: the paddle moves by how far the finger moves (times
 * `gain`), not to where the finger is. The finger can rest anywhere, never hides the paddle, and a short drag
 * crosses the whole field. Because it adds up movement step by step, a paddle held at a wall turns back as soon
 * as the finger does.
 */
export class TouchDrag {
  private last: number | null = null;

  /**
   * The paddle position after this step's finger movement, or null when no finger is down. `pos` is the finger
   * position on the axis; `jump` is the largest move in one step still read as dragging (a bigger one is a
   * different finger taking over, so it re-anchors instead of moving the paddle).
   */
  update(
    down: boolean,
    pressed: boolean,
    pos: number,
    value: number,
    gain: number,
    jump: number,
  ): number | null {
    if (!down) {
      this.last = null;
      return null;
    }
    const last = this.last;
    this.last = pos;
    if (pressed || last === null || Math.abs(pos - last) > jump) return value;
    return value + (pos - last) * gain;
  }
}

/** Tap detection: a press that lifts within `maxSec` and moves less than `slop` counts as a tap. */
export class TapTracker {
  private start: { x: number; y: number; t: number } | null = null;
  private moved = false;

  /** True on the step a tap ends. `time` is the game's simulation clock. */
  update(
    down: boolean,
    pressed: boolean,
    released: boolean,
    x: number,
    y: number,
    time: number,
    slop: number,
    maxSec: number,
  ): boolean {
    if (pressed) {
      this.start = { x, y, t: time };
      this.moved = false;
    }
    const s = this.start;
    if (s && down && Math.hypot(x - s.x, y - s.y) > slop) this.moved = true;
    if (!released || !s) return false;
    this.start = null;
    return !this.moved && time - s.t <= maxSec;
  }
}
