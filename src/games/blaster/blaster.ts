import { TAU, wrapAngle } from '../../core/math';
import { BaseGame } from '../base';
import { banner, text } from '../draw';
import { drawStatBar, statBarHeight } from '../statbar';
import type { GameServices } from '../types';

const DESIGN_W = 600;
const LIVES = 3;
const SHIP_R = 27;
const TURN_RATE = 9;
const KEY_TURN = 4;
const FIRE_SEC = 0.17;
const BULLET_SPEED = 900;
const BULLET_LIFE = 0.9;
const INVULN_SEC = 2;
const CLEAR_R = 140;
const WAVE_SEC = 1.8;
/** Rock radius (design px) and points by size: 3 is the biggest. */
export const ROCK: Readonly<Record<number, { r: number; points: number }>> = {
  3: { r: 46, points: 20 },
  2: { r: 28, points: 50 },
  1: { r: 16, points: 100 },
};

/** Big rocks in wave n, their speed (design px/s) and the gap between them (s). */
export function waveRocks(n: number): { count: number; speed: number; gap: number } {
  return { count: 3 + n, speed: Math.min(170, 60 + 10 * n), gap: Math.max(0.8, 2.4 - 0.15 * n) };
}

/** The two smaller rocks a shot rock breaks into, flying apart at right angles to the shot; none from the smallest. */
export function splitRock(
  size: number,
  x: number,
  y: number,
  vx: number,
  vy: number,
  speedUp: number,
): { size: number; x: number; y: number; vx: number; vy: number }[] {
  if (size <= 1) return [];
  const sp = Math.hypot(vx, vy) * speedUp;
  const a = Math.atan2(vy, vx);
  return [-0.7, 0.7].map((turn) => ({
    size: size - 1,
    x,
    y,
    vx: Math.cos(a + turn) * sp,
    vy: Math.sin(a + turn) * sp,
  }));
}

interface Rock {
  size: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  spin: number;
  angle: number;
  /** Seeds the jagged outline. */
  shape: number[];
}

interface Bullet {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
}

/** Asteroid Blaster: turn your ship, blast the rocks drifting in, and split them down to dust. */
export class BlasterGame extends BaseGame {
  private readonly u: number;
  private angle = -Math.PI / 2;
  private rocks: Rock[] = [];
  private bullets: Bullet[] = [];
  private wave = 0;
  private toSpawn = 0;
  private spawnT = 0;
  private fireT = 0;
  private lives: number;
  private invulnT = 0;
  private waveT = 0;

  constructor(services: GameServices) {
    super(services);
    this.u = this.W / DESIGN_W;
    this.lives = LIVES + (this.hasBoost('shield') ? 1 : 0);
    for (const key of ['rocks', 'waves']) this.addStat(key, 0);
    this.startWave(1);
  }

  protected tick(dt: number): void {
    this.invulnT = Math.max(0, this.invulnT - dt);
    for (const r of this.rocks) {
      r.x += r.vx * dt;
      r.y += r.vy * dt;
      r.angle += r.spin * dt;
    }
    if (this.isEnding) return;
    if (this.waveT > 0) {
      this.waveT -= dt;
      if (this.waveT <= 0) this.startWave(this.wave + 1);
    }
    this.aim(dt);
    this.shoot(dt);
    this.moveBullets(dt);
    this.spawn(dt);
    this.collide();
    // Rocks that drift far off the screen are gone.
    this.rocks = this.rocks.filter(
      (r) => Math.hypot(r.x - this.W / 2, r.y - this.centerY()) < Math.max(this.W, this.H),
    );
    if (this.waveT <= 0 && this.toSpawn === 0 && this.rocks.length === 0) this.endWave();
  }

