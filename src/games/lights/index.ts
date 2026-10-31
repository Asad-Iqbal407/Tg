import type { GameDefinition } from '../types';
import { LightsGame } from './lights';

export const lightsGame: GameDefinition = {
  id: 'lights',
  title: 'Lights Out',
  tagline: 'Every press flips a light and its neighbours. Switch them all off.',
  description:
    'Pressing a light switches it, and the lights above, below and beside it, on or off. Turn the whole board dark before time runs out. Each puzzle can be solved in a set number of presses, its par: match par for a bonus. Later puzzles need more presses.',
  genre: 'Logic puzzle',
  inspiredBy: 'Lights Out',
  width: 600,
  height: 880,
  viewport: { minWidth: 480, maxWidth: 720, minHeight: 800, maxHeight: 1000 },
  orientation: 'portrait',
  accent: '#facc15',
  gradient: ['#facc15', '#0b1020'],
  controls: [
    ['Click / tap a light', 'Press it'],
    ['← ↑ → ↓ + Space', 'Choose a light and press'],
    ['Esc / P', 'Pause'],
  ],
  touchHint: 'Tap a light to flip it and its neighbours. Make the board dark.',
  touchButtons: [],
  scorePerCoin: 250,
  scorePerXp: 60,
  music: { bpm: 90, root: 57, scale: 'minor', progression: [0, 5, 3, 4], seed: 229, lead: 'triangle' },
  statLabels: {
    puzzles: 'Puzzles solved',
    presses: 'Presses',
  },
  boostEffects: {
    shield: 'The first time the clock runs out, you get 20 more seconds.',
    'head-start': 'Every puzzle needs two fewer presses.',
  },
  create: (s) => new LightsGame(s),
};
