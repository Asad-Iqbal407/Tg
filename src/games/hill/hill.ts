import type { EngineSound } from '../../core/audio';
import { FloatingTexts } from '../../core/fx';
import { clamp, damp, lerp, TAU, wrapAngle } from '../../core/math';
import { BaseGame } from '../base';
import { drawCoin, fillRoundRect, hudPill, progressBar, text } from '../draw';
import type { GameServices } from '../types';
import { carStyle, type CarPaint, type CarPose, type CarStyle, drawCar, drawJerrycan } from './art';
import { BIOME_M, biomeAt, biomeIndexAt, biomeSerial, lapAt, physicsAt } from './biomes';
import { Scenery, type View } from './scenery';
import { type Kicker, PX_PER_M, Terrain } from './terrain';
import { FRONT, HEAD, REAR, Vehicle, type VehicleSpec } from './vehicle';

interface Pickup {
  kind: 'coin' | 'fuel';
  value: number;
  x: number;
  y: number;
  taken: boolean;
}

/** Collected coin flying to the HUD counter (screen space). */
interface Flyer {
  x: number;
  y: number;
  t: number;
}

/** Read-only telemetry, for tests and tooling. */
export interface HillProbe {
  x: number;
  y: number;
  vx: number;
  vy: number;
  speed: number;
  angle: number;
  angularVelocity: number;
  rearDown: boolean;
  frontDown: boolean;
  /** Seconds with no point touching the ground. */
  airT: number;
  fuel: number;
  fuelCap: number;
  meters: number;
  crashed: boolean;
  crashReason: string;
  kickers: readonly Kicker[];
  /** Ground angle (radians, positive = downhill) at world x. */
  groundAngle(x: number): number;
}

const FUEL_IDLE = 1.2;
const FUEL_BURN = 3;
/**
 * Out of fuel: the run ends OUT_END s after the tank empties once the car has stopped (slower
 * than SLOW_SPEED for SLOW_END s), or after OUT_STALL s without covering new ground.
 */
const SLOW_SPEED = 25;
const SLOW_END = 1;
const OUT_END = 3;
const OUT_STALL = 3.5;
/** Tail stand / roof / side: tilted beyond TIP_ANGLE while resting for TIP_END seconds. */
const TIP_ANGLE = 1.35;
const TIP_END = 2;
/** A flip needs ~305° of rotation in the air and a landing on both wheels within this angle. */
const FLIP_SLACK = 0.95;
const LAND_TOLERANCE = 0.6;
const BANNER_TIME = 2.6;

/** HUD pill sizes at the desktop scale, in logical px. */
const HUD_EDGE = 14;
const HUD_GAP = 10;
const FUEL_W = 230;
const COIN_W = 120;
const DIST_W = 170;
const SPEED_W = 104;
const CHIP_W = 150;
/**
 * Touch screens show the canvas at well under 1x (a phone in landscape draws 960 logical px in about
 * 690 CSS px), so their HUD type and pill height grow by TOUCH_TEXT and the pills by TOUCH_PILLS.
 */
const TOUCH_TEXT = 1.4;
const TOUCH_PILLS = 1.15;

interface HudLayout {
  /** Text and pill height scale. */
  s: number;
  /** Pill width scale. */
  k: number;
  ph: number;
  /** True when the pills no longer fit one row, so the coins and speed drop to a second row. */
  stacked: boolean;
  /** Bottom edge of the whole HUD block, in logical px. */
  bottom: number;
}

