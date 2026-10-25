import { clamp, TAU } from '../../core/math';
import { BaseGame } from '../base';
import { banner, fillRoundRect, shade, text } from '../draw';
import { drawStatBar, statBarHeight } from '../statbar';
import type { GameServices } from '../types';
import { bounceAxis, type Brick, buildLevel, circleHitsRect, COLS, isCleared } from './levels';

type DropKind = 'wide' | 'multi' | 'slow' | 'life' | 'coin';

interface Ball {
  x: number;
  y: number;
  /** Unit direction; the speed comes from the level and the slow power-up. */
  dx: number;
  dy: number;
}

interface Drop {
  x: number;
  y: number;
  kind: DropKind;
}

/** Playfield geometry for one frame, in logical px. It follows the live insets. */
interface Field {
  left: number;
  right: number;
  top: number;
  brickTop: number;
  brickW: number;
  brickH: number;
  gap: number;
  paddleY: number;
  /** Line below the paddle that a ball must cross to be lost. */
  floor: number;
}

const DESIGN_W = 600;
const START_LIVES = 3;
const MAX_LIVES = 5;
const BALL_R = 10;
const PADDLE_W = 120;
const WIDE_W = 184;
const PADDLE_H = 18;
/** Ball speed in design px/s on level 1. Each level adds LEVEL_SPEEDUP of it, up to MAX_SPEEDUP. */
const BALL_SPEED = 470;
const LEVEL_SPEEDUP = 0.05;
const MAX_SPEEDUP = 1.45;
const SLOW_FACTOR = 0.68;
const KEY_SPEED = 760;
const POINTER_SPEED = 2400;
/** The paddle's edge sends the ball off at this angle from straight up. */
const MAX_ANGLE = (Math.PI / 180) * 62;
/** Smallest vertical share of the ball's direction, so it never skims sideways for long. */
const MIN_DY = 0.28;
const LAUNCH_SPREAD = 0.45;
/** A ball left waiting on the paddle launches by itself after this long. */
const AUTO_LAUNCH_SEC = 3;
const DROP_SPEED = 190;
const DROP_CHANCE = 0.16;
const WIDE_SEC = 12;
const SLOW_SEC = 9;
const MAX_BALLS = 6;
const LEVEL_SEC = 1.8;
const SUBSTEP = 1 / 240;
const HIT_SCORE = 10;
const BRICK_SCORE = 50;
const COMBO_BONUS = 10;
const MAX_COMBO_BONUS = 12;
const LEVEL_BONUS = 500;
const COIN_SCORE = 25;

const DROP_WEIGHTS: readonly { value: DropKind; weight: number }[] = [
  { value: 'wide', weight: 3 },
  { value: 'multi', weight: 3 },
  { value: 'slow', weight: 2 },
  { value: 'coin', weight: 4 },
  { value: 'life', weight: 0.6 },
];

const DROP_LABEL: Readonly<Record<DropKind, string>> = {
  wide: 'W',
  multi: 'M',
  slow: 'S',
  life: '+',
  coin: '$',
};

/** Brick Breaker: bounce the ball off the paddle into rows of bricks. */
export class BreakoutGame extends BaseGame {
  private readonly u: number;
  private bricks: Brick[] = [];
  private balls: Ball[] = [];
  private drops: Drop[] = [];
  private paddleX: number;
  private level = 1;
  private lives = START_LIVES;
  /** True while the ball waits on the paddle for a launch. */
  private stuck = true;
  private stuckT = 0;
  private wideT = 0;
  private slowT = 0;
  private shield = false;
  /** Bricks broken since the ball last touched the paddle. */
  private combo = 0;
  /** Seconds left of the LEVEL banner between levels; 0 while playing. */
  private levelT = 0;

  constructor(services: GameServices) {
    super(services);
    this.u = this.W / DESIGN_W;
    this.paddleX = this.W / 2;
    this.shield = this.hasBoost('shield');
    if (this.hasBoost('head-start')) {
      this.lives = START_LIVES + 1;
      this.wideT = this.powerTime(WIDE_SEC);
    }
    for (const key of ['bricks', 'levels', 'powerups', 'combo']) this.addStat(key, 0);
    this.startLevel();
  }

