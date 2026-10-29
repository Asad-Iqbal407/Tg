import type { GameDefinition } from '../types';
import { HoopsGame } from './hoops';

export const hoopsGame: GameDefinition = {
  id: 'hoops',
  title: 'Hoops',
  tagline: 'Flick it up. Sink it. Keep the streak alive.',
  description:
    'Flick the basketball up towards the hoop and drop it through the net. Baskets in a row build a streak multiplier, and a clean swish that touches nothing scores extra and adds two seconds to the clock. After ten baskets the hoop starts to slide from side to side. Score as much as you can before time runs out.',
  genre: 'Flick sport',
  inspiredBy: 'Arcade basketball',
  width: 600,
  height: 880,
  viewport: { minWidth: 480, maxWidth: 720, minHeight: 800, maxHeight: 1000 },
  orientation: 'portrait',
  pointerArea: 'stage',
  accent: '#f97316',
  gradient: ['#f97316', '#1e3a8a'],
  controls: [
    ['Flick up', 'Shoot: the faster and more sideways the flick, the harder and wider the shot'],
    ['← → + hold Space', 'Aim, then charge and release'],
    ['Esc / P', 'Pause'],
  ],
  touchHint: 'Flick up from the ball toward the hoop. A swish adds two seconds.',
  touchButtons: [],
  scorePerCoin: 80,
  scorePerXp: 20,
  music: { bpm: 112, root: 60, scale: 'minor', progression: [0, 5, 3, 4], seed: 197, lead: 'square' },
  statLabels: {
    baskets: 'Baskets',
    swishes: 'Swishes',
    streak: 'Best streak',
  },
  boostEffects: {
    shield: 'When the clock runs out the first time, you get ten more seconds.',
    'head-start': 'Ten extra seconds on the clock.',
  },
  create: (s) => new HoopsGame(s),
};
