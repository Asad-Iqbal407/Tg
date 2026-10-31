import { TAU } from '../../core/math';
import { BaseGame } from '../base';
import { banner, fillRoundRect, text } from '../draw';
import { drawStatBar, statBarHeight } from '../statbar';
import type { GameServices } from '../types';

const DESIGN_W = 600;
const CITIES = 6;
const AMMO = 26;
const HEAD_START_AMMO = 10;
const INTERCEPT_SPEED = 950;
const BLAST_R = 66;
const GROW_SEC = 0.3;
const HOLD_SEC = 0.35;
const FADE_SEC = 0.4;
const MISSILE_POINTS = 25;
const CITY_POINTS = 100;
const AMMO_POINTS = 5;
const WAVE_SEC = 2;
const KEY_AIM = 700;
const SPLIT_FROM = 3;

/** Missiles in wave n, how fast they fall (design px/s) and the gap between launches (s). */
export function waveSpec(n: number): { count: number; speed: number; gap: number } {
  return {
    count: 7 + 2 * n,
    speed: Math.min(230, 50 + 12 * n),
    gap: Math.max(0.4, 1.3 - 0.07 * n),
  };
}

/** How big a blast is `age` seconds after it goes off: it grows, holds, then shrinks away. */
export function blastRadius(age: number, max: number): number {
  if (age < GROW_SEC) return (age / GROW_SEC) * max;
  if (age < GROW_SEC + HOLD_SEC) return max;
  const t = (age - GROW_SEC - HOLD_SEC) / FADE_SEC;
  return t >= 1 ? 0 : max * (1 - t);
}

interface Missile {
  x0: number;
  y0: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  target: number;
  /** Seconds until it splits in two (0 for never). */
  split: number;
}

interface Shot {
  x: number;
  y: number;
  tx: number;
  ty: number;
}

interface Blast {
  x: number;
  y: number;
  age: number;
  /** Blasts set off by the player score; a missile hitting the ground does not. */
  ours: boolean;
}

/** Missile Command: tap the sky to burst your interceptors in the path of falling missiles. Save your cities. */
export class MissileGame extends BaseGame {
  private readonly u: number;
  private cities: boolean[] = Array<boolean>(CITIES).fill(true);
  private missiles: Missile[] = [];
  private shots: Shot[] = [];
  private blasts: Blast[] = [];
  private wave = 0;
  private toLaunch = 0;
  private launchT = 0;
  private ammo = 0;
  private waveT = 0;
  private shield = false;
  private aimX: number;
  private aimY: number;
  private keyboard = false;
  private previewT = 0;

  constructor(services: GameServices) {
    super(services);
    this.u = this.W / DESIGN_W;
    this.shield = this.hasBoost('shield');
    this.aimX = this.W / 2;
    this.aimY = this.H * 0.4;
    for (const key of ['missiles', 'waves']) this.addStat(key, 0);
    this.startWave(1);
  }

  protected tick(dt: number): void {
    for (const b of this.blasts) b.age += dt;
    this.blasts = this.blasts.filter((b) => b.age < GROW_SEC + HOLD_SEC + FADE_SEC);
    if (this.isEnding) return;
    if (this.waveT > 0) {
      this.waveT -= dt;
      if (this.waveT <= 0) this.startWave(this.wave + 1);
      return;
    }
    this.launch(dt);
    this.readFire(dt);
    this.moveShots(dt);
    this.moveMissiles(dt);
    this.checkBlasts();
    if (this.toLaunch === 0 && this.missiles.length === 0 && this.shots.length === 0) this.endWave();
  }