  render(): void {
    const ctx = this.ctx;
    ctx.fillStyle = this.skinColor('space', '#030712');
    ctx.fillRect(0, 0, this.W, this.H);
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    for (let k = 0; k < 60; k++) {
      const x = ((k * 97.3) % 600) * this.u;
      const y = ((k * 151.7) % 1000) * (this.H / 1000);
      ctx.fillRect(x, y, (k % 3 === 0 ? 2 : 1) * this.u, (k % 3 === 0 ? 2 : 1) * this.u);
    }
    ctx.save();
    ctx.translate(this.shake.x, this.shake.y);
    for (const r of this.rocks) this.drawRock(r);
    ctx.fillStyle = this.skinColor('laser', '#67e8f9');
    for (const b of this.bullets) {
      ctx.beginPath();
      ctx.arc(b.x, b.y, 3.5 * this.u, 0, TAU);
      ctx.fill();
    }
    if (!(this.invulnT > 0 && Math.floor(this.invulnT * 10) % 2 === 0)) this.drawShip();
    this.particles.render(ctx);
    this.texts.render(ctx);
    ctx.restore();
    if (this.services.preview) return;
    drawStatBar(ctx, this.W, this.insets.top, this.u, [
      ['SCORE', Math.floor(this.score).toLocaleString('en-US')],
      ['WAVE', String(this.wave)],
      ['LIVES', String(Math.max(0, this.lives))],
    ]);
    if (this.waveT > 0) {
      banner(ctx, this.W, this.H, `WAVE ${this.wave + 1}`, 'Incoming', 1 - this.waveT / WAVE_SEC, '#67e8f9');
    } else if (this.wave === 1 && this.time < 3) {
      text(ctx, 'TOUCH TO AIM · THE CANNON FIRES ITSELF', this.W / 2, this.centerY() + 120 * this.u, {
        size: Math.round(18 * this.u),
        align: 'center',
      });
    }
  }

  private centerY(): number {
    const top = this.insets.top + statBarHeight(this.u);
    return top + (this.H - this.insets.bottom - top) / 2;
  }

  private startWave(n: number): void {
    this.wave = n;
    this.toSpawn = waveRocks(n).count;
    this.spawnT = 0.5;
  }

  private endWave(): void {
    this.addStat('waves');
    this.score += 200 * this.wave;
    this.coins++;
    this.waveT = WAVE_SEC;
    this.audio.play('levelup');
  }

  /** The ship turns toward a finger (or the mouse) at TURN_RATE; ← → turn it on a keyboard. Card art aims at the nearest rock. */
  private aim(dt: number): void {
    const p = this.input.pointer;
    let target: number | null = null;
    if (p.down || (p.active && !p.touch && p.inside))
      target = Math.atan2(p.y - this.centerY(), p.x - this.W / 2);
    else if (this.services.preview) {
      const near = this.nearestRock();
      if (near) target = Math.atan2(near.y - this.centerY(), near.x - this.W / 2);
    }
    const axis = this.input.axisX();
    if (axis !== 0) this.angle += axis * KEY_TURN * dt;
    else if (target !== null) {
      const diff = wrapAngle(target - this.angle);
      const step = TURN_RATE * dt;
      this.angle += Math.abs(diff) <= step ? diff : Math.sign(diff) * step;
    }
  }

  private nearestRock(): Rock | null {
    let best: Rock | null = null;
    let bestD = Infinity;
    for (const r of this.rocks) {
      const d = Math.hypot(r.x - this.W / 2, r.y - this.centerY());
      if (d < bestD) {
        bestD = d;
        best = r;
      }
    }
    return best;
  }

  /** The cannon fires on its own, twice as fast in the first wave with the head start. */
  private shoot(dt: number): void {
    this.fireT -= dt;
    if (this.fireT > 0 || this.rocks.length === 0) return;
    const fast = this.wave === 1 && this.hasBoost('head-start');
    this.fireT = FIRE_SEC * (fast ? 0.5 : 1);
    const nose = SHIP_R * this.u;
    this.bullets.push({
      x: this.W / 2 + Math.cos(this.angle) * nose,
      y: this.centerY() + Math.sin(this.angle) * nose,
      vx: Math.cos(this.angle) * BULLET_SPEED * this.u,
      vy: Math.sin(this.angle) * BULLET_SPEED * this.u,
      life: BULLET_LIFE,
    });
    this.audio.play('laser', { volume: 0.25 });
  }

  private moveBullets(dt: number): void {
    for (const b of this.bullets) {
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.life -= dt;
    }
    this.bullets = this.bullets.filter((b) => b.life > 0);
  }

  /** Big rocks drift in from just off the screen's edge toward a point near the ship. */
  private spawn(dt: number): void {
    if (this.toSpawn <= 0 || this.waveT > 0) return;
    this.spawnT -= dt;
    if (this.spawnT > 0) return;
    const spec = waveRocks(this.wave);
    this.spawnT = spec.gap * this.rng.range(0.7, 1.3);
    this.toSpawn--;
    const a = this.rng.range(0, TAU);
    const far = Math.hypot(this.W, this.H) * 0.55;
    const x = this.W / 2 + Math.cos(a) * far;
    const y = this.centerY() + Math.sin(a) * far;
    const tx = this.W / 2 + this.rng.range(-120, 120) * this.u;
    const ty = this.centerY() + this.rng.range(-120, 120) * this.u;
    const d = Math.hypot(tx - x, ty - y) || 1;
    const v = spec.speed * this.u * this.rng.range(0.85, 1.15);
    this.rocks.push(this.makeRock(3, x, y, ((tx - x) / d) * v, ((ty - y) / d) * v));
  }

