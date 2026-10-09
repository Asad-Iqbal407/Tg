import type { AudioLike, MusicTheme } from '../core/audio';
import type { Action, Input } from '../core/input';
import type { Rng } from '../core/rng';

export type GameId = 'runner' | 'platformer' | 'duck' | 'hill' | 'galaxy';
export const GAME_IDS: readonly GameId[] = ['runner', 'platformer', 'duck', 'hill', 'galaxy'];

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

export interface GameServices {
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  input: Input;
  audio: AudioLike;
  rng: Rng;
  loadout: Loadout;
  reducedMotion: boolean;
  haptic(ms: number): void;
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
