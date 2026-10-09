import { clamp, damp, lerp, TAU, wrapAngle } from '../../core/math';
import type { EngineSound } from '../../core/audio';
import { BaseGame } from '../base';
import { banner, drawCoin, fillRoundRect, hash1, hudPill, progressBar, shade, text } from '../draw';
import type { GameServices } from '../types';
import { PX_PER_M, STEP, Terrain } from './terrain';

interface VPoint {
  x: number;
  y: number;
  px: number;
  py: number;
  r: number;
  invMass: number;
  grounded: boolean;
}

interface Stick {
  a: number;
  b: number;
  len: number;
  k: number;
}

interface Pickup {
  kind: 'coin' | 'fuel';
  value: number;
  x: number;
  y: number;
  taken: boolean;
}

interface Biome {
  name: string;
  from: number;
  sky: [string, string];
  far: string;
  near: string;
  ground: [string, string];
  grass: string;
  gravity: number;
  grip: number;
}

const BIOMES: readonly Biome[] = [
  {
    name: 'Countryside',
    from: 0,
    sky: ['#5fb6f5', '#cdeeff'],
    far: '#9cc7a0',
    near: '#5fa55f',
    ground: ['#8a5a2b', '#5b3a1e'],
    grass: '#57c84d',
    gravity: 1,
    grip: 1,
  },
  {
    name: 'Desert Dunes',
    from: 800,
    sky: ['#f6a356', '#ffe3a8'],
    far: '#e9b97a',
    near: '#d39a55',
    ground: ['#e0b46c', '#b5823e'],
    grass: '#f2cf7a',
    gravity: 1,
    grip: 0.9,
  },
  {
    name: 'Frozen Peaks',
    from: 1600,
    sky: ['#7aa7d9', '#e8f3ff'],
    far: '#c9d9ec',
    near: '#9fb7d1',
    ground: ['#a8bfd6', '#6f88a6'],
    grass: '#f4fbff',
    gravity: 1,
    grip: 0.7,
  },
  {
    name: 'Lunar Base',
    from: 2400,
    sky: ['#05060f', '#1a1d3a'],
    far: '#2a2d48',
    near: '#3c3f5c',
    ground: ['#8b8d99', '#55576a'],
    grass: '#c9cbd6',
    gravity: 0.45,
    grip: 0.95,
  },
];

const SUBSTEPS = 6;
const ITERATIONS = 6;
const GRAVITY = 980;

function mixHex(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ch = (s: number) => Math.round(lerp((pa >> s) & 255, (pb >> s) & 255, t));
  return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
}

export class HillGame extends BaseGame {
  private readonly terrain: Terrain;
  private pts: VPoint[] = [];
  private sticks: Stick[] = [];
  private readonly wheelSpin = [0, 0];
  private readonly wheelAngle = [0, 0];
  private readonly startX = 200;
  private camX = 0;
  private camY = 0;
  private maxX = 0;
  private fuel: number;
  private readonly fuelCap: number;
  private pickups: Pickup[] = [];
  private spawnedTo = 0;
  private nextFuelM = 260;
  private fuelCount = 0;
  private airTime = 0;
  private airAngle = 0;
  private lastAngle = 0;
  private upsideT = 0;
  private stallT = 0;
  private crashed = false;
  private crashReason = '';
  private shield: boolean;
  private graceT = 0;
  private bannerT = 0;
  private biomeIndex = 0;
  private nextMilestone = 500;
  private engine: EngineSound | null = null;
  private throttle = 0;
  private brake = 0;

  // Vehicle parameters (from the selected vehicle skin)
  private readonly power: number;
  private readonly maxSpeed: number;
  private readonly grip: number;
  private readonly wheelR: number;
  private readonly suspension: number;
  private readonly airControl: number;

  constructor(s: GameServices) {
    super(s);
    this.terrain = new Terrain(this.rng.int(1, 100000));
    this.power = this.skinParam('power', 1);
    this.maxSpeed = this.skinParam('maxSpeed', 540);
    this.grip = this.skinParam('grip', 0.32);
    this.wheelR = this.skinParam('wheelRadius', 20);
    this.suspension = this.skinParam('suspension', 0.35);
    this.airControl = this.skinParam('airControl', 1);
    this.fuelCap = this.skinParam('fuel', 100) * (this.hasBoost('head-start') ? 1.5 : 1);
    this.fuel = this.fuelCap;
    this.shield = this.hasBoost('shield');
    this.buildVehicle(this.startX, 0);
    this.maxX = this.startX;
    const c = this.center();
    this.camX = c.x - this.W * 0.35;
    this.camY = c.y - this.H * 0.55;
    this.spawnPickups(this.startX + 3000);
  }

