import { clamp, damp, TAU } from '../../core/math';
import { BaseGame } from '../base';
import { drawCoin, fillRoundRect, hash1, hudPill, progressBar, shade, text, banner } from '../draw';
import type { GameServices } from '../types';

// World units are metres. The camera sits behind and above the runner, looking down the track.
const LANE_W = 2.4;
const CAM_H = 8.4;
const CAM_D = 7;
const FOCAL = 448;
const HORIZON = 250;
const FAR = 150;
const NEAR = -CAM_D + 1.4;
const GRAVITY = 34;
const TRAIN_H = 3.3;
const STAND_H = 1.8;
const ROLL_H = 0.8;
const WALL_X = LANE_W * 1.5 + 1.6;

type ObKind = 'low' | 'high' | 'train' | 'ramp';
type PowerKind = 'magnet' | 'double' | 'sneakers' | 'jetpack';

interface Obstacle {
  kind: ObKind;
  lane: number;
  z: number;
  len: number;
  h: number;
  vz: number;
  armed: boolean;
  livery: number;
  dead: boolean;
}

interface Coin {
  x: number;
  y: number;
  z: number;
  taken: boolean;
  pulled: boolean;
}

interface Power {
  kind: PowerKind;
  lane: number;
  z: number;
  taken: boolean;
}

const POWER_INFO: Record<PowerKind, { label: string; color: string; base: number }> = {
  magnet: { label: 'MAGNET', color: '#ff4d6d', base: 10 },
  double: { label: '2X SCORE', color: '#ffd23f', base: 12 },
  sneakers: { label: 'SUPER JUMP', color: '#4dd9ff', base: 12 },
  jetpack: { label: 'JETPACK', color: '#b06bff', base: 7 },
};

const LIVERIES = [
  { body: '#d7263d', stripe: '#f4f4f4', roof: '#9c1c2c' },
  { body: '#1b998b', stripe: '#f2e94e', roof: '#126b61' },
  { body: '#3a86ff', stripe: '#ffbe0b', roof: '#2a5fb5' },
  { body: '#8d99ae', stripe: '#ef233c', roof: '#5c6475' },
];

const laneX = (lane: number) => (lane - 1) * LANE_W;

export class RunnerGame extends BaseGame {
  private distance = 0;
  private speed = 0;
  private lane = 1;
  private px = 0;
  private py = 0;
  private vy = 0;
  private grounded = true;
  private rollT = 0;
  private jumpBuffer = 0;
  private stumbleT = 0;
  private graceT = 0;
  private crashed = false;
  private crashT = 0;
  private shield: boolean;
  private camX = 0;
  private camLift = 0;
  private runPhase = 0;
  private nextZ = 30;
  private lastPowerZ = 0;
  private bannerT = 0;
  private readonly powers: Record<PowerKind, number> = { magnet: 0, double: 0, sneakers: 0, jetpack: 0 };
  private obstacles: Obstacle[] = [];
  private coinList: Coin[] = [];
  private powerList: Power[] = [];
  private readonly skyline: { x: number; w: number; h: number; layer: number; seed: number }[] = [];

  constructor(s: GameServices) {
    super(s);
    this.shield = this.hasBoost('shield');
    if (this.hasBoost('head-start')) {
      this.powers.jetpack = this.powerTime(5);
      this.powers.magnet = this.powerTime(10);
      this.spawnJetpackCoins(this.powers.jetpack);
    }
    for (let layer = 0; layer < 2; layer++) {
      let x = -400;
      while (x < this.W + 400) {
        const w = this.rng.range(30, 80);
        this.skyline.push({
          x,
          w,
          h: this.rng.range(40, 150) * (layer === 0 ? 1 : 0.6),
          layer,
          seed: this.rng.next() * 1000,
        });
        x += w + this.rng.range(-5, 10);
      }
    }
    this.lastPowerZ = 0;
    this.generate();
  }

  // ------------------------------------------------------------------ simulation

  private difficulty(): number {
    return clamp(this.distance / 4000, 0, 1);
  }

  private targetSpeed(): number {
    return 15 + 15 * this.difficulty();
  }

  private multiplier(): number {
    return Math.min(6, 1 + Math.floor(this.distance / 750)) * (this.powers.double > 0 ? 2 : 1);
  }

  protected tick(dt: number): void {
    if (this.crashed) {
      this.crashT += dt;
      this.speed = Math.max(0, this.speed - 40 * dt);
      this.distance += this.speed * dt;
      this.vy -= GRAVITY * dt;
      this.py = Math.max(this.groundAt(this.px).h, this.py + this.vy * dt);
      return;
    }
    this.bannerT += dt;
    this.handleInput();

    // Speed ramps in at the start, then follows difficulty.
    this.speed += (this.targetSpeed() - this.speed) * damp(this.time < 2 ? 2.5 : 0.6, dt);
    const step = this.speed * dt;
    this.distance += step;
    this.score += step * this.multiplier();
    this.runPhase += step * 1.3;

    for (const k of Object.keys(this.powers) as PowerKind[]) {
      if (this.powers[k] > 0) {
        this.powers[k] = Math.max(0, this.powers[k] - dt);
        if (k === 'jetpack' && this.powers[k] === 0) this.graceT = Math.max(this.graceT, 1.4);
      }
    }
    this.stumbleT = Math.max(0, this.stumbleT - dt);
    this.graceT = Math.max(0, this.graceT - dt);
    this.jumpBuffer = Math.max(0, this.jumpBuffer - dt);

    // Lateral movement
    const tx = laneX(this.lane);
    this.px += (tx - this.px) * damp(16, dt);
    if (Math.abs(tx - this.px) < 0.01) this.px = tx;

    for (const ob of this.obstacles) {
      if (ob.vz !== 0) {
        if (!ob.armed && ob.z - this.distance < 85) {
          ob.armed = true;
          this.audio.play('whoosh', { volume: 0.6 });
        }
        if (ob.armed) ob.z += ob.vz * dt;
      }
    }

    this.updateVertical(dt);
    this.rollT = Math.max(0, this.rollT - dt);
    if (this.powers.jetpack > 0) {
      const p = this.project(this.px, this.py + 0.6, 0);
      this.particles.emit({
        x: p.x,
        y: p.y,
        count: 2,
        speed: 260,
        angle: Math.PI / 2,
        spread: 0.5,
        life: 0.35,
        size: 0.18 * p.s,
        colors: ['#ffb703', '#fb5607', '#fff'],
      });
    }

    this.collide();
    this.collectCoins(dt);
    this.collectPowers();

    const cut = this.distance - 14;
    this.obstacles = this.obstacles.filter((o) => !o.dead && o.z + o.len > cut);
    this.coinList = this.coinList.filter((c) => !c.taken && c.z > cut);
    this.powerList = this.powerList.filter((p) => !p.taken && p.z > cut);
    this.generate();

    this.camX += (this.px * 0.55 - this.camX) * damp(6, dt);
    this.camLift += (Math.min(this.py, TRAIN_H) * 0.55 - this.camLift) * damp(4, dt);
    this.maxStat('distance', this.distance);
  }

