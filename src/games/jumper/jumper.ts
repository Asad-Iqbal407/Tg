import { clamp, TAU } from '../../core/math';
import type { Rng } from '../../core/rng';
import { BaseGame } from '../base';
import { drawCoin, fillRoundRect, shade, text } from '../draw';
import { TouchDrag } from '../drag';
import { drawStatBar, statBarHeight } from '../statbar';
import type { GameServices } from '../types';

export type PadKind = 'normal' | 'moving' | 'breaking' | 'spring';

export interface Pad {
  kind: PadKind;
  x: number;
  /** World y of the pad's top; world y grows downward, so higher pads have smaller y. */
  y: number;
  vx: number;
  broken: boolean;
  /** Fall speed of a broken pad. */
  vy: number;
  coin: boolean;
}

const DESIGN_W = 600;
/** Design px, scaled by u. */
export const PAD_W = 96;
const PAD_H = 18;
const BODY_W = 46;
const BODY_H = 50;
const GRAVITY = 1500;
const BOUNCE = 820;
const SPRING = 1380;
const KEY_SPEED = 520;
const TOUCH_GAIN = 1.5;
/** Gap between pads on the climbing path: it widens from GAP_START to GAP_MAX as you climb. */
const GAP_MIN = 62;
const GAP_START = 105;
const GAP_MAX = 200;
/** Height (design px) over which the gap widens to its widest. */
const GAP_RAMP = 12000;
const SPRING_CHANCE = 0.07;
const MOVING_FROM = 1500;
const BREAKING_CHANCE = 0.3;
const COIN_CHANCE = 0.12;
/** Design px climbed per metre on the HUD. */
const PX_PER_M = 10;

/** Highest bounce a normal pad gives, in design px. */
export const REACH = (BOUNCE * BOUNCE) / (2 * GRAVITY);

/**
 * The next pad on the climbing path above a pad at `y`, `height` design px above the start. The gap never exceeds
 * what a bounce can reach. Breaking pads are never on the path, so the climb always has a solid pad within reach.
 */
export function nextPad(rng: Rng, y: number, height: number, width: number, u: number): Pad {
  const ramp = clamp(height / GAP_RAMP, 0, 1);
  const hi = Math.min(REACH * 0.85, GAP_START + (GAP_MAX - GAP_START) * ramp);
  const gap = rng.range(GAP_MIN, hi) * u;
  const roll = rng.next();
  const moving = height > MOVING_FROM && roll < 0.1 + 0.25 * ramp;
  const kind: PadKind = !moving && rng.chance(SPRING_CHANCE) ? 'spring' : moving ? 'moving' : 'normal';
  return {
    kind,
    x: rng.range(0, width - PAD_W * u),
    y: y - gap,
    vx: moving ? rng.range(70, 150) * u * (rng.chance(0.5) ? 1 : -1) : 0,
    broken: false,
    vy: 0,
    coin: rng.chance(COIN_CHANCE),
  };
}

/** Sky Jumper: bounce from pad to pad, steer left and right, and climb as high as you can. */
export class JumperGame extends BaseGame {
  private readonly u: number;
  private x: number;
  private y: number;
  private vx = 0;
  private vy: number;
  private facing = 1;
  private pads: Pad[] = [];
  /** World y of the highest path pad, where the next one is generated from. */
  private topY = 0;
  private startY: number;
  private best = 0;
  private camY: number;
  private readonly drag = new TouchDrag();
  private shield = false;
  /** Seconds since the last bounce, for the squash animation. */
  private bounceT = 1;

  constructor(services: GameServices) {
    super(services);
    this.u = this.W / DESIGN_W;
    this.shield = this.hasBoost('shield');
    for (const key of ['height', 'springs']) this.addStat(key, 0);
    const u = this.u;
    const ground = this.H - this.insets.bottom - 40 * u;
    // A floor of pads across the bottom, so the first bounce is free.
    for (let x = 0; x < this.W; x += PAD_W * u) {
      this.pads.push({ kind: 'normal', x, y: ground, vx: 0, broken: false, vy: 0, coin: false });
    }
    this.topY = ground;
    this.startY = ground;
    this.x = this.W / 2;
    this.y = ground - (BODY_H * u) / 2;
    this.vy = -(this.hasBoost('head-start') ? SPRING : BOUNCE) * u;
    this.camY = 0;
    this.fillPads();
  }

