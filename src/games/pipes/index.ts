import type { GameDefinition } from '../types';
import { PipesGame } from './pipes';

export const pipesGame: GameDefinition = {
  id: 'pipes',
  title: 'Pipe Connect',
  tagline: 'Turn the pipes until the water reaches every one.',
  description:
    'The pump in the middle pushes water into a scrambled grid of pipes. Tap a tile to turn it a quarter, and line up the ends so the water flows on. Connect every pipe on the board before time runs out. The grid grows from four by four up to seven by seven.',
  genre: 'Logic puzzle',
  inspiredBy: 'Pipe connecting puzzles',
  width: 600,
  height: 880,
  viewport: { minWidth: 480, maxWidth: 720, minHeight: 800, maxHeight: 1000 },
  orientation: 'portrait',
  accent: '#38bdf8',
  gradient: ['#0ea5e9', '#1c1917'],
  controls: [
    ['Click / tap a tile', 'Turn it a quarter'],
    ['← ↑ → ↓ + Space', 'Choose a tile and turn'],
    ['Esc / P', 'Pause'],
  ],
  touchHint: 'Tap a pipe to turn it. Connect every pipe to the pump in the middle.',
  touchButtons: [],
  scorePerCoin: 250,
  scorePerXp: 60,
  music: { bpm: 96, root: 62, scale: 'major', progression: [0, 4, 5, 3], seed: 233, lead: 'triangle' },
  statLabels: {
    puzzles: 'Puzzles solved',
    turns: 'Pipes turned',
  },
  boostEffects: {
    shield: 'The first time the clock runs out, you get 20 more seconds.',
    'head-start': 'A quarter of the pipes start the right way round.',
  },
  create: (s) => new PipesGame(s),
};