/** Layout for a canvas `W` wide: one row of pills when they fit, two rows when they do not. */
function hudLayout(W: number, touch: boolean, shield: boolean, insetTop: number): HudLayout {
  const s = touch ? TOUCH_TEXT : 1;
  const k = touch ? TOUCH_PILLS : 1;
  const ph = 44 * s;
  const top = HUD_EDGE + insetTop;
  const gaps = shield ? 4 : 3;
  const row = 2 * HUD_EDGE + k * (FUEL_W + COIN_W + SPEED_W + DIST_W + gaps * HUD_GAP) + (shield ? ph : 0);
  const stacked = row > W;
  const chipH = 26 * s;
  // One row: the next-fuel chip sits under the fuel pill. Two rows: the chip sits under the second row.
  const bottom = stacked
    ? top + ph + 8 * s + ph + 6 * s + chipH
    : Math.max(top + ph + 6 * s + chipH, top + ph + 16 * s + 21 * s);
  return { s, k, ph, stacked, bottom };
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

const FLIP_NAMES = ['', '', 'DOUBLE ', 'TRIPLE ', 'QUAD '];

export class HillGame extends BaseGame {
  private readonly terrain: Terrain;
  private readonly car: Vehicle;
  private readonly scenery: Scenery;
  private readonly style: CarStyle;
  private readonly paint: CarPaint;
  private readonly startX = 200;
  private readonly env = { gravity: 1, grip: 1 };
  private readonly envTarget = { gravity: 1, grip: 1 };
  private readonly worldTexts = new FloatingTexts();
  private camX = 0;
  private camY = 0;
  private zoom = 1;
  private maxX = 0;
  private progressT = 0;
  private fuel: number;
  private readonly fuelCap: number;
  /** Fuel can spacing scales with the vehicle's tank (not the boosted one). */
  private readonly fuelRange: number;
  private pickups: Pickup[] = [];
  private spawnedTo = 0;
  private arcsSpawned = 0;
  private nextFuelM = 240;
  private fuelCount = 0;
  private nextFuelX = Infinity;
  private flyers: Flyer[] = [];

  private airTime = 0;
  private airAngle = 0;
  private lastAngle = 0;
  private pendingFlips = 0;
  private pendingDir = 0;
  private pendingAir = 0;
  private landT = 0;

  private tipT = 0;
  private fuelOutT = 0;
  private slowT = 0;
  /** Seconds on an empty tank without new ground, and the furthest x reached since it ran dry. */
  private outStallT = 0;
  private outMaxX = 0;
  private crashed = false;
  private crashReason = '';
  private shield: boolean;
  private graceT = 0;

  private bannerT = 0;
  private bannerTitle = '';
  private bannerSub = '';
  private biomeNo = 0;
  private hintT = 0;
  private hint = '';
  private airHintShown = false;
  private nextMilestone = 500;
  private engine: EngineSound | null = null;
  private destroyed = false;
  private throttle = 0;
  private brake = 0;

  constructor(s: GameServices) {
    super(s);
    const spec: VehicleSpec = {
      power: this.skinParam('power', 1),
      maxSpeed: this.skinParam('maxSpeed', 540),
      grip: this.skinParam('grip', 0.32),
      wheelR: this.skinParam('wheelRadius', 20),
      suspension: this.skinParam('suspension', 0.35),
      airControl: this.skinParam('airControl', 1),
    };
    this.terrain = new Terrain(this.rng.int(1, 100000), 330, {
      origin: this.startX,
      designSpeed: Math.min(620, spec.maxSpeed * 0.95),
    });
    this.car = new Vehicle(this.terrain, spec);
    this.scenery = new Scenery(this.ctx, this.W, this.H, this.startX);
    this.style = carStyle(s.loadout.skin.id, this.skinParam('style', 0));
    this.paint = {
      body: this.skinColor('body', '#e63946'),
      trim: this.skinColor('trim', '#1d3557'),
      helmet: this.skinColor('helmet', '#ffd23f'),
    };
    const tank = this.skinParam('fuel', 100);
    this.fuelRange = tank / 100;
    this.fuelCap = tank * (this.hasBoost('head-start') ? 1.5 : 1);
    this.fuel = this.fuelCap;
    this.shield = this.hasBoost('shield');
    this.car.reset(this.startX, 0);
    this.maxX = this.car.center().x;
    this.lastAngle = this.car.angle();
    this.snapCamera();
    this.spawnPickups(this.startX + 3000);
    this.showBanner(biomeAt(0).name.toUpperCase(), '');
  }

  override destroy(): void {
    this.destroyed = true;
    this.engine?.stop();
    this.engine = null;
  }

  private get meters(): number {
    return Math.max(0, (this.maxX - this.startX) / PX_PER_M);
  }

  private metersAt(x: number): number {
    return (x - this.startX) / PX_PER_M;
  }

  /** Touch UI: on-screen pedals are showing, or the player last used touch. */
  private get touchUi(): boolean {
    return this.insets.bottom > 0 || this.input.pointer.touch;
  }

  probe(): HillProbe {
    const c = this.car.center();
    return {
      x: c.x,
      y: c.y,
      vx: this.car.velocityX(),
      vy: this.car.velocityY(),
      speed: this.car.speed(),
      angle: this.car.angle(),
      angularVelocity: this.car.angularVelocity(),
      rearDown: this.car.wheelDown(REAR),
      frontDown: this.car.wheelDown(FRONT),
      airT: this.car.airT,
      fuel: this.fuel,
      fuelCap: this.fuelCap,
      meters: this.meters,
      crashed: this.crashed,
      crashReason: this.crashReason,
      kickers: this.terrain.kickers,
      groundAngle: (x: number) => Math.atan(this.terrain.slopeAt(x)),
    };
  }

  // ------------------------------------------------------------------ simulation

  protected tick(dt: number): void {
    this.bannerT += dt;
    this.hintT = Math.max(0, this.hintT - dt);
    this.graceT = Math.max(0, this.graceT - dt);
    this.worldTexts.update(dt);
    if (!this.engine && !this.crashed && !this.destroyed && !this.services.preview)
      this.engine = this.audio.engine();

    const live = !this.crashed;
    const gas =
      live && (this.input.isDown('right') || this.input.isDown('up') || this.input.isDown('primary'));
    const brk =
      live && (this.input.isDown('left') || this.input.isDown('down') || this.input.isDown('secondary'));
    const hasFuel = this.fuel > 0;
    this.throttle = gas && hasFuel ? 1 : 0;
    // Braking needs no fuel (only reversing does).
    this.brake = brk ? 1 : 0;

    // Biome physics follow the car's position and only change while it is on the ground.
    const c0 = this.car.center();
    physicsAt(this.metersAt(c0.x), this.envTarget);
    if (this.car.airT === 0) {
      const k = damp(5, dt);
      this.env.gravity += (this.envTarget.gravity - this.env.gravity) * k;
      this.env.grip += (this.envTarget.grip - this.env.grip) * k;
    }
    this.car.step(dt, { throttle: this.throttle, brake: this.brake, canReverse: hasFuel }, this.env);

    const c = this.car.center();
    const prevMax = this.maxX;
    if (c.x > this.maxX + 1) {
      this.maxX = c.x;
      this.progressT = 0;
    } else this.progressT += dt;
    this.score += ((this.maxX - prevMax) / PX_PER_M) * 10;
    this.maxStat('distance', this.meters);
    this.checkProgress();

    if (!this.crashed) {
      const reversing = this.brake > 0 && hasFuel && this.car.velocityX() < 5 ? 1 : 0;
      this.fuel = Math.max(0, this.fuel - dt * (FUEL_IDLE + FUEL_BURN * Math.max(this.throttle, reversing)));
    }
    this.checkFuel(dt);
    this.trackAir(dt);
    this.checkCrash(dt);
    this.collectPickups();
    this.spawnPickups(this.maxX + 2500);
    this.prunePickups(c.x - 1500);
    this.updateFlyers(dt);
    this.updateCamera(dt);
    this.effects(dt);
  }

  private checkProgress(): void {
    const serial = biomeSerial(this.meters);
    if (serial !== this.biomeNo) {
      this.biomeNo = serial;
      const b = biomeAt(this.meters);
      const lap = lapAt(this.meters);
      this.showBanner(
        lap > 1 ? `${b.name.toUpperCase()} ${'I'.repeat(Math.min(lap, 3))}` : b.name.toUpperCase(),
        lap > 1 && biomeIndexAt(this.meters) === 0 ? `Lap ${lap}: tougher hills` : b.hint,
      );
      this.audio.play('levelup');
    }
    if (this.meters >= this.nextMilestone) {
      const bonus = 5 * Math.min(3, this.nextMilestone / 500);
      this.coins += bonus;
      this.score += 500;
      this.texts.add(
        this.W / 2,
        this.H * 0.36,
        `${this.nextMilestone} m! +${bonus} coins`,
        '#ffd23f',
        28,
        1.4,
      );
      this.audio.play('reward');
      this.nextMilestone += 500;
    }
    // One-time air control tip as the first jump comes up.
    const k = this.terrain.kickers[0];
    if (!this.airHintShown && k && this.maxX > k.start - 300) {
      this.airHintShown = true;
      this.hint = this.touchUi
        ? 'In the air: GAS tilts back, BRAKE tilts forward'
        : 'In the air: → tilts back, ← tilts forward';
      this.hintT = 4;
    }
  }

  private showBanner(title: string, sub: string): void {
    this.bannerTitle = title;
    this.bannerSub = sub;
    this.bannerT = 0;
  }

  /** Out of fuel: the run winds down a few seconds after the tank empties, once the car stops. */
  private checkFuel(dt: number): void {
    if (this.crashed || this.fuel > 0) {
      this.fuelOutT = this.slowT = this.outStallT = 0;
      this.outMaxX = this.maxX;
      return;
    }
    if (this.fuelOutT === 0) {
      this.audio.play('empty');
      this.outMaxX = this.maxX;
    }
    this.fuelOutT += dt;
    this.slowT = this.car.speed() < SLOW_SPEED ? this.slowT + dt : 0;
    if (this.maxX > this.outMaxX + 1) {
      this.outMaxX = this.maxX;
      this.outStallT = 0;
    } else this.outStallT += dt;
    if ((this.fuelOutT >= OUT_END && this.slowT >= SLOW_END) || this.outStallT >= OUT_STALL)
      this.crash('Out of fuel!');
  }

  /** 0..1 progress towards the out-of-fuel ending (for the HUD ring). */
  private get fuelEndProgress(): number {
    if (this.fuel > 0) return 0;
    return clamp(Math.max(this.fuelOutT / OUT_END, this.outStallT / OUT_STALL), 0, 1);
  }

  private trackAir(dt: number): void {
    const a = this.car.angle();
    const delta = wrapAngle(a - this.lastAngle);
    this.lastAngle = a;
    if (this.crashed) {
      this.pendingFlips = 0;
      this.airTime = 0;
      return;
    }
    if (this.car.airT > 0) {
      this.airTime += dt;
      this.airAngle += delta;
    } else if (this.airTime > 0) {
      // Touchdown: the stunt counts once the car settles on both wheels, the right way up.
      if (this.airTime > 0.3) {
        this.pendingFlips = Math.floor((Math.abs(this.airAngle) + FLIP_SLACK) / TAU);
        this.pendingDir = Math.sign(this.airAngle);
        this.pendingAir = this.airTime;
        this.landT = 0.6;
      }
      this.airTime = 0;
      this.airAngle = 0;
    }
    if (this.landT <= 0) return;
    this.landT -= dt;
    const c = this.car.center();
    const clean =
      this.car.wheelDown(REAR) &&
      this.car.wheelDown(FRONT) &&
      Math.abs(wrapAngle(a - Math.atan(this.terrain.slopeAt(c.x)))) < LAND_TOLERANCE;
    if (clean) {
      this.landT = 0;
      this.awardLanding();
    } else if (this.landT <= 0) this.pendingFlips = 0;
  }

  private awardLanding(): void {
    const n = this.pendingFlips;
    const y = this.H * 0.42;
    if (n > 0) {
      const pts = (250 * n * (n + 1)) / 2;
      this.addStat('flips', n);
      this.score += pts;
      this.coins += 2 * n;
      this.audio.play('flip', { pitch: 1 + 0.12 * (n - 1) });
      this.services.haptic(30);
      const name = `${FLIP_NAMES[Math.min(n, 4)]}${this.pendingDir < 0 ? 'BACKFLIP' : 'FRONTFLIP'}`;
      this.texts.add(this.W / 2, y, `${name}! +${pts}`, '#ff9cf0', 30, 1.3);
    }
    const air = this.pendingAir;
    if (air > 1) {
      const bonus = Math.floor(air * 100);
      this.score += bonus;
      this.texts.add(this.W / 2, y + 38, `AIR TIME ${air.toFixed(1)}s +${bonus}`, '#4dd9ff', 24, 1.2);
    }
    this.maxStat('airtime', air);
    this.pendingFlips = 0;
  }

  private checkCrash(dt: number): void {
    if (this.crashed || this.graceT > 0) return;
    if (this.car.headDown()) {
      this.crash('Driver down!');
      return;
    }
    const a = Math.abs(wrapAngle(this.car.angle()));
    // Standing on the tail, lying on the roof or on the side: nothing recovers that.
    const resting = this.car.bodyDown() || this.car.speed() < 30;
    if (a > TIP_ANGLE && resting) this.tipT += dt;
    else this.tipT = Math.max(0, this.tipT - dt * 2);
    if (this.tipT > TIP_END || (a > 1.2 && this.progressT > 5)) this.crash('Flipped over!');
  }

  private crash(reason: string): void {
    if (this.shield && reason !== 'Out of fuel!') {
      this.shield = false;
      this.graceT = 1.5;
      this.audio.play('pop');
      this.texts.add(this.W / 2, this.H * 0.36, 'GUARDIAN SAVE!', '#7cf', 30, 1.2);
      const x = this.car.center().x;
      this.car.reset(x, Math.atan(this.terrain.slopeAt(x)));
      this.lastAngle = this.car.angle();
      this.tipT = this.airTime = this.airAngle = this.landT = 0;
      this.pendingFlips = 0;
      this.progressT = 0;
      return;
    }
    this.crashed = true;
    this.crashReason = reason;
    this.throttle = this.brake = 0;
    this.engine?.stop();
    this.engine = null;
    if (reason === 'Out of fuel!') {
      this.endGame(1.6);
      return;
    }
    this.shake.add(0.6);
    this.audio.play('hit');
    const h = this.car.pts[HEAD];
    if (h)
      this.particles.emit({
        x: h.x,
        y: h.y,
        count: 26,
        speed: 240,
        life: 0.8,
        size: 5,
        colors: ['#fff', '#ffd23f', '#ff6b6b'],
        gravity: 500,
      });
    this.endGame(1.8);
  }

  // ------------------------------------------------------------------ pickups

  private spawnPickups(toX: number): void {
    this.terrain.ensureTo(toX + 1500);
    const kickers = this.terrain.kickers;
    while (this.arcsSpawned < kickers.length && (kickers[this.arcsSpawned] as Kicker).lip < toX) {
      this.spawnArc(kickers[this.arcsSpawned] as Kicker);
      this.arcsSpawned++;
    }
    while (this.spawnedTo < toX) {
      let x = Math.max(this.startX + 400, this.spawnedTo) + this.rng.range(1200, 2000);
      const k = this.terrain.kickerAt(x);
      if (k) x = k.end + 60;
      const m = this.metersAt(x);
      if (m >= this.nextFuelM) {
        this.pickups.push({ kind: 'fuel', value: 0, x, y: this.terrain.heightAt(x) - 30, taken: false });
        this.nextFuelX = Math.min(this.nextFuelX, x);
        this.nextFuelM = m + this.fuelGap() + this.rng.range(-25, 25);
        this.fuelCount++;
        this.spawnedTo = x + 60;
        continue;
      }
      const n = this.rng.int(2, 4);
      const roll = this.rng.next();
      const value = roll < 0.04 ? 5 : roll < 0.16 ? 2 : 1;
      let cx = x;
      for (let i = 0; i < n; i++, cx += 34) {
        if (this.terrain.kickerAt(cx)) break;
        this.pickups.push({ kind: 'coin', value, x: cx, y: this.terrain.heightAt(cx) - 34, taken: false });
      }
      this.spawnedTo = cx;
    }
  }

  /**
   * Spacing (m) to the next fuel can, scaled by the vehicle's tank. The cap sits inside what a full
   * tank covers at full throttle (about 430 m for the Trail Jeep), so the next can is always reachable.
   */
  private fuelGap(): number {
    return Math.min(360, 240 + 20 * this.fuelCount) * this.fuelRange;
  }

  /** Bonus coins along the flight path of a well-taken jump. */
  private spawnArc(k: Kicker): void {
    const lipY = this.terrain.heightAt(k.lip);
    const g = 980 * biomeAt(this.metersAt(k.lip)).gravity;
    const v = this.car.spec.maxSpeed * 0.82;
    const vx = v * Math.cos(k.lipAngle);
    const vy = -v * Math.sin(k.lipAngle);
    for (let i = 1; i <= 5; i++) {
      const t = 0.12 + i * 0.11;
      const x = k.lip + vx * t;
      const y = lipY - 34 + vy * t + 0.5 * g * t * t;
      if (y > this.terrain.heightAt(x) - 40) break;
      this.pickups.push({ kind: 'coin', value: 1, x, y, taken: false });
    }
  }

  private prunePickups(minX: number): void {
    let j = 0;
    for (const p of this.pickups) if (!p.taken && p.x > minX) this.pickups[j++] = p;
    this.pickups.length = j;
  }

  private collectPickups(): void {
    if (this.crashed) return;
    let nextFuel = Infinity;
    for (const pk of this.pickups) {
      if (pk.taken) continue;
      let hit = false;
      for (const p of this.car.pts) {
        const dx = p.x - pk.x;
        const dy = p.y - pk.y;
        const r = p.r + 18;
        if (dx * dx + dy * dy < r * r) {
          hit = true;
          break;
        }
      }
      if (!hit) {
        if (pk.kind === 'fuel') nextFuel = Math.min(nextFuel, pk.x);
        continue;
      }
      pk.taken = true;
      if (pk.kind === 'fuel') {
        this.fuel = this.fuelCap;
        this.addStat('fuelCans');
        this.audio.play('fuel');
        this.worldTexts.add(pk.x, pk.y - 24, 'FUEL!', '#ff6b6b', 26);
      } else {
        this.coins += pk.value;
        this.score += pk.value * 10;
        this.audio.play('coin', {
          volume: 0.6,
          pitch: pk.value > 1 ? 0.8 : 1 + 0.02 * (this.flyers.length % 6),
        });
        if (pk.value > 1) this.worldTexts.add(pk.x, pk.y - 18, `+${pk.value}`, '#ffd23f', 20);
        if (this.flyers.length < 12)
          this.flyers.push({ x: (pk.x - this.camX) * this.zoom, y: (pk.y - this.camY) * this.zoom, t: 0 });
      }
    }
    this.nextFuelX = nextFuel;
  }

  private updateFlyers(dt: number): void {
    let j = 0;
    for (const f of this.flyers) {
      f.t += dt / 0.45;
      if (f.t < 1) this.flyers[j++] = f;
    }
    this.flyers.length = j;
  }

  // ------------------------------------------------------------------ camera & effects

  /** Top of the playfield, below the HUD. Desktop keeps its original 80 px. */
  private hudTop(): number {
    if (!this.touchUi) return this.insets.top + 80;
    return hudLayout(this.W, true, this.shield, this.insets.top).bottom + 8;
  }

  private snapCamera(): void {
    this.updateCamera(0);
  }

  /** Look ahead in the direction of travel and towards the hills ahead; zoom out with speed. */
  private updateCamera(dt: number): void {
    const c = this.car.center();
    const vx = this.car.velocityX();
    const speed = this.car.speed();
    const t = this.terrain;
    let dh = 0;
    for (let d = 150; d <= 600; d += 150) dh = Math.max(dh, Math.abs(t.heightAt(c.x + d) - c.y));
    const zTarget =
      lerp(1, 0.8, clamp(speed / this.car.spec.maxSpeed, 0, 1)) * (dh > 0.45 * this.H ? 0.9 : 1);
    this.zoom = dt > 0 ? this.zoom + (zTarget - this.zoom) * damp(2, dt) : zTarget;
    const z = this.zoom;

    const look = clamp(vx * 0.3, -0.1 * this.W, 0.2 * this.W);
    const carSx = Math.min(0.38 * this.W, 360) - look;
    const tx = c.x - Math.max(0.16 * this.W, carSx) / z;

    const top = this.hudTop();
    const bottom = this.H - this.insets.bottom;
    const area = Math.max(1, bottom - top);
    const ahead = t.heightAt(c.x + 200 + Math.max(0, vx) * 0.6) - 40;
    const focus = lerp(c.y, ahead, 0.4);
    const ty = focus - (top + area * 0.55) / z;
    if (dt > 0) {
      this.camX += (tx - this.camX) * damp(4, dt);
      this.camY += (ty - this.camY) * damp(3, dt);
    } else {
      this.camX = tx;
      this.camY = ty;
    }
    // Keep the car between 30% and 75% of the visible play area.
    const minY = c.y - (top + area * 0.75) / z;
    const maxY = c.y - (top + area * 0.3) / z;
    this.camY = clamp(this.camY, minY, maxY);
  }

  private effects(dt: number): void {
    const speed = this.car.speed();
    const rpm = clamp(
      (Math.abs(this.car.wheelSpin[0] ?? 0) * this.car.spec.wheelR) / this.car.spec.maxSpeed,
      0,
      1,
    );
    this.engine?.set(rpm, this.throttle);
    if (this.crashed || this.time % 0.06 >= dt) return;
    const biome = biomeAt(this.metersAt(this.car.center().x));
    for (let w = 0; w < 2; w++) {
      const p = this.car.pts[w];
      if (!p || !p.grounded || (this.throttle === 0 && speed < 200)) continue;
      this.particles.emit({
        x: p.x - 6,
        y: p.y + p.r * 0.8,
        count: 2,
        speed: 60 + speed * 0.15,
        angle: Math.PI + 0.5,
        spread: 0.8,
        life: 0.5,
        size: 5,
        colors: [biome.ground[0], biome.grass],
        gravity: 260,
      });
    }
  }

  // ------------------------------------------------------------------ render

  render(): void {
    const ctx = this.ctx;
    const z = this.zoom;
    const view: View = { x: this.camX, y: this.camY, zoom: z };
    const midM = this.metersAt(this.camX + this.W / 2 / z);
    const serial = Math.floor(Math.max(0, midM) / BIOME_M);
    const a = biomeIndexAt(serial * BIOME_M);
    const b = biomeIndexAt((serial + 1) * BIOME_M);
    const blend = clamp((midM - ((serial + 1) * BIOME_M - 60)) / 60, 0, 1);

    ctx.save();
    ctx.translate(this.shake.x, this.shake.y);
    this.scenery.drawSky(a, b, blend);
    this.scenery.drawParallax(a, b, blend, view);

    const x0 = this.camX - 40;
    const x1 = this.camX + this.W / z + 40;
    ctx.save();
    ctx.scale(z, z);
    ctx.translate(-this.camX, -this.camY);
    this.scenery.drawTerrain(this.terrain, view, x0, x1);
    this.scenery.drawKickers(this.terrain, x0, x1);
    this.scenery.drawSigns(this.terrain, x0, x1);
    this.drawPickups(x0, x1);
    this.drawVehicle();
    this.particles.render(ctx);
    this.worldTexts.render(ctx);
    ctx.restore();
    if (!this.services.preview) this.texts.render(ctx);
    ctx.restore();
    if (!this.services.preview) this.drawHud();
  }

  private drawPickups(x0: number, x1: number): void {
    const ctx = this.ctx;
    for (const pk of this.pickups) {
      if (pk.taken || pk.x < x0 - 40 || pk.x > x1 + 40) continue;
      const sy = pk.y + Math.sin(this.time * 3 + pk.x) * 3;
      if (pk.kind === 'coin') {
        const r = pk.value >= 5 ? 16 : pk.value === 2 ? 13 : 10;
        drawCoin(ctx, pk.x, sy, r, Math.cos(this.time * 4 + pk.x * 0.05));
        if (pk.value > 1)
          text(ctx, `${pk.value}`, pk.x, sy + 1, {
            size: r * 0.9,
            align: 'center',
            color: '#7a4a00',
            stroke: null,
          });
      } else {
        const pulse = 0.5 + 0.5 * Math.sin(this.time * 5);
        ctx.fillStyle = `rgba(255,80,80,${0.18 + 0.14 * pulse})`;
        ctx.beginPath();
        ctx.arc(pk.x, sy, 30 + pulse * 4, 0, TAU);
        ctx.fill();
        drawJerrycan(ctx, pk.x, sy, 38);
      }
    }
  }

  /** Reused render pose (no per-frame allocation). */
  private readonly pose: Mutable<CarPose> & { wheelAngles: number[] } = {
    style: 0,
    wheels: [
      { x: 0, y: 0 },
      { x: 0, y: 0 },
    ],
    mounts: [
      { x: 0, y: 0 },
      { x: 0, y: 0 },
    ],
    wheelR: 20,
    wheelAngles: [0, 0],
    head: { x: 0, y: 0 },
    braking: false,
    time: 0,
  };

  private drawVehicle(): void {
    const ctx = this.ctx;
    const pts = this.car.pts;
    const p2 = pts[2];
    const p3 = pts[3];
    const head = pts[HEAD];
    if (!p2 || !p3 || !head) return;
    const ang = this.car.angle();
    const ox = (p2.x + p3.x) / 2;
    const oy = (p2.y + p3.y) / 2;
    const ca = Math.cos(ang);
    const sa = Math.sin(ang);
    const toLocal = (x: number, y: number, out: { x: number; y: number }) => {
      const dx = x - ox;
      const dy = y - oy;
      out.x = dx * ca + dy * sa;
      out.y = -dx * sa + dy * ca;
    };
    const pose = this.pose;
    pose.style = this.style;
    pose.wheelR = this.car.spec.wheelR;
    for (let w = 0; w < 2; w++) {
      const p = pts[w];
      const lw = pose.wheels[w];
      const lm = pose.mounts[w];
      if (!p || !lw || !lm) continue;
      toLocal(p.x, p.y, lw);
      lm.x = lw.x;
      lm.y = -6;
      pose.wheelAngles[w] = (this.car.wheelAngle[w] ?? 0) - ang;
    }
    toLocal(head.x, head.y, pose.head);
    pose.braking = this.brake > 0 && !this.crashed;
    pose.time = this.time;

    const blink = this.graceT > 0 && Math.floor(this.time * 14) % 2 === 0;
    ctx.save();
    if (blink) ctx.globalAlpha = 0.5;
    ctx.translate(ox, oy);
    ctx.rotate(ang);
    drawCar(ctx, pose, this.paint);
    ctx.restore();
    if (this.shield) {
      const c = this.car.center();
      ctx.strokeStyle = 'rgba(120,200,255,0.6)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(c.x, c.y - 6, 72, 0, TAU);
      ctx.stroke();
    }
  }

  // ------------------------------------------------------------------ HUD

  private drawHud(): void {
    const ctx = this.ctx;
    const { s, k, ph, stacked } = hudLayout(this.W, this.touchUi, this.shield, this.insets.top);
    const ins = this.insets;
    const left = HUD_EDGE + ins.left;
    const top = HUD_EDGE + ins.top;
    const right = this.W - HUD_EDGE - ins.right;
    const cy = top + ph / 2;
    // Second row, used when the pills do not fit one row: coins, shield and speed move down.
    const row2 = top + ph + 8 * s;
    const cy2 = row2 + ph / 2;

    // Fuel
    const fuelW = FUEL_W * k;
    const f = this.fuel / this.fuelCap;
    hudPill(ctx, left, top, fuelW, ph);
    drawJerrycan(ctx, left + 24 * s, cy, 28 * s);
    const barX = left + 46 * s;
    const barW = fuelW - 62 * s;
    if (f > 0) {
      const fuelColor = f > 0.5 ? '#57c84d' : f > 0.2 ? '#ffb703' : '#ff4d4d';
      progressBar(ctx, barX, cy - 7 * s, barW, 14 * s, f, fuelColor);
    } else {
      text(ctx, 'EMPTY', barX + barW / 2, cy, { size: 18 * s, align: 'center', color: '#ff6b6b' });
    }
    // Next fuel can distance (and low-fuel warning).
    const low = f < 0.25;
    const chipY = (stacked ? row2 + ph : top + ph) + 6 * s;
    const chipH = 26 * s;
    const nextM = Number.isFinite(this.nextFuelX)
      ? Math.max(0, Math.round((this.nextFuelX - this.car.center().x) / PX_PER_M))
      : -1;
    if (nextM >= 0 || low) {
      const blinkOn = low && f > 0 && Math.floor(this.time * 3) % 2 === 0;
      fillRoundRect(
        ctx,
        left,
        chipY,
        CHIP_W * k,
        chipH,
        chipH / 2,
        blinkOn ? 'rgba(200,30,40,0.8)' : 'rgba(8,10,30,0.55)',
      );
      drawJerrycan(ctx, left + 14 * s, chipY + chipH / 2, 16 * s);
      const label = nextM >= 0 ? `next ${nextM} m` : 'LOW FUEL';
      text(ctx, low && f > 0 && blinkOn ? 'LOW FUEL' : label, left + 28 * s, chipY + chipH / 2 + 1, {
        size: 14 * s,
        color: low ? '#ffd0d0' : '#eef',
        weight: 700,
      });
    }

    // Coins
    const coinY = stacked ? row2 : top;
    const coinCy = coinY + ph / 2;
    const coinX = stacked ? left : left + fuelW + HUD_GAP * k;
    const coinW = COIN_W * k;
    hudPill(ctx, coinX, coinY, coinW, ph);
    drawCoin(ctx, coinX + 24 * s, coinCy, 12 * s);
    text(ctx, `${this.coins}`, coinX + 44 * s, coinCy + 1, { size: 22 * s });
    for (const fl of this.flyers) {
      const e = fl.t * fl.t;
      drawCoin(ctx, lerp(fl.x, coinX + 24 * s, e), lerp(fl.y, coinCy, e), 9 * s * (1 - 0.3 * fl.t));
    }
    if (this.shield) {
      const gx = coinX + coinW + HUD_GAP * k;
      hudPill(ctx, gx, coinY, ph, ph);
      this.drawShieldIcon(gx + ph / 2, coinCy, 14 * s);
    }

    // Distance + score. The score sits under the distance, or at the right of the second row.
    const distW = DIST_W * k;
    hudPill(ctx, right - distW, top, distW, ph);
    text(ctx, `${Math.floor(this.meters)} m`, right - 16 * s, cy + 1, { size: 24 * s, align: 'right' });
    const score = `${Math.floor(this.score).toLocaleString('en-US')} pts`;
    if (stacked) {
      text(ctx, score, right - 16 * s, cy2 + 1, { size: 15 * s, align: 'right', color: '#eef' });
    } else {
      text(ctx, score, right - 16 * s, top + ph + 16 * s, { size: 15 * s, align: 'right', color: '#eef' });
    }
    // Speed
    const kmh = Math.round((this.car.speed() / PX_PER_M) * 3.6);
    const spW = SPEED_W * k;
    const spRight = stacked ? right - 124 * s - HUD_GAP * k : right - distW - HUD_GAP * k;
    const spX = spRight - spW;
    const spY = stacked ? row2 : top;
    const spCy = spY + ph / 2;
    hudPill(ctx, spX, spY, spW, ph);
    text(ctx, `${kmh}`, spX + 58 * k, spCy + 1, { size: 22 * s, align: 'right' });
    text(ctx, 'km/h', spX + 62 * k, spCy + 3 * s, { size: 13 * s, color: '#aab', weight: 600 });

    const bannerY = Math.max(this.hudTop() + 30, this.H * 0.24);
    if (this.crashed && this.crashReason) {
      this.drawBanner(
        this.crashReason.toUpperCase(),
        `${Math.floor(this.meters)} m`,
        0.5,
        '#ff6b6b',
        bannerY,
      );
    } else if (this.fuel <= 0) {
      this.drawOutOfFuel(bannerY);
    } else if (this.bannerT < BANNER_TIME) {
      const sub =
        this.bannerSub ||
        (this.touchUi ? 'Hold GAS to drive, BRAKE to slow down' : 'Hold → or D to drive, ← to brake');
      this.drawBanner(this.bannerTitle, sub, this.bannerT / BANNER_TIME, '#ffd23f', bannerY);
    }
    if (this.hintT > 0 && !this.crashed) {
      const a = Math.min(1, this.hintT / 0.4, (4 - this.hintT) / 0.3);
      ctx.save();
      ctx.globalAlpha = clamp(a, 0, 1);
      const y = this.H - ins.bottom - 34 * s;
      ctx.font = `700 ${16 * s}px system-ui, sans-serif`;
      const w = Math.min(this.W - 40, 520 * s);
      // Shrink the line on narrow canvases so it stays inside its pill.
      const fit = Math.min(1, (w - 32 * s) / Math.max(1, ctx.measureText(this.hint).width));
      fillRoundRect(ctx, this.W / 2 - w / 2, y - 18 * s, w, 36 * s, 18 * s, 'rgba(8,10,30,0.7)');
      text(ctx, this.hint, this.W / 2, y + 1, { size: 16 * s * fit, align: 'center', weight: 700 });
      ctx.restore();
    }
  }

  private drawShieldIcon(x: number, y: number, r: number): void {
    const ctx = this.ctx;
    ctx.fillStyle = '#7cf';
    ctx.beginPath();
    ctx.moveTo(x, y - r);
    ctx.lineTo(x + r * 0.85, y - r * 0.6);
    ctx.quadraticCurveTo(x + r * 0.8, y + r * 0.6, x, y + r);
    ctx.quadraticCurveTo(x - r * 0.8, y + r * 0.6, x - r * 0.85, y - r * 0.6);
    ctx.closePath();
    ctx.fill();
  }

  /** Title + subtitle that scale in and fade out over t in [0, 1]. */
  private drawBanner(title: string, sub: string, t: number, color: string, y: number): void {
    const ctx = this.ctx;
    const a = t < 0.12 ? t / 0.12 : t > 0.8 ? (1 - t) / 0.2 : 1;
    const sc = t < 0.12 ? 0.7 + 0.3 * (t / 0.12) : 1;
    const size = Math.min(52, this.W / 14);
    ctx.save();
    ctx.globalAlpha = clamp(a, 0, 1);
    ctx.translate(this.W / 2, y);
    ctx.scale(sc, sc);
    text(ctx, title, 0, 0, { size, align: 'center', color, strokeWidth: 7 });
    if (sub)
      text(ctx, sub, 0, size * 0.85, {
        size: this.touchUi ? 22 : Math.min(22, this.W / 34),
        align: 'center',
        weight: 700,
      });
    ctx.restore();
  }

  private drawOutOfFuel(y: number): void {
    const ctx = this.ctx;
    const p = this.fuelEndProgress;
    const size = Math.min(44, this.W / 16);
    text(ctx, 'OUT OF FUEL', this.W / 2, y, { size, align: 'center', color: '#ff6b6b', strokeWidth: 7 });
    // Ring drains as the run winds down.
    const r = 18;
    const cy = y + size * 0.95 + r;
    ctx.lineWidth = 5;
    ctx.strokeStyle = 'rgba(0,0,0,0.45)';
    ctx.beginPath();
    ctx.arc(this.W / 2, cy, r, 0, TAU);
    ctx.stroke();
    ctx.strokeStyle = '#ff6b6b';
    ctx.beginPath();
    ctx.arc(this.W / 2, cy, r, -Math.PI / 2, -Math.PI / 2 + TAU * (1 - p));
    ctx.stroke();
    drawJerrycan(ctx, this.W / 2, cy, 18);
  }
}