  private handleInput(): void {
    const sw = this.input.consumeSwipe();
    const left = this.input.wasPressed('left') || sw === 'left';
    const right = this.input.wasPressed('right') || sw === 'right';
    const up = this.input.wasPressed('up') || this.input.wasPressed('primary') || sw === 'up';
    const down = this.input.wasPressed('down') || sw === 'down';
    if (left) this.changeLane(-1);
    if (right) this.changeLane(1);
    if (up) this.jumpBuffer = 0.14;
    if (down && this.powers.jetpack <= 0) {
      if (!this.grounded) this.vy = Math.min(this.vy, -26);
      if (this.rollT <= 0) {
        this.addStat('rolls');
        this.audio.play('whoosh', { volume: 0.5, pitch: 1.4 });
      }
      this.rollT = 0.62;
      this.jumpBuffer = 0;
    }
  }

  private changeLane(dir: number): void {
    const target = this.lane + dir;
    if (target < 0 || target > 2) {
      this.stumble();
      return;
    }
    if (this.powers.jetpack <= 0 && this.graceT <= 0 && this.laneBlocked(target)) {
      this.stumble();
      return;
    }
    this.lane = target;
    this.audio.play('whoosh', { volume: 0.35, pitch: 1.8 });
  }

  private laneBlocked(lane: number): boolean {
    for (const ob of this.obstacles) {
      if (ob.lane !== lane || ob.kind !== 'train') continue;
      const rel = ob.z - this.distance;
      if (rel <= 0.6 && rel + ob.len >= -0.4 && this.py < ob.h - 0.45) return true;
    }
    return false;
  }

  private stumble(): void {
    this.audio.play('bump');
    this.shake.add(0.35);
    this.services.haptic(40);
    if (this.stumbleT > 0 && this.graceT <= 0) {
      this.crash();
      return;
    }
    this.stumbleT = 2.5;
  }

  private updateVertical(dt: number): void {
    if (this.powers.jetpack > 0) {
      const targetY = 6;
      this.py += (targetY - this.py) * damp(4, dt);
      this.vy = 0;
      this.grounded = false;
      this.rollT = 0;
      return;
    }
    const ground = this.groundAt(this.px);
    if (this.grounded && this.jumpBuffer > 0) this.jump();
    this.vy -= GRAVITY * dt;
    const prevY = this.py;
    this.py += this.vy * dt;
    if (this.py <= ground.h) {
      const canSnap = ground.kind === 'ramp' || ground.h - this.py < 0.7 || prevY >= ground.h - 0.05;
      if (canSnap) {
        if (!this.grounded && this.vy < -8) {
          this.audio.play('land', { volume: 0.6 });
          if (ground.h >= TRAIN_H - 0.01) this.addStat('trainsRidden');
        }
        this.py = ground.h;
        this.vy = 0;
        this.grounded = true;
      }
    } else if (this.py > ground.h + 0.05) {
      this.grounded = false;
    }
    if (this.grounded && this.jumpBuffer > 0) this.jump();
  }

  private jump(): void {
    this.vy = this.powers.sneakers > 0 ? 15.5 : 11.5;
    this.grounded = false;
    this.jumpBuffer = 0;
    this.rollT = 0;
    this.addStat('jumps');
    this.audio.play('jump', { pitch: this.powers.sneakers > 0 ? 1.3 : 1 });
  }

  private groundAt(x: number): { h: number; kind: ObKind | null } {
    const lane = clamp(Math.round(x / LANE_W) + 1, 0, 2);
    let h = 0;
    let kind: ObKind | null = null;
    for (const ob of this.obstacles) {
      if (ob.lane !== lane) continue;
      const rel = ob.z - this.distance;
      if (ob.kind === 'train' && rel <= 0.3 && rel + ob.len >= -0.3) {
        if (ob.h > h) {
          h = ob.h;
          kind = 'train';
        }
      } else if (ob.kind === 'ramp' && rel <= 0 && rel + ob.len >= 0) {
        const rh = ob.h * clamp(-rel / ob.len, 0, 1);
        if (rh > h) {
          h = rh;
          kind = 'ramp';
        }
      }
    }
    return { h, kind };
  }