  protected tick(dt: number): void {
    const u = this.u;
    this.bounceT += dt;
    for (const p of this.pads) {
      if (p.kind === 'moving' && !p.broken) {
        p.x += p.vx * dt;
        if (p.x < 0 || p.x + PAD_W * u > this.W) {
          p.vx = -p.vx;
          p.x = clamp(p.x, 0, this.W - PAD_W * u);
        }
      }
      if (p.broken) {
        p.vy += GRAVITY * u * dt;
        p.y += p.vy * dt;
      }
    }
    if (this.isEnding) return;
    this.steer(dt);
    const prevFeet = this.y + (BODY_H * u) / 2;
    this.vy += GRAVITY * u * dt;
    this.y += this.vy * dt;
    this.x += this.vx * dt;
    // Off one side, on at the other.
    if (this.x < 0) this.x += this.W;
    if (this.x > this.W) this.x -= this.W;
    if (this.vy > 0) this.land(prevFeet);
    this.collectCoins();
    const climbed = (this.startY - this.y) / u;
    if (climbed > this.best) {
      this.best = climbed;
      this.score = Math.floor(this.best / PX_PER_M);
      this.maxStat('height', this.score);
    }
    // The camera only goes up: it keeps the jumper in the lower part of the screen.
    const target = this.y - this.H * 0.45;
    if (target < this.camY) this.camY = target;
    this.fillPads();
    this.pads = this.pads.filter((p) => p.y - this.camY < this.H + 100 * u);
    if (this.y - this.camY > this.H + BODY_H * u) this.fall();
  }

