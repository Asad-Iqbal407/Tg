import type { GameDefinition } from '../types';
import { SudokuGame } from './sudoku';

export const sudokuGame: GameDefinition = {
  id: 'sudoku',
  title: 'Sudoku',
  tagline: 'Every row, column and box: 1 to 9, once each.',
  description:
    'Fill the grid so that every row, every column and every three-by-three box holds the numbers 1 to 9 exactly once. Tap a square, then a number. Pencil in candidates with notes, and the grid highlights where a number can and cannot go. Every puzzle has a single solution, each one gives you fewer numbers to start from, and three mistakes end the run.',
  genre: 'Number puzzle',
  inspiredBy: 'Sudoku',
  width: 600,
  height: 880,
  viewport: { minWidth: 480, maxWidth: 720, minHeight: 800, maxHeight: 1000 },
  orientation: 'portrait',
  accent: '#93c5fd',
  gradient: ['#3b82f6', '#020617'],
  controls: [
    ['Click / tap a square', 'Select it'],
    ['Click / tap a number', 'Write it in'],
    ['← ↑ → ↓', 'Move the selection'],
    ['X / Shift / NOTES', 'Switch pencil notes on or off'],
    ['Esc / P', 'Pause'],
  ],
  touchHint: 'Tap a square, then tap a number. NOTES pencils in candidates.',
  touchButtons: [],
  scorePerCoin: 400,
  scorePerXp: 90,
  music: { bpm: 84, root: 60, scale: 'major', progression: [0, 4, 5, 3], seed: 179, lead: 'triangle' },
  statLabels: {
    puzzles: 'Puzzles solved',
    cells: 'Squares filled',
  },
  boostEffects: {
    shield: 'One extra mistake allowed.',
    'head-start': 'Every puzzle starts with five more numbers filled in.',
  },
  create: (s) => new SudokuGame(s),
};
