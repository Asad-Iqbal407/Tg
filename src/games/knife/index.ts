import type { GameDefinition } from '../types';
import { KnifeGame } from './knife';

export const knifeGame: GameDefinition = {
  id: 'knife',
  title: 'Knife Hit',
  tagline: 'Throw every knife into the spinning log. Never hit another knife.',
  description:
    'A log spins at the top of the screen. Tap to throw a knife into it, and land every knife you have to splinter the log and move on. Hit a knife already in the log and you are out. Apples on the rim pay extra. Logs spin faster, surge and reverse as you go, and every fifth stage is a boss log.',
  genre: 'One-tap timing',
  inspiredBy: 'Knife Hit',
  width: 600,
  height: 880,
  viewport: { minWidth: 480, maxWidth: 720, minHeight: 800, maxHeight: 1000 },
  orientation: 'portrait',
  pointerArea: 'stage',
  accent: '#e2e8f0',
  gradient: ['#b45309', '#0f172a'],
  controls: [
    ['Space / ↑ / tap', 'Throw a knife'],
    ['Esc / P', 'Pause'],
  ],
  touchHint: 'Tap anywhere to throw. Time it between the knives already in the log.',
  touchButtons: [],
  scorePerCoin: 120,
  scorePerXp: 30,
  music: { bpm: 124, root: 57, scale: 'minor', progression: [0, 6, 5, 4], seed: 173, lead: 'square' },
  statLabels: {
    knives: 'Knives thrown',
    stages: 'Stages cleared',
    apples: 'Apples hit',
  },
  boostEffects: {
    shield: 'The first knife that hits another knife is given back.',
    'head-start': 'Start on stage 3 with the first two stages already scored.',
  },
  create: (s) => new KnifeGame(s),
};