  private collide(): void {
    if (this.powers.jetpack > 0 || this.graceT > 0) return;
    const height = this.rollT > 0 ? ROLL_H : STAND_H;
    for (const ob of this.obstacles) {
      if (ob.kind === 'ramp' || ob.dead) continue;
      const rel = ob.z - this.distance;
      if (rel > 0.35 || rel + ob.len < -0.35) continue;
      if (Math.abs(this.px - laneX(ob.lane)) > 1.15) continue;
      const hit =
        ob.kind === 'low'
          ? this.py < ob.h - 0.1
          : ob.kind === 'high'
            ? this.py + height > 1.2 && this.py < 2.6
            : this.py < ob.h - 0.45;
      if (!hit) continue;
      if (this.shield) {
        this.shield = false;
        this.graceT = 1.6;
        this.audio.play('pop');
        this.shake.add(0.4);
        this.burst(this.px, this.py + 1, '#7cf', 30);
        if (ob.kind === 'train') {
          this.py = ob.h;
          this.vy = 4;
        } else {
          ob.dead = true;
        }
        this.texts.add(this.W / 2, 600, 'GUARDIAN SAVE!', '#7cf', 26);
        return;
      }
      this.crash();
      return;
    }
  }

  private crash(): void {
    if (this.crashed) return;
    this.crashed = true;
    this.vy = 6;
    this.audio.play('hit');
    this.shake.add(0.9);
    this.burst(this.px, this.py + 1, '#fff', 40);
    this.endGame(1.5);
  }

  private burst(x: number, y: number, color: string, count: number): void {
    const p = this.project(x, y, 0);
    this.particles.emit({
      x: p.x,
      y: p.y,
      count,
      speed: 380,
      life: 0.7,
      size: 5,
      colors: [color, '#ffd23f', '#ff6b6b'],
      gravity: 600,
    });
  }

  private collectCoins(dt: number): void {
    const magnet = this.powers.magnet > 0;
    const top = this.py + (this.rollT > 0 ? ROLL_H : STAND_H) + 0.3;
    for (const c of this.coinList) {
      if (c.taken) continue;
      const rel = c.z - this.distance;
      if (magnet && !c.pulled && rel < 28 && rel > -1) c.pulled = true;
      if (c.pulled) {
        const k = damp(14, dt);
        c.x += (this.px - c.x) * k;
        c.y += (this.py + 1 - c.y) * k;
        c.z += (this.distance + 0.2 - c.z) * k;
      }
      const relz = c.z - this.distance;
      if (Math.abs(relz) < 0.9 && Math.abs(c.x - this.px) < 1.0 && c.y > this.py - 0.3 && c.y < top) {
        c.taken = true;
        this.coins += 1;
        this.score += 10 * this.multiplier();
        this.audio.play('coin', { volume: 0.7 });
        const p = this.project(c.x, c.y, relz);
        this.particles.emit({
          x: p.x,
          y: p.y,
          count: 5,
          speed: 120,
          life: 0.35,
          size: 3,
          colors: ['#ffe066', '#fff'],
        });
      }
    }
  }

  private collectPowers(): void {
    for (const pw of this.powerList) {
      if (pw.taken) continue;
      const rel = pw.z - this.distance;
      if (Math.abs(rel) < 1 && Math.abs(laneX(pw.lane) - this.px) < 1.1 && this.py < 3.6) {
        pw.taken = true;
        const dur = this.powerTime(POWER_INFO[pw.kind].base);
        this.powers[pw.kind] = dur;
        if (pw.kind === 'jetpack') this.spawnJetpackCoins(dur);
        this.addStat('powerups');
        this.audio.play('powerup');
        this.texts.add(this.W / 2, 560, POWER_INFO[pw.kind].label, POWER_INFO[pw.kind].color, 30);
      }
    }
  }

  private spawnJetpackCoins(duration: number): void {
    let lane = this.lane;
    const start = this.distance + 12;
    const end = start + this.targetSpeed() * duration - 10;
    for (let z = start; z < end; z += 3) {
      if (this.rng.chance(0.08)) lane = clamp(lane + (this.rng.chance(0.5) ? 1 : -1), 0, 2);
      this.coinList.push({ x: laneX(lane), y: 6.4, z, taken: false, pulled: false });
    }
  }

  // ------------------------------------------------------------------ procedural track

  private gap(): number {
    return Math.max(16, this.targetSpeed() * 0.95);
  }

  private generate(): void {
    while (this.nextZ < this.distance + FAR + 30) {
      const start = this.nextZ;
      const d = this.difficulty();
      const pattern = this.rng.weighted([
        { value: 'coins', weight: 2.2 - d * 1.2 },
        { value: 'barriers', weight: 3 },
        { value: 'trains', weight: 2 + d * 2 },
        { value: 'moving', weight: this.distance > 500 ? 0.8 + d * 1.6 : 0 },
        { value: 'zigzag', weight: this.distance > 350 ? 1 + d : 0 },
      ] as const);
      let len: number;
      switch (pattern) {
        case 'coins':
          len = this.patCoins(start);
          break;
        case 'barriers':
          len = this.patBarriers(start);
          break;
        case 'trains':
          len = this.patTrains(start);
          break;
        case 'moving':
          len = this.patMoving(start);
          break;
        default:
          len = this.patZigzag(start);
      }
      this.nextZ = start + len + this.gap();
    }
  }

  private addOb(kind: ObKind, lane: number, z: number, len: number, h: number, vz = 0): void {
    this.obstacles.push({
      kind,
      lane,
      z,
      len,
      h,
      vz,
      armed: vz === 0,
      livery: this.rng.int(0, LIVERIES.length - 1),
      dead: false,
    });
  }

  private coinLine(lane: number, z0: number, n: number, y = 0.9, spacing = 2.2): void {
    for (let i = 0; i < n; i++)
      this.coinList.push({ x: laneX(lane), y, z: z0 + i * spacing, taken: false, pulled: false });
  }

  private maybePower(lane: number, z: number): boolean {
    if (z - this.lastPowerZ < 320 || !this.rng.chance(0.7)) return false;
    this.lastPowerZ = z;
    const kind = this.rng.weighted<PowerKind>([
      { value: 'magnet', weight: 3 },
      { value: 'double', weight: 2 },
      { value: 'sneakers', weight: 2 },
      { value: 'jetpack', weight: 1.4 },
    ]);
    this.powerList.push({ kind, lane, z, taken: false });
    return true;
  }

