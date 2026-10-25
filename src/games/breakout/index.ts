import type { GameDefinition } from '../types';
import { BreakoutGame } from './breakout';

export const breakoutGame: GameDefinition = {
  id: 'breakout',
  title: 'Brick Breaker',
  tagline: 'Bounce the ball and smash every brick.',
  description:
    'Keep the ball in play with your paddle and break every brick to clear the level. Hit the ball with the edge of the paddle for a sharper angle. Some bricks take two or three hits, and steel ones never break. Catch falling capsules for a wide paddle, extra balls, slow motion, coins and extra lives.',
  genre: 'Arcade classic',
  inspiredBy: 'Breakout / Arkanoid',
  width: 600,
  height: 880,
  viewport: { minWidth: 480, maxWidth: 720, minHeight: 800, maxHeight: 1000 },
  // Rows of bricks above a paddle: a tall field, like the other portrait games.
  orientation: 'portrait',
  // A finger anywhere on the stage steers, so it never has to cover the paddle.
  pointerArea: 'stage',
  accent: '#22d3ee',
  gradient: ['#6366f1', '#0f172a'],
  controls: [
    ['← → / A D', 'Move the paddle'],
    ['Mouse / press and drag', 'Paddle follows the pointer'],
    ['Space / ↑ / tap', 'Launch the ball'],
    ['Esc / P', 'Pause'],
  ],
  touchHint: 'Drag anywhere to move the paddle. Tap to launch.',
  touchButtons: [],
  scorePerCoin: 300,
  scorePerXp: 70,
  music: { bpm: 128, root: 64, scale: 'minor', progression: [0, 5, 3, 4], seed: 103, lead: 'square' },
  statLabels: {
    bricks: 'Bricks broken',
    levels: 'Levels cleared',
    powerups: 'Capsules caught',
    combo: 'Best combo',
  },
  boostEffects: {
    shield: 'A barrier under the paddle saves the first ball you miss.',
    'head-start': 'Start with an extra life and a wide paddle.',
  },
  create: (s) => new BreakoutGame(s),
};
