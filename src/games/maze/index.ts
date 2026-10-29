import type { GameDefinition } from '../types';
import { MazeGame } from './maze';

export const mazeGame: GameDefinition = {
  id: 'maze',
  title: 'Maze Chase',
  tagline: 'Eat every dot. Dodge the ghosts. Then turn the tables.',
  description:
    'Steer through the maze and eat every dot while four ghosts hunt you, each in its own way: one chases you, one cuts you off, one wanders and one keeps its distance. Eat a big power pellet and the ghosts turn blue and run, and you can eat them for points that double with each one. The tunnel on either side wraps round.',
  genre: 'Maze chase',
  inspiredBy: 'Pac-Man',
  width: 600,
  height: 880,
  viewport: { minWidth: 480, maxWidth: 720, minHeight: 800, maxHeight: 1000 },
  orientation: 'portrait',
  pointerArea: 'stage',
  accent: '#facc15',
  gradient: ['#1d4ed8', '#020617'],
  controls: [
    ['← ↑ → ↓ / W A S D', 'Turn'],
    ['Swipe', 'Turn on touch screens'],
    ['Esc / P', 'Pause'],
  ],
  touchHint: 'Swipe anywhere to turn. You can swipe a turn early and it is taken at the next corner.',
  touchButtons: [],
  scorePerCoin: 300,
  scorePerXp: 70,
  music: { bpm: 136, root: 59, scale: 'minor', progression: [0, 3, 4, 3], seed: 191, lead: 'square' },
  statLabels: {
    dots: 'Dots eaten',
    ghosts: 'Ghosts eaten',
    levels: 'Mazes cleared',
  },
  boostEffects: {
    shield: 'Start with an extra life.',
    'head-start': 'Every maze starts with four seconds of ghost-eating power.',
  },
  create: (s) => new MazeGame(s),
};
