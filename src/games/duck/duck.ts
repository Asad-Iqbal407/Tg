import { clamp, TAU } from '../../core/math';
import { BaseGame } from '../base';
import { banner, fillRoundRect, hash1, hudPill, progressBar, text } from '../draw';
import type { GameServices } from '../types';

type DuckKind = 'green' | 'blue' | 'red' | 'gold';
type PowerKind = 'slowmo' | 'scatter' | 'ammo';
type Phase = 'intro' | 'wave' | 'waveEnd' | 'roundEnd' | 'over';

interface Duck {
  kind: DuckKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  speed: number;
  state: 'fly' | 'hit' | 'fall' | 'escape' | 'gone';
  t: number;
  turnT: number;
  flap: number;
}

interface Crate {
  kind: PowerKind;
  x: number;
  y: number;
  vy: number;
  alive: boolean;
}

interface Hole {
  x: number;
  y: number;
  life: number;
}

const DUCK_INFO: Record<
  DuckKind,
  { speed: number; points: number; head: string; body: string; wing: string; belly: string }
> = {
  green: { speed: 190, points: 500, head: '#1a7f3c', body: '#7a4e2a', wing: '#c8a165', belly: '#e8d5b0' },
  blue: { speed: 250, points: 1000, head: '#2a6fdb', body: '#3d3d7a', wing: '#8fa9e8', belly: '#d5dcf0' },
  red: { speed: 310, points: 1500, head: '#c0392b', body: '#5a2d0c', wing: '#e58e6d', belly: '#f2d0b5' },
  gold: { speed: 340, points: 3000, head: '#ffd23f', body: '#e0a100', wing: '#fff1a8', belly: '#fff6d0' },
};

const POWER_INFO: Record<PowerKind, { label: string; color: string; dur: number }> = {
  slowmo: { label: 'SLOW-MO', color: '#4dd9ff', dur: 6 },
  scatter: { label: 'SCATTER SHOT', color: '#ffb703', dur: 9 },
  ammo: { label: '+3 SHELLS', color: '#7CFC00', dur: 0 },
};

const SKIES = [
  ['#7ec8ff', '#d6f0ff'],
  ['#5aa9f0', '#bfe3ff'],
  ['#ff8e72', '#ffd59e'],
  ['#1b2a5a', '#4b3f7a'],
] as const;

const GRASS_TOP = 400;
const DUCKS_PER_ROUND = 10;
const DUCKS_PER_WAVE = 2;
const SHOTS_PER_WAVE = 3;

export class DuckGame extends BaseGame {
  private round = 1;
  private phase: Phase = 'intro';
  private phaseT = 0;
  private ducks: Duck[] = [];
  private crates: Crate[] = [];
  private holes: Hole[] = [];
  private results: ('hit' | 'miss' | 'pending')[] = [];
  private waveIndex = 0;
  private shots = SHOTS_PER_WAVE;
  private waveT = 0;
  private combo = 0;
  private flash = 0;
  private escapeFlash = 0;
  private aimX: number;
  private aimY: number;
  private readonly powers: Record<PowerKind, number> = { slowmo: 0, scatter: 0, ammo: 0 };
  private guardian: boolean;
  private dogX = 480;
  private dogMode: 'none' | 'happy' | 'laugh' = 'none';
  private dogCount = 0;
  private readonly clouds: { x: number; y: number; s: number }[] = [];
  private headStartRound: boolean;

  constructor(s: GameServices) {
    super(s);
    this.aimX = this.W / 2;
    this.aimY = this.H / 2.5;
    this.guardian = this.hasBoost('shield');
    this.headStartRound = this.hasBoost('head-start');
    for (let i = 0; i < 6; i++)
      this.clouds.push({
        x: this.rng.range(0, this.W),
        y: this.rng.range(30, 200),
        s: this.rng.range(0.6, 1.3),
      });
    this.startRound();
  }

  private get roundSpeed(): number {
    return 1 + Math.min(1.2, (this.round - 1) * 0.08);
  }

