import { TAU, wrapAngle } from '../../core/math';
import { BaseGame } from '../base';
import { PressBuffer } from '../drag';
import { banner, fillRoundRect, shade, text } from '../draw';
import { drawStatBar, statBarHeight } from '../statbar';
import type { GameServices } from '../types';

/** A tap this soon before the next knife is ready still throws it. */
const THROW_BUFFER_SEC = 0.15;
const DESIGN_W = 600;
const LOG_R = 128;
/** Two knives closer than this (radians round the log) collide. */
export const KNIFE_GAP = 0.17;
/** An apple is hit when a knife lands this close to it. */
const APPLE_GAP = 0.2;
const THROW_SPEED = 2600;
const BLADE = 64;
const HANDLE = 46;
const KNIFE_POINTS = 10;
const APPLE_POINTS = 50;
const STAGE_POINTS = 100;
const BOSS_EVERY = 5;
const CLEAR_SEC = 1.3;
const HEAD_START_STAGE = 3;

/** Knives to throw on stage n: more on later stages, and the most on a boss stage. */
export function knivesFor(stage: number): number {
  return Math.min(10, 5 + Math.floor(stage / 2)) + (stage % BOSS_EVERY === 0 ? 2 : 0);
}

/** Base spin of stage n in radians per second. */
export function spinFor(stage: number): number {
  return Math.min(3.4, 1.4 + 0.16 * stage) * (stage % BOSS_EVERY === 0 ? 1.2 : 1);
}

/** True when a knife landing at log angle `a` would strike a knife already stuck in the log. */
export function hitsKnife(stuck: readonly number[], a: number): boolean {
  return stuck.some((k) => Math.abs(wrapAngle(k - a)) < KNIFE_GAP);
}

interface Flying {
  y: number;
}

interface Bounced {
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  spin: number;
}

/** Knife Hit: throw every knife into the spinning log without hitting a knife already in it. */
export class KnifeGame extends BaseGame {
  private readonly u: number;
  private stage = 1;
  /** Log rotation (radians) and current spin speed. */
  private rot = 0;
  private spin = 0;
  /** Seconds into the stage, for the spin pattern. */
  private stageT = 0;
  /** Knives stuck in the log, by angle in the log's own frame. */
  private stuck: number[] = [];
  private apples: number[] = [];
  private left = 0;
  private flying: Flying | null = null;
  private readonly throwBuf = new PressBuffer(THROW_BUFFER_SEC);
  private bounced: Bounced[] = [];
  private clearT = 0;
  private bannerT = 1.3;
  /** Sideways shudder of the log after a hit. */
  private thud = 0;
  private shield = false;
  private previewT = 0;

  constructor(services: GameServices) {
    super(services);
    this.u = this.W / DESIGN_W;
    this.shield = this.hasBoost('shield');
    for (const key of ['knives', 'stages', 'apples']) this.addStat(key, 0);
    if (this.hasBoost('head-start')) {
      for (let s = 1; s < HEAD_START_STAGE; s++) this.score += STAGE_POINTS * s;
      this.startStage(HEAD_START_STAGE);
    } else this.startStage(1);
  }

  protected tick(dt: number): void {
    this.stageT += dt;
    this.bannerT = Math.max(0, this.bannerT - dt);
    this.thud = Math.max(0, this.thud - dt * 6);
    this.spin = this.spinAt(this.stageT);
    this.rot = wrapAngle(this.rot + this.spin * dt);
    for (const b of this.bounced) {
      b.vy += 2400 * this.u * dt;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.angle += b.spin * dt;
    }
    this.bounced = this.bounced.filter((b) => b.y < this.H + 200 * this.u);
    if (this.isEnding) return;
    if (this.clearT > 0) {
      this.throwBuf.clear();
      this.clearT -= dt;
      if (this.clearT <= 0) this.startStage(this.stage + 1);
      return;
    }
    // A tap while the last knife is still in the air is kept for a moment and throws the next one.
    if (!this.services.preview && this.pressedThrow()) this.throwBuf.press();
    this.throwBuf.tick(dt);
    if (this.flying) this.fly(dt);
    else if (this.wantsThrow(dt) && this.left > 0) this.flying = { y: this.restY() };
  }

