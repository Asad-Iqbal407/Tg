import type { GameDefinition } from '../types';
import { MergeGame } from './merge';

export const mergeGame: GameDefinition = {
  id: 'merge',
  title: '2048',
  tagline: 'Slide, merge, and build the 2048 tile.',
  description:
    'Slide every tile on the four-by-four board at once. Two equal tiles that meet merge into one of double the value. Each move adds a new tile, so plan ahead: the run ends when the board is full and no move is left. Reach 2048, then keep going for a bigger tile.',
  genre: 'Number puzzle',
  inspiredBy: '2048',
  width: 600,
  height: 880,
  viewport: { minWidth: 480, maxWidth: 720, minHeight: 800, maxHeight: 1000 },
  orientation: 'portrait',
  pointerArea: 'stage',
  accent: '#f97316',
  gradient: ['#f97316', '#3b0764'],
  controls: [
    ['← ↑ → ↓ / W A S D', 'Slide the tiles'],
    ['Swipe', 'Slide on touch screens'],
    ['Esc / P', 'Pause'],
  ],
  touchHint: 'Swipe up, down, left or right to slide every tile.',
  touchButtons: [],
  scorePerCoin: 400,
  scorePerXp: 80,
  music: { bpm: 104, root: 65, scale: 'major', progression: [0, 3, 5, 4], seed: 109, lead: 'triangle' },
  statLabels: {
    merges: 'Tiles merged',
    bestTile: 'Biggest tile',
    moves: 'Moves made',
  },
  boostEffects: {
    shield: 'When the board locks, the two smallest tiles clear instead of ending the run.',
    'head-start': 'Start with a 32 and a 16 on the board.',
  },
  create: (s) => new MergeGame(s),
};