  private get required(): number {
    return this.round <= 3 ? 6 : this.round <= 6 ? 7 : this.round <= 9 ? 8 : 9;
  }

  private get flyTime(): number {
    return Math.max(4.2, 7 - this.round * 0.25);
  }

  private startRound(): void {
    this.phase = 'intro';
    this.phaseT = 0;
    this.waveIndex = 0;
    this.results = Array.from({ length: DUCKS_PER_ROUND }, () => 'pending' as const);
    this.ducks = [];
    if (this.headStartRound) this.powers.scatter = 999;
  }

  private startWave(): void {
    this.phase = 'wave';
    this.phaseT = 0;
    this.waveT = 0;
    this.shots = SHOTS_PER_WAVE;
    this.ducks = [];
    for (let i = 0; i < DUCKS_PER_WAVE; i++) this.ducks.push(this.makeDuck());
    if (this.rng.chance(0.2)) {
      const kind = this.rng.pick<PowerKind>(['slowmo', 'scatter', 'ammo']);
      this.crates.push({
        kind,
        x: this.rng.range(120, this.W - 120),
        y: GRASS_TOP + 40,
        vy: -this.rng.range(55, 80),
        alive: true,
      });
    }
    this.audio.play('quack');
  }

  private makeDuck(): Duck {
    const r = this.rng.next();
    const rr = this.round;
    let kind: DuckKind = 'green';
    if (r < 0.04 + rr * 0.004) kind = 'gold';
    else if (r < 0.2 + rr * 0.03) kind = 'red';
    else if (r < 0.5 + rr * 0.03) kind = 'blue';
    const speed = DUCK_INFO[kind].speed * this.roundSpeed;
    const angle = -Math.PI / 2 + this.rng.range(-0.9, 0.9);
    return {
      kind,
      x: this.rng.range(140, this.W - 140),
      y: GRASS_TOP + 30,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      speed,
      state: 'fly',
      t: 0,
      turnT: this.rng.range(0.6, 1.4),
      flap: this.rng.next() * TAU,
    };
  }

  // ------------------------------------------------------------------ update

  protected tick(dt: number): void {
    this.phaseT += dt;
    this.flash = Math.max(0, this.flash - dt);
    this.escapeFlash = Math.max(0, this.escapeFlash - dt);
    for (const k of ['slowmo', 'scatter'] as const) this.powers[k] = Math.max(0, this.powers[k] - dt);
    for (const c of this.clouds) {
      c.x += 8 * c.s * dt;
      if (c.x > this.W + 120) c.x = -160;
    }
    for (const h of this.holes) h.life -= dt;
    this.holes = this.holes.filter((h) => h.life > 0);
    this.updateAim(dt);

    const slow = this.powers.slowmo > 0 ? 0.45 : 1;
    this.updateDucks(dt * slow);
    this.updateCrates(dt);

    switch (this.phase) {
      case 'intro':
        if (this.phaseT > 1.8) this.startWave();
        break;
      case 'wave':
        this.waveT += dt * slow;
        if (this.input.pointer.pressed || this.input.wasPressed('primary')) this.shoot();
        this.checkWaveEnd();
        break;
      case 'waveEnd':
        if (this.phaseT > 1.5) {
          this.dogMode = 'none';
          if ((this.waveIndex + 1) * DUCKS_PER_WAVE >= DUCKS_PER_ROUND) this.endRound();
          else {
            this.waveIndex++;
            this.startWave();
          }
        }
        break;
      case 'roundEnd':
        if (this.phaseT > 2.8) this.afterRound();
        break;
      case 'over':
        break;
    }
  }

  private updateAim(dt: number): void {
    const ptr = this.input.pointer;
    if (ptr.active) {
      this.aimX = ptr.x;
      this.aimY = ptr.y;
    }
    const ax = this.input.axisX();
    const ay = this.input.axisY();
    if (ax !== 0 || ay !== 0) {
      ptr.active = false;
      this.aimX += ax * 620 * dt;
      this.aimY += ay * 620 * dt;
    }
    this.aimX = clamp(this.aimX, 0, this.W);
    this.aimY = clamp(this.aimY, 0, this.H);
  }

