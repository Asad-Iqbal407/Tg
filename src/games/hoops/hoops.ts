import { clamp, TAU } from '../../core/math';
import { BaseGame } from '../base';
import { fillRoundRect, progressBar, shade, text } from '../draw';
import { drawStatBar, statBarHeight } from '../statbar';
import type { GameServices } from '../types';

const DESIGN_W = 600;
const BALL_R = 30;
const RIM_HALF = 58;
const RIM_KNOB = 6;
const GRAVITY = 1900;
const MAX_THROW = 2300;
/** A flick's speed (logical px/s) is scaled by this into the ball's launch speed. */
const FLICK_GAIN = 0.85;
const MIN_FLICK = 350;
const ROUND_SEC = 45;
const EXTRA_SEC = 10;
const SWISH_SEC = 2;
const BASKET_POINTS = 10;
const SWISH_POINTS = 5;
const MOVE_FROM = 10;
const COIN_BASKETS = 5;
const RIM_BOUNCE = 0.55;
const KEY_AIM = 520;
const CHARGE_RATE = 0.9;

/**
 * The launch velocity that sends a ball from (x0, y0) up to a peak `rise` px above the rim at height `hy`, then down
 * through the rim's centre at `hx`.
 */
export function shotTo(
  x0: number,
  y0: number,
  hx: number,
  hy: number,
  rise: number,
  g: number,
): { vx: number; vy: number } {
  const apex = hy - rise;
  const up = Math.max(1, y0 - apex);
  const vy = -Math.sqrt(2 * g * up);
  const t = -vy / g + Math.sqrt((2 * (hy - apex)) / g);
  return { vx: (hx - x0) / t, vy };
}

interface Ball {
  x: number;
  y: number;
  vx: number;
  vy: number;
  spin: number;
  /** True once the ball has been above the rim, so a fall through it counts. */
  above: boolean;
  touched: boolean;
  scored: boolean;
}

/** Hoops: flick the ball up into the basket. Swishes and streaks pay extra; the hoop starts moving after ten baskets. */
export class HoopsGame extends BaseGame {
  private readonly u: number;
  private ball: Ball | null = null;
  /** Where the next ball waits. */
  private restX: number;
  private timeLeft: number;
  private roundSec: number;
  private baskets = 0;
  private streak = 0;
  private shield = false;
  private trail: { x: number; y: number; t: number }[] = [];
  private aimVx = 0;
  private charge = 0;
  private charging = false;
  private netT = 0;
  private previewT = 0;

  constructor(services: GameServices) {
    super(services);
    this.u = this.W / DESIGN_W;
    this.shield = this.hasBoost('shield');
    this.roundSec = ROUND_SEC + (this.hasBoost('head-start') ? EXTRA_SEC : 0);
    this.timeLeft = this.roundSec;
    this.restX = this.W / 2;
    for (const key of ['baskets', 'swishes', 'streak']) this.addStat(key, 0);
  }

  protected tick(dt: number): void {
    this.netT = Math.max(0, this.netT - dt);
    if (this.isEnding) return;
    this.timeLeft -= dt;
    if (this.timeLeft <= 0) {
      if (this.shield) {
        this.shield = false;
        this.timeLeft = EXTRA_SEC;
        this.roundSec = Math.max(this.roundSec, EXTRA_SEC);
        this.texts.add(this.W / 2, this.H * 0.5, `SHIELD +${EXTRA_SEC}s`, '#67e8f9', 26 * this.u, 1.2);
        this.audio.play('powerup');
      } else {
        this.timeLeft = 0;
        this.audio.play('win');
        this.endGame(1.4, false);
        return;
      }
    }
    if (this.ball) this.fly(dt);
    else this.readThrow(dt);
  }

