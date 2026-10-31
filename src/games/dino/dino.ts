import { TAU } from '../../core/math';
import { BaseGame } from '../base';
import { text } from '../draw';
import { drawStatBar, statBarHeight } from '../statbar';
import type { GameServices } from '../types';

export type ObstacleKind = 'cactus' | 'cacti' | 'bigCactus' | 'birdLow' | 'birdMid' | 'birdHigh';

export interface Obstacle {
  kind: ObstacleKind;
  /** Left edge, logical px. */
  x: number;
}

const DESIGN_W = 600;
/** The dinosaur, the obstacles and the jump are drawn this much bigger than the design px, so they read on a phone. */
const BIG = 1.35;
const DINO_X = 90;
const DINO_W = 56;
const DINO_H = 62;
const DUCK_H = 36;
const JUMP_V = 1080;
const GRAVITY = 3300;
/** Swiping down in the air drops the dino faster. */
const DIVE_GRAVITY = 9000;
const START_SPEED = 430;
const SPEED_GAIN = 7;
const MAX_SPEED = 1050;
const DUCK_SEC = 0.55;
const BIRDS_FROM = 300;
const NIGHT_EVERY = 700;
const NIGHT_LEN = 200;
const HEAD_START_M = 300;
const INVULN_SEC = 1.5;
const COIN_EVERY = 100;

/** Width and height (design px) of each obstacle, and how high its bottom sits above the ground. */
export const SIZES: Readonly<Record<ObstacleKind, { w: number; h: number; lift: number }>> = {
  cactus: { w: 30, h: 62, lift: 0 },
  cacti: { w: 76, h: 56, lift: 0 },
  bigCactus: { w: 40, h: 88, lift: 0 },
  birdLow: { w: 60, h: 40, lift: 10 },
  birdMid: { w: 60, h: 40, lift: 46 },
  birdHigh: { w: 60, h: 40, lift: 96 },
};

/** True when two boxes overlap, each shrunk by `inset` on every side (a forgiving hit test). */
export function overlap(
  ax: number,
  ay: number,
  aw: number,
  ah: number,
  bx: number,
  by: number,
  bw: number,
  bh: number,
  inset: number,
): boolean {
  return (
    ax + inset < bx + bw - inset &&
    bx + inset < ax + aw - inset &&
    ay + inset < by + bh - inset &&
    by + inset < ay + ah - inset
  );
}

/** Dino Run: jump the cacti and duck the birds. The desert gets faster, and night falls every 700 m. */
export class DinoGame extends BaseGame {
  private readonly u: number;
  /** Logical px per design px for sizes and the jump (u times BIG); speeds stay in u. */
  private readonly s: number;
  /** Height of the dino's feet above the ground, logical px. */
  private y = 0;
  private vy = 0;
  private duckT = 0;
  private diving = false;
  private speed: number;
  private distance = 0;
  private obstacles: Obstacle[] = [];
  private gap = 0;
  private started = false;
  private shield = false;
  private invulnT = 0;
  private run = 0;
  private dead = false;

  constructor(services: GameServices) {
    super(services);
    this.u = this.W / DESIGN_W;
    this.s = this.u * BIG;
    this.speed = START_SPEED * this.u;
    this.shield = this.hasBoost('shield');
    for (const key of ['distance', 'jumps']) this.addStat(key, 0);
    if (this.hasBoost('head-start')) {
      this.distance = HEAD_START_M * 10 * this.u;
      this.speed = Math.min(MAX_SPEED, START_SPEED + SPEED_GAIN * 18) * this.u;
    }
    this.gap = 500 * this.u;
    if (services.preview) this.started = true;
  }

