import type { GameDefinition } from '../types';
import { HockeyGame } from './hockey';

export const hockeyGame: GameDefinition = {
  id: 'hockey',
  title: 'Air Hockey',
  tagline: 'Slam the puck past the computer. First to seven.',
  description:
    'Slide your red mallet around your half of the table and smash the puck into the computer’s goal at the top. Hit it moving for more power, and bank it off the rails. First to seven goals wins the match and brings a quicker opponent. Lose a match and the run is over.',
  genre: 'Table sport',
  inspiredBy: 'Air hockey',
  width: 600,
  height: 880,
  viewport: { minWidth: 480, maxWidth: 720, minHeight: 800, maxHeight: 1000 },
  orientation: 'portrait',
  pointerArea: 'stage',
  accent: '#ef4444',
  gradient: ['#1e40af', '#e0f2fe'],
  controls: [
    ['Drag / mouse', 'Move your mallet'],
    ['← ↑ → ↓', 'Move your mallet'],
    ['Esc / P', 'Pause'],
  ],
  touchHint: 'Drag your mallet around the bottom half and hit the puck.',
  touchButtons: [],
  scorePerCoin: 250,
  scorePerXp: 60,
  music: { bpm: 132, root: 62, scale: 'minor', progression: [0, 5, 3, 4], seed: 241, lead: 'square' },
  statLabels: {
    goals: 'Goals scored',
    wins: 'Matches won',
  },
  boostEffects: {
    shield: 'Your first lost match gets a rematch.',
    'head-start': 'Every match starts with you one goal up.',
  },
  create: (s) => new HockeyGame(s),
};
