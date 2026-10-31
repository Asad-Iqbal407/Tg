import type { GameDefinition } from '../types';
import { ArcheryGame } from './archery';

export const archeryGame: GameDefinition = {
  id: 'archery',
  title: 'Archery',
  tagline: 'Draw, aim for the gold, and mind the wind.',
  description:
    'Pull back anywhere on the screen to draw your bow and let go to shoot. The arrow arcs under gravity and the wind pushes it left or right, so aim off to allow for both. Rings score from 1 at the edge to 10 in the gold, and bullseyes in a row earn a bonus. From the fifth arrow the target starts to move. Three misses and the contest is over.',
  genre: 'Aiming sport',
  inspiredBy: 'Target archery',
  width: 600,
  height: 880,
  viewport: { minWidth: 480, maxWidth: 720, minHeight: 800, maxHeight: 1000 },
  orientation: 'portrait',
  pointerArea: 'stage',
  accent: '#facc15',
  gradient: ['#7dd3fc', '#166534'],
  controls: [
    ['Pull back and let go', 'Draw and shoot (like a slingshot)'],
    ['↑ ↓ + hold Space', 'Set the angle, then draw and release'],
    ['Esc / P', 'Pause'],
  ],
  touchHint: 'Pull back from anywhere to draw the bow. Let go to shoot.',
  touchButtons: [],
  scorePerCoin: 120,
  scorePerXp: 30,
  music: { bpm: 100, root: 62, scale: 'major', progression: [0, 4, 5, 3], seed: 263, lead: 'triangle' },
  statLabels: {
    hits: 'Targets hit',
    bullseyes: 'Bullseyes',
  },
  boostEffects: {
    shield: 'One extra miss allowed.',
    'head-start': 'No wind for your first five arrows.',
  },
  create: (s) => new ArcheryGame(s),
};
