import type { GameDefinition } from '../types';
import { TilesGame } from './tiles';

export const tilesGame: GameDefinition = {
  id: 'tiles',
  title: 'Piano Tiles',
  tagline: 'Tap the black tiles. Never the white ones.',
  description:
    'Black tiles scroll down four lanes, one per row. Tap each one in order before it slides off the bottom, and every tap plays a note. The tiles speed up with every one you play. Tap a white tile, or let a black one slip past, and the song is over.',
  genre: 'Rhythm reflex',
  inspiredBy: 'Piano Tiles',
  width: 600,
  height: 880,
  viewport: { minWidth: 480, maxWidth: 720, minHeight: 800, maxHeight: 1000 },
  orientation: 'portrait',
  accent: '#111827',
  gradient: ['#111827', '#64748b'],
  controls: [
    ['Tap a lane', 'Play the black tile'],
    ['← ↓ ↑ →', 'Lanes one to four'],
    ['Esc / P', 'Pause'],
  ],
  touchHint: 'Tap START, then every black tile in order. Never tap white.',
  touchButtons: [],
  scorePerCoin: 25,
  scorePerXp: 6,
  music: { bpm: 120, root: 60, scale: 'major', progression: [0, 5, 3, 4], seed: 223, lead: 'triangle' },
  statLabels: {
    tiles: 'Most tiles in one song',
  },
  boostEffects: {
    shield: 'One wrong tap or missed tile is forgiven.',
    'head-start': 'The tiles speed up half as fast.',
  },
  create: (s) => new TilesGame(s),
};
