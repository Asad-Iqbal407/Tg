import type { GameDefinition } from '../types';
import { PlatformerGame } from './platformer';

export const platformerGame: GameDefinition = {
  id: 'platformer',
  title: 'Pixel Quest',
  tagline: 'Stomp, bump and run to the flag.',
  description:
    'A side-scrolling platformer with procedurally assembled worlds. Bump blocks for coins and power-ups, stomp Grumbles, kick Shellbacks, throw fireballs and reach the flagpole before time runs out. Every world gets faster, busier and shorter on time.',
  genre: 'Platformer',
  inspiredBy: 'Super Mario Bros.',
  width: 960,
  height: 540,
  // Wider screens see further ahead; the course is always 15 rows tall.
  viewport: { minWidth: 800, maxWidth: 1280 },
  // Held sideways on a phone the level is zoomed in (see platformer.ts); portrait gets a rotate prompt.
  orientation: 'landscape',
  accent: '#ffd23f',
  gradient: ['#5c94fc', '#e63946'],
  controls: [
    ['← / → or A / D', 'Move'],
    ['Space / ↑ / W', 'Jump (hold for higher, tap to hop)'],
    ['Shift / X', 'Run · throw fireball when powered'],
  ],
  touchHint: 'Use the on-screen pad to move, A to jump and B to run / throw fire.',
  touchButtons: [
    { action: 'left', label: '◀', side: 'left', slot: 0 },
    { action: 'right', label: '▶', side: 'left', slot: 1 },
    { action: 'secondary', label: 'B', side: 'right', slot: 0 },
    { action: 'primary', label: 'A', side: 'right', slot: 1 },
  ],
  scorePerCoin: 400,
  scorePerXp: 80,
  music: { bpm: 140, root: 60, scale: 'major', progression: [0, 3, 4, 0], seed: 21, lead: 'square' },
  statLabels: {
    levels: 'Courses cleared',
    stomps: 'Stomps',
    enemies: 'Enemies defeated',
    powerups: 'Power-ups',
    bricks: 'Bricks smashed',
    jumps: 'Jumps',
  },
  boostEffects: {
    shield: 'Start with an extra life.',
    'head-start': 'Start with fire power.',
  },
  create: (s) => new PlatformerGame(s),
};
