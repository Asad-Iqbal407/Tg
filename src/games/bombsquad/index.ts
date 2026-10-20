import type { GameDefinition } from '../types';
import { BombSquadGame } from './bombsquad';

export const bombsquadGame: GameDefinition = {
  id: 'bombsquad',
  title: 'Bomb Squad',
  tagline: "Lay bombs down, clear the arena, and don't get caught in the blast.",
  description:
    'Blow up crates to uncover power-ups and trap the bots that chase you through the arena. Lay timed bombs on the floor, punch them down the lane, and clear each wave before the next squad arrives.',
  genre: 'Bomb arena',
  inspiredBy: 'BombSquad',
  width: 960,
  height: 600,
  // A tall screen (a portrait phone running the game anyway, a portrait tablet or window) gets a tall arena rather than
  // a letterboxed strip; a wide screen is sized as before, since only an aspect under 960:760 reaches the new bounds.
  viewport: { minWidth: 600, maxWidth: 1280, minHeight: 360, maxHeight: 1280 },
  // The arena is designed wide; a portrait phone is asked to turn first, and a tall arena is the fallback.
  orientation: 'landscape',
  pointerArea: 'stage',
  accent: '#fb923c',
  gradient: ['#fb923c', '#7c2d12'],
  controls: [
    ['← → ↑ ↓ / W A S D', 'Walk'],
    ['Space / Enter / Z', 'Lay a bomb'],
    ['X / Shift', 'Punch: kick bombs and bots'],
  ],
  touchHint: 'Drag anywhere to walk toward your finger. Tap BOMB to lay a bomb, PUNCH to kick.',
  touchButtons: [
    { action: 'primary', label: 'BOMB', side: 'right', slot: 0, wide: true },
    { action: 'secondary', label: 'PUNCH', side: 'right', slot: 1, wide: true },
  ],
  scorePerCoin: 150,
  scorePerXp: 40,
  music: { bpm: 128, root: 55, scale: 'minor', progression: [0, 6, 3, 4], seed: 71, lead: 'triangle' },
  statLabels: {
    kills: 'Bots defeated',
    blocks: 'Crates blown up',
    bombs: 'Bombs laid',
    wave: 'Best wave',
    multikill: 'Best multi-kill',
    powerups: 'Power-ups found',
  },
  boostEffects: {
    shield: 'Start with a shield that absorbs one hit.',
    'head-start': 'Start with an extra bomb to lay.',
  },
  create: (s) => new BombSquadGame(s),
};