  private shoot(): void {
    if (this.shots <= 0) {
      this.audio.play('empty');
      return;
    }
    this.shots--;
    this.addStat('shots');
    this.audio.play('gun');
    this.flash = 0.06;
    this.shake.add(0.18);
    this.services.haptic(25);
    this.holes.push({ x: this.aimX, y: this.aimY, life: 0.4 });
    const radius = this.powers.scatter > 0 ? 62 : 36;
    let hits = 0;
    for (const crate of this.crates) {
      if (crate.alive && Math.hypot(crate.x - this.aimX, crate.y - this.aimY) < radius + 18) {
        crate.alive = false;
        this.activatePower(crate.kind);
        this.particles.emit({
          x: crate.x,
          y: crate.y,
          count: 18,
          speed: 220,
          life: 0.6,
          size: 4,
          colors: ['#c58b4a', '#fff', POWER_INFO[crate.kind].color],
          shape: 'square',
          gravity: 400,
        });
      }
    }
    for (const d of this.ducks) {
      if (d.state !== 'fly') continue;
      if (Math.hypot(d.x - this.aimX, d.y - this.aimY) < radius) {
        hits++;
        this.hitDuck(d);
      }
    }
    if (hits === 0) {
      this.combo = 0;
    } else if (hits > 1) {
      this.addStat('doubleKills');
      this.score += 2000;
      this.texts.add(this.aimX, this.aimY - 50, 'DOUBLE! +2000', '#ffd23f', 26);
    }
  }

  private hitDuck(d: Duck): void {
    d.state = 'hit';
    d.t = 0;
    this.combo++;
    const mult = Math.min(5, 1 + Math.floor(this.combo / 3));
    const pts = Math.round(DUCK_INFO[d.kind].points * (1 + (this.round - 1) * 0.1)) * mult;
    this.score += pts;
    this.addStat('ducks');
    this.addStat('hits');
    if (d.kind === 'gold') {
      this.coins += 5;
      this.addStat('goldenDucks');
      this.audio.play('reward');
    } else {
      this.coins += 1;
    }
    this.audio.play('quack', { pitch: 1.4 });
    const idx = this.results.indexOf('pending');
    if (idx >= 0) this.results[idx] = 'hit';
    this.texts.add(
      d.x,
      d.y - 30,
      mult > 1 ? `${pts} x${mult}` : `${pts}`,
      d.kind === 'gold' ? '#ffd23f' : '#fff',
      22,
    );
    this.particles.emit({
      x: d.x,
      y: d.y,
      count: 14,
      speed: 200,
      life: 1.1,
      size: 4,
      colors: [DUCK_INFO[d.kind].wing, DUCK_INFO[d.kind].belly, '#fff'],
      gravity: 120,
      drag: 2.5,
      shape: 'square',
    });
    this.dogX = d.x;
  }

  private activatePower(kind: PowerKind): void {
    this.audio.play('powerup');
    this.addStat('powerups');
    this.texts.add(this.W / 2, 200, POWER_INFO[kind].label, POWER_INFO[kind].color, 30);
    if (kind === 'ammo') this.shots += 3;
    else this.powers[kind] = POWER_INFO[kind].dur;
  }

