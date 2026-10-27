import type { GameDefinition } from '../types';
import { MemoryGame } from './memory';

export const memoryGame: GameDefinition = {
  id: 'memory',
  title: 'Memory Match',
  tagline: 'Flip two cards. Find every pair before time runs out.',
  description:
    'Turn the cards over two at a time and remember what you saw. Find a matching pair and it stays face up; miss and both turn back. Matches in a row multiply your points. Clear the board for a time bonus, and each level deals a bigger board. The run ends when the clock runs out.',
  genre: 'Memory puzzle',
  inspiredBy: 'Concentration',
  width: 600,
  height: 880,
  viewport: { minWidth: 480, maxWidth: 720, minHeight: 800, maxHeight: 1000 },
  orientation: 'portrait',
  accent: '#2dd4bf',
  gradient: ['#14b8a6', '#042f2e'],
  controls: [
    ['Click / tap', 'Turn a card'],
    ['← ↑ → ↓ + Space', 'Move the cursor and turn a card'],
    ['Esc / P', 'Pause'],
  ],
  touchHint: 'Tap a card to turn it over.',
  touchButtons: [],
  scorePerCoin: 250,
  scorePerXp: 60,
  music: { bpm: 100, root: 64, scale: 'major', progression: [0, 3, 4, 5], seed: 131, lead: 'triangle' },
  statLabels: {
    pairs: 'Pairs found',
    levels: 'Boards cleared',
    streak: 'Best streak',
  },
  boostEffects: {
    shield: 'The first time the clock runs out, you get 15 more seconds.',
    'head-start': 'Every board opens with a two-second peek at all the cards.',
  },
  create: (s) => new MemoryGame(s),
};
