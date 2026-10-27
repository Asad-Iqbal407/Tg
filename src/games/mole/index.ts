import type { GameDefinition } from '../types';
import { MoleGame } from './mole';

export const moleGame: GameDefinition = {
  id: 'mole',
  title: 'Whack-a-Mole',
  tagline: 'Sixty seconds. Bop every mole, skip the bombs.',
  description:
    'Moles pop out of nine holes and duck back fast. Tap them before they hide. Whacks in a row build a combo multiplier, golden moles with crowns are worth five times as much and pay a coin, and bombs cost you five seconds. The moles get quicker as the round goes on.',
  genre: 'Reflex arcade',
  inspiredBy: 'Whac-A-Mole',
  width: 600,
  height: 880,
  viewport: { minWidth: 480, maxWidth: 720, minHeight: 800, maxHeight: 1000 },
  orientation: 'portrait',
  accent: '#f59e0b',
  gradient: ['#22c55e', '#713f12'],
  controls: [
    ['Click / tap', 'Whack a mole'],
    ['← ↑ → ↓ + Space', 'Move the hammer and whack'],
    ['Esc / P', 'Pause'],
  ],
  touchHint: 'Tap the moles as they pop up. Leave the bombs alone.',
  touchButtons: [],
  scorePerCoin: 120,
  scorePerXp: 30,
  music: { bpm: 140, root: 60, scale: 'major', progression: [0, 4, 5, 3], seed: 137, lead: 'square' },
  statLabels: {
    whacks: 'Moles whacked',
    golden: 'Golden moles',
    combo: 'Best combo',
  },
  boostEffects: {
    shield: 'The first bomb you whack costs no time.',
    'head-start': 'Ten extra seconds on the clock.',
  },
  create: (s) => new MoleGame(s),
};
