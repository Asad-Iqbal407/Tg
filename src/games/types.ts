import type { AudioLike, MusicTheme } from '../core/audio';
import type { Action, Input } from '../core/input';
import type { Rng } from '../core/rng';

export type GameId =
  | 'runner'
  | 'platformer'
  | 'duck'
  | 'hill'
  | 'galaxy'
  | 'snake'
  | 'bombsquad'
  | 'tetris'
  | 'bubble'
  | 'pong'
  | 'breakout'
  | 'merge'
  | 'flappy'
  | 'stack'
  | 'memory'
  | 'mole';
export const GAME_IDS: readonly GameId[] = [
  'runner',
  'platformer',
  'duck',
  'hill',
  'galaxy',
  'snake',
  'bombsquad',
  'tetris',
  'bubble',
  'pong',
  'breakout',
  'merge',
  'flappy',
  'stack',
  'memory',
  'mole',
];

export type BoostId = 'coin-doubler' | 'xp-booster' | 'shield' | 'head-start';

/** Cosmetic / gameplay variant chosen in the shop. Games read only the keys they define. */
export interface SkinData {
  id: string;
  palette: Readonly<Record<string, string>>;
  params: Readonly<Record<string, number>>;
}

export interface Loadout {
  skin: SkinData;
  boosts: ReadonlySet<BoostId>;
  /** Multiplier applied to power-up durations (from the Power Duration upgrade). */
  powerDuration: number;
}

/**
 * Bounds for a flexible logical size. The shell picks the size inside these bounds that best
 * fills the screen, once per run; missing bounds default to the definition's width/height.
 */
export interface ViewportRange {
  minWidth?: number;
  maxWidth?: number;
  minHeight?: number;
  maxHeight?: number;
}

/** Logical pixels at each canvas edge that are covered by on-screen controls or display cutouts. */
export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export const NO_INSETS: Readonly<Insets> = { top: 0, right: 0, bottom: 0, left: 0 };

export interface GameServices {
  ctx: CanvasRenderingContext2D;
  /** Logical size chosen for this run (within the definition's viewport range). */
  width: number;
  height: number;
  /**
   * Areas of the canvas covered by touch controls / cutouts; keep important HUD out of them.
   * The object is live: the shell updates it in place when the layout changes mid-run.
   */
  insets: Readonly<Insets>;
  input: Input;
  audio: AudioLike;
  rng: Rng;
  loadout: Loadout;
  reducedMotion: boolean;
  haptic(ms: number): void;
  /** True when rendering a static thumbnail (card art); games may skip HUD and banners. */
  preview?: boolean;
}

export interface GameResult {
  score: number;
  /** Coins physically collected in-game (converted 1:1 to arcade coins). */
  coins: number;
  /** Per-run statistics, aggregated into lifetime totals/bests for achievements & missions. */
  stats: Record<string, number>;
  durationSec: number;
}

export interface GameInstance {
  update(dt: number): void;
  /**
   * Draw the current state. Must be a pure function of simulation state (no wall-clock time, no
   * gameplay RNG): the shell renders only after a simulation step ran or the canvas was resized.
   */
  render(): void;
  isOver(): boolean;
  getResult(): GameResult;
  destroy(): void;
}

export interface TouchButton {
  action: Action;
  label: string;
  /** Screen side and stacking slot for layout. */
  side: 'left' | 'right';
  slot?: number;
  wide?: boolean;
}

export interface GameDefinition {
  id: GameId;
  title: string;
  tagline: string;
  description: string;
  genre: string;
  inspiredBy: string;
  width: number;
  height: number;
  accent: string;
  gradient: readonly [string, string];
  controls: readonly (readonly [string, string])[];
  touchHint: string;
  touchButtons: readonly TouchButton[];
  /** Flexible logical size range; omit for a fixed width x height. */
  viewport?: ViewportRange;
  /**
   * Range used instead of viewport on a touch phone held landscape, so a game can fill a short
   * landscape screen without changing its desktop or portrait size.
   */
  landscapeViewport?: ViewportRange;
  /**
   * Orientation the game is designed for. On a touch phone held the other way the shell asks the
   * player to rotate before the run starts and pauses a run that is rotated away. Omit or use 'any'
   * for games that work well either way.
   */
  orientation?: 'landscape' | 'portrait' | 'any';
  /** Where pointer presses count: only on the canvas (default) or anywhere on the play stage. */
  pointerArea?: 'canvas' | 'stage';
  /** In-game score points converted into one arcade coin. */
  scorePerCoin: number;
  /** In-game score points converted into one XP. */
  scorePerXp: number;
  music: MusicTheme;
  /** Labels for per-run stats shown on the profile and results screens. */
  statLabels: Readonly<Record<string, string>>;
  /** What the Guardian / Power Start boosts do in this game. */
  boostEffects: Readonly<Partial<Record<BoostId, string>>>;
  create(services: GameServices): GameInstance;
}
