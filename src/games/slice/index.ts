import type { GameDefinition } from '../types';
import { SliceGame } from './slice';

export const sliceGame: GameDefinition = {
  id: 'slice',
  title: 'Fruit Slice',
  tagline: 'Swipe to slice. Drop three and you are out. Never cut a bomb.',
  description:
    'Fruit is thrown up from below the screen. Swipe through it to slice it in two. Cut three or more with one swipe for a combo bonus, and catch the golden star fruit for a coin. Every fruit that falls back uncut costs a life, and cutting a bomb ends the run at once.',
  genre: 'Swipe action',
  inspiredBy: 'Fruit Ninja',
  width: 600,
  height: 880,
  viewport: { minWidth: 480, maxWidth: 720, minHeight: 800, maxHeight: 1000 },
  orientation: 'portrait',
  pointerArea: 'stage',
  accent: '#f97316',
  gradient: ['#f97316', '#7c2d12'],
  controls: [
    ['Swipe / drag', 'Slice through the fruit'],
    ['Esc / P', 'Pause'],
  ],
  touchHint: 'Swipe across the fruit to slice it. Leave the bombs alone.',
  touchButtons: [],
  scorePerCoin: 200,
  scorePerXp: 50,
  music: { bpm: 132, root: 62, scale: 'minor', progression: [0, 6, 5, 4], seed: 149, lead: 'square' },
  statLabels: {
    fruits: 'Fruit sliced',
    combo: 'Best combo',
    golden: 'Golden fruit',
  },
  boostEffects: {
    shield: 'The first bomb you cut is defused.',
    'head-start': 'Start with an extra life.',
  },
  create: (s) => new SliceGame(s),
};
