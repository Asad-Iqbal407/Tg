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
    ['Swipe', 'Left / right to move, up to rotate, down to drop'],
  ],
  touchHint: 'Use the buttons: move, rotate, soft drop, hard drop and hold.',
  touchButtons: [
    { action: 'left', label: '◀', side: 'left', slot: 0 },
    { action: 'right', label: '▶', side: 'left', slot: 1 },
    { action: 'secondary', label: 'HOLD', side: 'left', slot: 2 },
    { action: 'up', label: 'ROT', side: 'right', slot: 0 },
    { action: 'down', label: '▼', side: 'right', slot: 1 },
    { action: 'primary', label: 'DROP', side: 'right', slot: 2 },
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
