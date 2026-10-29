import type { GameDefinition } from '../types';
import { GolfGame } from './golf';

export const golfGame: GameDefinition = {
  id: 'golf',
  title: 'Mini Golf',
  tagline: 'Nine holes. Pull back, aim, putt.',
  description:
    'Play a nine-hole mini golf course: doglegs, blocks, sand traps, a water hazard with a bridge, a turning windmill, bumpers and a grand finale. Pull back anywhere on the screen and let go to putt: the further you pull, the harder you hit. Too fast over the cup and the ball rattles past. Finish each hole in as few strokes as you can.',
  genre: 'Putting sport',
  inspiredBy: 'Mini golf',
  width: 600,
  height: 880,
  viewport: { minWidth: 480, maxWidth: 720, minHeight: 800, maxHeight: 1000 },
  orientation: 'portrait',
  pointerArea: 'stage',
  accent: '#4ade80',
  gradient: ['#22c55e', '#14532d'],
  controls: [
    ['Pull back and let go', 'Aim and putt (like a slingshot)'],
    ['← → + hold Space', 'Turn the aim, then charge and release'],
    ['Esc / P', 'Pause'],
  ],
  touchHint: 'Drag back from anywhere, like a slingshot, and let go to putt.',
  touchButtons: [],
  scorePerCoin: 250,
  scorePerXp: 60,
  music: { bpm: 100, root: 65, scale: 'major', progression: [0, 3, 4, 0], seed: 193, lead: 'triangle' },
  statLabels: {
    holes: 'Holes played',
    aces: 'Holes in one',
    under: 'Holes under par',
  },
  boostEffects: {
    shield: 'Your first ball in the water is a free drop, with no stroke added.',
    'head-start': 'Every hole is scored one stroke better (never below one).',
  },
  create: (s) => new GolfGame(s),
};
