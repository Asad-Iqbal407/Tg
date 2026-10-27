import type { GameDefinition } from '../types';
import { JumperGame } from './jumper';

export const jumperGame: GameDefinition = {
  id: 'jumper',
  title: 'Sky Jumper',
  tagline: 'Bounce up the pads. Steer left and right. Never look down.',
  description:
    'Your jumper bounces by itself: steer it onto the next pad up and climb as high as you can. Blue pads slide, brown pads crumble when you land on them, and springs launch you sky high. Go off one side of the screen and you come back on the other. Fall below the screen and the climb is over.',
  genre: 'Endless climber',
  inspiredBy: 'Doodle Jump',
  width: 600,
  height: 880,
  viewport: { minWidth: 480, maxWidth: 720, minHeight: 800, maxHeight: 1000 },
  orientation: 'portrait',
  pointerArea: 'stage',
  accent: '#facc15',
  gradient: ['#38bdf8', '#1e3a8a'],
  controls: [
    ['← → / A D', 'Steer'],
    ['Drag', 'Steer with your finger or mouse'],
    ['Esc / P', 'Pause'],
  ],
  touchHint: 'Drag left and right anywhere on the screen to steer.',
  touchButtons: [],
  scorePerCoin: 60,
  scorePerXp: 15,
  music: { bpm: 126, root: 65, scale: 'major', progression: [0, 5, 3, 4], seed: 151, lead: 'square' },
  statLabels: {
    height: 'Best height (m)',
    springs: 'Springs used',
  },
  boostEffects: {
    shield: 'The first fall bounces you back up instead of ending the climb.',
    'head-start': 'Start with a spring jump.',
  },
  create: (s) => new JumperGame(s),
};
