import type { Rng } from '../../core/rng';
import { type Arena, DIRECTIONS, FLOOR } from './grid';
import {
  BOMBER_DROP_COOLDOWN,
  BOMBER_DROP_RANGE,
  BOT_TOUCH_COOLDOWN,
  BOT_TOUCH_RANGE,
  type Bot,
  REPATH_TIME,
} from './types';

export interface BotEnv {
  arena: Arena;
  /** 1 for tiles that hold a landed bomb. */
  occupied: Uint8Array;
  rng: Rng;
  /** Lets a bomber drop a bomb on its tile. Returns false when the tile cannot take one. */
  dropBomb(tx: number, ty: number): boolean;
}

const ARRIVE_EPS = 1e-6;

/**
 * Advances one bot by `dt` seconds: walks tile to tile toward the player, drops bombs (bombers)
 * and reports whether it touched the player this step (the caller applies the hit).
 */
export function stepBot(bot: Bot, env: BotEnv, px: number, py: number, dt: number): boolean {
  const { arena } = env;
  if (bot.wait > 0) {
    bot.wait -= dt;
    return false;
  }
  if (bot.flash > 0) bot.flash -= dt;
  if (bot.touchCd > 0) bot.touchCd -= dt;
  const cols = arena.cols;

  bot.repath -= dt;
  if (bot.repath <= 0) {
    bot.repath = REPATH_TIME;
    replan(bot, env, px, py);
  }

  if (bot.goal < 0 && bot.path.length > 0) {
    const next = bot.path.shift();
    if (next !== undefined) {
      bot.goal = next;
      const gx = next % cols;
      const dx = gx + 0.5 - bot.x;
      if (Math.abs(dx) > ARRIVE_EPS) bot.facingX = Math.sign(dx);
    }
  }

  if (bot.goal >= 0) {
    const gx = (bot.goal % cols) + 0.5;
    const gy = Math.floor(bot.goal / cols) + 0.5;
    const dx = gx - bot.x;
    const dy = gy - bot.y;
    const left = Math.abs(dx) + Math.abs(dy);
    const step = bot.speed * dt;
    if (left <= step) {
      bot.x = gx;
      bot.y = gy;
      bot.goal = -1;
    } else {
      bot.x += Math.sign(dx) * Math.min(Math.abs(dx), step);
      bot.y += Math.sign(dy) * Math.min(Math.abs(dy), step);
    }
  }

  if (bot.kind === 'bomber') {
    bot.bombCd -= dt;
    const tileX = Math.floor(bot.x);
    const tileY = Math.floor(bot.y);
    const near = Math.abs(tileX - Math.floor(px)) + Math.abs(tileY - Math.floor(py)) <= BOMBER_DROP_RANGE;
    if (bot.bombCd <= 0 && near && bot.goal < 0 && env.dropBomb(tileX, tileY)) {
      bot.bombCd = BOMBER_DROP_COOLDOWN;
    }
  }

  const reach = BOT_TOUCH_RANGE;
  if (bot.touchCd <= 0 && Math.hypot(bot.x - px, bot.y - py) < reach) {
    bot.touchCd = BOT_TOUCH_COOLDOWN;
    return true;
  }
  return false;
}

/** Plans a path to the player's tile, or wanders to a random free neighbour when none exists. */
function replan(bot: Bot, env: BotEnv, px: number, py: number): void {
  const { arena, occupied, rng } = env;
  const cols = arena.cols;
  // Plan from the tile the bot is heading to, so a path never starts mid-step.
  const from = bot.goal >= 0 ? bot.goal : Math.floor(bot.y) * cols + Math.floor(bot.x);
  const fromX = from % cols;
  const fromY = Math.floor(from / cols);
  const path = arena.findPath(fromX, fromY, Math.floor(px), Math.floor(py), occupied);
  // An empty path means the bot already stands on the player's tile: it stays put.
  if (path) {
    bot.path = path;
    return;
  }
  bot.path = [];
  if (bot.goal >= 0) return;
  const options: number[] = [];
  for (const d of DIRECTIONS) {
    const nx = fromX + d.x;
    const ny = fromY + d.y;
    if (!arena.inBounds(nx, ny)) continue;
    const k = ny * cols + nx;
    if (arena.kindAt(nx, ny) === FLOOR && !occupied[k]) options.push(k);
  }
  if (options.length > 0) bot.path = [rng.pick(options)];
}
