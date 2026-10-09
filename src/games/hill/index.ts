import type { GameDefinition } from '../types';
import { HillGame } from './hill';

export const hillGame: GameDefinition = {
  id: 'hill',
  title: 'Hill Rider',
  tagline: 'Physics, fuel and a lot of nerve.',
  description:
    'Drive as far as you can across endless procedurally generated hills with real soft-body suspension physics. Manage your fuel, balance in the air, land flips for bonuses and push through desert, ice and the low-gravity lunar base.',
  genre: 'Physics driving',
  inspiredBy: 'Hill Climb Racing',
  width: 960,
  height: 540,
  accent: '#4dd9ff',
  gradient: ['#4dd9ff', '#2a7f62'],
  controls: [
    ['→ / D / ↑', 'Gas (tilts back in the air)'],
    ['← / A / ↓', 'Brake / reverse (tilts forward in the air)'],
  ],
  touchHint: 'Hold GAS and BRAKE to drive and balance.',
  touchButtons: [
    { action: 'left', label: 'BRAKE', side: 'left', slot: 0, wide: true },
    { action: 'right', label: 'GAS', side: 'right', slot: 0, wide: true },
  ],
  scorePerCoin: 300,
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
