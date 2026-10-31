import type { GameDefinition } from '../types';
import { MissileGame } from './missile';

export const missileGame: GameDefinition = {
  id: 'missile',
  title: 'Missile Command',
  tagline: 'Tap the sky to blow up the missiles before they hit your cities.',
  description:
    'Missiles streak down at your six cities. Tap anywhere in the sky and an interceptor flies there and bursts into a fireball that destroys every missile it touches; their own blasts can catch others. Ammo is limited each wave, so lead your shots. From wave three some missiles split in two. Lose every city and it is over.',
  genre: 'Defence',
  inspiredBy: 'Missile Command',
  width: 600,
  height: 880,
  viewport: { minWidth: 480, maxWidth: 720, minHeight: 800, maxHeight: 1000 },
  orientation: 'portrait',
  accent: '#7dd3fc',
  gradient: ['#1e1b4b', '#854d0e'],
  controls: [
    ['Click / tap', 'Fire an interceptor at that point'],
    ['← ↑ → ↓ + Space', 'Move the crosshair and fire'],
    ['Esc / P', 'Pause'],
  ],
  touchHint: 'Tap the sky a little ahead of a missile to blow it up.',
  touchButtons: [],
  scorePerCoin: 300,
  scorePerXp: 70,
  music: { bpm: 128, root: 57, scale: 'minor', progression: [0, 6, 5, 4], seed: 251, lead: 'square' },
  statLabels: {
    missiles: 'Missiles destroyed',
    waves: 'Waves survived',
  },
  boostEffects: {
    shield: 'The first missile to reach a city is stopped.',
    'head-start': 'Ten extra interceptors every wave.',
  },
  create: (s) => new MissileGame(s),
};
