import type { GameDefinition } from '../types';
import { StackGame } from './stack';

export const stackGame: GameDefinition = {
  id: 'stack',
  title: 'Stack Tower',
  tagline: 'Tap to drop. Stack it high, slice nothing off.',
  description:
    'A block slides back and forth above your tower. Tap to drop it: whatever hangs over the edge is sliced off, so the tower gets narrower with every sloppy drop. Land a block exactly on the one below for a perfect drop, and from the third perfect in a row the block grows back. Miss the tower completely and it is over.',
  genre: 'One-tap timing',
  inspiredBy: 'Stack',
  width: 600,
  height: 880,
  viewport: { minWidth: 480, maxWidth: 720, minHeight: 800, maxHeight: 1000 },
  orientation: 'portrait',
  pointerArea: 'stage',
  accent: '#a78bfa',
  gradient: ['#7c3aed', '#1e1b4b'],
  controls: [
    ['Space / ↑ / tap', 'Drop the block'],
    ['Esc / P', 'Pause'],
  ],
  touchHint: 'Tap anywhere to drop the block.',
  touchButtons: [],
  scorePerCoin: 150,
  scorePerXp: 40,
  music: { bpm: 112, root: 62, scale: 'minor', progression: [0, 5, 3, 4], seed: 127, lead: 'triangle' },
  statLabels: {
    floors: 'Floors stacked',
    perfects: 'Perfect drops',
    combo: 'Best perfect streak',
  },
  boostEffects: {
    shield: 'The first block that misses the tower is given back.',
    'head-start': 'Start five floors up.',
  },
  create: (s) => new StackGame(s),
};