  protected tick(dt: number): void {
    this.invulnT = Math.max(0, this.invulnT - dt);
    if (this.isEnding) return;
    const jump =
      this.input.wasPressed('primary') || this.input.wasPressed('up') || this.input.pointer.pressed;
    const swipe = this.input.consumeSwipe();
    if (swipe === 'up') this.tryJump();
    if (!this.started) {
      if (jump || swipe === 'up') {
        this.started = true;
        this.tryJump();
      }
      return;
    }
    if (jump) this.tryJump();
    const down = this.input.isDown('down') || swipe === 'down';
    if (swipe === 'down') this.duckT = DUCK_SEC;
    this.diving = down && this.y > 0;
    if (this.input.isDown('down')) this.duckT = Math.max(this.duckT, 0.05);
    this.duckT = Math.max(0, this.duckT - dt);
    if (this.services.preview) this.autopilot();
    this.physics(dt);
    this.scroll(dt);
    this.hitTest();
  }

  render(): void {
    const ctx = this.ctx;
    const m = this.metres();
    const nightPhase = (m % NIGHT_EVERY) / NIGHT_EVERY;
    const night = m > 0 && nightPhase > 1 - NIGHT_LEN / NIGHT_EVERY;
    const sky = night ? this.skinColor('night', '#0f172a') : this.skinColor('sky', '#f8fafc');
    const ink = night ? '#e2e8f0' : this.skinColor('ink', '#475569');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, this.W, this.H);
    const ground = this.groundY();
    ctx.save();
    ctx.translate(this.shake.x, this.shake.y);
    this.drawBackdrop(ink, night);
    ctx.fillStyle = night ? 'rgba(255,255,255,0.04)' : 'rgba(120,53,15,0.07)';
    ctx.fillRect(0, ground, this.W, this.H - ground);
    ctx.fillStyle = ink;
    ctx.fillRect(0, ground, this.W, 3 * this.u);
    // Pebbles scroll past on the ground.
    for (let k = 0; k < 18; k++) {
      const span = this.W + 40 * this.u;
      const x = ((((((k * 97) % 600) * this.u - this.distance) % span) + span) % span) - 20 * this.u;
      ctx.fillRect(x, ground + (8 + (k % 3) * 7) * this.u, (3 + (k % 4) * 2) * this.u, 2 * this.u);
    }
    for (const o of this.obstacles) this.drawObstacle(o, ground, ink);
    if (!(this.invulnT > 0 && Math.floor(this.invulnT * 10) % 2 === 0)) this.drawDino(ground, ink);
    this.particles.render(ctx);
    this.texts.render(ctx);
    ctx.restore();
    if (this.services.preview) return;
    drawStatBar(ctx, this.W, this.insets.top, this.u, [
      ['DISTANCE', `${m} m`],
      ['BEST', `${this.stats['distance'] ?? 0} m`],
      ['SPEED', `${Math.round(this.speed / this.u / 10)}`],
    ]);
    if (!this.started) {
      text(ctx, 'TAP TO JUMP · SWIPE DOWN TO DUCK', this.W / 2, ground - 200 * this.u, {
        size: Math.round(22 * this.u),
        align: 'center',
        color: ink,
        stroke: null,
      });
    }
  }

  private metres(): number {
    return Math.floor(this.distance / (10 * this.u));
  }

  private groundY(): number {
    const top = this.insets.top + statBarHeight(this.u);
    return top + (this.H - this.insets.bottom - top) * 0.62;
  }

  private tryJump(): void {
    if (this.y > 0 || this.isEnding) return;
    this.vy = JUMP_V * this.s;
    this.duckT = 0;
    this.addStat('jumps');
    this.audio.play('jump', { volume: 0.5 });
  }

  /** Card art jumps anything on the ground ahead and ducks the middle birds. */
  private autopilot(): void {
    const next = this.obstacles.find((o) => o.x + SIZES[o.kind].w * this.s > DINO_X * this.u);
    if (!next) return;
    const ahead = next.x - (DINO_X * this.u + DINO_W * this.s);
    if (next.kind === 'birdMid' && ahead < 120 * this.u) this.duckT = 0.1;
    else if (next.kind !== 'birdHigh' && ahead < 90 * this.u && ahead > 0) this.tryJump();
  }

  private physics(dt: number): void {
    if (this.y > 0 || this.vy > 0) {
      this.vy -= (this.diving ? DIVE_GRAVITY : GRAVITY) * this.s * dt;
      this.y += this.vy * dt;
      if (this.y <= 0) {
        this.y = 0;
        this.vy = 0;
      }
    }
    this.run += (dt * this.speed) / (40 * this.u);
  }

  private scroll(dt: number): void {
    const before = this.metres();
    this.distance += this.speed * dt;
    this.speed = Math.min(MAX_SPEED * this.u, this.speed + SPEED_GAIN * this.u * dt);
    for (const o of this.obstacles) o.x -= this.speed * dt;
    this.obstacles = this.obstacles.filter((o) => o.x + SIZES[o.kind].w * this.s > -20 * this.u);
    this.gap -= this.speed * dt;
    if (this.gap <= 0) this.spawn();
    const m = this.metres();
    if (m !== before) {
      this.score = m;
      this.maxStat('distance', m);
      if (m % COIN_EVERY === 0) {
        this.coins++;
        this.audio.play('coin', { volume: 0.5 });
      }
    }
  }

  /** Lays the next obstacle off the right edge, then a gap that grows with speed so every jump stays possible. */
  private spawn(): void {
    const birds = this.metres() >= BIRDS_FROM;
    const kinds: ObstacleKind[] = birds
      ? ['cactus', 'cacti', 'bigCactus', 'birdLow', 'birdMid', 'birdHigh']
      : ['cactus', 'cacti', 'bigCactus'];
    const kind = this.rng.pick(kinds);
    this.obstacles.push({ kind, x: this.W + 20 * this.u });
    // The air time of a jump times the speed is the shortest gap that can be cleared, plus room to land.
    const air = (2 * JUMP_V) / GRAVITY;
    this.gap = this.speed * air * this.rng.range(1.05, 2.1) + SIZES[kind].w * this.s + 80 * this.u;
  }

  private ducking(): boolean {
    return this.duckT > 0 && this.y === 0;
  }

  private hitTest(): void {
    if (this.invulnT > 0) return;
    const ground = this.groundY();
    const h = (this.ducking() ? DUCK_H : DINO_H) * this.s;
    const w = (this.ducking() ? DINO_W * 1.25 : DINO_W) * this.s;
    const dx = DINO_X * this.u;
    const dy = ground - this.y - h;
    for (const o of this.obstacles) {
      const s = SIZES[o.kind];
      const oy = ground - (s.lift + s.h) * this.s;
      if (overlap(dx, dy, w, h, o.x, oy, s.w * this.s, s.h * this.s, 7 * this.s)) {
        this.crash();
        return;
      }
    }
  }

  /** Hit something. The shield blinks through it once; otherwise the run ends. */
  private crash(): void {
    this.shake.add(0.4);
    this.services.haptic(120);
    if (this.shield) {
      this.shield = false;
      this.invulnT = INVULN_SEC;
      this.texts.add(
        DINO_X * this.u + 30 * this.u,
        this.groundY() - 110 * this.u,
        'SHIELD',
        '#0ea5e9',
        22 * this.u,
        1,
      );
      this.audio.play('powerup');
      return;
    }
    this.dead = true;
    this.audio.play('hit');
    this.endGame(1.2);
  }

  private drawBackdrop(ink: string, night: boolean): void {
    const ctx = this.ctx;
    if (night) {
      ctx.fillStyle = '#f8fafc';
      ctx.beginPath();
      ctx.arc(this.W * 0.78, this.groundY() * 0.35, 22 * this.u, 0, TAU);
      ctx.fill();
      for (let k = 0; k < 20; k++) {
        ctx.fillRect(
          ((k * 131) % 600) * this.u,
          ((k * 53) % 300) * this.u * 0.8 + 60 * this.u,
          2 * this.u,
          2 * this.u,
        );
      }
    }
    // Clouds drift at a fifth of the ground speed.
    ctx.strokeStyle = ink;
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = 2 * this.u;
    for (let k = 0; k < 4; k++) {
      const span = this.W + 120 * this.u;
      const x = ((((k * 190 * this.u - this.distance * 0.2) % span) + span) % span) - 60 * this.u;
      const y = this.groundY() - (160 + (k % 3) * 60) * this.u;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + 70 * this.u, y);
      ctx.arc(x + 50 * this.u, y, 18 * this.u, 0, Math.PI, true);
      ctx.arc(x + 22 * this.u, y, 14 * this.u, 0, Math.PI, true);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  /** A blocky dinosaur: body, head with an eye, a short arm, a tail and running legs. */
  private drawDino(ground: number, ink: string): void {
    const ctx = this.ctx;
    const u = this.s;
    const body = this.skinColor('dino', ink);
    const x = DINO_X * this.u;
    const feet = ground - this.y;
    ctx.fillStyle = body;
    if (this.ducking()) {
      ctx.fillRect(x, feet - 30 * u, 52 * u, 22 * u);
      ctx.fillRect(x + 44 * u, feet - 36 * u, 30 * u, 20 * u);
      ctx.fillStyle = this.skinColor('sky', '#f8fafc');
      ctx.fillRect(x + 54 * u, feet - 32 * u, 5 * u, 5 * u);
      ctx.fillStyle = body;
    } else {
      ctx.fillRect(x + 6 * u, feet - 44 * u, 34 * u, 30 * u);
      ctx.fillRect(x + 26 * u, feet - 62 * u, 30 * u, 22 * u);
      ctx.fillRect(x + 40 * u, feet - 44 * u, 14 * u, 5 * u);
      ctx.fillRect(x - 6 * u, feet - 40 * u, 14 * u, 10 * u);
      ctx.fillStyle = this.dead ? '#ef4444' : this.skinColor('sky', '#f8fafc');
      ctx.fillRect(x + 34 * u, feet - 57 * u, 5 * u, 5 * u);
      ctx.fillStyle = body;
      ctx.fillRect(x + 36 * u, feet - 34 * u, 8 * u, 4 * u);
    }
    // Legs alternate while running, together in the air.
    const step = this.y > 0 ? 0 : Math.floor(this.run * 2) % 2;
    ctx.fillRect(x + 12 * u, feet - 14 * u, 7 * u, step === 0 ? 14 * u : 9 * u);
    ctx.fillRect(x + 28 * u, feet - 14 * u, 7 * u, step === 1 ? 14 * u : 9 * u);
  }

  private drawObstacle(o: Obstacle, ground: number, ink: string): void {
    const ctx = this.ctx;
    const u = this.s;
    const s = SIZES[o.kind];
    const top = ground - (s.lift + s.h) * u;
    ctx.fillStyle = this.skinColor('cactus', '#15803d');
    if (o.kind.startsWith('bird')) {
      ctx.fillStyle = ink;
      const flap = Math.floor(this.time * 6) % 2 === 0;
      ctx.fillRect(o.x + 6 * u, top + 16 * u, 44 * u, 12 * u);
      ctx.fillRect(o.x - 4 * u, top + 12 * u, 16 * u, 8 * u);
      ctx.beginPath();
      ctx.moveTo(o.x + 18 * u, top + 18 * u);
      ctx.lineTo(o.x + 30 * u, flap ? top : top + 40 * u);
      ctx.lineTo(o.x + 40 * u, top + 18 * u);
      ctx.fill();
      return;
    }
    const stem = (x: number, w: number, h: number) => {
      ctx.fillRect(x, ground - h, w, h);
      ctx.fillRect(x - w * 0.55, ground - h * 0.62, w * 0.45, h * 0.2);
      ctx.fillRect(x - w * 0.55, ground - h * 0.85, w * 0.3, h * 0.3);
      ctx.fillRect(x + w * 1.1, ground - h * 0.5, w * 0.45, h * 0.18);
      ctx.fillRect(x + w * 1.25, ground - h * 0.75, w * 0.3, h * 0.3);
    };
    if (o.kind === 'cacti') {
      stem(o.x + 8 * u, 14 * u, 50 * u);
      stem(o.x + 44 * u, 16 * u, 56 * u);
    } else {
      const w = o.kind === 'bigCactus' ? 20 * u : 16 * u;
      stem(o.x + (s.w * u - w) / 2, w, s.h * u);
    }
  }
}
