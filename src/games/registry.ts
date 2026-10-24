import { bombsquadGame } from './bombsquad';
import { bubbleGame } from './bubble/index';
import { duckGame } from './duck';
import { galaxyGame } from './galaxy';
import { hillGame } from './hill';
import { platformerGame } from './platformer';
import { pongGame } from './pong/index';
import { runnerGame } from './runner';
import { snakeGame } from './snake';
import { tetrisGame } from './tetris';
import type { GameDefinition, GameId } from './types';

export const GAMES: readonly GameDefinition[] = [
  runnerGame,
  platformerGame,
  duckGame,
  hillGame,
  galaxyGame,
  snakeGame,
  bombsquadGame,
  tetrisGame,
  bubbleGame,
  pongGame,
];

const BY_ID = new Map<string, GameDefinition>(GAMES.map((g) => [g.id, g]));

export function getGame(id: string): GameDefinition | undefined {
  return BY_ID.get(id);
}

export function gameTitle(id: GameId): string {
  return BY_ID.get(id)?.title ?? id;
}
