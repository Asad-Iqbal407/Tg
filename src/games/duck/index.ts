import type { GameDefinition } from '../types';
import { DuckGame } from './duck';

export const duckGame: GameDefinition = {
  id: 'duck',
  title: 'Duck Season',
  tagline: 'Three shells. Two ducks. No mercy.',
  description:
    'A sharpshooting gallery across changing skies. Each round releases ten ducks in pairs — hit enough to advance. Chain hits for combo multipliers, land double kills, shoot supply balloons for slow-mo and scatter shots, and hunt the rare golden duck.',
  genre: 'Shooting gallery',
  inspiredBy: 'Duck Hunt',
  width: 960,
  height: 540,
  // Wider screens show more sky; the flight band, scenery and HUD all follow the width.
  viewport: { minWidth: 800, maxWidth: 1280 },
  accent: '#7CFC00',
  gradient: ['#4caf50', '#1b5e20'],
  controls: [
    ['Mouse / tap', 'Aim and shoot'],
    ['Arrow keys / WASD / stick', 'Move crosshair (hold to speed up; it drifts with nearby ducks)'],
    ['Space / Enter', 'Shoot'],
  ],
  touchHint: 'Tap anywhere to shoot at that spot.',
  touchButtons: [],
  scorePerCoin: 900,
  scorePerXp: 150,
  music: { bpm: 112, root: 55, scale: 'pentatonic', progression: [0, 3, 1, 4], seed: 33, lead: 'triangle' },
  statLabels: {
    ducks: 'Ducks hit',
    rounds: 'Rounds cleared',
    bestRound: 'Best round',
    perfectRounds: 'Perfect rounds',
    doubleKills: 'Double kills',
    goldenDucks: 'Golden ducks',
    shots: 'Shots fired',
  },
  boostEffects: {
    shield: 'Retry one failed round.',
    'head-start': 'Scatter shot for the whole first round (crates never cut it short).',
  },
  create: (s) => new DuckGame(s),
};
