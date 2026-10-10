import type { GameDefinition } from '../types';
import { GalaxyGame } from './galaxy';

export const galaxyGame: GameDefinition = {
  id: 'galaxy',
  title: 'Galaxy War',
  tagline: 'Hold the line against the armada.',
  description:
    'A vertical space shooter with auto-fire, five weapon levels, screen-clearing bombs and chain multipliers. Surplus power-ups at max weapon grant Overdrive. Survive formations of scouts, fighters, tanks and kamikazes, then face a Mothership with telegraphed bullet patterns every fifth wave.',
  genre: 'Space shooter',
  inspiredBy: 'Galaga / Space Shooter',
  width: 540,
  height: 960,
  viewport: { minWidth: 540, maxWidth: 720, minHeight: 900, maxHeight: 1200 },
  // Right-drags and mouse steering keep working over the letterbox, so the ship never stops mid-fight.
  pointerArea: 'stage',
  accent: '#b06bff',
  gradient: ['#b06bff', '#140a2e'],
  controls: [
    ['Arrows / WASD or mouse', 'Fly (weapons fire automatically)'],
    ['Space / X / B / Shift / Right click', 'Bomb — clears enemy fire'],
  ],
  touchHint: 'Drag anywhere to fly — the ship moves with your finger. Tap BOMB to clear the screen.',
  touchButtons: [{ action: 'secondary', label: 'BOMB', side: 'right', slot: 0 }],
  scorePerCoin: 1200,
  scorePerXp: 240,
  music: { bpm: 150, root: 50, scale: 'minor', progression: [0, 5, 6, 4], seed: 55, lead: 'sawtooth' },
  statLabels: {
    enemies: 'Enemies destroyed',
    wave: 'Best wave',
    bosses: 'Motherships destroyed',
    powerups: 'Power-ups',
    bombs: 'Bombs used',
  },
  boostEffects: {
    shield: 'Start with a shield bubble.',
    'head-start': 'Start with weapon power +2.',
  },
  create: (s) => new GalaxyGame(s),
};
