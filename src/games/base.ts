import type { AudioLike } from '../core/audio';
import { FloatingTexts, Particles, Shake } from '../core/fx';
import type { Input } from '../core/input';
import type { Rng } from '../core/rng';
import type { BoostId, GameInstance, GameResult, GameServices, Insets } from './types';

/** Shared plumbing for all games: effects, scoring, stats and a delayed game-over sequence. */
export abstract class BaseGame implements GameInstance {
  protected readonly ctx: CanvasRenderingContext2D;
  protected readonly W: number;
  protected readonly H: number;
  protected readonly input: Input;
  protected readonly audio: AudioLike;
  protected readonly rng: Rng;
  protected readonly insets: Readonly<Insets>;
  protected readonly particles: Particles;
  protected readonly shake: Shake;
  protected readonly texts = new FloatingTexts();

  protected score = 0;
  protected coins = 0;
  protected time = 0;
  protected readonly stats: Record<string, number> = {};

  private ending = false;
  private endTimer = 0;

  constructor(protected readonly services: GameServices) {
    this.ctx = services.ctx;
    this.W = services.width;
    this.H = services.height;
    this.input = services.input;
    this.audio = services.audio;
    this.rng = services.rng;
    this.insets = services.insets;
    this.particles = new Particles(services.rng);
    this.particles.density = services.reducedMotion ? 0.35 : 1;
    this.shake = new Shake();
    this.shake.enabled = !services.reducedMotion;
  }

  update(dt: number): void {
    this.time += dt;
    if (this.ending) this.endTimer -= dt;
    this.tick(dt);
    this.particles.update(dt);
    this.shake.update(dt);
    this.texts.update(dt);
  }

  abstract render(): void;
  protected abstract tick(dt: number): void;

  isOver(): boolean {
    return this.ending && this.endTimer <= 0;
  }

  protected get isEnding(): boolean {
    return this.ending;
  }

  /** Begin the game-over sequence; `isOver()` turns true after `delay` seconds of animation. */
  protected endGame(delay = 1.4, sound = true): void {
    if (this.ending) return;
    this.ending = true;
    this.endTimer = delay;
    if (sound) this.audio.play('gameover');
    this.services.haptic(120);
  }

  protected hasBoost(id: BoostId): boolean {
    return this.services.loadout.boosts.has(id);
  }

  protected skinColor(key: string, fallback: string): string {
    return this.services.loadout.skin.palette[key] ?? fallback;
  }

  protected skinParam(key: string, fallback: number): number {
    return this.services.loadout.skin.params[key] ?? fallback;
  }

  /** Power-up duration scaled by the Power Duration upgrade. */
  protected powerTime(base: number): number {
    return base * this.services.loadout.powerDuration;
  }

  protected addStat(key: string, n = 1): void {
    this.stats[key] = (this.stats[key] ?? 0) + n;
  }

  protected maxStat(key: string, v: number): void {
    this.stats[key] = Math.max(this.stats[key] ?? 0, v);
  }

  getResult(): GameResult {
    const stats: Record<string, number> = {};
    for (const [k, v] of Object.entries(this.stats)) stats[k] = Math.floor(v);
    return {
      score: Math.max(0, Math.floor(this.score)),
      coins: Math.max(0, Math.floor(this.coins)),
      stats,
      durationSec: this.time,
    };
  }

  destroy(): void {}
}
