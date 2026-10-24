import type { PointerState } from '../../core/input';

/** What a touch on the well asks for in this step. */
export type DropGesture = 'none' | 'soft' | 'hard';

/** A flick has to cover its distance within this many seconds of the touch starting. */
const FLICK_SEC = 0.3;
/** Flick distance and soft-drag distance, as fractions of the well height so they track the logical size. */
const FLICK_FRAC = 0.08;
const SOFT_FRAC = 0.06;

/**
 * Reads a finger on the well as a drop. A flick down that is far and fast enough is a hard drop, once per touch.
 * A drag still held, past the flick window, at least a little way below where the touch began is a soft drop, for
 * as long as the finger rests there. The soft drag waits for the window to close, so a flick never drops a row
 * softly on its way. Sideways drags are not drops (they steer through the swipe events), and mouse input is
 * ignored, so the keyboard and the mouse keep their own controls.
 */
export class TouchDrop {
  private readonly flickPx: number;
  private readonly softPx: number;
  private tracking = false;
  private flicked = false;
  private startX = 0;
  private startY = 0;
  private startT = 0;

  constructor(height: number) {
    this.flickPx = height * FLICK_FRAC;
    this.softPx = height * SOFT_FRAC;
  }

  /** Call once per simulation step with the game pointer and the simulation time. */
  update(pointer: Readonly<PointerState>, now: number): DropGesture {
    // A release ends the touch. A hand-over to a second finger also reads as a release, so it starts no gesture.
    if (pointer.released) this.tracking = false;
    if (pointer.pressed && pointer.touch) {
      this.tracking = true;
      this.flicked = false;
      this.startX = pointer.x;
      this.startY = pointer.y;
      this.startT = now;
    }
    if (!this.tracking || !pointer.down) {
      this.tracking = false;
      return 'none';
    }
    if (this.flicked) return 'none';
    const dx = pointer.x - this.startX;
    const dy = pointer.y - this.startY;
    if (dy <= Math.abs(dx)) return 'none';
    const within = now - this.startT <= FLICK_SEC;
    if (dy >= this.flickPx && within) {
      this.flicked = true;
      return 'hard';
    }
    return dy >= this.softPx && !within ? 'soft' : 'none';
  }
}