  protected tick(dt: number): void {
    if (this.isEnding) return;
    if (this.levelT > 0) {
      this.levelT -= dt;
      if (this.levelT <= 0) {
        this.level++;
        this.startLevel();
      }
      return;
    }
    const f = this.field();
    this.wideT = Math.max(0, this.wideT - dt);
    this.slowT = Math.max(0, this.slowT - dt);
    this.movePaddle(dt, f);
    if (this.stuck) {
      this.stuckT += dt;
      this.holdBall(f);
      const tapped = this.input.pointer.released && this.input.pointer.inside;
      const pressed = this.input.wasPressed('primary') || this.input.wasPressed('up') || tapped;
      if (pressed || this.stuckT >= AUTO_LAUNCH_SEC || this.services.preview) this.launch();
    } else {
      let left = dt;
      while (left > 0 && !this.stuck && this.levelT <= 0 && !this.isEnding) {
        const h = Math.min(left, SUBSTEP);
        this.stepBalls(h, f);
        left -= h;
      }
    }
    this.stepDrops(dt, f);
  }

  render(): void {
    const ctx = this.ctx;
    const f = this.field();
    const g = ctx.createLinearGradient(0, 0, 0, this.H);
    g.addColorStop(0, this.skinColor('bg1', '#1e1b4b'));
    g.addColorStop(1, this.skinColor('bg2', '#020617'));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.W, this.H);
    ctx.save();
    ctx.translate(this.shake.x, this.shake.y);
    this.drawWalls(f);
    for (const b of this.bricks) this.drawBrick(b, f);
    for (const d of this.drops) this.drawDrop(d);
    if (this.shield) {
      ctx.fillStyle = 'rgba(103,232,249,0.7)';
      ctx.fillRect(f.left, f.floor - 3 * this.u, f.right - f.left, 3 * this.u);
    }
    this.drawPaddle(f);
    for (const b of this.balls) this.drawBall(b);
    this.particles.render(ctx);
    this.texts.render(ctx);
    ctx.restore();
    if (this.services.preview) return;
    drawStatBar(ctx, this.W, this.insets.top, this.u, [
      ['SCORE', Math.floor(this.score).toLocaleString('en-US')],
      ['LEVEL', String(this.level)],
      ['LIVES', String(this.lives)],
    ]);
    if (this.levelT > 0) {
      banner(ctx, this.W, this.H, `LEVEL ${this.level + 1}`, 'Bricks cleared!', 1 - this.levelT / LEVEL_SEC);
    } else if (this.stuck && this.stuckT < AUTO_LAUNCH_SEC) {
      text(ctx, 'TAP TO LAUNCH', this.W / 2, f.paddleY - 90 * this.u, {
        size: Math.round(22 * this.u),
        align: 'center',
        color: 'rgba(255,255,255,0.85)',
      });
    }
  }

  private field(): Field {
    const u = this.u;
    const top = this.insets.top + statBarHeight(u);
    const left = 12 * u;
    const right = this.W - 12 * u;
    const gap = 4 * u;
    const brickW = (right - left - gap * (COLS - 1)) / COLS;
    const paddleY = this.H - this.insets.bottom - 64 * u;
    return {
      left,
      right,
      top,
      brickTop: top + 56 * u,
      brickW,
      brickH: 32 * u,
      gap,
      paddleY,
      floor: paddleY + 40 * u,
    };
  }

  private brickRect(b: Brick, f: Field): [number, number, number, number] {
    return [f.left + b.col * (f.brickW + f.gap), f.brickTop + b.row * (f.brickH + f.gap), f.brickW, f.brickH];
  }

  private paddleHalf(): number {
    return ((this.wideT > 0 ? WIDE_W : PADDLE_W) * this.u) / 2;
  }

  private speed(): number {
    const level = Math.min(MAX_SPEEDUP, 1 + LEVEL_SPEEDUP * (this.level - 1));
    return BALL_SPEED * this.u * level * (this.slowT > 0 ? SLOW_FACTOR : 1);
  }

  private startLevel(): void {
    this.bricks = buildLevel(this.level);
    this.drops = [];
    this.resetBall();
  }

  private resetBall(): void {
    this.balls = [{ x: this.paddleX, y: 0, dx: 0, dy: -1 }];
    this.stuck = true;
    this.stuckT = 0;
    this.combo = 0;
    this.holdBall(this.field());
  }

  private holdBall(f: Field): void {
    const b = this.balls[0];
    if (!b) return;
    b.x = this.paddleX;
    b.y = f.paddleY - BALL_R * this.u - 1;
  }

  private launch(): void {
    const b = this.balls[0];
    if (!b) return;
    const angle = this.rng.range(-LAUNCH_SPREAD, LAUNCH_SPREAD);
    b.dx = Math.sin(angle);
    b.dy = -Math.cos(angle);
    this.stuck = false;
    this.audio.play('whoosh');
  }

  /**
   * Arrow keys move the paddle at KEY_SPEED. A press or drag moves it under the finger, and a mouse moves it by
   * hovering. Preview cards follow the lowest ball so the frame shows play.
   */
  private movePaddle(dt: number, f: Field): void {
    const half = this.paddleHalf();
    const axis = this.input.axisX();
    const p = this.input.pointer;
    let target: number | null = null;
    if (axis !== 0) {
      this.paddleX += axis * KEY_SPEED * this.u * dt;
    } else if (p.down || (p.active && !p.touch && p.inside)) {
      target = p.x;
    } else if (this.services.preview) {
      const low = this.balls.reduce<Ball | null>((m, b) => (!m || b.y > m.y ? b : m), null);
      if (low) target = low.x;
    }
    if (target !== null) {
      const max = POINTER_SPEED * this.u * dt;
      this.paddleX += clamp(target - this.paddleX, -max, max);
    }
    this.paddleX = clamp(this.paddleX, f.left + half, f.right - half);
  }

  private stepBalls(h: number, f: Field): void {
    const r = BALL_R * this.u;
    const v = this.speed();
    const half = this.paddleHalf();
    for (const b of this.balls) {
      b.x += b.dx * v * h;
      b.y += b.dy * v * h;
      if (b.x < f.left + r && b.dx < 0) {
        b.x = f.left + r;
        b.dx = -b.dx;
        this.wallBounce(b);
      } else if (b.x > f.right - r && b.dx > 0) {
        b.x = f.right - r;
        b.dx = -b.dx;
        this.wallBounce(b);
      }
      if (b.y < f.top + r && b.dy < 0) {
        b.y = f.top + r;
        b.dy = -b.dy;
        this.wallBounce(b);
      }
      const ph = PADDLE_H * this.u;
      if (
        b.dy > 0 &&
        b.y + r >= f.paddleY &&
        b.y - r <= f.paddleY + ph &&
        Math.abs(b.x - this.paddleX) <= half + r
      ) {
        this.paddleHit(b, half, f);
      }
      if (this.shield && b.dy > 0 && b.y + r >= f.floor) {
        this.shield = false;
        b.y = f.floor - r;
        b.dy = -Math.abs(b.dy);
        this.texts.add(b.x, f.floor - 30 * this.u, 'SHIELD', '#67e8f9', 22 * this.u, 1);
        this.audio.play('powerup');
      }
      this.brickHit(b, r, f);
    }
    const lost = this.balls.filter((b) => b.y - r > f.floor);
    if (lost.length > 0) {
      this.balls = this.balls.filter((b) => b.y - r <= f.floor);
      if (this.balls.length === 0) this.loseLife();
    }
  }

  /** Keeps a wall bounce from leaving the ball moving almost sideways. */
  private wallBounce(b: Ball): void {
    if (Math.abs(b.dy) < MIN_DY) {
      b.dy = MIN_DY * (b.dy < 0 ? -1 : 1);
      b.dx = Math.sqrt(1 - MIN_DY * MIN_DY) * (b.dx < 0 ? -1 : 1);
    }
    this.audio.play('click', { volume: 0.3 });
  }

  /** The contact point sets the new direction: the centre sends the ball straight up, the edge at MAX_ANGLE. */
  private paddleHit(b: Ball, half: number, f: Field): void {
    const rel = clamp((b.x - this.paddleX) / half, -1, 1);
    const angle = rel * MAX_ANGLE;
    b.dx = Math.sin(angle);
    b.dy = -Math.cos(angle);
    b.y = f.paddleY - BALL_R * this.u;
    this.combo = 0;
    this.audio.play('hit', { volume: 0.6 });
    this.services.haptic(10);
  }

  /** At most one brick per ball per sub-step: the ball bounces off the side it came in through. */
  private brickHit(b: Ball, r: number, f: Field): void {
    for (let i = 0; i < this.bricks.length; i++) {
      const brick = this.bricks[i];
      if (!brick) continue;
      const [x, y, w, hh] = this.brickRect(brick, f);
      if (!circleHitsRect(b.x, b.y, r, x, y, w, hh)) continue;
      if (bounceAxis(b.x, b.y, r, x, y, w, hh) === 'x') b.dx = Math.abs(b.dx) * (b.x < x + w / 2 ? -1 : 1);
      else b.dy = Math.abs(b.dy) * (b.y < y + hh / 2 ? -1 : 1);
      if (brick.steel) {
        this.audio.play('bump', { volume: 0.5 });
        return;
      }
      brick.hp--;
      if (brick.hp > 0) {
        this.score += HIT_SCORE;
        this.audio.play('click');
        return;
      }
      this.bricks.splice(i, 1);
      this.breakBrick(brick, x + w / 2, y + hh / 2);
      return;
    }
  }

  private breakBrick(brick: Brick, cx: number, cy: number): void {
    this.combo++;
    const bonus = Math.min(MAX_COMBO_BONUS, this.combo - 1) * COMBO_BONUS;
    const points = BRICK_SCORE * brick.maxHp + bonus;
    this.score += points;
    this.addStat('bricks');
    this.maxStat('combo', this.combo);
    this.audio.play('pop');
    this.shake.add(0.06);
    this.particles.emit({
      x: cx,
      y: cy,
      count: 12,
      speed: 160 * this.u,
      life: 0.5,
      size: 3,
      gravity: 400 * this.u,
      colors: [this.brickColour(brick.maxHp), '#ffffff'],
    });
    if (this.combo >= 3) this.texts.add(cx, cy, `+${points}`, '#fde047', 16 * this.u, 0.7);
    if (this.rng.chance(DROP_CHANCE))
      this.drops.push({ x: cx, y: cy, kind: this.rng.weighted(DROP_WEIGHTS) });
    if (isCleared(this.bricks)) this.clearLevel();
  }

  private clearLevel(): void {
    const bonus = LEVEL_BONUS * this.level;
    this.score += bonus;
    this.addStat('levels');
    this.audio.play('levelup');
    this.texts.add(this.W / 2, this.H * 0.55, `+${bonus}`, '#fde047', 26 * this.u, 1.4);
    this.balls = [];
    this.drops = [];
    // The banner names the next level; the level number moves on when it ends.
    this.levelT = LEVEL_SEC;
  }

  private loseLife(): void {
    this.lives--;
    this.wideT = 0;
    this.slowT = 0;
    this.drops = [];
    this.shake.add(0.35);
    if (this.lives <= 0) {
      this.endGame();
      return;
    }
    this.audio.play('bump');
    this.resetBall();
  }

  private stepDrops(dt: number, f: Field): void {
    const half = this.paddleHalf();
    const ph = PADDLE_H * this.u;
    const size = 14 * this.u;
    const keep: Drop[] = [];
    for (const d of this.drops) {
      d.y += DROP_SPEED * this.u * dt;
      if (
        d.y + size >= f.paddleY &&
        d.y - size <= f.paddleY + ph &&
        Math.abs(d.x - this.paddleX) <= half + size
      ) {
        this.collect(d);
      } else if (d.y - size < f.floor) {
        keep.push(d);
      }
    }
    this.drops = keep;
  }

  private collect(d: Drop): void {
    this.addStat('powerups');
    this.audio.play(d.kind === 'coin' ? 'coin' : 'powerup');
    const at = (label: string, colour: string) =>
      this.texts.add(d.x, d.y - 20 * this.u, label, colour, 18 * this.u, 0.9);
    switch (d.kind) {
      case 'wide':
        this.wideT = this.powerTime(WIDE_SEC);
        at('WIDE', '#4ade80');
        break;
      case 'slow':
        this.slowT = this.powerTime(SLOW_SEC);
        at('SLOW', '#60a5fa');
        break;
      case 'life':
        this.lives = Math.min(MAX_LIVES, this.lives + 1);
        at('+1 LIFE', '#f472b6');
        break;
      case 'coin':
        this.coins++;
        this.score += COIN_SCORE;
        at('+1', '#fde047');
        break;
      case 'multi':
        this.splitBalls();
        at('MULTI', '#fb923c');
        break;
    }
  }

  /** Every ball in play splits into three, fanned out, up to MAX_BALLS. */
  private splitBalls(): void {
    if (this.stuck) return;
    const extra: Ball[] = [];
    for (const b of this.balls) {
      for (const turn of [-0.5, 0.5]) {
        if (this.balls.length + extra.length >= MAX_BALLS) break;
        const c = Math.cos(turn);
        const s = Math.sin(turn);
        let dx = b.dx * c - b.dy * s;
        let dy = b.dx * s + b.dy * c;
        if (Math.abs(dy) < MIN_DY) {
          dy = MIN_DY * (dy < 0 ? -1 : 1);
          dx = Math.sqrt(1 - MIN_DY * MIN_DY) * (dx < 0 ? -1 : 1);
        }
        extra.push({ x: b.x, y: b.y, dx, dy });
      }
    }
    this.balls.push(...extra);
  }

  private brickColour(hp: number): string {
    if (hp >= 3) return this.skinColor('b3', '#f472b6');
    if (hp === 2) return this.skinColor('b2', '#a78bfa');
    return this.skinColor('b1', '#22d3ee');
  }

  private drawWalls(f: Field): void {
    const ctx = this.ctx;
    ctx.fillStyle = this.skinColor('wall', 'rgba(148,163,184,0.35)');
    const t = 4 * this.u;
    ctx.fillRect(f.left - t, f.top, t, f.floor - f.top);
    ctx.fillRect(f.right, f.top, t, f.floor - f.top);
    ctx.fillRect(f.left - t, f.top - t, f.right - f.left + 2 * t, t);
  }

  private drawBrick(b: Brick, f: Field): void {
    const ctx = this.ctx;
    const [x, y, w, h] = this.brickRect(b, f);
    const colour = b.steel ? this.skinColor('steel', '#94a3b8') : this.brickColour(b.hp);
    const g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, shade(colour, 0.25));
    g.addColorStop(1, shade(colour, -0.25));
    fillRoundRect(ctx, x, y, w, h, 5 * this.u, g);
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.fillRect(x + 4 * this.u, y + 3 * this.u, w - 8 * this.u, 3 * this.u);
    if (!b.steel && b.hp < b.maxHp) {
      ctx.strokeStyle = 'rgba(0,0,0,0.45)';
      ctx.lineWidth = 2 * this.u;
      ctx.beginPath();
      ctx.moveTo(x + w * 0.3, y);
      ctx.lineTo(x + w * 0.45, y + h * 0.55);
      ctx.lineTo(x + w * 0.62, y + h);
      ctx.stroke();
    }
    if (b.steel) {
      ctx.fillStyle = 'rgba(15,23,42,0.5)';
      for (const fx of [0.2, 0.8]) {
        ctx.beginPath();
        ctx.arc(x + w * fx, y + h / 2, 2.5 * this.u, 0, TAU);
        ctx.fill();
      }
    }
  }

  private drawPaddle(f: Field): void {
    const ctx = this.ctx;
    const half = this.paddleHalf();
    const h = PADDLE_H * this.u;
    const colour = this.skinColor('paddle', '#e2e8f0');
    const g = ctx.createLinearGradient(0, f.paddleY, 0, f.paddleY + h);
    g.addColorStop(0, shade(colour, 0.3));
    g.addColorStop(1, shade(colour, -0.3));
    fillRoundRect(ctx, this.paddleX - half, f.paddleY, half * 2, h, h / 2, g);
    ctx.fillStyle = this.skinColor('accent', '#22d3ee');
    ctx.fillRect(this.paddleX - half + h / 2, f.paddleY + h * 0.4, half * 2 - h, h * 0.2);
  }

  private drawBall(b: Ball): void {
    const ctx = this.ctx;
    const r = BALL_R * this.u;
    ctx.save();
    ctx.fillStyle = this.skinColor('ball', '#fef9c3');
    ctx.shadowColor = this.skinColor('ball', '#fef9c3');
    ctx.shadowBlur = 12 * this.u;
    ctx.beginPath();
    ctx.arc(b.x, b.y, r, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  private drawDrop(d: Drop): void {
    const ctx = this.ctx;
    const w = 34 * this.u;
    const h = 18 * this.u;
    const colours: Record<DropKind, string> = {
      wide: '#4ade80',
      multi: '#fb923c',
      slow: '#60a5fa',
      life: '#f472b6',
      coin: '#facc15',
    };
    fillRoundRect(ctx, d.x - w / 2, d.y - h / 2, w, h, h / 2, colours[d.kind]);
    text(ctx, DROP_LABEL[d.kind], d.x, d.y + this.u, {
      size: Math.round(14 * this.u),
      align: 'center',
      color: '#0f172a',
      stroke: null,
    });
  }
}
