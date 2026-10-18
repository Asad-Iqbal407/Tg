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
  // Desktop and portrait phones keep the design board. A touch phone held landscape uses its own range:
  // the full 900 px width and the height that matches the stage (about 440 to 470 px on a landscape
  // phone), with a floor low enough that no stage letterboxes sideways. Desktop never uses it.
  viewport: { minWidth: 380, maxWidth: 900, minHeight: 640, maxHeight: 800 },
  landscapeViewport: { minWidth: 380, maxWidth: 1200, minHeight: 360, maxHeight: 800 },
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