  render(): void {
    const ctx = this.ctx;
    const g = ctx.createLinearGradient(0, 0, 0, this.H);
    g.addColorStop(0, this.skinColor('sky1', '#020617'));
    g.addColorStop(1, this.skinColor('sky2', '#1e1b4b'));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.W, this.H);
    const ground = this.groundY();
    ctx.save();
    ctx.translate(this.shake.x, this.shake.y);
    ctx.fillStyle = this.skinColor('ground', '#854d0e');
    ctx.fillRect(0, ground, this.W, this.H - ground);
    for (let i = 0; i < CITIES; i++) this.drawCity(i, ground);
    this.drawBase(ground);
    ctx.lineWidth = 2 * this.u;
    for (const m of this.missiles) {
      ctx.strokeStyle = this.skinColor('trail', 'rgba(248,113,113,0.8)');
      ctx.beginPath();
      ctx.moveTo(m.x0, m.y0);
      ctx.lineTo(m.x, m.y);
      ctx.stroke();
      ctx.fillStyle = '#fef2f2';
      ctx.fillRect(m.x - 2 * this.u, m.y - 2 * this.u, 4 * this.u, 4 * this.u);
    }
    const [bx, by] = this.basePos();
    for (const s of this.shots) {
      ctx.strokeStyle = this.skinColor('shot', 'rgba(125,211,252,0.85)');
      ctx.beginPath();
      ctx.moveTo(bx, by);
      ctx.lineTo(s.x, s.y);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(125,211,252,0.6)';
      ctx.beginPath();
      ctx.moveTo(s.tx - 6 * this.u, s.ty - 6 * this.u);
      ctx.lineTo(s.tx + 6 * this.u, s.ty + 6 * this.u);
      ctx.moveTo(s.tx + 6 * this.u, s.ty - 6 * this.u);
      ctx.lineTo(s.tx - 6 * this.u, s.ty + 6 * this.u);
      ctx.stroke();
    }
    for (const b of this.blasts) {
      const r = blastRadius(b.age, BLAST_R * this.u);
      const flick = Math.floor(b.age * 20) % 3;
      ctx.fillStyle = b.ours ? (['#fde047', '#f97316', '#ffffff'][flick] ?? '#fde047') : '#ef4444';
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      ctx.arc(b.x, b.y, r, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    if (this.keyboard) {
      ctx.strokeStyle = '#7dd3fc';
      ctx.lineWidth = 2 * this.u;
      ctx.beginPath();
      ctx.arc(this.aimX, this.aimY, 14 * this.u, 0, TAU);
      ctx.moveTo(this.aimX - 20 * this.u, this.aimY);
      ctx.lineTo(this.aimX + 20 * this.u, this.aimY);
      ctx.moveTo(this.aimX, this.aimY - 20 * this.u);
      ctx.lineTo(this.aimX, this.aimY + 20 * this.u);
      ctx.stroke();
    }
    this.particles.render(ctx);
    this.texts.render(ctx);
    ctx.restore();
    if (this.services.preview) return;
    drawStatBar(ctx, this.W, this.insets.top, this.u, [
      ['SCORE', Math.floor(this.score).toLocaleString('en-US')],
      ['WAVE', String(this.wave)],
      ['AMMO', String(this.ammo)],
    ]);
    if (this.waveT > 0) {
      banner(
        ctx,
        this.W,
        this.H,
        `WAVE ${this.wave} CLEAR`,
        `${this.cities.filter(Boolean).length} cities saved`,
        1 - this.waveT / WAVE_SEC,
        '#7dd3fc',
      );
    } else if (this.wave === 1 && this.ammo === this.waveAmmo() && this.missiles.length < 3) {
      text(ctx, 'TAP THE SKY TO FIRE', this.W / 2, this.H * 0.45, {
        size: Math.round(26 * this.u),
        align: 'center',
      });
    }
  }

  private groundY(): number {
    return this.H - this.insets.bottom - 70 * this.u;
  }

  private basePos(): [number, number] {
    return [this.W / 2, this.groundY() - 22 * this.u];
  }

  /** x of city i: three on each side of the launcher. */
  private cityX(i: number): number {
    const slot = i < 3 ? i : i + 1;
    return ((slot + 0.5) / 7) * this.W;
  }

  private waveAmmo(): number {
    return AMMO + (this.hasBoost('head-start') ? HEAD_START_AMMO : 0);
  }

  private startWave(n: number): void {
    this.wave = n;
    const spec = waveSpec(n);
    this.toLaunch = spec.count;
    this.launchT = 1;
    this.ammo = this.waveAmmo();
  }

  private launch(dt: number): void {
    if (this.toLaunch <= 0) return;
    this.launchT -= dt;
    if (this.launchT > 0) return;
    const spec = waveSpec(this.wave);
    this.launchT = spec.gap * this.rng.range(0.6, 1.4);
    this.toLaunch--;
    const top = this.insets.top + statBarHeight(this.u);
    this.fire(this.rng.range(0, this.W), top, spec.speed, this.wave >= SPLIT_FROM && this.rng.chance(0.25));
  }

  /** A missile from (x, y) at a random standing city (or the launcher, once the cities are gone). */
  private fire(x: number, y: number, speed: number, splits: boolean): void {
    const alive = this.cities.map((c, i) => (c ? i : -1)).filter((i) => i >= 0);
    const target = alive.length > 0 ? this.rng.pick(alive) : -1;
    const tx = target >= 0 ? this.cityX(target) : this.W / 2;
    const ty = this.groundY();
    const d = Math.hypot(tx - x, ty - y) || 1;
    const v = speed * this.u;
    this.missiles.push({
      x0: x,
      y0: y,
      x,
      y,
      vx: ((tx - x) / d) * v,
      vy: ((ty - y) / d) * v,
      target,
      split: splits ? this.rng.range(1.5, 3) : 0,
    });
  }

  /** A tap (or Space at the crosshair) sends an interceptor to that point, while there is ammo left. */
  private readFire(dt: number): void {
    const p = this.input.pointer;
    let at: [number, number] | null = null;
    if (p.pressed) {
      this.keyboard = false;
      at = [p.x, p.y];
    } else {
      const ax = this.input.axisX();
      const ay = this.input.axisY();
      if (ax || ay) this.keyboard = true;
      this.aimX = Math.max(0, Math.min(this.W, this.aimX + ax * KEY_AIM * this.u * dt));
      this.aimY = Math.max(0, Math.min(this.groundY() - 40 * this.u, this.aimY + ay * KEY_AIM * this.u * dt));
      if (this.input.wasPressed('primary')) {
        this.keyboard = true;
        at = [this.aimX, this.aimY];
      }
    }
    if (this.services.preview) {
      this.previewT += dt;
      const m = this.missiles[0];
      if (this.previewT > 0.7 && m) {
        this.previewT = 0;
        at = [m.x + m.vx * 0.6, m.y + m.vy * 0.6];
      }
    }
    if (!at || this.ammo <= 0) {
      if (at) this.audio.play('empty');
      return;
    }
    if (at[1] > this.groundY() - 20 * this.u) return;
    this.ammo--;
    const [bx, by] = this.basePos();
    this.shots.push({ x: bx, y: by, tx: at[0], ty: at[1] });
    this.audio.play('laser', { volume: 0.4 });
  }

  private moveShots(dt: number): void {
    const keep: Shot[] = [];
    for (const s of this.shots) {
      const dx = s.tx - s.x;
      const dy = s.ty - s.y;
      const d = Math.hypot(dx, dy);
      const step = INTERCEPT_SPEED * this.u * dt;
      if (d <= step) {
        this.blasts.push({ x: s.tx, y: s.ty, age: 0, ours: true });
        this.audio.play('explode', { volume: 0.5 });
      } else {
        s.x += (dx / d) * step;
        s.y += (dy / d) * step;
        keep.push(s);
      }
    }
    this.shots = keep;
  }

  private moveMissiles(dt: number): void {
    const ground = this.groundY();
    const keep: Missile[] = [];
    const born: [number, number, number][] = [];
    for (const m of this.missiles) {
      m.x += m.vx * dt;
      m.y += m.vy * dt;
      if (m.split > 0) {
        m.split -= dt;
        if (m.split <= 0) born.push([m.x, m.y, Math.hypot(m.vx, m.vy) / this.u]);
      }
      if (m.y >= ground) this.impact(m);
      else keep.push(m);
    }
    this.missiles = keep;
    // A splitting missile fires one more from where it is.
    for (const [x, y, sp] of born) this.fire(x, y, sp, false);
  }

  /** A missile reached the ground. It flattens its city, unless the shield takes the first hit. */
  private impact(m: Missile): void {
    this.blasts.push({ x: m.x, y: this.groundY(), age: 0, ours: false });
    this.shake.add(0.4);
    this.audio.play('bomb', { volume: 0.7 });
    if (m.target < 0 || !this.cities[m.target]) return;
    if (this.shield) {
      this.shield = false;
      this.texts.add(m.x, this.groundY() - 60 * this.u, 'SHIELD', '#67e8f9', 24 * this.u, 1.1);
      this.audio.play('powerup');
      return;
    }
    this.cities[m.target] = false;
    this.services.haptic(120);
    this.particles.emit({
      x: this.cityX(m.target),
      y: this.groundY() - 10 * this.u,
      count: 30,
      speed: 220 * this.u,
      life: 0.9,
      size: 4,
      gravity: 400 * this.u,
      colors: ['#f97316', '#fde047', '#64748b'],
    });
    if (this.cities.every((c) => !c)) this.endGame(1.8);
  }

  /** Every missile inside one of our blasts is destroyed, and goes off in a blast of its own. */
  private checkBlasts(): void {
    const keep: Missile[] = [];
    for (const m of this.missiles) {
      const hit = this.blasts.some(
        (b) => b.ours && Math.hypot(m.x - b.x, m.y - b.y) < blastRadius(b.age, BLAST_R * this.u),
      );
      if (!hit) {
        keep.push(m);
        continue;
      }
      this.score += MISSILE_POINTS * Math.max(1, Math.floor(this.wave / 2));
      this.addStat('missiles');
      this.blasts.push({ x: m.x, y: m.y, age: GROW_SEC * 0.5, ours: true });
      this.texts.add(
        m.x,
        m.y - 20 * this.u,
        `+${MISSILE_POINTS * Math.max(1, Math.floor(this.wave / 2))}`,
        '#fde047',
        16 * this.u,
        0.6,
      );
    }
    this.missiles = keep;
  }

  private endWave(): void {
    const saved = this.cities.filter(Boolean).length;
    this.score += saved * CITY_POINTS + this.ammo * AMMO_POINTS;
    this.coins++;
    this.addStat('waves');
    this.waveT = WAVE_SEC;
    this.audio.play('levelup');
  }

  private drawCity(i: number, ground: number): void {
    const ctx = this.ctx;
    const x = this.cityX(i);
    const u = this.u;
    if (!this.cities[i]) {
      ctx.fillStyle = '#44403c';
      ctx.fillRect(x - 24 * u, ground - 8 * u, 48 * u, 8 * u);
      return;
    }
    ctx.fillStyle = this.skinColor('city', '#38bdf8');
    const heights = [26, 40, 32, 46, 28];
    heights.forEach((h, k) => ctx.fillRect(x - 25 * u + k * 10 * u, ground - h * u, 9 * u, h * u));
    ctx.fillStyle = '#fef9c3';
    for (let k = 0; k < 5; k++) ctx.fillRect(x - 22 * u + k * 10 * u, ground - 18 * u, 3 * u, 3 * u);
  }

  private drawBase(ground: number): void {
    const ctx = this.ctx;
    const u = this.u;
    const x = this.W / 2;
    ctx.fillStyle = this.skinColor('base', '#a8a29e');
    ctx.beginPath();
    ctx.moveTo(x - 40 * u, ground);
    ctx.lineTo(x - 20 * u, ground - 26 * u);
    ctx.lineTo(x + 20 * u, ground - 26 * u);
    ctx.lineTo(x + 40 * u, ground);
    ctx.fill();
    fillRoundRect(ctx, x - 4 * u, ground - 42 * u, 8 * u, 18 * u, 3 * u, '#e7e5e4');
  }
}
