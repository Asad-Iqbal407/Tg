import type { GameDefinition } from '../types';
import { DuckGame } from './duck';

export const duckGame: GameDefinition = {
  id: 'duck',
  title: 'Duck Season',
  tagline: 'Three shells. Two ducks. No mercy.',
  description:
    'A sharpshooting gallery across changing skies. Each round releases ten ducks in waves — hit enough to advance. Chain hits for combo multipliers, land double kills, shoot supply balloons for slow-mo and scatter shots, and hunt the rare golden duck.',
  genre: 'Shooting gallery',
  inspiredBy: 'Duck Hunt',
  width: 960,
  height: 540,
  // Wider screens show more sky; the flight band, scenery and HUD all follow the width. The floor
  // keeps ducks large on a narrow canvas (portrait phones, tablets) and the HUD readable there.
  viewport: { minWidth: 640, maxWidth: 1280 },
  // Aiming is by finger, so the game is played sideways: a portrait phone gets the rotate prompt.
  orientation: 'landscape',
  accent: '#7CFC00',
  gradient: ['#4caf50', '#1b5e20'],
  controls: [
    ['Mouse / tap', 'Aim and shoot'],
    ['Arrow keys / WASD / stick', 'Move crosshair (hold to speed up; it drifts with nearby ducks)'],
    ['Space / Enter', 'Shoot'],
    ['Shift / X / right click', 'Snap onto the nearest duck'],
  ],
  touchHint: 'Tap anywhere to shoot at that spot.',
  touchButtons: [],
  scorePerCoin: 4000,
  scorePerXp: 650,
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
