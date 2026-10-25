import type { GameDefinition } from '../types';
import { PongGame } from './pong';

export const pongGame: GameDefinition = {
  id: 'pong',
  title: 'Ping Pong',
  tagline: 'Rally past the computer. First to eleven, win by two.',
  description:
    'Table tennis against the computer. Keep the ball in play, and return it off the edge of your paddle for a sharper angle. Every hit in a rally makes the ball faster, and each serve starts slow again. Games go to eleven, and a win must be by two points. Long rallies earn bonus points.',
  genre: 'Table tennis',
  inspiredBy: 'Classic table tennis',
  width: 960,
  height: 600,
  viewport: { minWidth: 800, maxWidth: 1200, minHeight: 480, maxHeight: 640 },
  // A table is wider than it is tall, and held upright a phone would show only a sliver of it.
  orientation: 'landscape',
  pointerArea: 'stage',
  accent: '#fb923c',
  gradient: ['#166534', '#1e3a8a'],
  controls: [
    ['↑ ↓ / W S', 'Move your paddle'],
    ['Mouse press and drag', 'Paddle follows the pointer height'],
    ['Touch drag', 'Drag anywhere: the paddle moves with your finger, never under it'],
    ['Esc / P', 'Pause'],
  ],
  touchHint: 'Drag up and down anywhere on the screen, or hold UP / DOWN.',
  touchButtons: [
    { action: 'up', label: 'UP', side: 'left', wide: true },
    { action: 'down', label: 'DOWN', side: 'right', wide: true },
  ],
  scorePerCoin: 200,
  scorePerXp: 60,
  music: { bpm: 138, root: 62, scale: 'major', progression: [0, 5, 3, 4], seed: 97, lead: 'triangle' },
  statLabels: {
    points: 'Points won',
    rallies: 'Rallies played',
    longestRally: 'Longest rally',
    wins: 'Matches won',
    aces: 'Aces',
  },
  boostEffects: {
    shield: 'The first point you lose is not counted.',
    'head-start': 'Start the match 2 points up.',
  },
  create: (s) => new PongGame(s),
};
