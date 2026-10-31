import { clamp, TAU } from '../../core/math';
import { BaseGame } from '../base';
import { fillRoundRect, progressBar, text } from '../draw';
import { drawStatBar, statBarHeight } from '../statbar';
import type { GameServices } from '../types';

const DESIGN_W = 600;
const GRAVITY = 900;
const MIN_SPEED = 650;
const MAX_SPEED = 1500;
const FULL_DRAW = 0.45;
const TARGET_H = 150;
const MISSES = 3;
const MOVING_FROM = 5;
const CALM_SHOTS = 5;
const KEY_TURN = 1.4;
const CHARGE_RATE = 0.9;
const HIT_PAUSE = 0.9;

/** Ring score (10 down to 1) for an arrow `offset` from the centre of a face `half` tall each way; 0 is a miss. */
export function ringScore(offset: number, half: number): number {
  const t = Math.abs(offset) / half;
  if (t >= 1) return 0;
  return 10 - Math.floor(t * 10);
}

interface Arrow {
  x: number;
  y: number;
  vx: number;
  vy: number;
  stuck: boolean;
  /** Where it stuck, relative to the target's centre. */
  dy: number;
}

/** Archery: pull back to draw, mind the wind, and hit the target. Three misses and the contest is over. */
export class ArcheryGame extends BaseGame {
  private readonly u: number;
  private arrow: Arrow | null = null;
  private drawFrom: { x: number; y: number } | null = null;
  private aim = -0.3;
  private power = 0;
  private charging = false;
  private targetY = 0;
  private wind = 0;
  private shots = 0;
  private misses = 0;
  private allowed: number;
  private streak = 0;
  private pauseT = 0;
  private pendingNext = false;

  constructor(services: GameServices) {
    super(services);
    this.u = this.W / DESIGN_W;
    this.allowed = MISSES + (this.hasBoost('shield') ? 1 : 0);
    for (const key of ['hits', 'bullseyes']) this.addStat(key, 0);
    this.newTarget();
  }

  protected tick(dt: number): void {
    // A stuck arrow rides along with a moving target.
    if (this.arrow?.stuck) this.arrow.y = this.targetCentre() + this.arrow.dy;
    if (this.isEnding) return;
    if (this.pauseT > 0) {
      this.pauseT -= dt;
      if (this.pauseT <= 0 && this.pendingNext) {
        this.pendingNext = false;
        this.arrow = null;
        this.newTarget();
      }
      return;
    }
    if (this.arrow && !this.arrow.stuck) this.fly(dt);
    else if (!this.arrow) this.readDraw(dt);
  }

