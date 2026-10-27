import type { GameDefinition } from '../types';
import { FourGame } from './four';

export const fourGame: GameDefinition = {
  id: 'four',
  title: 'Connect Four',
  tagline: 'Four in a row beats the computer. Each win makes it smarter.',
  description:
    'Drop your red discs into the frame and get four in a row: across, up or diagonally, before the computer does with its yellow ones. Every win takes you to a sharper opponent that looks further ahead. A draw replays the level, and a loss ends the run. Quick wins score extra.',
  genre: 'Strategy',
  inspiredBy: 'Connect Four',
  width: 600,
  height: 880,
  viewport: { minWidth: 480, maxWidth: 720, minHeight: 800, maxHeight: 1000 },
  orientation: 'portrait',
  pointerArea: 'stage',
  accent: '#ef4444',
  gradient: ['#2563eb', '#0b1530'],
  controls: [
    ['Click / tap a column', 'Drop a disc'],
    ['← → + Space / ↓', 'Choose a column and drop'],
    ['Esc / P', 'Pause'],
  ],
  touchHint: 'Tap a column to drop your disc.',
  touchButtons: [],
  scorePerCoin: 300,
  scorePerXp: 60,
  music: { bpm: 100, root: 57, scale: 'minor', progression: [0, 3, 4, 0], seed: 167, lead: 'triangle' },
  statLabels: {
    wins: 'Games won',
    draws: 'Draws',
  },
  boostEffects: {
    shield: 'Your first loss is forgiven: replay the level instead of ending the run.',
    'head-start': 'In your first game the computer plays at random.',
  },
  create: (s) => new FourGame(s),
};