  override destroy(): void {
    this.engine?.stop();
    this.engine = null;
  }

  // ------------------------------------------------------------------ vehicle

  private buildVehicle(x: number, angle: number): void {
    const r = this.wheelR;
    const groundY = Math.min(
      this.terrain.heightAt(x - 40),
      this.terrain.heightAt(x),
      this.terrain.heightAt(x + 40),
    );
    const cy = groundY - r - 22;
    const local: [number, number, number, number][] = [
      // x, y, radius, invMass
      [-32, 18, r, 0.8], // 0 rear wheel
      [34, 18, r, 0.8], // 1 front wheel
      [-46, 0, 4, 1], // 2 rear bottom
      [46, 0, 4, 1], // 3 front bottom
      [36, -24, 4, 1], // 4 front top
      [-44, -26, 4, 1], // 5 rear top
      [-6, -50, 11, 1.6], // 6 head
    ];
    const ca = Math.cos(angle);
    const sa = Math.sin(angle);
    this.pts = local.map(([lx, ly, pr, im]) => {
      const wx = x + lx * ca - ly * sa;
      const wy = cy + lx * sa + ly * ca;
      return { x: wx, y: wy, px: wx, py: wy, r: pr, invMass: im, grounded: false };
    });
    const stick = (a: number, b: number, k: number): Stick => {
      const pa = this.pts[a] as VPoint;
      const pb = this.pts[b] as VPoint;
      return { a, b, len: Math.hypot(pa.x - pb.x, pa.y - pb.y), k };
    };
    this.sticks = [];
    const body = [2, 3, 4, 5, 6];
    for (let i = 0; i < body.length; i++)
      for (let j = i + 1; j < body.length; j++) this.sticks.push(stick(body[i]!, body[j]!, 1));
    const s = this.suspension;
    this.sticks.push(stick(0, 2, s), stick(0, 5, s), stick(0, 3, s * 0.6));
    this.sticks.push(stick(1, 3, s), stick(1, 4, s), stick(1, 2, s * 0.6));
    this.wheelSpin[0] = this.wheelSpin[1] = 0;
  }

  private center(): { x: number; y: number } {
    const p2 = this.pts[2] as VPoint;
    const p4 = this.pts[4] as VPoint;
    return { x: (p2.x + p4.x) / 2, y: (p2.y + p4.y) / 2 };
  }

  private angle(): number {
    const a = this.pts[2] as VPoint;
    const b = this.pts[3] as VPoint;
    return Math.atan2(b.y - a.y, b.x - a.x);
  }

  private velocity(): { x: number; y: number } {
    const p = this.pts[2] as VPoint;
    const q = this.pts[3] as VPoint;
    const dt = 1 / 60 / SUBSTEPS;
    return { x: (p.x - p.px + q.x - q.px) / 2 / dt, y: (p.y - p.py + q.y - q.py) / 2 / dt };
  }

  private biomeAt(m: number): number {
    let idx = 0;
    for (let i = 0; i < BIOMES.length; i++) if (m >= (BIOMES[i] as Biome).from) idx = i;
    return idx;
  }

  private get meters(): number {
    return Math.max(0, (this.maxX - this.startX) / PX_PER_M);
  }

  // ------------------------------------------------------------------ simulation