  private updateDucks(dt: number): void {
    for (const d of this.ducks) {
      d.t += dt;
      d.flap += dt * (d.state === 'fly' ? 14 : 22);
      if (d.state === 'fly') {
        d.turnT -= dt;
        const emerging = d.y > GRASS_TOP - 40 && d.t < 1.2;
        if (d.turnT <= 0 && !emerging) {
          d.turnT = this.rng.range(0.5, 1.4) / (d.kind === 'gold' ? 1.8 : 1);
          const a = Math.atan2(d.vy, d.vx) + this.rng.range(-1.4, 1.4);
          d.vx = Math.cos(a) * d.speed;
          d.vy = Math.sin(a) * d.speed;
        }
        d.x += d.vx * dt;
        d.y += d.vy * dt;
        if (d.x < 30 && d.vx < 0) d.vx = -d.vx;
        if (d.x > this.W - 30 && d.vx > 0) d.vx = -d.vx;
        if (d.y < 40 && d.vy < 0) d.vy = -d.vy;
        if (!emerging && d.y > GRASS_TOP - 50 && d.vy > 0) d.vy = -Math.abs(d.vy);
        if (d.t > 0.8 && d.t % 1.5 < dt) this.audio.play('quack', { volume: 0.4 });
      } else if (d.state === 'hit') {
        if (d.t > 0.4) {
          d.state = 'fall';
          d.vy = 0;
          d.t = 0;
        }
      } else if (d.state === 'fall') {
        d.vy = Math.min(700, d.vy + 1400 * dt);
        d.y += d.vy * dt;
        if (d.y > GRASS_TOP + 40) {
          d.state = 'gone';
          this.audio.play('land');
        }
      } else if (d.state === 'escape') {
        d.vy = -420;
        d.vx *= 0.98;
        d.x += d.vx * dt;
        d.y += d.vy * dt;
        if (d.y < -80) d.state = 'gone';
      }
    }
  }

  private updateCrates(dt: number): void {
    for (const c of this.crates) {
      c.y += c.vy * dt;
      if (c.y < -60) c.alive = false;
    }
    this.crates = this.crates.filter((c) => c.alive);
  }

  private checkWaveEnd(): void {
    const flying = this.ducks.filter((d) => d.state === 'fly');
    const busy = this.ducks.some((d) => d.state === 'hit' || d.state === 'fall' || d.state === 'escape');
    if (flying.length > 0 && (this.waveT > this.flyTime || (this.shots <= 0 && !busy && this.waveT > 0.3))) {
      for (const d of flying) {
        d.state = 'escape';
        const idx = this.results.indexOf('pending');
        if (idx >= 0) this.results[idx] = 'miss';
      }
      this.combo = 0;
      this.escapeFlash = 1.2;
      this.audio.play('whoosh');
      return;
    }
    if (this.ducks.every((d) => d.state === 'gone')) {
      const hitCount = this.ducks.filter((d) => d.y > GRASS_TOP).length;
      this.dogCount = hitCount;
      this.dogMode = hitCount > 0 ? 'happy' : 'laugh';
      this.phase = 'waveEnd';
      this.phaseT = 0;
      if (hitCount === 0) this.audio.play('error');
      else this.audio.play('select');
    }
  }

  private endRound(): void {
    this.phase = 'roundEnd';
    this.phaseT = 0;
    const hits = this.results.filter((r) => r === 'hit').length;
    if (hits >= this.required) {
      this.audio.play('win');
      if (hits === DUCKS_PER_ROUND) {
        this.score += 10000;
        this.coins += 10;
        this.addStat('perfectRounds');
        this.texts.add(this.W / 2, 300, 'PERFECT! +10000', '#ffd23f', 34);
      }
    } else {
      this.audio.play('gameover');
    }
  }

  private afterRound(): void {
    const hits = this.results.filter((r) => r === 'hit').length;
    this.headStartRound = false;
    if (this.powers.scatter > 100) this.powers.scatter = 0;
    if (hits >= this.required) {
      this.addStat('rounds');
      this.maxStat('bestRound', this.round);
      this.round++;
      this.startRound();
    } else if (this.guardian) {
      this.guardian = false;
      this.texts.add(this.W / 2, 240, 'GUARDIAN: ROUND RETRY', '#7cf', 30);
      this.audio.play('powerup');
      this.startRound();
    } else {
      this.phase = 'over';
      this.dogMode = 'laugh';
      this.endGame(2.2, false);
    }
  }

  // ------------------------------------------------------------------ render

