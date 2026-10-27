import { bombsquadGame } from './bombsquad';
import { breakoutGame } from './breakout/index';
import { bubbleGame } from './bubble/index';
import { duckGame } from './duck';
import { flappyGame } from './flappy/index';
import { fourGame } from './four/index';
import { galaxyGame } from './galaxy';
import { hillGame } from './hill';
import { hopperGame } from './hopper/index';
import { jumperGame } from './jumper/index';
import { memoryGame } from './memory/index';
import { mergeGame } from './merge/index';
import { minesGame } from './mines/index';
import { moleGame } from './mole/index';
import { platformerGame } from './platformer';
import { pongGame } from './pong/index';
import { runnerGame } from './runner';
import { sliceGame } from './slice/index';
import { snakeGame } from './snake';
import { sortGame } from './sort/index';
import { stackGame } from './stack/index';
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
  breakoutGame,
  mergeGame,
  flappyGame,
  stackGame,
  memoryGame,
  moleGame,
  minesGame,
  sliceGame,
  jumperGame,
  hopperGame,
  sortGame,
  fourGame,
];

const BY_ID = new Map<string, GameDefinition>(GAMES.map((g) => [g.id, g]));

export function getGame(id: string): GameDefinition | undefined {
  return BY_ID.get(id);
}

export function gameTitle(id: GameId): string {
  return BY_ID.get(id)?.title ?? id;
}
