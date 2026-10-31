import type { GameDefinition, GameId } from './types';

export type Category = 'action' | 'puzzle' | 'sports' | 'quick';

export const CATEGORIES: readonly Category[] = ['action', 'puzzle', 'sports', 'quick'];

export const CATEGORY_LABEL: Readonly<Record<Category, string>> = {
  action: 'Action',
  puzzle: 'Puzzle & strategy',
  sports: 'Sports',
  quick: 'Quick play',
};

/** Where each game sits on the home screen. A game missing here is a compile error. */
export const CATEGORY_OF: Readonly<Record<GameId, Category>> = {
  runner: 'action',
  platformer: 'action',
  duck: 'action',
  hill: 'action',
  galaxy: 'action',
  bombsquad: 'action',
  jumper: 'action',
  hopper: 'action',
  maze: 'action',
  dino: 'action',
  missile: 'action',
  blaster: 'action',
  tetris: 'puzzle',
  bubble: 'puzzle',
  merge: 'puzzle',
  memory: 'puzzle',
  mines: 'puzzle',
  sort: 'puzzle',
  sudoku: 'puzzle',
  lights: 'puzzle',
  pipes: 'puzzle',
  gems: 'puzzle',
  four: 'puzzle',
  tictactoe: 'puzzle',
  pong: 'sports',
  golf: 'sports',
  hoops: 'sports',
  hockey: 'sports',
  archery: 'sports',
  snake: 'quick',
  breakout: 'quick',
  flappy: 'quick',
  stack: 'quick',
  mole: 'quick',
  slice: 'quick',
  knife: 'quick',
  simon: 'quick',
  tiles: 'quick',
};

/**
 * Whether a game fits a search: every word typed must appear in its title, genre, tagline, the game it is inspired by
 * or its category. An empty search fits everything.
 */
export function matchesQuery(def: GameDefinition, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const hay = [def.title, def.genre, def.tagline, def.inspiredBy, CATEGORY_LABEL[CATEGORY_OF[def.id]]]
    .join(' ')
    .toLowerCase();
  return words.every((w) => hay.includes(w));
}

/** The games played most recently, newest first (never-played games are left out). */
export function recentGames<T extends { lastPlayed: number }>(
  records: Readonly<Record<GameId, T>>,
  ids: readonly GameId[],
  count: number,
): GameId[] {
  return ids
    .filter((id) => (records[id]?.lastPlayed ?? 0) > 0)
    .sort((a, b) => (records[b]?.lastPlayed ?? 0) - (records[a]?.lastPlayed ?? 0))
    .slice(0, count);
}