  render(): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(this.shake.x, this.shake.y);
    this.drawSky();
    for (const c of this.crates) this.drawCrate(c);
    for (const d of this.ducks) if (d.state !== 'gone') this.drawDuck(d);
    this.drawDog();
    this.drawForeground();
    this.particles.render(ctx);
    for (const h of this.holes) {
      ctx.globalAlpha = h.life / 0.4;
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(h.x, h.y, (1 - h.life / 0.4) * 40 + 6, 0, TAU);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    this.texts.render(ctx);
    ctx.restore();
    if (this.flash > 0 && !this.services.reducedMotion) {
      ctx.fillStyle = `rgba(255,255,255,${this.flash * 4})`;
      ctx.fillRect(0, 0, this.W, this.H);
    }
    this.drawHud();
    this.drawCrosshair();
  }

  private drawSky(): void {
    const ctx = this.ctx;
    const sky = SKIES[(this.round - 1) % SKIES.length] ?? SKIES[0];
    const g = ctx.createLinearGradient(0, 0, 0, GRASS_TOP);
    g.addColorStop(0, sky[0]);
    g.addColorStop(1, sky[1]);
    ctx.fillStyle = g;
    ctx.fillRect(-20, -20, this.W + 40, this.H + 40);
    if (this.escapeFlash > 0) {
      ctx.fillStyle = `rgba(255,140,180,${Math.min(0.45, this.escapeFlash * 0.5)})`;
      ctx.fillRect(-20, -20, this.W + 40, this.H + 40);
    }
    const night = (this.round - 1) % SKIES.length === 3;
    if (night) {
      ctx.fillStyle = '#f5f3ce';
      ctx.beginPath();
      ctx.arc(800, 90, 34, 0, TAU);
      ctx.fill();
      ctx.fillStyle = '#fff';
      for (let i = 0; i < 50; i++) ctx.fillRect(hash1(i) * this.W, hash1(i + 7) * 300, 2, 2);
    } else {
      const sg = ctx.createRadialGradient(820, 90, 10, 820, 90, 90);
      sg.addColorStop(0, 'rgba(255,250,210,0.95)');
      sg.addColorStop(1, 'rgba(255,250,210,0)');
      ctx.fillStyle = sg;
      ctx.fillRect(700, 0, 260, 200);
    }
    for (const c of this.clouds) {
      ctx.fillStyle = night ? 'rgba(180,180,220,0.18)' : 'rgba(255,255,255,0.85)';
      ctx.beginPath();
      ctx.ellipse(c.x, c.y, 60 * c.s, 20 * c.s, 0, 0, TAU);
      ctx.ellipse(c.x + 40 * c.s, c.y - 12 * c.s, 40 * c.s, 22 * c.s, 0, 0, TAU);
      ctx.fill();
    }
    // Distant tree line
    ctx.fillStyle = night ? '#1d2b3a' : '#4f8f5a';
    ctx.beginPath();
    ctx.moveTo(0, GRASS_TOP);
    for (let x = 0; x <= this.W; x += 24) ctx.lineTo(x, GRASS_TOP - 40 - hash1(x * 0.37) * 40);
    ctx.lineTo(this.W, GRASS_TOP);
    ctx.fill();
  }

  private drawForeground(): void {
    const ctx = this.ctx;
    const night = (this.round - 1) % SKIES.length === 3;
    // Big tree on the left
    ctx.fillStyle = night ? '#2b1d14' : '#5b3a1e';
    ctx.fillRect(60, 170, 34, GRASS_TOP - 160);
    ctx.fillStyle = night ? '#173826' : '#2f7d3a';
    for (const [x, y, r] of [
      [77, 150, 70],
      [30, 200, 50],
      [130, 195, 55],
      [80, 230, 55],
    ] as const) {
      ctx.beginPath();
      ctx.arc(x, y, r, 0, TAU);
      ctx.fill();
    }
    // Ground and tall grass
    ctx.fillStyle = night ? '#3a2a1e' : '#8a5a2b';
    ctx.fillRect(-20, GRASS_TOP + 70, this.W + 40, this.H);
    const blades = night ? ['#1f5a2c', '#2a6b36'] : ['#4caf50', '#3d8f40'];
    for (let layer = 0; layer < 2; layer++) {
      ctx.fillStyle = blades[layer] as string;
      ctx.beginPath();
      ctx.moveTo(-10, GRASS_TOP + 90);
      for (let x = -10; x <= this.W + 10; x += 14) {
        const sway = Math.sin(this.time * 1.5 + x * 0.05 + layer) * 4;
        ctx.lineTo(x + 7 + sway, GRASS_TOP - 10 + layer * 20 + hash1(x + layer * 13) * 20);
        ctx.lineTo(x + 14, GRASS_TOP + 40 + layer * 10);
      }
      ctx.lineTo(this.W + 10, GRASS_TOP + 90);
      ctx.fill();
    }
  }