  protected tick(dt: number): void {
    this.bannerT += dt;
    this.graceT = Math.max(0, this.graceT - dt);
    if (!this.engine && !this.crashed) this.engine = this.audio.engine();

    const gas =
      !this.crashed &&
      (this.input.isDown('right') || this.input.isDown('up') || this.input.isDown('primary'));
    const brk =
      !this.crashed &&
      (this.input.isDown('left') || this.input.isDown('down') || this.input.isDown('secondary'));
    const hasFuel = this.fuel > 0;
    this.throttle = gas && hasFuel ? 1 : 0;
    this.brake = brk && hasFuel ? 1 : 0;

    const m = this.meters;
    const bi = this.biomeAt(m);
    if (bi !== this.biomeIndex) {
      this.biomeIndex = bi;
      this.bannerT = 0;
      this.audio.play('levelup');
    }
    const biome = BIOMES[bi] as Biome;

    const sdt = dt / SUBSTEPS;
    for (let i = 0; i < SUBSTEPS; i++) this.substep(sdt, biome);

    // Fuel
    if (!this.crashed) {
      this.fuel = Math.max(0, this.fuel - dt * (1.2 + 2.2 * this.throttle));
      if (this.fuel <= 0 && Math.abs(this.velocity().x) < 12) {
        this.stallT += dt;
        if (this.stallT > 1.6) this.crash('Out of fuel!');
      } else this.stallT = 0;
    }

    const c = this.center();
    const prevMax = this.maxX;
    this.maxX = Math.max(this.maxX, c.x);
    this.score += ((this.maxX - prevMax) / PX_PER_M) * 10;
    this.maxStat('distance', this.meters);
    if (this.meters >= this.nextMilestone) {
      const bonus = Math.floor(this.nextMilestone / 100);
      this.coins += bonus;
      this.score += this.nextMilestone;
      this.texts.add(this.W / 2, 150, `${this.nextMilestone} m! +${bonus} coins`, '#ffd23f', 28);
      this.audio.play('reward');
      this.nextMilestone += 500;
    }

    this.trackAir(dt);
    this.checkCrash(dt);
    this.collectPickups();
    this.spawnPickups(this.maxX + 2500);
    this.pickups = this.pickups.filter((p) => !p.taken && p.x > this.camX - 400);

    // Camera with look-ahead
    const v = this.velocity();
    const tx = c.x - this.W * 0.35 + clamp(v.x * 0.25, -120, 160);
    const ty = c.y - this.H * 0.55;
    this.camX += (tx - this.camX) * damp(4, dt);
    this.camY += (ty - this.camY) * damp(3, dt);

    // Effects and audio
    const speed = Math.hypot(v.x, v.y);
    const rpm = clamp((Math.abs(this.wheelSpin[0] ?? 0) * this.wheelR) / this.maxSpeed, 0, 1);
    this.engine?.set(rpm, this.throttle);
    for (let w = 0; w < 2; w++) {
      const p = this.pts[w] as VPoint;
      if (p.grounded && this.throttle > 0 && this.time % 0.06 < dt) {
        this.particles.emit({
          x: p.x - this.camX,
          y: p.y + p.r * 0.7 - this.camY,
          count: 2,
          speed: 80 + speed * 0.2,
          angle: Math.PI + 0.4,
          spread: 0.8,
          life: 0.5,
          size: 5,
          colors: [shade(biome.ground[0], 0.2), biome.ground[0]],
          gravity: 200,
        });
      }
    }
  }

