import type { GameDefinition } from '../types';
import { DinoGame } from './dino';

export const dinoGame: GameDefinition = {
  id: 'dino',
  title: 'Dino Run',
  tagline: 'Jump the cacti, duck the birds, run forever.',
  description:
    'A little dinosaur runs across the desert, faster and faster. Tap to jump over the cacti. From 300 m birds fly in at three heights: jump the low ones, duck under the middle ones and run beneath the high ones. Night falls every 700 m. Every 100 m pays a coin.',
  genre: 'Endless runner',
  inspiredBy: 'The offline dinosaur game',
  width: 600,
  height: 880,
  viewport: { minWidth: 480, maxWidth: 720, minHeight: 800, maxHeight: 1000 },
  orientation: 'portrait',
  pointerArea: 'stage',
  accent: '#64748b',
  gradient: ['#94a3b8', '#334155'],
  controls: [
    ['Space / ↑ / tap', 'Jump'],
    ['↓ / swipe down', 'Duck (or drop faster in the air)'],
    ['Esc / P', 'Pause'],
  ],
  touchHint: 'Tap to jump. Swipe down to duck under a bird.',
  touchButtons: [],
  scorePerCoin: 120,
  scorePerXp: 30,
  music: { bpm: 140, root: 60, scale: 'major', progression: [0, 4, 5, 3], seed: 211, lead: 'square' },
  statLabels: {
    distance: 'Best distance (m)',
    jumps: 'Jumps',
  },
  boostEffects: {
    shield: 'Survive your first crash.',
    'head-start': 'Start 300 m into the run.',
  },
  create: (s) => new DinoGame(s),
};