  render(): void {
    const ctx = this.ctx;
    const g = ctx.createLinearGradient(0, 0, 0, this.H);
    g.addColorStop(0, this.skinColor('wall1', '#1e3a8a'));
    g.addColorStop(0.75, this.skinColor('wall2', '#0f172a'));
    g.addColorStop(0.75, this.skinColor('floor1', '#b45309'));
    g.addColorStop(1, this.skinColor('floor2', '#78350f'));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.W, this.H);
    ctx.save();
    ctx.translate(this.shake.x, this.shake.y);
    const [hx, hy] = this.hoop();
    this.drawBackboard(hx, hy);
    // A ball dropping through the hoop is drawn behind the net and the front of the rim.
    const b = this.ball;
    const behind = b && b.y > hy - BALL_R * this.u && b.above;
    if (b && behind) this.drawBall(b.x, b.y, b.spin);
    this.drawRim(hx, hy);
    if (b && !behind) this.drawBall(b.x, b.y, b.spin);
    if (!b) this.drawBall(this.restX + this.aimVx * 0.05, this.restY(), 0);
    this.particles.render(ctx);
    this.texts.render(ctx);
    ctx.restore();
    if (this.services.preview) return;
    const mult = this.multiplier();
    drawStatBar(ctx, this.W, this.insets.top, this.u, [
      ['SCORE', Math.floor(this.score).toLocaleString('en-US')],
      ['TIME', String(Math.ceil(this.timeLeft))],
      ['STREAK', mult > 1 ? `x${mult}` : String(this.streak)],
    ]);
    const t = this.timeLeft / this.roundSec;
    progressBar(
      ctx,
      24 * this.u,
      this.insets.top + statBarHeight(this.u),
      this.W - 48 * this.u,
      8 * this.u,
      t,
      t < 0.2 ? '#ef4444' : '#fb923c',
      'rgba(0,0,0,0.3)',
    );
    if (this.baskets === 0 && !this.ball) {
      text(ctx, 'FLICK UP TO SHOOT', this.W / 2, this.restY() - 110 * this.u, {
        size: Math.round(26 * this.u),
        align: 'center',
      });
    }
    if (this.charging)
      progressBar(
        ctx,
        this.W * 0.3,
        this.restY() + 50 * this.u,
        this.W * 0.4,
        10 * this.u,
        this.charge,
        '#fde047',
      );
  }

  private multiplier(): number {
    return Math.min(4, 1 + Math.floor(this.streak / 3));
  }

  /** The rim's centre. After MOVE_FROM baskets the hoop drifts from side to side, faster as the score grows. */
  private hoop(): [number, number] {
    const top = this.insets.top + statBarHeight(this.u);
    const hy = top + (this.H - this.insets.bottom - top) * 0.3;
    if (this.baskets < MOVE_FROM) return [this.W / 2, hy];
    const speed = Math.min(1.6, 0.6 + (this.baskets - MOVE_FROM) * 0.04);
    return [this.W / 2 + Math.sin(this.time * speed) * this.W * 0.22, hy];
  }

  private restY(): number {
    return this.H - this.insets.bottom - 130 * this.u;
  }

  /**
   * A flick: press, swipe up and let go; the swipe's speed and direction over its last tenth of a second set the
   * throw. On a keyboard ← → aim and holding Space charges. Card art shoots straight at the hoop.
   */
  private readThrow(dt: number): void {
    const p = this.input.pointer;
    const u = this.u;
    if (this.services.preview) {
      this.previewT += dt;
      if (this.previewT > 0.5) {
        this.previewT = 0;
        const [hx, hy] = this.hoop();
        const v = shotTo(this.restX, this.restY(), hx, hy, 140 * u, GRAVITY * u);
        this.launch(v.vx, v.vy);
      }
      return;
    }
    if (p.pressed) this.trail = [];
    if (p.down) {
      this.trail.push({ x: p.x, y: p.y, t: this.time });
      this.trail = this.trail.filter((q) => this.time - q.t <= 0.1);
    } else if (p.released && this.trail.length >= 2) {
      const a = this.trail[0];
      const b = this.trail[this.trail.length - 1];
      this.trail = [];
      if (a && b && b.t > a.t) {
        const vx = ((b.x - a.x) / (b.t - a.t)) * FLICK_GAIN;
        const vy = ((b.y - a.y) / (b.t - a.t)) * FLICK_GAIN;
        if (-vy > MIN_FLICK * u) this.launch(vx, vy);
      }
      return;
    }
    this.aimVx = clamp(this.aimVx + this.input.axisX() * KEY_AIM * u * dt, -400 * u, 400 * u);
    if (this.input.isDown('primary') || this.input.isDown('up')) {
      this.charging = true;
      this.charge = Math.min(1, this.charge + CHARGE_RATE * dt);
    } else if (this.charging) {
      this.charging = false;
      this.launch(this.aimVx, -(900 + 1300 * this.charge) * u);
      this.charge = 0;
    }
  }

  private launch(vx: number, vy: number): void {
    const u = this.u;
    const sp = Math.hypot(vx, vy);
    const k = sp > MAX_THROW * u ? (MAX_THROW * u) / sp : 1;
    this.ball = {
      x: this.restX,
      y: this.restY(),
      vx: vx * k,
      vy: vy * k,
      spin: 0,
      above: false,
      touched: false,
      scored: false,
    };
    this.audio.play('whoosh', { volume: 0.5 });
  }

  private fly(dt: number): void {
    const b = this.ball;
    if (!b) return;
    const u = this.u;
    const steps = Math.max(1, Math.ceil((Math.hypot(b.vx, b.vy) * dt) / (8 * u)));
    const h = dt / steps;
    const [hx, hy] = this.hoop();
    for (let i = 0; i < steps; i++) {
      const prevY = b.y;
      b.vy += GRAVITY * u * h;
      b.x += b.vx * h;
      b.y += b.vy * h;
      b.spin += (b.vx / (BALL_R * u)) * h;
      if (b.y + BALL_R * u < hy) b.above = true;
      this.rimHits(b, hx, hy);
      // Through the hoop: the centre crosses the rim line going down, inside the rim.
      if (
        !b.scored &&
        b.above &&
        b.vy > 0 &&
        prevY < hy &&
        b.y >= hy &&
        Math.abs(b.x - hx) < (RIM_HALF - 6) * u
      ) {
        this.basket(b, hx, hy);
      }
      // Side walls keep the ball in play.
      if (b.x < BALL_R * u && b.vx < 0) b.vx = -b.vx * 0.6;
      if (b.x > this.W - BALL_R * u && b.vx > 0) b.vx = -b.vx * 0.6;
    }
    if (b.y - BALL_R * u > this.H) this.nextBall(b);
  }

  /**
   * The two ends of the rim are solid knobs the ball can clip on its way down. On the way up the ball passes in front
   * of the hoop (this is a view from the front), so only a falling ball that has been above the rim can hit it.
   */
  private rimHits(b: Ball, hx: number, hy: number): void {
    if (b.vy <= 0 || !b.above) return;
    const u = this.u;
    for (const side of [-1, 1]) {
      const kx = hx + side * RIM_HALF * u;
      const dx = b.x - kx;
      const dy = b.y - hy;
      const d = Math.hypot(dx, dy);
      const reach = (BALL_R + RIM_KNOB) * u;
      if (d >= reach || d === 0) continue;
      const nx = dx / d;
      const ny = dy / d;
      b.x = kx + nx * reach;
      b.y = hy + ny * reach;
      const vn = b.vx * nx + b.vy * ny;
      if (vn < 0) {
        b.vx -= (1 + RIM_BOUNCE) * vn * nx;
        b.vy -= (1 + RIM_BOUNCE) * vn * ny;
        b.touched = true;
        this.audio.play('click', { volume: 0.6 });
      }
    }
  }

  private basket(b: Ball, hx: number, hy: number): void {
    b.scored = true;
    this.baskets++;
    this.streak++;
    this.addStat('baskets');
    this.maxStat('streak', this.streak);
    const mult = this.multiplier();
    const swish = !b.touched;
    const points = (BASKET_POINTS + (swish ? SWISH_POINTS : 0)) * mult;
    this.score += points;
    if (swish) {
      this.addStat('swishes');
      this.timeLeft += SWISH_SEC;
    }
    if (this.baskets % COIN_BASKETS === 0) this.coins++;
    this.netT = 0.5;
    this.texts.add(
      hx,
      hy - 70 * this.u,
      swish ? `SWISH! +${points}` : `+${points}`,
      swish ? '#fde047' : '#ffffff',
      26 * this.u,
      1,
    );
    this.particles.emit({
      x: hx,
      y: hy,
      count: swish ? 24 : 12,
      speed: 180 * this.u,
      life: 0.6,
      size: 3,
      colors: ['#fb923c', '#fde047', '#ffffff'],
    });
    this.audio.play(swish ? 'reward' : 'coin');
    this.services.haptic(15);
  }

  /** The ball has dropped out of sight: a miss breaks the streak; a new ball waits somewhere else on the floor. */
  private nextBall(b: Ball): void {
    if (!b.scored) {
      this.streak = 0;
      this.audio.play('bump', { volume: 0.4 });
    }
    this.ball = null;
    this.aimVx = 0;
    this.restX = this.rng.range(this.W * 0.22, this.W * 0.78);
  }

  private drawBackboard(hx: number, hy: number): void {
    const ctx = this.ctx;
    const u = this.u;
    ctx.fillStyle = '#475569';
    ctx.fillRect(hx - 5 * u, hy - 170 * u, 10 * u, 40 * u);
    fillRoundRect(
      ctx,
      hx - 120 * u,
      hy - 150 * u,
      240 * u,
      150 * u,
      8 * u,
      this.skinColor('board', 'rgba(255,255,255,0.9)'),
    );
    ctx.strokeStyle = this.skinColor('rim', '#ea580c');
    ctx.lineWidth = 5 * u;
    ctx.strokeRect(hx - 45 * u, hy - 85 * u, 90 * u, 70 * u);
  }

  private drawRim(hx: number, hy: number): void {
    const ctx = this.ctx;
    const u = this.u;
    const rim = this.skinColor('rim', '#ea580c');
    // Net: strings from the rim to a narrower bottom, swaying after a basket.
    const sway = Math.sin(this.netT * 30) * this.netT * 10 * u;
    ctx.strokeStyle = this.skinColor('net', 'rgba(255,255,255,0.85)');
    ctx.lineWidth = 2 * u;
    for (let k = 0; k <= 6; k++) {
      const t = k / 6;
      const x0 = hx - RIM_HALF * u + t * RIM_HALF * 2 * u;
      const x1 = hx - RIM_HALF * 0.6 * u + t * RIM_HALF * 1.2 * u + sway;
      ctx.beginPath();
      ctx.moveTo(x0, hy);
      ctx.lineTo(x1, hy + 70 * u);
      ctx.stroke();
    }
    for (const f of [0.35, 0.7]) {
      ctx.beginPath();
      ctx.moveTo(hx - RIM_HALF * (1 - 0.4 * f) * u + sway * f, hy + 70 * u * f);
      ctx.lineTo(hx + RIM_HALF * (1 - 0.4 * f) * u + sway * f, hy + 70 * u * f);
      ctx.stroke();
    }
    ctx.strokeStyle = rim;
    ctx.lineWidth = RIM_KNOB * 2 * u;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(hx - RIM_HALF * u, hy);
    ctx.lineTo(hx + RIM_HALF * u, hy);
    ctx.stroke();
  }

  private drawBall(x: number, y: number, spin: number): void {
    const ctx = this.ctx;
    const r = BALL_R * this.u;
    const colour = this.skinColor('ball', '#f97316');
    const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.35, r * 0.1, x, y, r);
    g.addColorStop(0, shade(colour, 0.35));
    g.addColorStop(1, shade(colour, -0.25));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fill();
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(spin);
    ctx.strokeStyle = 'rgba(15,23,42,0.75)';
    ctx.lineWidth = 2.2 * this.u;
    ctx.beginPath();
    ctx.moveTo(-r, 0);
    ctx.lineTo(r, 0);
    ctx.moveTo(0, -r);
    ctx.lineTo(0, r);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(-r * 1.25, 0, r * 0.85, -0.85, 0.85);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(r * 1.25, 0, r * 0.85, Math.PI - 0.85, Math.PI + 0.85);
    ctx.stroke();
    ctx.restore();
  }
}
