/** Shared entity types and tuning for Bomb Squad. */

export const PLAYER_SPEED = 3.3;
export const SPEED_STEP = 0.5;
export const MAX_SPEED_UPS = 3;
/** Collision half-size of the player and bots, in tile units. */
export const PLAYER_RADIUS = 0.34;
export const LIVES = 3;
export const PUNCH_COOLDOWN = 0.35;
export const THROW_RANGE = 3;
export const FLIGHT_TIME = 0.25;
export const FUSE = 2.2;
export const BOT_FUSE = 2.0;
export const BLAST_BASE = 2;
export const MAX_BLAST_UPS = 3;
export const EXPLOSION_TIME = 0.4;
export const SHIELD_INVULN = 1.5;
export const RESPAWN_DELAY = 1.2;
export const RESPAWN_INVULN = 2;
export const DROP_CHANCE = 0.22;
export const REPATH_TIME = 0.5;
export const SPAWN_STAGGER = 0.4;
export const WAVE_BANNER = 2;
export const WAVE_CLEAR_DELAY = 1.5;
export const BOT_TOUCH_RANGE = 0.6;
export const BOT_TOUCH_COOLDOWN = 0.9;
export const BOMBER_DROP_COOLDOWN = 3.5;
export const BOMBER_DROP_RANGE = 3;
export const WALKER_SPEED = 1.5;
export const BOMBER_SPEED = 1.0;

export type ItemKind = 'blast' | 'bombs' | 'speed' | 'shield';
export type BotKind = 'walker' | 'bomber';

export interface Item {
  kind: ItemKind;
  x: number;
  y: number;
}

export interface Bomb {
  owner: 'player' | 'bot';
  /** Blast radius in tiles. */
  power: number;
  /** Seconds left before detonation; only counts down once the bomb has landed. */
  fuse: number;
  /** Fuse length the bomb was started with, used to pace its spark. */
  maxFuse: number;
  /** Seconds left in flight; 0 once landed. */
  flight: number;
  /** Position in tile units: the flight position while in flight, the tile centre once landed. */
  x: number;
  y: number;
  fromX: number;
  fromY: number;
  /** Landing tile. */
  tx: number;
  ty: number;
  dead: boolean;
}

/** Visual and damage record of one detonation: the tiles it covered, for `EXPLOSION_TIME` seconds. */
export interface Explosion {
  tiles: number[];
  life: number;
  /** Used by the renderer to pick the flame palette and by the shake. */
  big: boolean;
}

export interface Bot {
  kind: BotKind;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  speed: number;
  /** Tile indices still to visit, nearest first. */
  path: number[];
  /** Tile index the bot is currently stepping into, or -1 when standing on a tile centre. */
  goal: number;
  /** Seconds until the next path recomputation. */
  repath: number;
  /** Seconds until the next bomb drop (bombers only). */
  bombCd: number;
  /** Seconds until this bot can hurt the player again. */
  touchCd: number;
  /** Seconds until the bot starts moving (spawn animation). */
  wait: number;
  /** Seconds of white damage flash left. */
  flash: number;
  facingX: number;
  /** Cosmetic animation offset so bots don't bob in unison. */
  phase: number;
}

export interface Player {
  x: number;
  y: number;
  facingX: number;
  facingY: number;
  /** Bombs in hand. */
  ammo: number;
  ammoMax: number;
  speedUps: number;
  blastUps: number;
  bombUps: number;
  shielded: boolean;
  /** Seconds of invulnerability left (shield absorb, respawn blink). */
  invuln: number;
  /** Seconds until respawn, or 0 while alive. */
  respawn: number;
  punchCd: number;
  walk: number;
}