  private patCoins(start: number): number {
    const lane = this.rng.int(0, 2);
    const n = this.rng.int(7, 12);
    const hasPower = this.maybePower(lane, start);
    this.coinLine(lane, start + (hasPower ? 6 : 0), n);
    return n * 2.2 + 6;
  }

  private barrierRow(z: number, lanes: number[]): void {
    const d = this.difficulty();
    for (const lane of lanes) {
      const high = this.rng.chance(0.35 + d * 0.2);
      this.addOb(high ? 'high' : 'low', lane, z, 0.5, high ? 2.6 : 1.0);
      if (!high && this.rng.chance(0.4)) {
        for (let i = -3; i <= 3; i++) {
          const dz = i * 1.5;
          this.coinList.push({
            x: laneX(lane),
            y: 1 + 1.6 * (1 - (dz / 5) ** 2),
            z: z + dz,
            taken: false,
            pulled: false,
          });
        }
      }
    }
  }

  private patBarriers(start: number): number {
    const d = this.difficulty();
    const rows = d > 0.3 && this.rng.chance(0.5) ? 2 : 1;
    const spacing = Math.max(15, this.targetSpeed() * 0.95);
    for (let r = 0; r < rows; r++) {
      const count = this.rng.int(1, d < 0.2 ? 2 : 3);
      const lanes = this.rng.shuffle([0, 1, 2]).slice(0, count);
      this.barrierRow(start + r * spacing, lanes);
      const free = [0, 1, 2].filter((l) => !lanes.includes(l));
      const fl = free[0];
      if (fl !== undefined && this.rng.chance(0.6)) this.coinLine(fl, start + r * spacing - 4, 5);
    }
    return (rows - 1) * spacing + 4;
  }

  private patTrains(start: number): number {
    const d = this.difficulty();
    const withRamp = this.rng.chance(0.35 + d * 0.2);
    const maxTrains = d < 0.15 ? 1 : withRamp && d > 0.35 && this.rng.chance(0.35) ? 3 : 2;
    const count = this.rng.int(1, maxTrains);
    const lanes = this.rng.shuffle([0, 1, 2]).slice(0, count);
    const rampLane = withRamp ? (lanes[0] as number) : -1;
    const rampLen = 9;
    let longest = 0;
    for (const lane of lanes) {
      const offset = lane === rampLane ? rampLen : this.rng.range(0, 6);
      const len = this.rng.pick([16, 22, 28, 34]);
      if (lane === rampLane) {
        this.addOb('ramp', lane, start, rampLen, TRAIN_H);
        // Coins up the ramp then along the roof.
        for (let i = 0; i < 4; i++) {
          const z = start + 1 + i * 2.2;
          this.coinList.push({
            x: laneX(lane),
            y: TRAIN_H * ((z - start) / rampLen) + 0.9,
            z,
            taken: false,
            pulled: false,
          });
        }
        this.coinLine(lane, start + rampLen + 1, Math.floor(len / 2.4), TRAIN_H + 0.9, 2.4);
      }
      this.addOb('train', lane, start + offset, len, TRAIN_H);
      longest = Math.max(longest, offset + len);
    }
    const free = [0, 1, 2].filter((l) => !lanes.includes(l));
    for (const lane of free) {
      if (d > 0.25 && this.rng.chance(0.35)) this.barrierRow(start + this.rng.range(4, longest - 4), [lane]);
      else if (this.rng.chance(0.6)) {
        if (!this.maybePower(lane, start + 2)) this.coinLine(lane, start + 2, Math.floor(longest / 2.6));
      }
    }
    return longest;
  }

  private patMoving(start: number): number {
    const d = this.difficulty();
    const lane = this.rng.int(0, 2);
    const len = this.rng.pick([18, 24]);
    this.addOb('train', lane, start + 42, len, TRAIN_H, -(9 + 7 * d));
    const others = [0, 1, 2].filter((l) => l !== lane);
    const coinLane = this.rng.pick(others);
    this.coinLine(coinLane, start + 4, 10);
    const other = others.find((l) => l !== coinLane);
    if (other !== undefined && d > 0.35 && this.rng.chance(0.6)) this.barrierRow(start + 18, [other]);
    return 42 + len;
  }

  private patZigzag(start: number): number {
    let free = this.rng.int(0, 2);
    const spacing = Math.max(12, this.targetSpeed() * 0.75);
    const rows = 3;
    for (let r = 0; r < rows; r++) {
      const z = start + r * spacing;
      for (let lane = 0; lane < 3; lane++) {
        if (lane === free) continue;
        const high = this.rng.chance(0.5);
        this.addOb(high ? 'high' : 'low', lane, z, 0.5, high ? 2.6 : 1.0);
      }
      this.coinLine(free, z - 3, 3);
      free = clamp(free + (this.rng.chance(0.5) ? 1 : -1), 0, 2);
    }
    return (rows - 1) * spacing + 3;
  }

  // ------------------------------------------------------------------ rendering

  private project(x: number, y: number, z: number): { x: number; y: number; s: number } {
    const depth = Math.max(0.5, z + CAM_D);
    const s = FOCAL / depth;
    return { x: this.W / 2 + (x - this.camX) * s, y: HORIZON + (CAM_H + this.camLift - y) * s, s };
  }

  private quad(
    a: [number, number, number],
    b: [number, number, number],
    c: [number, number, number],
    d: [number, number, number],
    fill: string | CanvasGradient,
  ): void {
    const ctx = this.ctx;
    const pa = this.project(...a);
    const pb = this.project(...b);
    const pc = this.project(...c);
    const pd = this.project(...d);
    ctx.beginPath();
    ctx.moveTo(pa.x, pa.y);
    ctx.lineTo(pb.x, pb.y);
    ctx.lineTo(pc.x, pc.y);
    ctx.lineTo(pd.x, pd.y);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
  }