  render(): void {
    const ctx = this.ctx;
    const height = clamp(this.best / 30000, 0, 1);
    const g = ctx.createLinearGradient(0, 0, 0, this.H);
    g.addColorStop(0, this.skinColor('sky1', '#38bdf8'));
    g.addColorStop(1, this.skinColor('sky2', '#e0f2fe'));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.W, this.H);
    // The sky darkens toward space as you climb.
    ctx.fillStyle = `rgba(15,23,42,${height * 0.85})`;
    ctx.fillRect(0, 0, this.W, this.H);
    this.drawBackdrop();
    ctx.save();
    ctx.translate(this.shake.x, this.shake.y - this.camY);
    for (const p of this.pads) this.drawPad(p);
    this.drawJumper();
    this.particles.render(ctx);
    this.texts.render(ctx);
    ctx.restore();
    if (this.services.preview) return;
    drawStatBar(ctx, this.W, this.insets.top, this.u, [
      ['HEIGHT', `${this.score} m`],
      ['COINS', String(this.coins)],
      ['SPRINGS', String(this.stats['springs'] ?? 0)],
    ]);
    if (this.time < 2.5) {
      text(ctx, 'DRAG TO STEER', this.W / 2, this.insets.top + statBarHeight(this.u) + 50 * this.u, {
        size: Math.round(26 * this.u),
        align: 'center',
      });
    }
  }

  /**
   * The arrow keys steer at KEY_SPEED. On touch screens a drag anywhere moves the jumper with the finger (TOUCH_GAIN
   * times as far); a mouse drag pulls it toward the pointer. Card art steers toward the next pad up.
   */
  private steer(dt: number): void {
    const u = this.u;
    const axis = this.input.axisX();
    const p = this.input.pointer;
    const touch = p.touch ? this.drag.update(p.down, p.pressed, p.x, this.x, TOUCH_GAIN, this.W * 0.3) : null;
    if (!p.touch) this.drag.update(false, false, 0, 0, 0, 0);
    this.vx = 0;
    if (axis !== 0) {
      this.vx = axis * KEY_SPEED * u;
    } else if (touch !== null) {
      // Steered by the finger directly: the step's movement becomes velocity for this step.
      if (dt > 0) this.vx = (touch - this.x) / dt;
    } else if (p.down) {
      this.vx = clamp((p.x - this.x) * 6, -KEY_SPEED * u, KEY_SPEED * u);
    } else if (this.services.preview) {
      const next = this.pads.filter((q) => q.y < this.y && !q.broken).sort((a, b) => b.y - a.y)[0];
      if (next) this.vx = clamp((next.x + (PAD_W * u) / 2 - this.x) * 4, -KEY_SPEED * u, KEY_SPEED * u);
    }
    if (this.vx > 1) this.facing = 1;
    else if (this.vx < -1) this.facing = -1;
  }

  /** Falling onto a pad from above bounces; a breaking pad crumbles instead; a spring launches high. */
  private land(prevFeet: number): void {
    const u = this.u;
    const feet = this.y + (BODY_H * u) / 2;
    const half = (BODY_W * u) / 2;
    for (const p of this.pads) {
      if (p.broken || prevFeet > p.y || feet < p.y) continue;
      if (this.x + half * 0.8 < p.x || this.x - half * 0.8 > p.x + PAD_W * u) continue;
      if (p.kind === 'breaking') {
        p.broken = true;
        this.audio.play('bump', { volume: 0.5 });
        this.particles.emit({
          x: p.x + (PAD_W * u) / 2,
          y: p.y,
          count: 10,
          speed: 120 * u,
          life: 0.5,
          size: 4,
          colors: ['#a16207', '#78350f'],
        });
        continue;
      }
      this.y = p.y - (BODY_H * u) / 2;
      this.bounceT = 0;
      if (p.kind === 'spring') {
        this.vy = -SPRING * u;
        this.addStat('springs');
        this.audio.play('powerup');
        this.texts.add(this.x, this.y - 40 * u, 'BOING!', '#fde047', 22 * u, 0.8);
      } else {
        this.vy = -BOUNCE * u;
        this.audio.play('jump', { volume: 0.45 });
      }
      return;
    }
  }

  private collectCoins(): void {
    const u = this.u;
    for (const p of this.pads) {
      if (!p.coin) continue;
      const cx = p.x + (PAD_W * u) / 2;
      const cy = p.y - 46 * u;
      if (Math.hypot(cx - this.x, cy - this.y) < 40 * u) {
        p.coin = false;
        this.coins++;
        this.audio.play('coin');
        this.particles.emit({
          x: cx,
          y: cy,
          count: 10,
          speed: 120 * u,
          life: 0.4,
          size: 3,
          colors: ['#fde047', '#ffffff'],
        });
      }
    }
  }

  /** Lays pads up to a screen above the camera: the climbing path, plus breaking decoys beside it. */
  private fillPads(): void {
    const u = this.u;
    while (this.topY > this.camY - this.H) {
      const height = (this.startY - this.topY) / u;
      const pad = nextPad(this.rng, this.topY, height, this.W, u);
      if (height > 400 && this.rng.chance(BREAKING_CHANCE)) {
        const y = this.topY + (pad.y - this.topY) * this.rng.range(0.35, 0.65);
        this.pads.push({
          kind: 'breaking',
          x: this.rng.range(0, this.W - PAD_W * u),
          y,
          vx: 0,
          broken: false,
          vy: 0,
          coin: false,
        });
      }
      this.pads.push(pad);
      this.topY = pad.y;
    }
  }

  /** Fell off the bottom. The shield launches the jumper back up once; otherwise the run ends. */
  private fall(): void {
    if (this.shield) {
      this.shield = false;
      this.y = this.camY + this.H - BODY_H * this.u;
      this.vy = -SPRING * this.u;
      this.texts.add(this.x, this.y - 60 * this.u, 'SHIELD!', '#67e8f9', 24 * this.u, 1.1);
      this.audio.play('powerup');
      return;
    }
    this.audio.play('gameover');
    this.endGame(0.6, false);
  }

  private drawBackdrop(): void {
    const ctx = this.ctx;
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    // Clouds drift past at a third of the climb speed.
    for (let i = 0; i < 6; i++) {
      const span = this.H + 200;
      const y = ((((i * 173 - this.camY * 0.3) % span) + span) % span) - 100;
      const x = ((i * 211) % (this.W + 100)) - 50;
      for (const [dx, dy, r] of [
        [0, 0, 26],
        [30, -10, 32],
        [62, 0, 24],
      ] as const) {
        ctx.beginPath();
        ctx.arc(x + dx * this.u, y + dy * this.u, r * this.u, 0, TAU);
        ctx.fill();
      }
    }
  }

  private drawPad(p: Pad): void {
    const ctx = this.ctx;
    const u = this.u;
    const w = PAD_W * u;
    const h = PAD_H * u;
    const colour =
      p.kind === 'moving'
        ? this.skinColor('moving', '#3b82f6')
        : p.kind === 'breaking'
          ? '#a16207'
          : this.skinColor('pad', '#22c55e');
    if (p.kind === 'breaking' && p.broken) {
      // Two halves tipping apart as they fall.
      ctx.fillStyle = colour;
      ctx.save();
      ctx.translate(p.x + w * 0.25, p.y + h / 2);
      ctx.rotate(-0.4);
      ctx.fillRect(-w * 0.25, -h / 2, w * 0.48, h);
      ctx.restore();
      ctx.save();
      ctx.translate(p.x + w * 0.75, p.y + h / 2);
      ctx.rotate(0.4);
      ctx.fillRect(-w * 0.23, -h / 2, w * 0.48, h);
      ctx.restore();
      return;
    }
    fillRoundRect(ctx, p.x, p.y, w, h, h / 2, colour);
    ctx.fillStyle = shade(colour, 0.35);
    ctx.fillRect(p.x + h / 2, p.y + 2 * u, w - h, 4 * u);
    if (p.kind === 'breaking') {
      ctx.strokeStyle = '#451a03';
      ctx.lineWidth = 2 * u;
      ctx.beginPath();
      ctx.moveTo(p.x + w * 0.5, p.y);
      ctx.lineTo(p.x + w * 0.45, p.y + h * 0.5);
      ctx.lineTo(p.x + w * 0.55, p.y + h);
      ctx.stroke();
    }
    if (p.kind === 'spring') {
      const sx = p.x + w * 0.6;
      ctx.strokeStyle = '#94a3b8';
      ctx.lineWidth = 3 * u;
      ctx.beginPath();
      for (let k = 0; k <= 4; k++) {
        const yy = p.y - k * 5 * u;
        ctx.lineTo(sx + (k % 2 === 0 ? -8 : 8) * u, yy);
      }
      ctx.stroke();
      fillRoundRect(ctx, sx - 12 * u, p.y - 26 * u, 24 * u, 6 * u, 3 * u, '#e2e8f0');
    }
    if (p.coin) drawCoin(ctx, p.x + w / 2, p.y - 46 * u, 13 * u, Math.cos(this.time * 4 + p.y));
  }

  private drawJumper(): void {
    const ctx = this.ctx;
    const u = this.u;
    const w = BODY_W * u;
    const h = BODY_H * u;
    // A short squash right after a bounce.
    const squash = this.bounceT < 0.12 ? 1 - Math.sin((this.bounceT / 0.12) * Math.PI) * 0.18 : 1;
    const body = this.skinColor('body', '#facc15');
    ctx.save();
    ctx.translate(this.x, this.y + h / 2);
    ctx.scale(this.facing / squash, squash);
    // Feet
    ctx.fillStyle = shade(body, -0.4);
    ctx.fillRect(-w * 0.3, -h * 0.12, w * 0.18, h * 0.12);
    ctx.fillRect(w * 0.1, -h * 0.12, w * 0.18, h * 0.12);
    // Body
    fillRoundRect(ctx, -w / 2, -h, w, h * 0.9, w * 0.42, body);
    ctx.fillStyle = shade(body, 0.35);
    ctx.beginPath();
    ctx.ellipse(-w * 0.15, -h * 0.75, w * 0.18, h * 0.1, -0.5, 0, TAU);
    ctx.fill();
    // Snout and eyes, facing the way it moves.
    fillRoundRect(ctx, w * 0.2, -h * 0.62, w * 0.42, h * 0.2, h * 0.1, shade(body, -0.15));
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(w * 0.12, -h * 0.72, w * 0.13, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#111827';
    ctx.beginPath();
    ctx.arc(w * 0.16, -h * 0.72, w * 0.06, 0, TAU);
    ctx.fill();
    ctx.restore();
    if (this.shield) {
      ctx.strokeStyle = 'rgba(103,232,249,0.6)';
      ctx.lineWidth = 3 * u;
      ctx.beginPath();
      ctx.arc(this.x, this.y, h * 0.75, 0, TAU);
      ctx.stroke();
    }
  }
}
