import type { GameDefinition } from '../types';
import { SimonGame } from './simon';

export const simonGame: GameDefinition = {
  id: 'simon',
  title: 'Simon Says',
  tagline: 'Watch the lights. Repeat the pattern. One more every round.',
  description:
    'Four coloured pads light up in a sequence, each with its own sound. Tap them back in the same order. Every round adds one more step, and the pattern plays a little faster as it grows. One wrong pad, or waiting too long, and the run is over.',
  genre: 'Memory game',
  inspiredBy: 'Simon',
  width: 600,
  height: 880,
  viewport: { minWidth: 480, maxWidth: 720, minHeight: 800, maxHeight: 1000 },
  orientation: 'portrait',
  accent: '#22c55e',
  gradient: ['#22c55e', '#1e3a8a'],
  controls: [
    ['Click / tap a pad', 'Play it'],
    ['↑ → ↓ ←', 'Play the top, right, bottom or left pad'],
    ['Esc / P', 'Pause'],
  ],
  touchHint: 'Watch the pads light up, then tap them back in the same order.',
  touchButtons: [],
  scorePerCoin: 120,
  scorePerXp: 30,
  music: { bpm: 96, root: 60, scale: 'major', progression: [0, 5, 3, 4], seed: 181, lead: 'triangle' },
  statLabels: {
    rounds: 'Longest sequence',
    taps: 'Pads played',
  },
  boostEffects: {
    shield: 'One wrong pad is forgiven: the sequence plays again.',
    'head-start': 'Start on round 4 with the first three rounds already scored.',
  },
  create: (s) => new SimonGame(s),
};
