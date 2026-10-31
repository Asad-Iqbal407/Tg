import type { GameDefinition } from '../games/types';

export type Orientation = 'landscape' | 'portrait';

/** Short side (CSS px) under which a coarse-pointer screen counts as a phone rather than a tablet. */
export const PHONE_SHORT_SIDE = 600;

/** Landscape when the box is wider than it is tall, portrait otherwise. */
export function orientationOf(width: number, height: number): Orientation {
  return width > height ? 'landscape' : 'portrait';
}

/** A touch phone: a coarse pointer and a short side under PHONE_SHORT_SIDE CSS px. */
export function isTouchPhone(coarsePointer: boolean, width: number, height: number): boolean {
  return coarsePointer && Math.min(width, height) < PHONE_SHORT_SIDE;
}

/** True when the game asks for one orientation (as opposed to 'any' or no field at all). */
export function declaresOrientation(preferred: GameDefinition['orientation']): preferred is Orientation {
  return preferred === 'landscape' || preferred === 'portrait';
}

/**
 * Whether the prompt owns a game's turns on this device: the game declares an orientation and the
 * device is a touch phone. The prompt holds a run the wrong way and resumes it when the phone turns
 * back. Every other turn (undeclared or 'any' games, tablets, desktops) pauses, as it always has.
 */
export function promptOwnsTurns(
  preferred: GameDefinition['orientation'],
  coarsePointer: boolean,
  width: number,
  height: number,
): boolean {
  return declaresOrientation(preferred) && isTouchPhone(coarsePointer, width, height);
}

/**
 * Whether the rotate prompt holds a run: the game declares an orientation, the device is a touch
 * phone held the other way, and the player has not chosen "Play anyway" for this orientation.
 */
export function needsRotation(
  preferred: GameDefinition['orientation'],
  coarsePointer: boolean,
  width: number,
  height: number,
  anywayFor: Orientation | null = null,
): boolean {
  if (!promptOwnsTurns(preferred, coarsePointer, width, height)) return false;
  const now = orientationOf(width, height);
  return now !== preferred && anywayFor !== now;
}