  private makeRock(size: number, x: number, y: number, vx: number, vy: number): Rock {
    return {
      size,
      x,
      y,
      vx,
      vy,
      spin: this.rng.range(-1.5, 1.5),
      angle: this.rng.range(0, TAU),
      shape: Array.from({ length: 10 }, () => this.rng.range(0.75, 1.1)),
    };
  }

  private collide(): void {
    const born: Rock[] = [];
    for (const b of this.bullets) {
      const hit = this.rocks.find((r) => Math.hypot(r.x - b.x, r.y - b.y) < (ROCK[r.size]?.r ?? 20) * this.u);
      if (!hit) continue;
      b.life = 0;
      this.rocks = this.rocks.filter((r) => r !== hit);
      const points = ROCK[hit.size]?.points ?? 20;
      this.score += points;
      this.addStat('rocks');
      if (this.stats['rocks'] && this.stats['rocks'] % 25 === 0) this.coins++;
      this.particles.emit({
        x: hit.x,
        y: hit.y,
        count: 6 + hit.size * 4,
        speed: 150 * this.u,
        life: 0.5,
        size: 3,
        colors: [this.skinColor('rock', '#a8a29e'), '#e7e5e4'],
      });
      this.audio.play(hit.size === 1 ? 'pop' : 'explode', { volume: 0.4 });
      for (const s of splitRock(hit.size, hit.x, hit.y, hit.vx, hit.vy, 1.35))
        born.push(this.makeRock(s.size, s.x, s.y, s.vx, s.vy));
    }
    this.bullets = this.bullets.filter((b) => b.life > 0);
    this.rocks.push(...born);
    if (this.invulnT > 0) return;
    const cy = this.centerY();
    const crash = this.rocks.find(
      (r) => Math.hypot(r.x - this.W / 2, r.y - cy) < ((ROCK[r.size]?.r ?? 20) + SHIP_R * 0.8) * this.u,
    );
    if (crash) this.hurt();
  }

  /** A rock hit the ship: a life lost, and the rocks close by are blown away. */
  private hurt(): void {
    this.lives--;
    this.invulnT = INVULN_SEC;
    this.shake.add(0.6);
    this.audio.play('hit');
    this.services.haptic(140);
    const cy = this.centerY();
    this.rocks = this.rocks.filter((r) => Math.hypot(r.x - this.W / 2, r.y - cy) > CLEAR_R * this.u);
    this.particles.emit({
      x: this.W / 2,
      y: cy,
      count: 30,
      speed: 260 * this.u,
      life: 0.8,
      size: 4,
      colors: [this.skinColor('ship', '#e2e8f0'), '#f97316', '#fde047'],
    });
    if (this.lives <= 0) this.endGame(1.4);
  }

  private drawRock(r: Rock): void {
    const ctx = this.ctx;
    const rad = (ROCK[r.size]?.r ?? 20) * this.u;
    ctx.save();
    ctx.translate(r.x, r.y);
    ctx.rotate(r.angle);
    ctx.beginPath();
    r.shape.forEach((k, i) => {
      const a = (i / r.shape.length) * TAU;
      ctx.lineTo(Math.cos(a) * rad * k, Math.sin(a) * rad * k);
    });
    ctx.closePath();
    ctx.fillStyle = this.skinColor('rockFill', '#292524');
    ctx.fill();
    ctx.strokeStyle = this.skinColor('rock', '#a8a29e');
    ctx.lineWidth = 2.5 * this.u;
    ctx.stroke();
    ctx.restore();
  }

  private drawShip(): void {
    const ctx = this.ctx;
    const r = SHIP_R * this.u;
    ctx.save();
    ctx.translate(this.W / 2, this.centerY());
    ctx.rotate(this.angle);
    ctx.fillStyle = this.skinColor('ship', '#e2e8f0');
    ctx.beginPath();
    ctx.moveTo(r * 1.3, 0);
    ctx.lineTo(-r, r * 0.8);
    ctx.lineTo(-r * 0.5, 0);
    ctx.lineTo(-r, -r * 0.8);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = this.skinColor('laser', '#67e8f9');
    ctx.beginPath();
    ctx.arc(r * 0.2, 0, r * 0.25, 0, TAU);
    ctx.fill();
    ctx.restore();
  }
}
