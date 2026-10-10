import type { GameDefinition } from '../types';
import { BombSquadGame } from './bombsquad';

export const bombsquadGame: GameDefinition = {
  id: 'bombsquad',
  title: 'Bomb Squad',
  tagline: "Throw bombs, clear the arena, and don't get caught in the blast.",
  description:
    'Blow up crates to uncover power-ups and bomb the bots that chase you through the arena. Throw timed bombs, kick them away, and clear each wave before the next squad arrives.',
  genre: 'Bomb arena',
  inspiredBy: 'BombSquad',
  width: 960,
  height: 600,
  viewport: { minWidth: 800, maxWidth: 1280, minHeight: 540, maxHeight: 760 },
  pointerArea: 'stage',
  accent: '#fb923c',
  gradient: ['#fb923c', '#7c2d12'],
  controls: [
    ['← → ↑ ↓ / W A S D', 'Walk'],
    ['Space / Enter / Z', 'Throw a bomb toward your aim'],
    ['X / Shift', 'Punch: kick bombs and bots'],
    ['Mouse', 'Aim the throw'],
  ],
  touchHint: 'Drag anywhere to walk toward your finger. Tap BOMB to throw, PUNCH to kick.',
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
    bombs: 'Bombs thrown',
    wave: 'Best wave',
    multikill: 'Best multi-kill',
    powerups: 'Power-ups found',
  },
  boostEffects: {
    shield: 'Start with a shield that absorbs one hit.',
    'head-start': 'Start with an extra bomb and a bigger blast.',
  },
  create: (s) => new BombSquadGame(s),
};
