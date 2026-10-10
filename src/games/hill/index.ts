import type { GameDefinition } from '../types';
import { HillGame } from './hill';

export const hillGame: GameDefinition = {
  id: 'hill',
  title: 'Hill Rider',
  tagline: 'Physics, fuel and a lot of nerve.',
  description:
    'Drive as far as you can across endless procedurally generated hills on sprung suspension. Manage your fuel, launch off jumps, land flips for bonuses and push through desert, ice, the low-gravity lunar base and a volcano, lap after lap.',
  genre: 'Physics driving',
  inspiredBy: 'Hill Climb Racing',
  width: 960,
  height: 540,
  viewport: { minWidth: 880, maxWidth: 1280, minHeight: 540, maxHeight: 760 },
  accent: '#4dd9ff',
  gradient: ['#4dd9ff', '#2a7f62'],
  controls: [
    ['→ / D / ↑', 'Gas (tilts back in the air)'],
    ['← / A / ↓', 'Brake, then reverse (tilts forward in the air)'],
  ],
  touchHint: 'Hold GAS to drive. In the air, GAS tilts back and BRAKE tilts forward.',
  touchButtons: [
    { action: 'left', label: 'BRAKE', side: 'left', slot: 0, wide: true },
    { action: 'right', label: 'GAS', side: 'right', slot: 0, wide: true },
  ],
  scorePerCoin: 500,
  scorePerXp: 60,
  music: { bpm: 120, root: 52, scale: 'dorian', progression: [0, 3, 6, 4], seed: 44, lead: 'triangle' },
  statLabels: {
    distance: 'Distance (m)',
    flips: 'Flips',
    airtime: 'Best air time (s)',
    fuelCans: 'Fuel cans',
  },
  boostEffects: {
    shield: 'Recover from one crash.',
    'head-start': 'Start with a 150% fuel tank.',
  },
  create: (s) => new HillGame(s),
};
