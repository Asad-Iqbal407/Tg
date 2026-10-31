import type { GameDefinition } from '../types';
import { FlappyGame } from './flappy';

export const flappyGame: GameDefinition = {
  id: 'flappy',
  title: 'Sky Hopper',
  tagline: 'Tap to flap through the gaps.',
  description:
    'A one-touch flier. Every tap gives your bird a flap of lift, and gravity does the rest. Thread the gaps between the pipes, grab the coins floating inside them, and see how far you get. The gaps narrow and the pipes speed up as you go.',
  genre: 'One-tap arcade',
  inspiredBy: 'Flappy Bird',
  width: 600,
  height: 880,
  viewport: { minWidth: 480, maxWidth: 720, minHeight: 800, maxHeight: 1000 },
  orientation: 'portrait',
  pointerArea: 'stage',
  accent: '#facc15',
  gradient: ['#38bdf8', '#166534'],
  controls: [
    ['Space / ↑ / W', 'Flap'],
    ['Click / tap', 'Flap'],
    ['Esc / P', 'Pause'],
  ],
  touchHint: 'Tap anywhere to flap.',
  touchButtons: [],
  scorePerCoin: 60,
  scorePerXp: 15,
  music: { bpm: 124, root: 67, scale: 'major', progression: [0, 4, 5, 3], seed: 113, lead: 'triangle' },
  statLabels: {
    gates: 'Gates passed',
    flaps: 'Flaps',
  },
  boostEffects: {
    shield: 'Survive the first crash: the bird blinks through pipes for a moment.',
    'head-start': 'Start with 5 gates already counted.',
  },
  create: (s) => new FlappyGame(s),
};