  render(): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(this.shake.x, this.shake.y);
    this.drawBackground();
    this.drawTrack();
    this.drawWorld();
    this.particles.render(ctx);
    this.texts.render(ctx);
    ctx.restore();
    this.drawHud();
  }

  private drawBackground(): void {
    const ctx = this.ctx;
    const g = ctx.createLinearGradient(0, 0, 0, HORIZON + 20);
    g.addColorStop(0, '#1a1446');
    g.addColorStop(0.55, '#7a2f7d');
    g.addColorStop(1, '#ff8a5b');
    ctx.fillStyle = g;
    ctx.fillRect(-20, -20, this.W + 40, HORIZON + 40);
    // Sun
    const sg = ctx.createRadialGradient(this.W * 0.7, HORIZON - 40, 10, this.W * 0.7, HORIZON - 40, 120);
    sg.addColorStop(0, 'rgba(255,230,160,1)');
    sg.addColorStop(0.3, 'rgba(255,170,100,0.6)');
    sg.addColorStop(1, 'rgba(255,120,80,0)');
    ctx.fillStyle = sg;
    ctx.fillRect(0, 0, this.W, HORIZON + 20);
    // Skyline (two parallax layers)
    for (const b of this.skyline) {
      const par = b.layer === 0 ? 8 : 4;
      const x = b.x - this.camX * par;
      ctx.fillStyle = b.layer === 0 ? '#2a1a4a' : '#3b2463';
      ctx.fillRect(x, HORIZON - b.h, b.w, b.h + 2);
      if (b.layer === 0) {
        ctx.fillStyle = 'rgba(255,214,120,0.55)';
        for (let wy = HORIZON - b.h + 8; wy < HORIZON - 6; wy += 12) {
          for (let wx = 5; wx < b.w - 6; wx += 10) {
            if (hash1(b.seed + wx * 3.1 + wy * 7.7) > 0.62) ctx.fillRect(x + wx, wy, 4, 5);
          }
        }
      }
    }
  }

  private drawTrack(): void {
    const ctx = this.ctx;
    // Ground
    const gg = ctx.createLinearGradient(0, HORIZON, 0, this.H);
    gg.addColorStop(0, '#4a3b5c');
    gg.addColorStop(1, '#2b2233');
    ctx.fillStyle = gg;
    ctx.fillRect(-20, HORIZON, this.W + 40, this.H - HORIZON + 20);
    const zNear = NEAR;
    const half = LANE_W * 1.5 + 0.4;
    this.quad([-half, 0, zNear], [half, 0, zNear], [half, 0, FAR], [-half, 0, FAR], '#5a4a52');
    // Sleepers
    const off = this.distance % 1.6;
    for (let lane = 0; lane < 3; lane++) {
      const cx = laneX(lane);
      for (let z = -off + NEAR; z < 70; z += 1.6) {
        if (z < NEAR) continue;
        this.quad(
          [cx - 1.0, 0, z],
          [cx + 1.0, 0, z],
          [cx + 1.0, 0, z + 0.45],
          [cx - 1.0, 0, z + 0.45],
          '#7b5a43',
        );
      }
    }
    // Rails
    ctx.strokeStyle = '#c9c9d6';
    for (let lane = 0; lane < 3; lane++) {
      for (const rx of [-0.6, 0.6]) {
        const x = laneX(lane) + rx;
        const a = this.project(x, 0.05, NEAR);
        const b = this.project(x, 0.05, FAR);
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
    }
    // Side walls, segmented so they visibly stream past.
    const segLen = 10;
    const first = Math.floor((this.distance + NEAR) / segLen);
    for (let k = first + Math.ceil(FAR / segLen); k >= first; k--) {
      const z0 = Math.max(NEAR, k * segLen - this.distance);
      const z1 = k * segLen + segLen - this.distance;
      if (z1 <= NEAR) continue;
      const shadeAmt = hash1(k) > 0.5 ? 0 : -0.12;
      for (const side of [-1, 1]) {
        const x = side * WALL_X;
        this.quad([x, 0, z0], [x, 0, z1], [x, 4.2, z1], [x, 4.2, z0], shade('#5b4b8a', shadeAmt));
        if (hash1(k * 7 + side) > 0.55) {
          const gz0 = z0 + 2;
          const gz1 = Math.min(z1 - 2, gz0 + 5);
          if (gz1 > gz0) {
            const hue = Math.floor(hash1(k * 13 + side) * 360);
            this.quad([x, 0.8, gz0], [x, 0.8, gz1], [x, 2.6, gz1], [x, 2.6, gz0], `hsla(${hue},85%,60%,0.8)`);
          }
        }
        // Catenary poles every other segment
        if (k % 2 === 0) {
          const pz = k * segLen - this.distance;
          if (pz > NEAR) {
            const a = this.project(x - side * 0.3, 0, pz);
            const b = this.project(x - side * 0.3, 6.5, pz);
            ctx.strokeStyle = '#2d2445';
            ctx.lineWidth = Math.max(1, 0.25 * a.s);
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
          }
        }
      }
    }
  }

  private fogAlpha(rel: number): number {
    return clamp((FAR - rel) / 35, 0, 1);
  }

  private drawWorld(): void {
    type Item = { z: number; draw: () => void };
    const items: Item[] = [];
    for (const ob of this.obstacles) {
      const rel = ob.z - this.distance;
      if (rel > FAR || rel + ob.len < NEAR) continue;
      items.push({ z: rel, draw: () => this.drawObstacle(ob, rel) });
    }
    for (const c of this.coinList) {
      const rel = c.z - this.distance;
      if (rel > FAR * 0.8 || rel < NEAR + 0.5) continue;
      items.push({ z: rel, draw: () => this.drawCoin3d(c, rel) });
    }
    for (const p of this.powerList) {
      const rel = p.z - this.distance;
      if (rel > FAR * 0.8 || rel < NEAR + 0.5) continue;
      items.push({ z: rel, draw: () => this.drawPower(p, rel) });
    }
    items.push({ z: 0.01, draw: () => this.drawPlayer() });
    items.sort((a, b) => b.z - a.z);
    for (const it of items) it.draw();
    this.ctx.globalAlpha = 1;
  }

  private drawObstacle(ob: Obstacle, rel: number): void {
    const ctx = this.ctx;
    ctx.globalAlpha = this.fogAlpha(rel);
    const cx = laneX(ob.lane);
    const z0 = Math.max(rel, NEAR);
    const z1 = rel + ob.len;
    if (ob.kind === 'train') {
      const lv = LIVERIES[ob.livery] ?? LIVERIES[0]!;
      const hw = 1.05;
      const h = ob.h;
      const x0 = cx - hw;
      const x1 = cx + hw;
      // Visible side face
      if (x0 > this.camX) {
        this.quad([x0, 0, z0], [x0, 0, z1], [x0, h, z1], [x0, h, z0], shade(lv.body, -0.3));
        this.quad(
          [x0, h * 0.55, z0],
          [x0, h * 0.55, z1],
          [x0, h * 0.75, z1],
          [x0, h * 0.75, z0],
          shade(lv.stripe, -0.25),
        );
      } else if (x1 < this.camX) {
        this.quad([x1, 0, z0], [x1, 0, z1], [x1, h, z1], [x1, h, z0], shade(lv.body, -0.3));
        this.quad(
          [x1, h * 0.55, z0],
          [x1, h * 0.55, z1],
          [x1, h * 0.75, z1],
          [x1, h * 0.75, z0],
          shade(lv.stripe, -0.25),
        );
      }
      // Roof
      this.quad([x0, h, z0], [x1, h, z0], [x1, h, z1], [x0, h, z1], lv.roof);
      for (let cz = rel + 11; cz < z1 - 1; cz += 11) {
        if (cz > z0)
          this.quad(
            [x0, h + 0.01, cz],
            [x1, h + 0.01, cz],
            [x1, h + 0.01, cz + 0.4],
            [x0, h + 0.01, cz + 0.4],
            '#2b2b36',
          );
      }
      // Front face (only if the train front is ahead of the near plane)
      if (rel >= NEAR) {
        const a = this.project(x0, h, rel);
        const b = this.project(x1, 0, rel);
        const w = b.x - a.x;
        const hh = b.y - a.y;
        fillRoundRect(ctx, a.x, a.y, w, hh, w * 0.08, lv.body);
        fillRoundRect(ctx, a.x + w * 0.12, a.y + hh * 0.1, w * 0.76, hh * 0.32, w * 0.05, '#203050');
        ctx.fillStyle = 'rgba(160,220,255,0.35)';
        ctx.fillRect(a.x + w * 0.16, a.y + hh * 0.13, w * 0.25, hh * 0.08);
        ctx.fillStyle = lv.stripe;
        ctx.fillRect(a.x, a.y + hh * 0.55, w, hh * 0.1);
        const lightOn = ob.vz !== 0;
        ctx.fillStyle = lightOn ? '#fff8c0' : '#ffd27a';
        const lr = Math.max(1.5, w * 0.07);
        ctx.beginPath();
        ctx.arc(a.x + w * 0.2, a.y + hh * 0.8, lr, 0, TAU);
        ctx.arc(a.x + w * 0.8, a.y + hh * 0.8, lr, 0, TAU);
        ctx.fill();
        if (lightOn) {
          ctx.globalAlpha *= 0.35 + 0.25 * Math.sin(this.time * 12);
          const glow = ctx.createRadialGradient(
            a.x + w / 2,
            a.y + hh * 0.8,
            0,
            a.x + w / 2,
            a.y + hh * 0.8,
            w,
          );
          glow.addColorStop(0, 'rgba(255,250,200,0.9)');
          glow.addColorStop(1, 'rgba(255,250,200,0)');
          ctx.fillStyle = glow;
          ctx.fillRect(a.x - w / 2, a.y, w * 2, hh * 1.4);
        }
      }
    } else if (ob.kind === 'ramp') {
      const hw = 1.0;
      const x0 = cx - hw;
      const x1 = cx + hw;
      const y0 = ob.h * clamp((z0 - rel) / ob.len, 0, 1);
      this.quad([x0, y0, z0], [x1, y0, z0], [x1, ob.h, z1], [x0, ob.h, z1], '#c08a3e');
      for (let i = 1; i < 6; i++) {
        const t = i / 6;
        const z = rel + ob.len * t;
        if (z > z0)
          this.quad(
            [x0, ob.h * t, z],
            [x1, ob.h * t, z],
            [x1, ob.h * t + 0.05, z + 0.25],
            [x0, ob.h * t + 0.05, z + 0.25],
            '#8a5f28',
          );
      }
      if (x0 > this.camX) this.quad([x0, 0, z0], [x0, 0, z1], [x0, ob.h, z1], [x0, y0, z0], '#7a5424');
      else if (x1 < this.camX) this.quad([x1, 0, z0], [x1, 0, z1], [x1, ob.h, z1], [x1, y0, z0], '#7a5424');
    } else {
      if (rel < NEAR) return;
      const low = ob.kind === 'low';
      const y0 = low ? 0.35 : 1.25;
      const y1 = low ? 1.0 : 2.6;
      const a = this.project(cx - 1.05, y1, rel);
      const b = this.project(cx + 1.05, y0, rel);
      const postW = Math.max(2, 0.14 * a.s);
      const ground = this.project(cx, 0, rel);
      ctx.fillStyle = '#d9d9e3';
      ctx.fillRect(a.x + postW * 0.5, a.y, postW, ground.y - a.y);
      ctx.fillRect(b.x - postW * 1.5, a.y, postW, ground.y - a.y);
      const w = b.x - a.x;
      const hh = b.y - a.y;
      ctx.fillStyle = low ? '#f4f4f4' : '#ffd23f';
      ctx.fillRect(a.x, a.y, w, hh);
      ctx.save();
      ctx.beginPath();
      ctx.rect(a.x, a.y, w, hh);
      ctx.clip();
      ctx.fillStyle = low ? '#e63946' : '#1d1d1d';
      const stripe = Math.max(4, w / 7);
      for (let sx = a.x - hh; sx < a.x + w + hh; sx += stripe * 2) {
        ctx.beginPath();
        ctx.moveTo(sx, a.y + hh);
        ctx.lineTo(sx + stripe, a.y + hh);
        ctx.lineTo(sx + stripe + hh, a.y);
        ctx.lineTo(sx + hh, a.y);
        ctx.fill();
      }
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  private drawCoin3d(c: Coin, rel: number): void {
    const p = this.project(c.x, c.y, rel);
    this.ctx.globalAlpha = this.fogAlpha(rel);
    drawCoin(this.ctx, p.x, p.y, Math.max(1.5, 0.34 * p.s), Math.cos(this.time * 5 + c.z * 0.3));
    this.ctx.globalAlpha = 1;
  }

  private drawPower(pw: Power, rel: number): void {
    const ctx = this.ctx;
    const bob = Math.sin(this.time * 4 + pw.z) * 0.15;
    const p = this.project(laneX(pw.lane), 1.2 + bob, rel);
    const r = Math.max(3, 0.55 * p.s);
    const info = POWER_INFO[pw.kind];
    ctx.globalAlpha = this.fogAlpha(rel);
    const g = ctx.createRadialGradient(p.x, p.y, r * 0.2, p.x, p.y, r * 1.6);
    g.addColorStop(0, info.color);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r * 1.6, 0, TAU);
    ctx.fill();
    ctx.fillStyle = 'rgba(20,20,40,0.85)';
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = info.color;
    ctx.lineWidth = Math.max(1, r * 0.15);
    ctx.stroke();
    this.drawPowerIcon(pw.kind, p.x, p.y, r * 0.6);
    ctx.globalAlpha = 1;
  }

  private drawPowerIcon(kind: PowerKind, x: number, y: number, r: number): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(x, y);
    ctx.lineCap = 'round';
    switch (kind) {
      case 'magnet':
        ctx.strokeStyle = '#ff4d6d';
        ctx.lineWidth = r * 0.45;
        ctx.beginPath();
        ctx.arc(0, -r * 0.1, r * 0.6, Math.PI, 0, true);
        ctx.stroke();
        ctx.strokeStyle = '#eee';
        ctx.beginPath();
        ctx.moveTo(-r * 0.6, -r * 0.1);
        ctx.lineTo(-r * 0.6, -r * 0.6);
        ctx.moveTo(r * 0.6, -r * 0.1);
        ctx.lineTo(r * 0.6, -r * 0.6);
        ctx.stroke();
        break;
      case 'double':
        text(ctx, '2X', 0, 0, { size: r * 1.3, align: 'center', color: '#ffd23f', stroke: null });
        break;
      case 'sneakers':
        ctx.fillStyle = '#4dd9ff';
        ctx.beginPath();
        ctx.moveTo(-r, r * 0.4);
        ctx.lineTo(-r * 0.7, -r * 0.6);
        ctx.lineTo(-r * 0.1, -r * 0.6);
        ctx.lineTo(0, -r * 0.1);
        ctx.lineTo(r, r * 0.1);
        ctx.lineTo(r, r * 0.4);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.fillRect(-r, r * 0.3, r * 2, r * 0.22);
        break;
      case 'jetpack':
        ctx.fillStyle = '#b06bff';
        fillRoundRect(ctx, -r * 0.6, -r * 0.8, r * 0.5, r * 1.3, r * 0.2, '#b06bff');
        fillRoundRect(ctx, r * 0.1, -r * 0.8, r * 0.5, r * 1.3, r * 0.2, '#b06bff');
        ctx.fillStyle = '#ffb703';
        ctx.beginPath();
        ctx.moveTo(-r * 0.55, r * 0.5);
        ctx.lineTo(-r * 0.35, r);
        ctx.lineTo(-r * 0.15, r * 0.5);
        ctx.moveTo(r * 0.15, r * 0.5);
        ctx.lineTo(r * 0.35, r);
        ctx.lineTo(r * 0.55, r * 0.5);
        ctx.fill();
        break;
    }
    ctx.restore();
  }

  private drawPlayer(): void {
    const ctx = this.ctx;
    const ground = this.groundAt(this.px).h;
    // Shadow
    const sh = this.project(this.px, ground, 0);
    const shadowScale = clamp(1 - (this.py - ground) / 8, 0.3, 1);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.ellipse(sh.x, sh.y, 0.55 * sh.s * shadowScale, 0.2 * sh.s * shadowScale, 0, 0, TAU);
    ctx.fill();

    const base = this.project(this.px, this.py, 0);
    const s = base.s;
    const blink = this.graceT > 0 && Math.floor(this.time * 14) % 2 === 0;
    if (blink) ctx.globalAlpha = 0.45;
    const body = this.skinColor('body', '#e63946');
    const accent = this.skinColor('accent', '#1d3557');
    const skin = this.skinColor('skin', '#f1c27d');
    const hair = this.skinColor('hair', '#2b2118');
    const shoes = this.skinColor('shoes', '#f8f9fa');
    ctx.save();
    ctx.translate(base.x, base.y);
    if (this.crashed) ctx.rotate(-0.9 * Math.min(1, this.crashT * 3));

    if (this.rollT > 0) {
      const r = 0.55 * s;
      ctx.rotate(this.runPhase * 2);
      ctx.fillStyle = body;
      ctx.beginPath();
      ctx.arc(0, -r, r, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = accent;
      ctx.lineWidth = r * 0.25;
      ctx.beginPath();
      ctx.arc(0, -r, r * 0.65, 0, Math.PI);
      ctx.stroke();
      ctx.fillStyle = hair;
      ctx.beginPath();
      ctx.arc(0, -r * 1.55, r * 0.4, 0, TAU);
      ctx.fill();
    } else {
      const airborne = !this.grounded;
      const ph = airborne ? 0.6 : Math.sin(this.runPhase);
      const legLen = 0.8 * s;
      const legW = 0.2 * s;
      // Legs (seen from behind)
      for (const side of [-1, 1]) {
        const swing = ph * side;
        fillRoundRect(
          ctx,
          side * 0.13 * s - legW / 2,
          -legLen - swing * 0.1 * s,
          legW,
          legLen * (0.85 + 0.15 * swing),
          legW * 0.4,
          accent,
        );
        const shoe = this.powers.sneakers > 0 ? '#4dd9ff' : shoes;
        fillRoundRect(
          ctx,
          side * 0.13 * s - legW * 0.6,
          -0.12 * s - swing * 0.12 * s,
          legW * 1.2,
          0.14 * s,
          0.05 * s,
          shoe,
        );
      }
      // Torso
      const torsoY = -legLen - 0.65 * s;
      fillRoundRect(ctx, -0.32 * s, torsoY, 0.64 * s, 0.72 * s, 0.14 * s, body);
      // Backpack / jetpack
      if (this.powers.jetpack > 0) {
        fillRoundRect(ctx, -0.3 * s, torsoY + 0.05 * s, 0.24 * s, 0.55 * s, 0.08 * s, '#8d5cf6');
        fillRoundRect(ctx, 0.06 * s, torsoY + 0.05 * s, 0.24 * s, 0.55 * s, 0.08 * s, '#8d5cf6');
      } else {
        fillRoundRect(ctx, -0.22 * s, torsoY + 0.1 * s, 0.44 * s, 0.4 * s, 0.1 * s, shade(accent, 0.15));
      }
      // Arms
      for (const side of [-1, 1]) {
        const swing = -ph * side;
        ctx.save();
        ctx.translate(side * 0.36 * s, torsoY + 0.1 * s);
        ctx.rotate(swing * 0.5 + side * (airborne ? 0.6 : 0.1));
        fillRoundRect(ctx, -0.08 * s, 0, 0.16 * s, 0.55 * s, 0.07 * s, body);
        ctx.fillStyle = skin;
        ctx.beginPath();
        ctx.arc(0, 0.58 * s, 0.08 * s, 0, TAU);
        ctx.fill();
        ctx.restore();
      }
      // Head from behind
      ctx.fillStyle = skin;
      ctx.beginPath();
      ctx.arc(0, torsoY - 0.2 * s, 0.24 * s, 0, TAU);
      ctx.fill();
      ctx.fillStyle = hair;
      ctx.beginPath();
      ctx.arc(0, torsoY - 0.22 * s, 0.24 * s, Math.PI * 1.05, Math.PI * 1.95, true);
      ctx.fill();
      ctx.fillStyle = accent;
      ctx.beginPath();
      ctx.arc(0, torsoY - 0.3 * s, 0.25 * s, Math.PI, 0);
      ctx.fill();
    }
    ctx.restore();
    if (this.shield || this.graceT > 0) {
      ctx.globalAlpha = this.shield ? 0.35 + 0.1 * Math.sin(this.time * 6) : 0.2;
      ctx.strokeStyle = '#7cf';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(base.x, base.y - 0.9 * s, 1.15 * s, 0, TAU);
      ctx.stroke();
      ctx.fillStyle = 'rgba(120,200,255,0.15)';
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  private drawHud(): void {
    const ctx = this.ctx;
    hudPill(ctx, 14, 14, 150, 44);
    drawCoin(ctx, 38, 36, 13);
    text(ctx, `${this.coins}`, 60, 37, { size: 24 });
    hudPill(ctx, this.W - 214, 14, 200, 44);
    text(ctx, `${Math.floor(this.score).toLocaleString('en-US')}`, this.W - 28, 37, {
      size: 26,
      align: 'right',
    });
    const mult = this.multiplier();
    text(ctx, `x${mult}`, this.W - 200, 37, {
      size: 20,
      color: mult > 1 ? '#ffd23f' : '#aab',
      align: 'left',
    });
    text(ctx, `${Math.floor(this.distance)} m`, this.W - 28, 76, { size: 18, align: 'right', color: '#dde' });

    let y = 76;
    for (const k of Object.keys(this.powers) as PowerKind[]) {
      const t = this.powers[k];
      if (t <= 0) continue;
      const info = POWER_INFO[k];
      hudPill(ctx, 14, y, 170, 34);
      this.drawPowerIcon(k, 34, y + 17, 9);
      progressBar(ctx, 52, y + 12, 118, 10, t / this.powerTime(info.base), info.color);
      y += 40;
    }
    if (this.shield) {
      hudPill(ctx, 14, y, 120, 34);
      text(ctx, 'GUARDIAN', 74, y + 17, { size: 14, align: 'center', color: '#7cf' });
    }
    if (this.stumbleT > 0 && !this.crashed) {
      text(ctx, 'CAREFUL!', this.W / 2, 120, { size: 26, align: 'center', color: '#ff6b6b' });
    }
    if (this.bannerT < 2.2) {
      banner(ctx, this.W, this.H, 'RUN!', 'Swipe or use arrow keys', this.bannerT / 2.2, '#ffd23f');
    }
  }
}
