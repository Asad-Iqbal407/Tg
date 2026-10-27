import type { GameDefinition } from '../types';
import { HopperGame } from './hopper';

export const hopperGame: GameDefinition = {
  id: 'hopper',
  title: 'Road Hopper',
  tagline: 'Why did the chicken cross the road? For the high score.',
  description:
    'Hop up the screen one lane at a time. Dodge the traffic on the roads, ride the logs across the rivers, and do not fall in the water or drift off the edge. Trees block your way, coins wait on the grass, and if you dawdle too long without moving forward an eagle swoops down to take you.',
  genre: 'Endless hopper',
  inspiredBy: 'Crossy Road / Frogger',
  width: 600,
  height: 880,
  viewport: { minWidth: 480, maxWidth: 720, minHeight: 800, maxHeight: 1000 },
  orientation: 'portrait',
  pointerArea: 'stage',
  accent: '#4ade80',
  gradient: ['#4ade80', '#1e3a8a'],
  controls: [
    ['↑ / W / Space / tap', 'Hop forward'],
    ['← → ↓ / swipe', 'Hop sideways or back'],
    ['Esc / P', 'Pause'],
  ],
  touchHint: 'Tap to hop forward. Swipe left, right or down to hop that way.',
  touchButtons: [],
  scorePerCoin: 40,
  scorePerXp: 10,
  music: { bpm: 120, root: 62, scale: 'major', progression: [0, 4, 5, 3], seed: 157, lead: 'square' },
  statLabels: {
    rows: 'Best distance',
    hops: 'Hops',
  },
  boostEffects: {
    shield: 'Survive one crash or splash: you are put back on the last patch of grass.',
    'head-start': 'Start ten rows up the road.',
  },
  create: (s) => new HopperGame(s),
};