  private substep(dt: number, biome: Biome): void {
    const g = GRAVITY * biome.gravity;
    const pts = this.pts;
    // Integrate
    for (const p of pts) {
      const vx = (p.x - p.px) * 0.9995;
      const vy = (p.y - p.py) * 0.9995;
      p.px = p.x;
      p.py = p.y;
      p.x += vx;
      p.y += vy + g * dt * dt;
    }

    // Engine & wheel spin
    const maxW = this.maxSpeed / this.wheelR;
    for (let w = 0; w < 2; w++) {
      let spin = this.wheelSpin[w] as number;
      if (this.throttle > 0) spin = Math.min(maxW, spin + maxW * 0.9 * this.power * dt);
      else if (this.brake > 0) {
        spin = spin > 0 ? Math.max(0, spin - maxW * 3 * dt) : Math.max(-maxW * 0.45, spin - maxW * 0.8 * dt);
      } else spin *= 1 - 0.4 * dt;
      this.wheelSpin[w] = spin;
    }

    // Engine reaction torque and mid-air control
    const airborne = !(pts[0] as VPoint).grounded && !(pts[1] as VPoint).grounded;
    const torque = airborne
      ? (this.brake - this.throttle) * 9 * this.airControl
      : (this.brake * 0.6 - this.throttle) * 2.4 * this.power;
    if (torque !== 0 && !this.crashed) {
      const c = this.center();
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i] as VPoint;
        const dx = p.x - c.x;
        const dy = p.y - c.y;
        // Positive torque rotates clockwise on screen.
        p.x += -dy * torque * dt * dt;
        p.y += dx * torque * dt * dt;
      }
    }

    // Constraints
    for (let it = 0; it < ITERATIONS; it++) {
      for (const s of this.sticks) {
        const a = pts[s.a] as VPoint;
        const b = pts[s.b] as VPoint;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.hypot(dx, dy) || 0.0001;
        const diff = ((d - s.len) / d) * s.k;
        const wsum = a.invMass + b.invMass;
        const ka = (a.invMass / wsum) * diff;
        const kb = (b.invMass / wsum) * diff;
        a.x += dx * ka;
        a.y += dy * ka;
        b.x -= dx * kb;
        b.y -= dy * kb;
      }
      this.collideGround(dt, biome, false);
    }
    this.collideGround(dt, biome, true);
    for (let w = 0; w < 2; w++)
      this.wheelAngle[w] = (this.wheelAngle[w] as number) + (this.wheelSpin[w] as number) * dt;
  }

  /**
   * Position-only pushes during constraint iterations; the final pass (`contact`) also decides
   * which points touch the ground (with a small tolerance) and applies drive/friction to them.
   */
  private collideGround(dt: number, biome: Biome, contact: boolean): void {
    for (let i = 0; i < this.pts.length; i++) {
      const p = this.pts[i] as VPoint;
      if (contact) p.grounded = false;
      const hit = this.terrain.closest(p.x, p.y, p.r + 2);
      let nx = hit.nx;
      let ny = hit.ny;
      let pen = p.r - hit.d;
      const surface = this.terrain.heightAt(p.x);
      if (p.y > surface) {
        // Centre is underground: push straight out along the surface normal.
        const sl = this.terrain.slopeAt(p.x);
        const len = Math.hypot(sl, 1);
        nx = sl / len;
        ny = -1 / len;
        pen = p.r + (p.y - surface) / len;
      } else if (hit.d > 0.0001) {
        nx = (p.x - hit.px) / hit.d;
        ny = (p.y - hit.py) / hit.d;
      }
      if (pen <= (contact ? -1.5 : 0)) continue;
      if (pen > 0) {
        p.x += nx * pen;
        p.y += ny * pen;
      }
      if (!contact) continue;
      p.grounded = true;
      if (i === 6) continue; // head contact is handled as a crash
      const vx = p.x - p.px;
      const vy = p.y - p.py;
      const tx = -ny;
      const ty = nx;
      let vn = vx * nx + vy * ny;
      let vt = vx * tx + vy * ty;
      if (vn < 0) vn = -vn * 0.12;
      if (i <= 1) {
        const spin = this.wheelSpin[i] as number;
        const surfaceV = spin * p.r * dt;
        const grip = this.grip * biome.grip;
        const nvt = vt + (surfaceV - vt) * grip;
        this.wheelSpin[i] = spin + (nvt / (p.r * dt) - spin) * 0.5;
        vt = nvt;
      } else {
        vt *= 0.92;
      }
      p.px = p.x - (nx * vn + tx * vt);
      p.py = p.y - (ny * vn + ty * vt);
    }
  }

  private trackAir(dt: number): void {
    const a = this.angle();
    const delta = wrapAngle(a - this.lastAngle);
    this.lastAngle = a;
    const airborne = this.pts.every((p) => !p.grounded);
    if (airborne && !this.crashed) {
      this.airTime += dt;
      this.airAngle += delta;
      if (Math.abs(this.airAngle) > TAU * 0.92) {
        this.airAngle -= Math.sign(this.airAngle) * TAU;
        this.addStat('flips');
        this.score += 250;
        this.coins += 2;
        this.audio.play('flip');
        this.texts.add(
          this.W / 2,
          200,
          Math.sign(delta) < 0 ? 'BACKFLIP! +250' : 'FRONTFLIP! +250',
          '#ff9cf0',
          30,
        );
      }
    } else {
      if (this.airTime > 1.2 && !this.crashed) {
        const bonus = Math.floor(this.airTime * 100);
        this.score += bonus;
        this.maxStat('airtime', this.airTime);
        this.texts.add(this.W / 2, 240, `AIR TIME ${this.airTime.toFixed(1)}s +${bonus}`, '#4dd9ff', 24);
      }
      this.airTime = 0;
      this.airAngle = 0;
    }
  }

  private checkCrash(dt: number): void {
    if (this.crashed || this.graceT > 0) return;
    const head = this.pts[6] as VPoint;
    if (head.grounded) {
      this.crash('Driver down!');
      return;
    }
    const a = Math.abs(wrapAngle(this.angle()));
    const wheelsDown = (this.pts[0] as VPoint).grounded || (this.pts[1] as VPoint).grounded;
    if (a > 2.2 && !wheelsDown) {
      this.upsideT += dt;
      if (this.upsideT > 1.2) this.crash('Flipped over!');
    } else this.upsideT = 0;
  }

  private crash(reason: string): void {
    if (this.shield && reason !== 'Out of fuel!') {
      this.shield = false;
      this.graceT = 1.5;
      this.audio.play('pop');
      this.texts.add(this.W / 2, 220, 'GUARDIAN SAVE!', '#7cf', 30);
      this.buildVehicle(this.center().x, 0);
      return;
    }
    this.crashed = true;
    this.crashReason = reason;
    this.throttle = this.brake = 0;
    this.engine?.stop();
    this.engine = null;
    this.shake.add(0.6);
    if (reason !== 'Out of fuel!') {
      this.audio.play('hit');
      const h = this.pts[6] as VPoint;
      this.particles.emit({
        x: h.x - this.camX,
        y: h.y - this.camY,
        count: 26,
        speed: 240,
        life: 0.8,
        size: 5,
        colors: ['#fff', '#ffd23f', '#ff6b6b'],
        gravity: 500,
      });
    }
    this.endGame(1.8);
  }

  private spawnPickups(toX: number): void {
    while (this.spawnedTo < toX) {
      const x = Math.max(this.startX + 400, this.spawnedTo) + this.rng.range(350, 750);
      this.spawnedTo = x;
      const m = (x - this.startX) / PX_PER_M;
      if (m >= this.nextFuelM) {
        this.pickups.push({ kind: 'fuel', value: 0, x, y: this.terrain.heightAt(x) - 26, taken: false });
        this.nextFuelM += Math.min(560, 280 + this.fuelCount * 30) + this.rng.range(-30, 30);
        this.fuelCount++;
        continue;
      }
      const n = this.rng.int(4, 8);
      const roll = this.rng.next();
      const value = roll < 0.06 ? 5 : roll < 0.25 ? 2 : 1;
      for (let i = 0; i < n; i++) {
        const cx = x + i * 34;
        this.pickups.push({ kind: 'coin', value, x: cx, y: this.terrain.heightAt(cx) - 34, taken: false });
      }
      this.spawnedTo = x + n * 34;
    }
  }

  private collectPickups(): void {
    if (this.crashed) return;
    for (const pk of this.pickups) {
      if (pk.taken) continue;
      let hit = false;
      for (const p of this.pts) {
        if (Math.hypot(p.x - pk.x, p.y - pk.y) < p.r + 18) {
          hit = true;
          break;
        }
      }
      if (!hit) continue;
      pk.taken = true;
      if (pk.kind === 'fuel') {
        this.fuel = this.fuelCap;
        this.addStat('fuelCans');
        this.audio.play('fuel');
        this.texts.add(pk.x - this.camX, pk.y - this.camY - 20, 'FUEL!', '#ff6b6b', 24);
      } else {
        this.coins += pk.value;
        this.score += pk.value * 10;
        this.audio.play('coin', { volume: 0.6, pitch: pk.value > 1 ? 0.8 : 1 });
        if (pk.value > 1)
          this.texts.add(pk.x - this.camX, pk.y - this.camY - 16, `+${pk.value}`, '#ffd23f', 20);
      }
    }
  }

  // ------------------------------------------------------------------ render

  render(): void {
    const ctx = this.ctx;
    const m = (this.camX + this.W / 2 - this.startX) / PX_PER_M;
    const bi = this.biomeAt(Math.max(0, m));
    const biome = BIOMES[bi] as Biome;
    const next = BIOMES[bi + 1];
    const blend = next ? clamp((m - (next.from - 60)) / 60, 0, 1) : 0;
    ctx.save();
    ctx.translate(this.shake.x, this.shake.y);
    this.drawSky(biome, next ?? biome, blend);
    this.drawParallax(biome, next ?? biome, blend);
    this.drawTerrain();
    this.drawPickups();
    this.drawVehicle();
    this.particles.render(ctx);
    this.texts.render(ctx);
    ctx.restore();
    this.drawHud(biome);
  }

  private drawSky(a: Biome, b: Biome, t: number): void {
    const ctx = this.ctx;
    const g = ctx.createLinearGradient(0, 0, 0, this.H);
    g.addColorStop(0, mixHex(a.sky[0], b.sky[0], t));
    g.addColorStop(1, mixHex(a.sky[1], b.sky[1], t));
    ctx.fillStyle = g;
    ctx.fillRect(-20, -20, this.W + 40, this.H + 40);
    if (a.gravity < 1 || t > 0.5) {
      ctx.fillStyle = '#fff';
      for (let i = 0; i < 80; i++) {
        ctx.globalAlpha = (a.gravity < 1 ? 1 : t) * (0.4 + 0.6 * hash1(i + 3));
        ctx.fillRect(hash1(i) * this.W, hash1(i + 50) * this.H * 0.6, 2, 2);
      }
      ctx.globalAlpha = 1;
    }
    if (a.gravity < 1) {
      ctx.fillStyle = '#3b82f6';
      ctx.beginPath();
      ctx.arc(780, 110, 46, 0, TAU);
      ctx.fill();
      ctx.fillStyle = '#22c55e';
      ctx.beginPath();
      ctx.arc(770, 100, 18, 0, TAU);
      ctx.arc(796, 124, 12, 0, TAU);
      ctx.fill();
    } else {
      const sg = ctx.createRadialGradient(780, 100, 10, 780, 100, 120);
      sg.addColorStop(0, 'rgba(255,250,220,1)');
      sg.addColorStop(0.25, 'rgba(255,240,180,0.7)');
      sg.addColorStop(1, 'rgba(255,240,180,0)');
      ctx.fillStyle = sg;
      ctx.fillRect(640, 0, 300, 260);
    }
  }

  private drawParallax(a: Biome, b: Biome, t: number): void {
    const ctx = this.ctx;
    const layers = [
      { par: 0.15, color: mixHex(a.far, b.far, t), base: 320, amp: 120, wl: 260, salt: 1 },
      { par: 0.35, color: mixHex(a.near, b.near, t), base: 380, amp: 90, wl: 180, salt: 2 },
    ];
    for (const l of layers) {
      ctx.fillStyle = l.color;
      ctx.beginPath();
      ctx.moveTo(-10, this.H + 10);
      const off = this.camX * l.par;
      const yOff = -this.camY * l.par * 0.3;
      for (let sx = -10; sx <= this.W + 20; sx += 20) {
        const wx = (sx + off) / l.wl;
        const i = Math.floor(wx);
        const f = wx - i;
        const h0 = hash1(i * 3.3 + l.salt);
        const h1 = hash1((i + 1) * 3.3 + l.salt);
        const h = h0 + (h1 - h0) * (f * f * (3 - 2 * f));
        ctx.lineTo(sx, l.base - h * l.amp + yOff);
      }
      ctx.lineTo(this.W + 20, this.H + 10);
      ctx.fill();
    }
  }

  private drawTerrain(): void {
    const ctx = this.ctx;
    const x0 = Math.floor((this.camX - 20) / STEP) * STEP;
    const x1 = this.camX + this.W + 20;
    // Group runs of samples by biome so boundaries render cleanly.
    let runStart = x0;
    let runBiome = this.biomeAt(Math.max(0, (x0 - this.startX) / PX_PER_M));
    const flush = (from: number, to: number, bi: number) => {
      const b = BIOMES[bi] as Biome;
      const g = ctx.createLinearGradient(0, 300 - this.camY, 0, this.H + 200);
      g.addColorStop(0, b.ground[0]);
      g.addColorStop(1, b.ground[1]);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(from - this.camX, this.H + 40);
      for (let x = from; x <= to; x += STEP) ctx.lineTo(x - this.camX, this.terrain.heightAt(x) - this.camY);
      ctx.lineTo(to - this.camX, this.H + 40);
      ctx.fill();
      ctx.strokeStyle = b.grass;
      ctx.lineWidth = 9;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      for (let x = from; x <= to; x += STEP) {
        const y = this.terrain.heightAt(x) - this.camY;
        if (x === from) ctx.moveTo(x - this.camX, y);
        else ctx.lineTo(x - this.camX, y);
      }
      ctx.stroke();
      ctx.strokeStyle = shade(b.grass, -0.25);
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let x = from; x <= to; x += STEP) {
        const y = this.terrain.heightAt(x) - this.camY + 5;
        if (x === from) ctx.moveTo(x - this.camX, y);
        else ctx.lineTo(x - this.camX, y);
      }
      ctx.stroke();
    };
    for (let x = x0; x <= x1; x += STEP) {
      const bi = this.biomeAt(Math.max(0, (x - this.startX) / PX_PER_M));
      if (bi !== runBiome) {
        flush(runStart, x, runBiome);
        runStart = x;
        runBiome = bi;
      }
    }
    flush(runStart, x1 + STEP, runBiome);
    // Distance signs every 100 m
    const firstSign = Math.ceil((this.camX - this.startX) / (100 * PX_PER_M));
    for (let k = Math.max(1, firstSign); ; k++) {
      const wx = this.startX + k * 100 * PX_PER_M;
      if (wx > x1) break;
      const gy = this.terrain.heightAt(wx) - this.camY;
      const sx = wx - this.camX;
      ctx.fillStyle = '#6b4a2a';
      ctx.fillRect(sx - 2, gy - 46, 4, 46);
      fillRoundRect(ctx, sx - 26, gy - 66, 52, 24, 5, '#f4e3c1');
      text(ctx, `${k * 100}m`, sx, gy - 54, { size: 13, align: 'center', color: '#5b3a1e', stroke: null });
    }
  }

  private drawPickups(): void {
    const ctx = this.ctx;
    for (const pk of this.pickups) {
      const sx = pk.x - this.camX;
      const sy = pk.y - this.camY + Math.sin(this.time * 3 + pk.x) * 3;
      if (sx < -40 || sx > this.W + 40) continue;
      if (pk.kind === 'coin') {
        const r = pk.value >= 5 ? 16 : pk.value === 2 ? 13 : 10;
        drawCoin(ctx, sx, sy, r, Math.cos(this.time * 4 + pk.x * 0.05));
        if (pk.value > 1)
          text(ctx, `${pk.value}`, sx, sy + 1, {
            size: r * 0.9,
            align: 'center',
            color: '#7a4a00',
            stroke: null,
          });
      } else {
        ctx.save();
        ctx.translate(sx, sy);
        const glow = ctx.createRadialGradient(0, 0, 4, 0, 0, 40);
        glow.addColorStop(0, 'rgba(255,80,80,0.5)');
        glow.addColorStop(1, 'rgba(255,80,80,0)');
        ctx.fillStyle = glow;
        ctx.fillRect(-40, -40, 80, 80);
        fillRoundRect(ctx, -14, -18, 28, 36, 5, '#e63946');
        fillRoundRect(ctx, -6, -24, 12, 8, 2, '#333');
        ctx.strokeStyle = '#ffd6d6';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(-8, -10);
        ctx.lineTo(8, 10);
        ctx.moveTo(8, -10);
        ctx.lineTo(-8, 10);
        ctx.stroke();
        ctx.restore();
      }
    }
  }

  private drawVehicle(): void {
    const ctx = this.ctx;
    const P = (i: number) => {
      const p = this.pts[i] as VPoint;
      return { x: p.x - this.camX, y: p.y - this.camY };
    };
    const body = this.skinColor('body', '#e63946');
    const trim = this.skinColor('trim', '#1d3557');
    const style = this.skinParam('style', 0);
    const ang = this.angle();
    const rb = P(2);
    const fb = P(3);
    const ft = P(4);
    const rt = P(5);
    const head = P(6);
    const blink = this.graceT > 0 && Math.floor(this.time * 14) % 2 === 0;
    if (blink) ctx.globalAlpha = 0.5;
    // Suspension struts
    ctx.strokeStyle = '#444';
    ctx.lineWidth = 5;
    for (const [w, a] of [
      [0, 2],
      [1, 3],
    ] as const) {
      const pw = P(w);
      const pa = P(a);
      ctx.beginPath();
      ctx.moveTo(pw.x, pw.y);
      ctx.lineTo(pa.x, pa.y);
      ctx.stroke();
    }
    // Driver and roll cage, oriented with the chassis.
    const dx = Math.cos(ang);
    const dy = Math.sin(ang);
    const ux = dy;
    const uy = -dx;
    const seatX = lerp(rt.x, ft.x, 0.42);
    const seatY = lerp(rt.y, ft.y, 0.42);
    const neckX = head.x - ux * 10;
    const neckY = head.y - uy * 10;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#2b2b33';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(rt.x, rt.y);
    ctx.lineTo(rt.x + ux * 40 + dx * 6, rt.y + uy * 40 + dy * 6);
    ctx.lineTo(ft.x + ux * 22 - dx * 10, ft.y + uy * 22 - dy * 10);
    ctx.lineTo(ft.x, ft.y);
    ctx.stroke();
    ctx.strokeStyle = trim;
    ctx.lineWidth = 12;
    ctx.beginPath();
    ctx.moveTo(seatX, seatY);
    ctx.lineTo(neckX, neckY);
    ctx.stroke();
    ctx.strokeStyle = '#f6c18f';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(lerp(neckX, seatX, 0.3), lerp(neckY, seatY, 0.3));
    ctx.lineTo(lerp(rt.x, ft.x, 0.78) + ux * 8, lerp(rt.y, ft.y, 0.78) + uy * 8);
    ctx.stroke();
    ctx.lineCap = 'butt';
    ctx.fillStyle = '#f6c18f';
    ctx.beginPath();
    ctx.arc(head.x, head.y, 11, 0, TAU);
    ctx.fill();
    ctx.fillStyle = this.skinColor('helmet', '#ffd23f');
    ctx.beginPath();
    ctx.arc(head.x, head.y - 2, 12, ang + Math.PI, ang + TAU);
    ctx.fill();
    // Chassis
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.moveTo(rb.x, rb.y);
    ctx.lineTo(fb.x, fb.y);
    ctx.lineTo(ft.x, ft.y);
    if (style === 1) {
      // Monster truck cab
      ctx.lineTo(lerp(rt.x, ft.x, 0.55), lerp(rt.y, ft.y, 0.55) - 2);
    }
    ctx.lineTo(rt.x, rt.y);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = shade(body.startsWith('#') ? body : '#e63946', -0.35);
    ctx.lineWidth = 2;
    ctx.stroke();
    // Stripe / trim
    ctx.strokeStyle = trim;
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(lerp(rb.x, rt.x, 0.45), lerp(rb.y, rt.y, 0.45));
    ctx.lineTo(lerp(fb.x, ft.x, 0.45), lerp(fb.y, ft.y, 0.45));
    ctx.stroke();
    // Headlight
    ctx.fillStyle = '#fff6b0';
    ctx.beginPath();
    ctx.arc(lerp(fb.x, ft.x, 0.3), lerp(fb.y, ft.y, 0.3), 4, 0, TAU);
    ctx.fill();
    // Wheels
    for (let w = 0; w < 2; w++) {
      const p = P(w);
      const r = this.wheelR;
      ctx.fillStyle = '#1b1b1f';
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, TAU);
      ctx.fill();
      ctx.fillStyle = '#9aa0ad';
      ctx.beginPath();
      ctx.arc(p.x, p.y, r * 0.55, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = '#2b2b33';
      ctx.lineWidth = 3;
      const a0 = this.wheelAngle[w] as number;
      ctx.beginPath();
      for (let k = 0; k < 3; k++) {
        const a = a0 + (k * TAU) / 3;
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x + Math.cos(a) * r * 0.55, p.y + Math.sin(a) * r * 0.55);
      }
      ctx.stroke();
      // Tread marks
      ctx.strokeStyle = '#333';
      ctx.lineWidth = 2;
      for (let k = 0; k < 8; k++) {
        const a = a0 + (k * TAU) / 8;
        ctx.beginPath();
        ctx.moveTo(p.x + Math.cos(a) * r * 0.8, p.y + Math.sin(a) * r * 0.8);
        ctx.lineTo(p.x + Math.cos(a) * r, p.y + Math.sin(a) * r);
        ctx.stroke();
      }
    }
    if (this.shield) {
      const c = this.center();
      ctx.strokeStyle = 'rgba(120,200,255,0.6)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(c.x - this.camX, c.y - this.camY - 10, 70, 0, TAU);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  private drawHud(biome: Biome): void {
    const ctx = this.ctx;
    // Fuel
    hudPill(ctx, 14, 14, 250, 44);
    fillRoundRect(ctx, 28, 24, 18, 24, 3, '#e63946');
    const f = this.fuel / this.fuelCap;
    const fuelColor = f > 0.5 ? '#57c84d' : f > 0.2 ? '#ffb703' : '#ff4d4d';
    progressBar(ctx, 56, 29, 194, 14, f, fuelColor);
    if (f < 0.2 && f > 0 && Math.floor(this.time * 3) % 2 === 0)
      text(ctx, 'LOW FUEL', 153, 70, { size: 16, align: 'center', color: '#ff6b6b' });
    // Coins
    hudPill(ctx, 274, 14, 130, 44);
    drawCoin(ctx, 298, 36, 12);
    text(ctx, `${this.coins}`, 318, 37, { size: 22 });
    // Distance
    hudPill(ctx, this.W - 214, 14, 200, 44);
    text(ctx, `${Math.floor(this.meters)} m`, this.W - 28, 37, { size: 24, align: 'right' });
    text(ctx, `${Math.floor(this.score).toLocaleString('en-US')} pts`, this.W - 28, 72, {
      size: 15,
      align: 'right',
      color: '#eef',
    });
    // Speed gauge
    const v = this.velocity();
    const kmh = Math.round((Math.hypot(v.x, v.y) / PX_PER_M) * 3.6);
    hudPill(ctx, this.W - 330, 14, 106, 44);
    text(ctx, `${kmh}`, this.W - 290, 37, { size: 22, align: 'right' });
    text(ctx, 'km/h', this.W - 284, 39, { size: 12, color: '#aab', weight: 600 });
    if (this.shield) {
      hudPill(ctx, 414, 14, 120, 44);
      text(ctx, 'GUARDIAN', 474, 37, { size: 14, align: 'center', color: '#7cf' });
    }
    if (this.bannerT < 2.6)
      banner(
        ctx,
        this.W,
        this.H,
        biome.name.toUpperCase(),
        biome.gravity < 1
          ? 'Low gravity!'
          : biome.grip < 0.8
            ? 'Slippery ice!'
            : biome.from === 0
              ? 'Hold → to drive'
              : `${biome.from} m reached`,
        this.bannerT / 2.6,
        '#ffd23f',
      );
    if (this.crashed && this.crashReason) {
      banner(
        ctx,
        this.W,
        this.H,
        this.crashReason.toUpperCase(),
        `${Math.floor(this.meters)} m`,
        0.5,
        '#ff6b6b',
      );
    }
  }
}