  render(): void {
    const ctx = this.ctx;
    const g = ctx.createLinearGradient(0, 0, 0, this.H);
    g.addColorStop(0, this.skinColor('sky1', '#7dd3fc'));
    g.addColorStop(1, this.skinColor('sky2', '#e0f2fe'));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.W, this.H);
    const ground = this.groundY();
    ctx.fillStyle = this.skinColor('grass', '#4ade80');
    ctx.fillRect(0, ground, this.W, this.H - ground);
    ctx.save();
    ctx.translate(this.shake.x, this.shake.y);
    this.drawTarget();
    this.drawArcher();
    if (this.arrow)
      this.drawArrow(
        this.arrow.x,
        this.arrow.y,
        this.arrow.stuck ? 0 : Math.atan2(this.arrow.vy, this.arrow.vx),
      );
    else if (this.drawFrom || this.charging) this.drawGuide();
    this.particles.render(ctx);
    this.texts.render(ctx);
    ctx.restore();
    if (this.services.preview) return;
    drawStatBar(ctx, this.W, this.insets.top, this.u, [
      ['SCORE', Math.floor(this.score).toLocaleString('en-US')],
      ['ARROW', String(this.shots + (this.arrow ? 0 : 1))],
      ['MISSES', `${this.misses}/${this.allowed}`],
    ]);
    this.drawWind();
    if (this.drawFrom || this.charging)
      progressBar(
        ctx,
        this.W * 0.25,
        this.H - this.insets.bottom - 40 * this.u,
        this.W * 0.5,
        12 * this.u,
        this.power,
        this.power > 0.9 ? '#ef4444' : '#fde047',
      );
    if (this.shots === 0 && !this.drawFrom) {
      text(ctx, 'PULL BACK TO DRAW · LET GO TO SHOOT', this.W / 2, ground + 60 * this.u, {
        size: Math.round(18 * this.u),
        align: 'center',
      });
    }
  }

  private groundY(): number {
    return this.H - this.insets.bottom - 110 * this.u;
  }

  private bow(): [number, number] {
    return [70 * this.u, this.groundY() - 70 * this.u];
  }

  private targetX(): number {
    return this.W - 50 * this.u;
  }

  /** The target's centre now: from MOVING_FROM shots on it bobs up and down. */
  private targetCentre(): number {
    if (this.shots < MOVING_FROM) return this.targetY;
    const amp = Math.min(160, 40 + (this.shots - MOVING_FROM) * 12) * this.u;
    return this.targetY + Math.sin(this.time * 1.4) * amp;
  }

  private newTarget(): void {
    const top = this.insets.top + statBarHeight(this.u) + 60 * this.u + TARGET_H * this.u;
    const bottom = this.groundY() - TARGET_H * 0.5 * this.u;
    this.targetY = this.rng.range(top, bottom);
    const calm = this.hasBoost('head-start') && this.shots < CALM_SHOTS;
    this.wind = calm ? 0 : this.rng.range(-1, 1) * Math.min(160, 40 + this.shots * 12);
  }

  /**
   * Drawing the bow: press anywhere and pull back; the arrow flies the opposite way, harder the further you pull. On a
   * keyboard ↑ ↓ set the angle and holding Space draws. Card art shoots a fixed lob.
   */
  private readDraw(dt: number): void {
    const p = this.input.pointer;
    if (this.services.preview) {
      if (this.time > 0.3) this.loose(-0.42, 0.72);
      return;
    }
    if (p.pressed) this.drawFrom = { x: p.x, y: p.y };
    if (this.drawFrom && p.down) {
      const dx = this.drawFrom.x - p.x;
      const dy = this.drawFrom.y - p.y;
      const len = Math.hypot(dx, dy);
      if (len > 6 * this.u) this.aim = clamp(Math.atan2(dy, dx), -1.45, 0.6);
      this.power = Math.min(1, len / (FULL_DRAW * this.W));
    } else if (this.drawFrom) {
      this.drawFrom = null;
      if (this.power > 0.08) this.loose(this.aim, this.power);
      this.power = 0;
      return;
    }
    this.aim = clamp(this.aim + this.input.axisY() * KEY_TURN * dt, -1.45, 0.6);
    if (this.input.isDown('primary')) {
      this.charging = true;
      this.power = Math.min(1, this.power + CHARGE_RATE * dt);
    } else if (this.charging) {
      this.charging = false;
      this.loose(this.aim, this.power);
      this.power = 0;
    }
  }

  private loose(angle: number, power: number): void {
    const [bx, by] = this.bow();
    const speed = (MIN_SPEED + (MAX_SPEED - MIN_SPEED) * power) * this.u;
    this.arrow = {
      x: bx,
      y: by,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      stuck: false,
      dy: 0,
    };
    this.shots++;
    this.audio.play('whoosh', { volume: 0.6 });
  }

  private fly(dt: number): void {
    const a = this.arrow;
    if (!a) return;
    const prevX = a.x;
    a.vy += GRAVITY * this.u * dt;
    a.vx += this.wind * this.u * dt;
    a.x += a.vx * dt;
    a.y += a.vy * dt;
    const tx = this.targetX();
    if (prevX < tx && a.x >= tx) {
      // Where it crossed the target's face.
      const f = (tx - prevX) / (a.x - prevX || 1);
      const y = a.y - a.vy * dt * (1 - f);
      const cy = this.targetCentre();
      const ring = ringScore(y - cy, (TARGET_H * this.u) / 2);
      if (ring > 0) {
        a.x = tx;
        a.y = y;
        a.stuck = true;
        a.dy = y - cy;
        this.hit(ring);
        return;
      }
    }
    if (a.y > this.groundY() || a.x > this.W + 40 * this.u || a.x < -40 * this.u || a.y > this.H) this.miss();
  }

  private hit(ring: number): void {
    this.streak = ring === 10 ? this.streak + 1 : 0;
    const bonus = ring === 10 ? 10 * this.streak : 0;
    this.score += ring * 10 + bonus;
    this.addStat('hits');
    if (ring === 10) {
      this.addStat('bullseyes');
      this.coins++;
    }
    const a = this.arrow;
    if (a) {
      this.texts.add(
        a.x - 30 * this.u,
        a.y - 30 * this.u,
        ring === 10 ? `BULLSEYE! +${100 + bonus}` : `+${ring * 10}`,
        ring === 10 ? '#facc15' : '#ffffff',
        24 * this.u,
        1,
      );
      this.particles.emit({
        x: a.x,
        y: a.y,
        count: ring === 10 ? 24 : 8,
        speed: 160 * this.u,
        life: 0.5,
        size: 3,
        colors: ['#fde047', '#ffffff', '#ef4444'],
      });
    }
    this.audio.play(ring === 10 ? 'reward' : 'hit');
    this.services.haptic(15);
    this.pauseT = HIT_PAUSE;
    this.pendingNext = true;
  }

  /** The arrow missed. Three misses (four with the shield) end the contest. */
  private miss(): void {
    this.misses++;
    this.streak = 0;
    this.audio.play('bump', { volume: 0.5 });
    const a = this.arrow;
    if (a)
      this.texts.add(
        clamp(a.x, 60 * this.u, this.W - 60 * this.u),
        clamp(a.y, 120 * this.u, this.groundY()) - 30 * this.u,
        'MISS',
        '#ef4444',
        24 * this.u,
        0.9,
      );
    if (this.misses >= this.allowed) {
      this.arrow = null;
      this.endGame(1.2);
      return;
    }
    this.pauseT = HIT_PAUSE * 0.6;
    this.pendingNext = true;
  }

  private drawTarget(): void {
    const ctx = this.ctx;
    const x = this.targetX();
    const cy = this.targetCentre();
    const h = TARGET_H * this.u;
    ctx.fillStyle = '#78350f';
    ctx.fillRect(x + 6 * this.u, cy, 8 * this.u, this.groundY() - cy);
    // Seen side-on the target is a tall oval: rings from white at the edge to gold in the middle.
    const rings = ['#f8fafc', '#111827', '#3b82f6', '#ef4444', '#facc15'];
    rings.forEach((colour, k) => {
      const s = 1 - k * 0.2;
      ctx.fillStyle = colour;
      ctx.beginPath();
      ctx.ellipse(x, cy, 14 * this.u * s + 4 * this.u, (h / 2) * s, 0, 0, TAU);
      ctx.fill();
    });
  }

  private drawArcher(): void {
    const ctx = this.ctx;
    const u = this.u;
    const [bx, by] = this.bow();
    const ground = this.groundY();
    ctx.fillStyle = this.skinColor('archer', '#1e3a8a');
    fillRoundRect(
      ctx,
      bx - 30 * u,
      by - 10 * u,
      22 * u,
      ground - by + 10 * u,
      8 * u,
      this.skinColor('archer', '#1e3a8a'),
    );
    ctx.fillStyle = '#fcd34d';
    ctx.beginPath();
    ctx.arc(bx - 19 * u, by - 26 * u, 15 * u, 0, TAU);
    ctx.fill();
    // The bow bends as it is drawn.
    const bend = 30 * u + this.power * 18 * u;
    ctx.save();
    ctx.translate(bx, by);
    ctx.rotate(this.arrow && !this.arrow.stuck ? 0 : this.aim);
    ctx.strokeStyle = this.skinColor('bow', '#92400e');
    ctx.lineWidth = 6 * u;
    ctx.beginPath();
    ctx.arc(-bend + 30 * u, 0, bend, -0.9, 0.9);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 1.5 * u;
    const pull = this.arrow ? 0 : this.power * 26 * u;
    ctx.beginPath();
    ctx.moveTo(-bend + 30 * u + Math.cos(-0.9) * bend, Math.sin(-0.9) * bend);
    ctx.lineTo(-pull, 0);
    ctx.lineTo(-bend + 30 * u + Math.cos(0.9) * bend, Math.sin(0.9) * bend);
    ctx.stroke();
    ctx.restore();
    if (!this.arrow)
      this.drawArrow(
        bx + Math.cos(this.aim) * (30 * u - this.power * 26 * u),
        by + Math.sin(this.aim) * (30 * u - this.power * 26 * u),
        this.aim,
      );
  }

  private drawArrow(x: number, y: number, angle: number): void {
    const ctx = this.ctx;
    const u = this.u;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.strokeStyle = '#78350f';
    ctx.lineWidth = 3 * u;
    ctx.beginPath();
    ctx.moveTo(-56 * u, 0);
    ctx.lineTo(0, 0);
    ctx.stroke();
    ctx.fillStyle = '#64748b';
    ctx.beginPath();
    ctx.moveTo(6 * u, 0);
    ctx.lineTo(-6 * u, -5 * u);
    ctx.lineTo(-6 * u, 5 * u);
    ctx.fill();
    ctx.fillStyle = this.skinColor('fletch', '#ef4444');
    ctx.fillRect(-58 * u, -5 * u, 12 * u, 3 * u);
    ctx.fillRect(-58 * u, 2 * u, 12 * u, 3 * u);
    ctx.restore();
  }

  /** The first stretch of the flight, as dots, so the aim can be judged without giving the whole arc away. */
  private drawGuide(): void {
    const ctx = this.ctx;
    const [bx, by] = this.bow();
    const speed = (MIN_SPEED + (MAX_SPEED - MIN_SPEED) * this.power) * this.u;
    let x = bx;
    let y = by;
    const vx = Math.cos(this.aim) * speed;
    let vy = Math.sin(this.aim) * speed;
    ctx.fillStyle = 'rgba(15,23,42,0.5)';
    for (let k = 0; k < 10; k++) {
      for (let s = 0; s < 3; s++) {
        vy += GRAVITY * this.u * 0.01;
        x += vx * 0.01;
        y += vy * 0.01;
      }
      ctx.beginPath();
      ctx.arc(x, y, 3 * this.u, 0, TAU);
      ctx.fill();
    }
  }

  private drawWind(): void {
    const ctx = this.ctx;
    const y = this.insets.top + statBarHeight(this.u) + 20 * this.u;
    const w = Math.abs(this.wind);
    const label = w < 1 ? 'NO WIND' : `WIND ${Math.round(w / 10)} ${this.wind > 0 ? '→' : '←'}`;
    text(ctx, label, this.W / 2, y, {
      size: Math.round(18 * this.u),
      align: 'center',
      color: '#0f172a',
      stroke: null,
    });
  }
}