  render(): void {
    const ctx = this.ctx;
    const g = ctx.createRadialGradient(this.W / 2, this.logY(), 40 * this.u, this.W / 2, this.logY(), this.H);
    g.addColorStop(0, this.skinColor('bg1', '#334155'));
    g.addColorStop(1, this.skinColor('bg2', '#0f172a'));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.W, this.H);
    ctx.save();
    ctx.translate(this.shake.x, this.shake.y);
    if (this.clearT <= 0 || this.clearT > CLEAR_SEC - 0.05) this.drawLog();
    if (this.flying) this.drawKnife(this.W / 2, this.flying.y, -Math.PI / 2);
    else if (this.left > 0 && this.clearT <= 0 && !this.isEnding)
      this.drawKnife(this.W / 2, this.restY(), -Math.PI / 2);
    for (const b of this.bounced) this.drawKnife(b.x, b.y, b.angle);
    this.particles.render(ctx);
    this.texts.render(ctx);
    ctx.restore();
    if (this.services.preview) return;
    drawStatBar(ctx, this.W, this.insets.top, this.u, [
      ['SCORE', Math.floor(this.score).toLocaleString('en-US')],
      ['STAGE', this.isBoss() ? `${this.stage} BOSS` : String(this.stage)],
      ['APPLES', String(this.stats['apples'] ?? 0)],
    ]);
    this.drawKnivesLeft();
    if (this.clearT > 0) {
      banner(
        ctx,
        this.W,
        this.H,
        'STAGE CLEAR',
        `Stage ${this.stage + 1} next`,
        1 - this.clearT / CLEAR_SEC,
        '#86efac',
      );
    } else if (this.bannerT > 0) {
      banner(
        ctx,
        this.W,
        this.H,
        this.isBoss() ? 'BOSS LOG' : `STAGE ${this.stage}`,
        'Tap to throw',
        1 - this.bannerT / 1.3,
        this.isBoss() ? '#fca5a5' : '#ffffff',
      );
    }
  }

  private isBoss(): boolean {
    return this.stage % BOSS_EVERY === 0;
  }

  private logY(): number {
    const top = this.insets.top + statBarHeight(this.u);
    return top + (this.H - this.insets.bottom - top) * 0.32;
  }

  private restY(): number {
    return this.H - this.insets.bottom - 110 * this.u;
  }

  /**
   * Spin speed at `t` seconds into the stage. Stages cycle three patterns: a steady spin, a spin that surges and
   * slows, and a spin that stops and reverses. Boss logs always reverse.
   */
  private spinAt(t: number): number {
    const base = spinFor(this.stage);
    const pattern = this.isBoss() ? 2 : (this.stage - 1) % 3;
    if (pattern === 0) return base;
    if (pattern === 1) return base * (0.35 + 0.95 * Math.abs(Math.sin(t * 1.1)));
    // Reverses every 2.2 s, easing through zero.
    return base * 1.1 * Math.cos((t * Math.PI) / 2.2);
  }

  private startStage(stage: number): void {
    this.stage = stage;
    this.stageT = 0;
    this.left = knivesFor(stage);
    this.flying = null;
    this.bannerT = 1.3;
    this.stuck = [];
    this.apples = [];
    // Some knives are already in the log, spread out so they never block each other.
    const pre = stage === 1 ? 0 : this.rng.int(1, Math.min(4, 1 + Math.floor(stage / 2)));
    for (let i = 0; i < pre; i++) this.placeFree(this.stuck, KNIFE_GAP * 2.2);
    const apples = this.rng.int(stage === 1 ? 1 : 0, 2);
    for (let i = 0; i < apples; i++) this.placeFree(this.apples, APPLE_GAP * 2);
  }

  /** Adds an angle to `list` at least `gap` from every knife and apple already placed (it gives up after a few tries). */
  private placeFree(list: number[], gap: number): void {
    for (let tries = 0; tries < 20; tries++) {
      const a = this.rng.range(-Math.PI, Math.PI);
      if ([...this.stuck, ...this.apples].every((k) => Math.abs(wrapAngle(k - a)) >= gap)) {
        list.push(a);
        return;
      }
    }
  }

  private wantsThrow(dt: number): boolean {
    if (this.services.preview) {
      this.previewT += dt;
      if (this.previewT < 0.45) return false;
      this.previewT = 0;
      return !hitsKnife(this.stuck, this.impactAngle());
    }
    return this.throwBuf.take() !== null;
  }

  private pressedThrow(): boolean {
    return this.input.wasPressed('primary') || this.input.wasPressed('up') || this.input.pointer.pressed;
  }

  /** The log angle (in its own frame) that a knife arriving now strikes: the bottom of the log. */
  private impactAngle(): number {
    return wrapAngle(Math.PI / 2 - this.rot);
  }

  private fly(dt: number): void {
    const f = this.flying;
    if (!f) return;
    f.y -= THROW_SPEED * this.u * dt;
    const surface = this.logY() + LOG_R * this.u;
    // The knife sticks when its tip is buried, with the guard just outside the log as the stuck knives are drawn.
    if (f.y > surface + BLADE * 0.35 * this.u) return;
    this.flying = null;
    const a = this.impactAngle();
    if (hitsKnife(this.stuck, a)) {
      this.clang(surface);
      return;
    }
    this.stuck.push(a);
    this.left--;
    this.score += KNIFE_POINTS;
    this.addStat('knives');
    this.thud = 1;
    this.audio.play('hit', { volume: 0.7 });
    this.services.haptic(12);
    this.particles.emit({
      x: this.W / 2,
      y: surface,
      count: 8,
      speed: 140 * this.u,
      life: 0.35,
      size: 3,
      colors: [this.skinColor('wood', '#b45309'), '#fde68a'],
    });
    const apple = this.apples.findIndex((p) => Math.abs(wrapAngle(p - a)) < APPLE_GAP);
    if (apple >= 0) {
      this.apples.splice(apple, 1);
      this.score += APPLE_POINTS;
      this.coins++;
      this.addStat('apples');
      this.audio.play('coin');
      this.texts.add(this.W / 2, surface + 30 * this.u, `+${APPLE_POINTS}`, '#fde047', 24 * this.u, 0.9);
      this.particles.emit({
        x: this.W / 2,
        y: surface + 10 * this.u,
        count: 16,
        speed: 200 * this.u,
        life: 0.5,
        size: 4,
        colors: ['#ef4444', '#fecaca', '#ffffff'],
      });
    }
    if (this.left === 0) this.clearStage();
  }

  /** The knife struck another knife and bounces away. The shield gives it back once; otherwise the run ends. */
  private clang(y: number): void {
    this.bounced.push({
      x: this.W / 2,
      y,
      vx: (this.rng.chance(0.5) ? -1 : 1) * 260 * this.u,
      vy: 300 * this.u,
      angle: -Math.PI / 2,
      spin: 14,
    });
    this.particles.emit({
      x: this.W / 2,
      y,
      count: 14,
      speed: 220 * this.u,
      life: 0.3,
      size: 2.5,
      colors: ['#ffffff', '#fde047'],
    });
    this.shake.add(0.4);
    this.audio.play('bump');
    this.services.haptic(90);
    if (this.shield) {
      this.shield = false;
      this.texts.add(this.W / 2, y + 60 * this.u, 'SHIELD', '#67e8f9', 26 * this.u, 1.1);
      this.audio.play('powerup');
      return;
    }
    this.endGame(1.4);
  }

  private clearStage(): void {
    const bonus = STAGE_POINTS * this.stage;
    this.score += bonus;
    this.coins += this.isBoss() ? 3 : 1;
    this.addStat('stages');
    this.clearT = CLEAR_SEC;
    this.audio.play('levelup');
    // The log bursts into chips; its knives fall away.
    const y = this.logY();
    this.particles.emit({
      x: this.W / 2,
      y,
      count: 40,
      speed: 320 * this.u,
      life: 0.9,
      size: 6,
      gravity: 900 * this.u,
      colors: [this.skinColor('wood', '#b45309'), shade(this.skinColor('wood', '#b45309'), -0.3), '#fde68a'],
    });
    for (const k of this.stuck) {
      const s = k + this.rot;
      const r = (LOG_R + BLADE * 0.5) * this.u;
      this.bounced.push({
        x: this.W / 2 + Math.cos(s) * r,
        y: y + Math.sin(s) * r,
        vx: Math.cos(s) * 300 * this.u,
        vy: Math.sin(s) * 300 * this.u - 300 * this.u,
        angle: s + Math.PI,
        spin: this.rng.range(-8, 8),
      });
    }
    this.stuck = [];
    this.apples = [];
  }

  private drawLog(): void {
    const ctx = this.ctx;
    const cx = this.W / 2 + Math.sin(this.thud * 20) * this.thud * 4 * this.u;
    const cy = this.logY() - this.thud * 6 * this.u;
    const r = LOG_R * this.u;
    // Knives behind the log first: their blades disappear into it.
    for (const k of this.stuck) {
      const s = k + this.rot;
      const d = r + BLADE * 0.35 * this.u;
      this.drawKnife(cx + Math.cos(s) * d, cy + Math.sin(s) * d, s + Math.PI);
    }
    const wood = this.isBoss() ? this.skinColor('boss', '#7f1d1d') : this.skinColor('wood', '#b45309');
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(this.rot);
    ctx.fillStyle = shade(wood, -0.35);
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, TAU);
    ctx.fill();
    ctx.fillStyle = wood;
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.9, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = shade(wood, -0.2);
    ctx.lineWidth = 3 * this.u;
    for (const k of [0.68, 0.46, 0.24]) {
      ctx.beginPath();
      ctx.arc(r * 0.04, -r * 0.03, r * k, 0, TAU);
      ctx.stroke();
    }
    // A knot and a crack, so the spin reads.
    ctx.fillStyle = shade(wood, -0.3);
    ctx.beginPath();
    ctx.ellipse(r * 0.45, r * 0.2, r * 0.09, r * 0.06, 0.6, 0, TAU);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-r * 0.86, -r * 0.1);
    ctx.lineTo(-r * 0.6, -r * 0.05);
    ctx.lineTo(-r * 0.45, -r * 0.14);
    ctx.stroke();
    if (this.isBoss()) {
      ctx.fillStyle = '#fef2f2';
      ctx.beginPath();
      ctx.arc(-r * 0.3, -r * 0.2, r * 0.12, 0, TAU);
      ctx.arc(r * 0.3, -r * 0.2, r * 0.12, 0, TAU);
      ctx.fill();
      ctx.fillStyle = '#111827';
      ctx.fillRect(-r * 0.35, r * 0.25, r * 0.7, r * 0.08);
    }
    ctx.restore();
    for (const p of this.apples) {
      const s = p + this.rot;
      const d = r + 18 * this.u;
      this.drawApple(cx + Math.cos(s) * d, cy + Math.sin(s) * d, 16 * this.u);
    }
  }

  private drawApple(x: number, y: number, r: number): void {
    const ctx = this.ctx;
    ctx.fillStyle = '#ef4444';
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.beginPath();
    ctx.arc(x - r * 0.35, y - r * 0.35, r * 0.3, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#16a34a';
    ctx.beginPath();
    ctx.ellipse(x + r * 0.3, y - r * 1.05, r * 0.4, r * 0.18, -0.5, 0, TAU);
    ctx.fill();
  }

  /** A knife centred at (x, y), its tip pointing along `angle`. */
  private drawKnife(x: number, y: number, angle: number): void {
    const ctx = this.ctx;
    const u = this.u;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle + Math.PI / 2);
    // Pointing "up" in this frame: the blade above the centre, the handle below.
    ctx.fillStyle = this.skinColor('blade', '#e2e8f0');
    ctx.beginPath();
    ctx.moveTo(0, -BLADE * u);
    ctx.lineTo(9 * u, -BLADE * 0.55 * u);
    ctx.lineTo(9 * u, 0);
    ctx.lineTo(-9 * u, 0);
    ctx.lineTo(-9 * u, -BLADE * 0.4 * u);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.fillRect(-7 * u, -BLADE * 0.38 * u, 3 * u, BLADE * 0.36 * u);
    ctx.fillStyle = '#64748b';
    ctx.fillRect(-12 * u, 0, 24 * u, 6 * u);
    fillRoundRect(ctx, -7 * u, 6 * u, 14 * u, HANDLE * u, 5 * u, this.skinColor('handle', '#7c2d12'));
    ctx.restore();
  }

  private drawKnivesLeft(): void {
    const ctx = this.ctx;
    const u = this.u;
    const x = 28 * u;
    const base = this.H - this.insets.bottom - 40 * u;
    const total = knivesFor(this.stage);
    for (let i = 0; i < total; i++) {
      const y = base - i * 26 * u;
      ctx.fillStyle = i < this.left ? '#e2e8f0' : 'rgba(255,255,255,0.18)';
      ctx.fillRect(x - 3 * u, y - 16 * u, 6 * u, 18 * u);
      ctx.fillRect(x - 7 * u, y, 14 * u, 3 * u);
    }
    text(ctx, `×${this.left}`, x + 20 * u, base, { size: Math.round(16 * u), color: '#e2e8f0' });
  }
}
