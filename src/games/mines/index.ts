import type { GameDefinition } from '../types';
import { MinesGame } from './mines';

export const minesGame: GameDefinition = {
  id: 'mines',
  title: 'Minesweeper',
  tagline: 'Read the numbers. Clear the field. Flag every mine.',
  description:
    'Every number tells you how many mines touch that square. Dig the safe squares, flag the mines, and clear the whole field to move on to a board with more mines. Your first dig is always safe, and tapping a number whose mines are all flagged opens the rest of its neighbours at once.',
  genre: 'Logic puzzle',
  inspiredBy: 'Minesweeper',
  width: 600,
  height: 880,
  viewport: { minWidth: 480, maxWidth: 720, minHeight: 800, maxHeight: 1000 },
  orientation: 'portrait',
  accent: '#4ade80',
  gradient: ['#22c55e', '#0f172a'],
  controls: [
    ['Click / tap', 'Dig (or flag in flag mode)'],
    ['Hold', 'Flag a square'],
    ['← ↑ → ↓ + Space / X', 'Move, dig, flag'],
    ['Esc / P', 'Pause'],
  ],
  touchHint: 'Tap to dig, hold to flag. The button at the bottom switches to flag mode.',
  touchButtons: [],
  scorePerCoin: 300,
  scorePerXp: 70,
  music: { bpm: 96, root: 57, scale: 'minor', progression: [0, 3, 5, 4], seed: 139, lead: 'triangle' },
  statLabels: {
    cells: 'Squares cleared',
    boards: 'Fields cleared',
    flags: 'Mines flagged',
  },
  boostEffects: {
    shield: 'The first mine you dig is defused and flagged.',
    'head-start': 'Every field starts with four mines already flagged.',
  },
  create: (s) => new MinesGame(s),
};