  private drawDuck(d: Duck): void {
    const ctx = this.ctx;
    const info = DUCK_INFO[d.kind];
    const facing = d.vx >= 0 ? 1 : -1;
    ctx.save();
    ctx.translate(d.x, d.y);
    if (d.state === 'fall') ctx.rotate(d.t * 14);
    else if (d.state === 'fly' || d.state === 'escape')
      ctx.rotate(clamp(Math.atan2(d.vy, Math.abs(d.vx)) * 0.4, -0.5, 0.5) * facing);
    ctx.scale(facing * 1.1, 1.1);
    if (d.kind === 'gold') {
      ctx.shadowColor = '#ffd23f';
      ctx.shadowBlur = 18;
    }
    // Tail
    ctx.fillStyle = info.body;
    ctx.beginPath();
    ctx.moveTo(-26, -2);
    ctx.lineTo(-38, -8);
    ctx.lineTo(-36, 6);
    ctx.fill();
    // Body
    ctx.beginPath();
    ctx.ellipse(-4, 2, 26, 15, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = info.belly;
    ctx.beginPath();
    ctx.ellipse(-2, 9, 20, 7, 0, 0, TAU);
    ctx.fill();
    // Head
    ctx.fillStyle = info.head;
    ctx.beginPath();
    ctx.arc(22, -10, 11, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.fillRect(14, -2, 14, 3);
    // Beak
    ctx.fillStyle = '#f4a020';
    ctx.beginPath();
    ctx.moveTo(31, -12);
    ctx.lineTo(44, -8);
    ctx.lineTo(31, -5);
    ctx.fill();
    // Eye
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(25, -13, 3.5, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#111';
    if (d.state === 'hit' || d.state === 'fall') {
      ctx.strokeStyle = '#111';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(23, -15);
      ctx.lineTo(27, -11);
      ctx.moveTo(27, -15);
      ctx.lineTo(23, -11);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.arc(26, -13, 1.8, 0, TAU);
      ctx.fill();
    }
    // Wing
    const flapA = d.state === 'hit' ? -1.2 : Math.sin(d.flap) * 1.0;
    ctx.save();
    ctx.translate(-6, -4);
    ctx.rotate(-flapA * 0.9);
    ctx.fillStyle = info.wing;
    ctx.beginPath();
    ctx.ellipse(-4, -12, 9, 20, -0.4, 0, TAU);
    ctx.fill();
    ctx.restore();
    ctx.restore();
    ctx.shadowBlur = 0;
  }

  private drawCrate(c: Crate): void {
    const ctx = this.ctx;
    const info = POWER_INFO[c.kind];
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(c.x, c.y - 18);
    ctx.lineTo(c.x, c.y - 50);
    ctx.stroke();
    ctx.fillStyle = info.color;
    ctx.beginPath();
    ctx.ellipse(c.x, c.y - 66, 20, 24, 0, 0, TAU);
    ctx.fill();
    fillRoundRect(ctx, c.x - 18, c.y - 18, 36, 36, 6, '#c58b4a');
    ctx.strokeStyle = '#7a5226';
    ctx.lineWidth = 3;
    ctx.strokeRect(c.x - 15, c.y - 15, 30, 30);
    text(ctx, c.kind === 'slowmo' ? 'S' : c.kind === 'scatter' ? 'W' : '+3', c.x, c.y + 1, {
      size: 16,
      align: 'center',
      color: info.color,
    });
  }

  private drawDog(): void {
    if (this.dogMode === 'none') return;
    const ctx = this.ctx;
    const t = this.phase === 'over' ? Math.min(1, this.phaseT * 2) : this.phaseT;
    const rise =
      this.phase === 'over' ? t : t < 0.3 ? t / 0.3 : t > 1.2 ? Math.max(0, 1 - (t - 1.2) / 0.3) : 1;
    const x = clamp(this.dogX, 120, this.W - 120);
    const y = GRASS_TOP + 60 - rise * 110;
    ctx.save();
    ctx.translate(x, y + (this.dogMode === 'laugh' ? Math.abs(Math.sin(this.time * 14)) * -6 : 0));
    // Head
    ctx.fillStyle = '#b5733c';
    ctx.beginPath();
    ctx.ellipse(0, 0, 34, 30, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#6b3d1c';
    ctx.beginPath();
    ctx.ellipse(-32, -2, 12, 26, 0.3, 0, TAU);
    ctx.ellipse(32, -2, 12, 26, -0.3, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#f3dcc0';
    ctx.beginPath();
    ctx.ellipse(0, 14, 20, 15, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#1b1b1b';
    ctx.beginPath();
    ctx.ellipse(0, 6, 8, 6, 0, 0, TAU);
    ctx.fill();
    if (this.dogMode === 'laugh') {
      ctx.strokeStyle = '#1b1b1b';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(-12, -10, 6, Math.PI, 0);
      ctx.moveTo(18, -10);
      ctx.arc(12, -10, 6, Math.PI, 0);
      ctx.stroke();
      ctx.fillStyle = '#7a1f1f';
      ctx.beginPath();
      ctx.ellipse(0, 22, 10, 7, 0, 0, Math.PI);
      ctx.fill();
    } else {
      ctx.fillStyle = '#1b1b1b';
      ctx.beginPath();
      ctx.arc(-12, -10, 4, 0, TAU);
      ctx.arc(12, -10, 4, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = '#1b1b1b';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 16, 8, 0.2, Math.PI - 0.2);
      ctx.stroke();
      // Ducks held up
      for (let i = 0; i < this.dogCount; i++) {
        ctx.save();
        ctx.translate((i - (this.dogCount - 1) / 2) * 60, -48);
        ctx.rotate(Math.PI / 2);
        ctx.scale(0.6, 0.6);
        ctx.fillStyle = DUCK_INFO.green.body;
        ctx.beginPath();
        ctx.ellipse(0, 0, 26, 14, 0, 0, TAU);
        ctx.fill();
        ctx.fillStyle = DUCK_INFO.green.head;
        ctx.beginPath();
        ctx.arc(26, 0, 11, 0, TAU);
        ctx.fill();
        ctx.restore();
      }
    }
    ctx.restore();
  }

  private drawCrosshair(): void {
    const ctx = this.ctx;
    const main = this.skinColor('main', '#ff3b3b');
    const accent = this.skinColor('accent', '#ffffff');
    const style = this.skinParam('style', 0);
    const r = this.powers.scatter > 0 ? 62 : 30;
    const x = this.aimX;
    const y = this.aimY;
    ctx.save();
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.beginPath();
    ctx.arc(x, y, r + 1.5, 0, TAU);
    ctx.stroke();
    ctx.strokeStyle = main;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.stroke();
    if (style === 1) {
      ctx.fillStyle = main;
      ctx.shadowColor = main;
      ctx.shadowBlur = 12;
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, TAU);
      ctx.fill();
      ctx.shadowBlur = 0;
    } else {
      ctx.strokeStyle = accent;
      ctx.lineWidth = 2;
      const gap = style === 2 ? 10 : 6;
      const len = style === 2 ? r + 12 : r + 6;
      ctx.beginPath();
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        ctx.moveTo(x + dx * gap, y + dy * gap);
        ctx.lineTo(x + dx * len, y + dy * len);
      }
      ctx.stroke();
      if (style === 2) {
        ctx.strokeStyle = main;
        ctx.beginPath();
        ctx.arc(x, y, r * 0.5, 0, TAU);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  private drawHud(): void {
    const ctx = this.ctx;
    const y = this.H - 58;
    fillRoundRect(ctx, 12, y, this.W - 24, 48, 14, 'rgba(10,12,30,0.72)');
    // Round
    text(ctx, `R${this.round}`, 40, y + 24, { size: 22, align: 'center', color: '#7CFC00' });
    // Shells
    for (let i = 0; i < Math.max(SHOTS_PER_WAVE, this.shots); i++) {
      const filled = i < this.shots;
      fillRoundRect(ctx, 76 + i * 18, y + 12, 12, 24, 4, filled ? '#e63946' : 'rgba(255,255,255,0.15)');
      if (filled) fillRoundRect(ctx, 76 + i * 18, y + 30, 12, 6, 2, '#ffd23f');
    }
    // Hit tracker
    const tx = 200;
    text(ctx, 'HIT', tx, y + 24, { size: 16, color: '#ccd' });
    for (let i = 0; i < DUCKS_PER_ROUND; i++) {
      const r = this.results[i];
      const cx = tx + 50 + i * 30;
      ctx.fillStyle = r === 'hit' ? '#ff4d6d' : r === 'miss' ? 'rgba(255,255,255,0.2)' : '#fff';
      if (
        this.phase === 'wave' &&
        r === 'pending' &&
        i < (this.waveIndex + 1) * DUCKS_PER_WAVE &&
        i >= this.waveIndex * DUCKS_PER_WAVE
      ) {
        ctx.fillStyle = Math.floor(this.time * 4) % 2 === 0 ? '#fff' : '#aaa';
      }
      ctx.beginPath();
      ctx.ellipse(cx, y + 24, 9, 7, 0, 0, TAU);
      ctx.arc(cx + 8, y + 18, 5, 0, TAU);
      ctx.fill();
    }
    const reqX = tx + 50 + (this.required - 0.5) * 30;
    ctx.fillStyle = '#4dd9ff';
    ctx.fillRect(reqX, y + 6, 2, 36);
    // Score
    text(ctx, Math.floor(this.score).toLocaleString('en-US'), this.W - 30, y + 24, {
      size: 24,
      align: 'right',
    });
    // Power timers
    let px = 14;
    for (const k of ['slowmo', 'scatter'] as const) {
      const v = this.powers[k];
      if (v <= 0) continue;
      hudPill(ctx, px, 14, 190, 34);
      text(ctx, POWER_INFO[k].label, px + 14, 31, { size: 13, color: POWER_INFO[k].color });
      if (v < 100) progressBar(ctx, px + 112, 26, 66, 10, v / POWER_INFO[k].dur, POWER_INFO[k].color);
      px += 200;
    }
    if (this.guardian) {
      hudPill(ctx, this.W - 140, 14, 126, 34);
      text(ctx, 'GUARDIAN', this.W - 77, 31, { size: 14, align: 'center', color: '#7cf' });
    }
    if (
      this.phase === 'wave' &&
      this.waveT > this.flyTime - 1.5 &&
      this.ducks.some((d) => d.state === 'fly')
    ) {
      text(ctx, 'HURRY!', this.W / 2, 70, { size: 28, align: 'center', color: '#ff6b6b' });
    }
    if (this.phase === 'intro') {
      banner(
        ctx,
        this.W,
        this.H,
        `ROUND ${this.round}`,
        `Hit ${this.required} of ${DUCKS_PER_ROUND} ducks`,
        this.phaseT / 1.8,
        '#7CFC00',
      );
    } else if (this.phase === 'roundEnd') {
      const hits = this.results.filter((r) => r === 'hit').length;
      const pass = hits >= this.required;
      banner(
        ctx,
        this.W,
        this.H,
        pass ? 'ROUND CLEAR!' : 'ROUND FAILED',
        `${hits} / ${DUCKS_PER_ROUND} ducks`,
        this.phaseT / 2.8,
        pass ? '#ffd23f' : '#ff6b6b',
      );
    } else if (this.phase === 'over') {
      banner(ctx, this.W, this.H, 'GAME OVER', '', 0.5, '#ff6b6b');
    }
  }
}
