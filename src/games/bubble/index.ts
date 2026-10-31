import type { GameDefinition } from '../types';
import { BubbleGame } from './bubble';

export const bubbleGame: GameDefinition = {
  id: 'bubble',
  title: 'Bubble Shooter',
  tagline: 'Aim, shoot and pop matching bubbles.',
  description:
    'Aim the shooter, fire coloured bubbles into the hanging grid, and pop groups of three or more matching colours. Bubbles left hanging from the ceiling fall away for bonus points. Every six shots the ceiling sinks a row, so clear the board before it reaches the shooter.',
  genre: 'Classic Pop',
  inspiredBy: 'Bubble Shooter (classic puzzle)',
  width: 600,
  height: 880,
  viewport: { minWidth: 480, maxWidth: 720, minHeight: 800, maxHeight: 1000 },
  orientation: 'portrait',
  // Presses anywhere on the stage aim, so a finger over the letterbox still works.
  pointerArea: 'stage',
  accent: '#22d3ee',
  gradient: ['#1e3a8a', '#0b1530'],
  controls: [
    ['← → / A D', 'Aim the shooter'],
    ['Space / Enter / Z', 'Fire'],
    ['Press and drag', 'Aim, then let go to fire'],
    ['X / Shift / tap NEXT', 'Swap the loaded and the waiting bubble'],
  ],
  touchHint: 'Drag to aim, let go to fire. Tap the NEXT bubble to swap.',
  touchButtons: [],
  scorePerCoin: 400,
  scorePerXp: 80,
  music: { bpm: 132, root: 67, scale: 'major', progression: [0, 5, 3, 4], seed: 83, lead: 'triangle' },
  statLabels: {
    pops: 'Bubbles popped',
    drops: 'Bubbles dropped',
    shots: 'Shots fired',
    levels: 'Levels cleared',
    combo: 'Best combo',
  },
  boostEffects: {
    shield: 'Survive one settle on the shooter line: that row is cleared instead.',
    'head-start': 'Start on level 2, with an extra row and a sixth colour.',
  },
  create: (s) => new BubbleGame(s),
};
