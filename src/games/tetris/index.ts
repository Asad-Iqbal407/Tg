import type { GameDefinition } from '../types';
import { TetrisGame } from './tetris';

export const tetrisGame: GameDefinition = {
  id: 'tetris',
  title: 'Block Drop',
  tagline: 'Rotate, stack, and clear full lines.',
  description:
    'Falling blocks, a ten-column well, and endless levels. Fit the pieces together to clear lines, build tetris combos of four lines at once, and hold a piece for later. The stack speeds up as you level up.',
  genre: 'Puzzle classic',
  inspiredBy: 'Tetris',
  width: 540,
  height: 960,
  viewport: { minWidth: 480, maxWidth: 900, minHeight: 800, maxHeight: 1100 },
  accent: '#a855f7',
  gradient: ['#a855f7', '#1e1b4b'],
  controls: [
    ['← → / A D', 'Move'],
    ['↑ / W', 'Rotate'],
    ['↓ / S', 'Soft drop'],
    ['Space / Enter', 'Hard drop'],
    ['X / Shift', 'Hold a piece'],
    ['Swipe', 'Left / right to move, up to rotate'],
    ['Touch flick / drag', 'Flick down to hard drop, drag down and hold to soft drop'],
  ],
  touchHint:
    'Tap ◀ ▶ to move, ROT to turn and HOLD to swap. Flick down to drop, or drag down and hold to fall faster.',
  // Four buttons keep a 360 px phone clear of both edges. Touch players drop with gestures on the well instead: a flick
  // down hard drops, and a drag down that stays held soft drops (see TouchDrop). A short downward drag does neither.
  touchButtons: [
    { action: 'left', label: '◀', side: 'left', slot: 0 },
    { action: 'right', label: '▶', side: 'left', slot: 1 },
    { action: 'up', label: 'ROT', side: 'right', slot: 0 },
    { action: 'secondary', label: 'HOLD', side: 'right', slot: 1 },
  ],
  scorePerCoin: 500,
  scorePerXp: 100,
  music: { bpm: 140, root: 57, scale: 'minor', progression: [0, 3, 4, 0], seed: 81, lead: 'square' },
  statLabels: {
    lines: 'Lines cleared',
    tetrises: 'Four-line clears',
    pieces: 'Pieces placed',
    level: 'Best level',
  },
  boostEffects: {
    shield: 'Survive the first top-out: the top rows clear instead of ending the run.',
    'head-start': 'Start at level 3.',
  },
  create: (s) => new TetrisGame(s),
};
