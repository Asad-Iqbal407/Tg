import type { GameDefinition } from '../types';
import { TicTacToeGame } from './tictactoe';

export const tictactoeGame: GameDefinition = {
  id: 'tictactoe',
  title: 'Tic-Tac-Toe',
  tagline: 'Three in a row. Each win faces a sharper computer.',
  description:
    'You are X, the computer is O, and three in a row wins. You take turns starting. Every win moves you up a level, where the computer makes fewer mistakes, until it almost never slips. A draw replays the level and a loss ends the run.',
  genre: 'Strategy',
  inspiredBy: 'Noughts and crosses',
  width: 600,
  height: 880,
  viewport: { minWidth: 480, maxWidth: 720, minHeight: 800, maxHeight: 1000 },
  orientation: 'portrait',
  accent: '#fb7185',
  gradient: ['#14b8a6', '#042f2e'],
  controls: [
    ['Click / tap a square', 'Place your X'],
    ['← ↑ → ↓ + Space', 'Choose a square and place'],
    ['Esc / P', 'Pause'],
  ],
  touchHint: 'Tap a square to place your X.',
  touchButtons: [],
  scorePerCoin: 300,
  scorePerXp: 60,
  music: { bpm: 96, root: 62, scale: 'major', progression: [0, 3, 4, 0], seed: 227, lead: 'triangle' },
  statLabels: {
    wins: 'Games won',
    draws: 'Draws',
  },
  boostEffects: {
    shield: 'Your first loss is forgiven: replay the level.',
    'head-start': 'In your first game the computer plays at random.',
  },
  create: (s) => new TicTacToeGame(s),
};
