import { bombsquadGame } from './bombsquad';
import { duckGame } from './duck';
import { galaxyGame } from './galaxy';
import { hillGame } from './hill';
import { platformerGame } from './platformer';
import { runnerGame } from './runner';
import { snakeGame } from './snake';
import type { GameDefinition, GameId } from './types';

export const GAMES: readonly GameDefinition[] = [
  runnerGame,
  platformerGame,
  duckGame,
  hillGame,
  galaxyGame,
  snakeGame,
  bombsquadGame,
];

const BY_ID = new Map<string, GameDefinition>(GAMES.map((g) => [g.id, g]));

export function getGame(id: string): GameDefinition | undefined {
  return BY_ID.get(id);
}

export function gameTitle(id: GameId): string {
  return BY_ID.get(id)?.title ?? id;
}
