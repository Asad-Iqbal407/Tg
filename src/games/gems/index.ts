import type { GameDefinition } from '../types';
import { GemsGame } from './gems';

export const gemsGame: GameDefinition = {
  id: 'gems',
  title: 'Gem Swap',
  tagline: 'Swap neighbours, line up three, set off cascades.',
  description:
    'Swap two neighbouring gems to line up three or more of a kind. Matched gems burst, the gems above fall into the gap and new ones drop in from the top, and any lines they make cascade for multiplied points. Lines of four or five buy you extra seconds. Score as much as you can in a minute.',
  genre: 'Match-three puzzle',
  inspiredBy: 'Bejeweled',
  width: 600,
  height: 880,
  viewport: { minWidth: 480, maxWidth: 720, minHeight: 800, maxHeight: 1000 },
  orientation: 'portrait',
  pointerArea: 'stage',
  accent: '#a855f7',
  gradient: ['#7c3aed', '#0f172a'],
  controls: [
    ['Swipe a gem', 'Swap it with its neighbour that way'],
    ['Tap two neighbours', 'Swap them'],
    ['← ↑ → ↓ + Space', 'Move, pick a gem, then swap with an arrow'],
    ['Esc / P', 'Pause'],
  ],
  touchHint: 'Swipe a gem toward a neighbour to swap them. Make lines of three.',
  touchButtons: [],
  scorePerCoin: 400,
  scorePerXp: 90,
  music: { bpm: 118, root: 64, scale: 'major', progression: [0, 5, 3, 4], seed: 239, lead: 'triangle' },
  statLabels: {
    gems: 'Gems matched',
    combo: 'Best cascade',
  },
  boostEffects: {
    shield: 'When the clock runs out the first time, you get ten more seconds.',
    'head-start': 'Fifteen extra seconds on the clock.',
  },
  create: (s) => new GemsGame(s),
};
