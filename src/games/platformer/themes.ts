import { STAGES_PER_WORLD } from './tuning';

export interface Theme {
  name: string;
  sky: readonly [string, string];
  /** Near hills (or rock mounds underground). */
  hill: string;
  hillFar: string;
  ground: string;
  /** Grass on top of the ground (moss underground). */
  grass: string;
  /** Twinkling stars in the sky. */
  stars: boolean;
  /** Underground: stalactites hang from the top instead of clouds drifting by. */
  cave: boolean;
}

const OUTDOOR: readonly Theme[] = [
  {
    name: 'Grassland',
    sky: ['#5c94fc', '#a8d0ff'],
    hill: '#47b04f',
    hillFar: '#8fd18f',
    ground: '#c8743c',
    grass: '#62d162',
    stars: false,
    cave: false,
  },
  {
    name: 'Sunset Ridge',
    sky: ['#6a3d9a', '#ff9a62'],
    hill: '#8c3f6e',
    hillFar: '#c06b8a',
    ground: '#a8603a',
    grass: '#f2b34c',
    stars: false,
    cave: false,
  },
  {
    name: 'Starlight Hills',
    sky: ['#081430', '#253a6e'],
    hill: '#1f4d5c',
    hillFar: '#2c3e70',
    ground: '#5c4f86',
    grass: '#46d9c4',
    stars: true,
    cave: false,
  },
];

const CAVERN: Theme = {
  name: 'Crystal Caverns',
  sky: ['#0b0a1a', '#2a2048'],
  hill: '#2e2550',
  hillFar: '#1d1838',
  ground: '#6a5a8c',
  grass: '#b48cff',
  stars: false,
  cave: true,
};

/**
 * Each world runs through the outdoor themes (starting one further along per world) and ends
 * underground on its last stage, so the look changes every course and every world closes the same way.
 */
export function themeFor(level: number): Theme {
  const world = Math.ceil(level / STAGES_PER_WORLD);
  const stage = ((level - 1) % STAGES_PER_WORLD) + 1;
  if (stage === STAGES_PER_WORLD) return CAVERN;
  return OUTDOOR[(world - 1 + stage - 1) % OUTDOOR.length] as Theme;
}
