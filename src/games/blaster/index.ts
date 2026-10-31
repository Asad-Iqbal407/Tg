import type { GameDefinition } from '../types';
import { BlasterGame } from './blaster';

export const blasterGame: GameDefinition = {
  id: 'blaster',
  title: 'Asteroid Blaster',
  tagline: 'Turn, blast, and break the rocks down to dust.',
  description:
    'Your ship sits in the middle of an asteroid field and its cannon fires by itself: touch the screen and the ship turns to aim at your finger. Big rocks split into two smaller, faster ones, and those into two more, worth more points the smaller they get. Each wave sends more rocks. Three hits and the ship is lost.',
  genre: 'Space shooter',
  inspiredBy: 'Asteroids',
  width: 600,
  height: 880,
  viewport: { minWidth: 480, maxWidth: 720, minHeight: 800, maxHeight: 1000 },
  orientation: 'portrait',
  pointerArea: 'stage',
  accent: '#67e8f9',
  gradient: ['#0e7490', '#030712'],
  controls: [
    ['Touch / mouse', 'Turn the ship toward the pointer (it fires by itself)'],
    ['← →', 'Turn the ship'],
    ['Esc / P', 'Pause'],
  ],
  touchHint: 'Touch where you want to shoot. The cannon fires on its own.',
  touchButtons: [],
  scorePerCoin: 300,
  scorePerXp: 70,
  music: { bpm: 126, root: 55, scale: 'minor', progression: [0, 3, 6, 5], seed: 257, lead: 'square' },
  statLabels: {
    rocks: 'Rocks blasted',
    waves: 'Waves cleared',
  },
  boostEffects: {
    shield: 'Start with an extra life.',
    'head-start': 'Your cannon fires twice as fast in the first wave.',
  },
  create: (s) => new BlasterGame(s),
};
