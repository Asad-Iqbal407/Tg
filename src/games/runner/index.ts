import type { GameDefinition } from '../types';
import { RunnerGame } from './runner';

export const runnerGame: GameDefinition = {
  id: 'runner',
  title: 'Metro Dash',
  tagline: 'Dodge trains. Grab coins. Never stop running.',
  description:
    'An endless 3-lane rail runner through a city that changes every 1000 m. Jump hurdles, roll under gantries, ride ramps onto train roofs and dodge oncoming trains as the pace keeps rising, while magnets, jetpacks and super sneakers keep the run alive.',
  genre: 'Endless runner',
  inspiredBy: 'Subway Surfers',
  width: 540,
  height: 960,
  // Portrait design size; wider screens see more of the city (Hor+), taller ones more sky.
  viewport: { minWidth: 540, maxWidth: 1706, minHeight: 900, maxHeight: 1200 },
  accent: '#ff6b6b',
  gradient: ['#ff6b6b', '#7a2f7d'],
  controls: [
    ['← / → or A / D', 'Change lane'],
    ['↑ / W / Space', 'Jump'],
    ['↓ / S', 'Roll under gantries (slam down mid-air)'],
    ['Swipe', 'Same as arrows on touch screens'],
    ['White hurdle / yellow gantry', 'Jump over / roll under'],
  ],
  touchHint: 'Swipe left/right to change lanes, up to jump, down to roll.',
  touchButtons: [],
  scorePerCoin: 120,
  scorePerXp: 25,
  music: { bpm: 132, root: 57, scale: 'minor', progression: [0, 5, 3, 4], seed: 11, lead: 'square' },
  statLabels: {
    distance: 'Distance (m)',
    jumps: 'Jumps',
    rolls: 'Rolls',
    powerups: 'Power-ups',
    trainsRidden: 'Train roofs reached',
  },
  boostEffects: {
    shield: 'Survive one crash.',
    'head-start': 'Start with a jetpack and coin magnet.',
  },
  create: (s) => new RunnerGame(s),
};
