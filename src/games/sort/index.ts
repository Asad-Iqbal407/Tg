import type { GameDefinition } from '../types';
import { SortGame } from './sort';

export const sortGame: GameDefinition = {
  id: 'sort',
  title: 'Color Sort',
  tagline: 'Pour the balls until every tube holds one colour.',
  description:
    'Tap a tube to lift its top ball, then tap another tube to drop it in. A ball can only go into an empty tube or onto a ball of the same colour, and each tube holds four. Sort every colour into its own tube before the clock runs out. Every puzzle can be solved, and you can undo as many moves as you like.',
  genre: 'Sorting puzzle',
  inspiredBy: 'Ball Sort Puzzle',
  width: 600,
  height: 880,
  viewport: { minWidth: 480, maxWidth: 720, minHeight: 800, maxHeight: 1000 },
  orientation: 'portrait',
  accent: '#a5b4fc',
  gradient: ['#6366f1', '#0f172a'],
  controls: [
    ['Click / tap', 'Lift a ball, then drop it in another tube'],
    ['← → + Space', 'Choose a tube and lift or drop'],
    ['X / Shift / UNDO', 'Undo a move'],
    ['Esc / P', 'Pause'],
  ],
  touchHint: 'Tap a tube to lift its top ball, then tap where it should go.',
  touchButtons: [],
  scorePerCoin: 300,
  scorePerXp: 70,
  music: { bpm: 92, root: 64, scale: 'major', progression: [0, 5, 3, 4], seed: 163, lead: 'triangle' },
  statLabels: {
    levels: 'Puzzles solved',
    moves: 'Balls poured',
  },
  boostEffects: {
    shield: 'The first time the clock runs out, you get 20 more seconds.',
    'head-start': 'Every puzzle has an extra empty tube.',
  },
  create: (s) => new SortGame(s),
};
