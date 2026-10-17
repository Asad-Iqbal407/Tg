import type { GameDefinition } from '../types';
import { SnakeGame } from './snake';

export const snakeGame: GameDefinition = {
  id: 'snake',
  title: 'Snake Classic',
  tagline: 'Eat, grow, and never bite yourself.',
  description:
    'The timeless serpent game. Steer your snake to the apples and grow longer. Every few apples you level up and new walls appear. Golden apples slow time for a few seconds.',
  genre: 'Arcade classic',
  inspiredBy: 'Nokia Snake',
  width: 600,
  height: 800,
  // Phones in portrait get a board about as tall as the design (800 px), so their cells stay near
  // their desktop size; landscape keeps the desktop 900 x 640 board, which is what the desktop sizes.
  viewport: { minWidth: 380, maxWidth: 900, minHeight: 640, maxHeight: 800 },
  orientation: 'any',
  accent: '#4ade80',
  gradient: ['#4ade80', '#14532d'],
  controls: [
    ['← ↑ → ↓ / W A S D', 'Turn the snake'],
    ['Swipe', 'Turn on touch screens'],
    ['Esc / P', 'Pause'],
  ],
  touchHint: 'Swipe in the direction you want to turn.',
  touchButtons: [],
  scorePerCoin: 120,
  scorePerXp: 30,
  music: { bpm: 118, root: 60, scale: 'major', progression: [0, 4, 5, 3], seed: 61, lead: 'square' },
  statLabels: {
    food: 'Apples eaten',
    golden: 'Golden apples',
    length: 'Longest snake',
    level: 'Best level',
  },
  boostEffects: {
    shield: 'Survive one crash into a wall or into yourself.',
    'head-start': 'Start with a longer snake.',
  },
  create: (s) => new SnakeGame(s),
};
