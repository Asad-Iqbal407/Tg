import { clamp, damp, TAU } from '../../core/math';
import { BaseGame } from '../base';
import { FONT, hudPill, progressBar, text } from '../draw';
import type { GameServices } from '../types';
import { Camera, Framing, NEAR } from './camera';
import {
  GEN_AHEAD,
  HIGH_BOTTOM,
  HIGH_TOP,
  JETPACK_Y,
  Kinematics,
  laneOf,
  laneX,
  MAX_MULTIPLIER,
  MILESTONE_M,
  ROLL_H,
  speedAt,
  STAND_H,
  TRAIN_H,
  viewDistance,
} from './config';
import { Look, zoneDef } from './palette';
import {
  CoinSprites,
  drawBarrier,
  drawPower,
  drawPowerIcon,
  drawRamp,
  drawTrain,
  fogAt,
  POWER_INFO,
  POWER_KINDS,
} from './props';
import { drawRig, type RigColors, rigColors, RigPose } from './rig';
import { GANTRY_EVERY, gantryAt, Scenery, type View } from './scenery';
import { GlowSprites, rand } from './surface';
import { type Coin, type ObKind, type Obstacle, type Power, type PowerKind, TrackGenerator } from './track';

/** Painter's-order key of the runner; larger keys paint first. */
export const PLAYER_KEY = 0.01;
/** Key for long obstacles that span the runner's plane, so they paint before the runner. */
export const SPAN_KEY = 0.02;

/**
 * Depth-sort key for an object whose near end is `rel` metres ahead and which is `len` long.
 * Trains and ramps sorted by their front alone would paint over a runner standing on them once
 * the front has passed, so anything spanning the runner's plane is keyed just behind the runner.
 */
export function depthKey(rel: number, len: number): number {
  return len > 1 && rel < SPAN_KEY && rel + len > 0 ? SPAN_KEY : rel;
}

const ITEM_OBSTACLE = 0;
const ITEM_COIN = 1;
const ITEM_POWER = 2;
const ITEM_PLAYER = 3;
const ITEM_GANTRY = 4;
const ITEM_CHASER = 5;

interface DrawItem {
  key: number;
  kind: number;
  rel: number;
  ob: Obstacle | null;
  coin: Coin | null;
  power: Power | null;
}

type HintId = 'lanes' | 'jump' | 'roll' | 'dodge' | 'ramp' | 'oncoming';
type HintIcon = 'lr' | 'up' | 'down';

const HINTS: Record<HintId, { touch: string; keys: string; icon: HintIcon }> = {
  lanes: {
    touch: 'Swipe left or right to change lanes',
    keys: 'Left / Right or A / D to change lanes',
    icon: 'lr',
  },
  jump: { touch: 'Swipe up to jump the barrier', keys: 'Up, W or Space to jump', icon: 'up' },
  roll: { touch: 'Swipe down to roll under', keys: 'Down or S to roll under', icon: 'down' },
  dodge: { touch: 'Swipe sideways to dodge the train', keys: 'Change lanes to dodge trains', icon: 'lr' },
  ramp: { touch: 'Run up the ramp to ride the roofs', keys: 'Run up the ramp to ride the roofs', icon: 'up' },
  oncoming: { touch: 'Oncoming train! Swipe away', keys: 'Oncoming train! Change lanes', icon: 'lr' },
};

/** Width of the power-up pills stacked under the coin counter (HUD units, times the HUD scale). */
export const POWER_PILL_W = 170;
/** Half the width of the CAREFUL! warning (HUD units): it is centred, so this much each side. */
const CAREFUL_HALF_W = 70;

/** Where the HUD announcements go: the centre of the milestone banner and the CAREFUL! warning. */
export interface BannerBand {
  y: number;
  carefulX: number;
  carefulY: number;
}

/**
 * Lay out the announcements for a `w` px wide canvas whose HUD starts at `top` and `left`, at HUD scale
 * `s`, with the power-up stack under the coin counter ending at `stackBottom`. The banner, centred and
 * `bannerHalfW` px wide on each side, sits halfway between the HUD and `skyBottom` (just above the
 * horizon). Only when it would reach across the left-hand power-up stack (narrow portrait canvases) does
 * it drop below the stack, so a milestone reached with several power-ups running never draws over their
 * timers; on wide canvases it stays in the sky, clear of the track. The CAREFUL! warning keeps its row
 * under the score and moves right when it would touch the stack.
 */
export function bannerBand(
  w: number,
  top: number,
  left: number,
  stackBottom: number,
  s: number,
  skyBottom: number,
  bannerHalfW: number,
): BannerBand {
  const bandTop = top + 92 * s;
  const size = Math.min(54 * s, w / 8);
  const mid = (bandTop + skyBottom) / 2;
  const reachesStack = w / 2 - bannerHalfW < left + (POWER_PILL_W + 8) * s;
  const y = reachesStack ? Math.max(mid, stackBottom + 8 * s + 0.8 * size) : mid;
  const carefulX = Math.max(w / 2, left + (POWER_PILL_W + 10 + CAREFUL_HALF_W) * s);
  return { y, carefulX, carefulY: bandTop + 6 * s };
}

/** Seconds the world freezes on impact before the crash animation plays. */
const HIT_STOP = 0.12;
/** First-encounter hints are only offered early in a run. */
const HINT_UNTIL_M = 2000;
const STREAKS = 26;

export class RunnerGame extends BaseGame {
  // Track
  private readonly obstacles: Obstacle[] = [];
  private readonly coinList: Coin[] = [];
  private readonly powerList: Power[] = [];
  private readonly gen: TrackGenerator;

  // Runner
  private distance = 0;
  private speed = 8;
  private readonly kin = new Kinematics();
  private lane = 1;
  private px = 0;
  private prevPx = 0;
  private py = 0;
  private vy = 0;
  private grounded = true;
  private coyoteT = 0;
  private rollT = 0;
  private jumpBuffer = 0;
  private stumbleT = 0;
  private graceT = 0;
  private shield: boolean;
  private crashed = false;
  private crashT = 0;
  private crashOb: Obstacle | null = null;
  /** 1 = splat against a train front, 2 = tripped (barrier or stumble). */
  private crashKind = 0;
  private roofOb: Obstacle | null = null;
  private runPhase = 0;
  private rollAngle = 0;
  private landT = 1;
  private takeoffT = 1;
  private readonly powers: Record<PowerKind, number> = { magnet: 0, double: 0, sneakers: 0, jetpack: 0 };

  // Ground probe output, written by probeGround() to avoid allocating a result.
  private gKind: ObKind | null = null;
  private gOb: Obstacle | null = null;

  // Presentation
  private readonly cam = new Camera();
  private readonly framing = new Framing();
  private camX = 0;
  private camLift = 0;
  private viewSpeed = 13;
  private readonly look = new Look();
  private readonly scenery: Scenery;
  private readonly coinSprites = new CoinSprites();
  private readonly pose = new RigPose();
  private readonly chaserPose = new RigPose();
  private readonly colors: RigColors;
  private readonly chaserColors: RigColors;
  private readonly view: View;
  private readonly items: DrawItem[] = [];
  private itemCount = 0;
  /** HUD scale: follows the logical size, then grows when the canvas is shown small (see hudScale). */
  private hs: number;
  private readonly baseHs: number;
  private readonly preview: boolean;
  private touchUi: boolean;
  private chaserT = 0;
  private bannerT = 0;
  private milestone = 0;
  private milestoneT = 99;
  private hint: HintId | null = null;
  private hintT = 0;
  private readonly hintsShown = new Set<HintId>();
  private readonly streakAngle = new Float32Array(STREAKS);
  private readonly streakSeed = new Float32Array(STREAKS);
  private vignette: CanvasGradient | null = null;

  constructor(s: GameServices) {
    super(s);
    this.shield = this.hasBoost('shield');
    this.preview = s.preview === true;
    this.touchUi = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
    this.baseHs = clamp(Math.min(this.H / 960, this.W / 540), 0.9, 1.3);
    this.hs = this.baseHs;
    this.framing.update(this.W, this.H, this.insets);
    this.scenery = new Scenery(
      this.W,
      this.H,
      this.framing.unit,
      this.framing.horizonFor(this.framing.focal),
    );
    this.colors = rigColors(
      this.skinColor('body', '#e63946'),
      this.skinColor('accent', '#1d3557'),
      this.skinColor('skin', '#f1c27d'),
      this.skinColor('hair', '#2b2118'),
      this.skinColor('shoes', '#f8f9fa'),
    );
    this.chaserColors = rigColors('#26315c', '#151a2e', '#c68642', '#1a1a1a', '#111111');
    this.view = {
      ctx: this.ctx,
      cam: this.cam,
      look: this.look,
      dist: 0,
      far: viewDistance(13),
      time: 0,
      speed: 0,
      reducedMotion: s.reducedMotion,
      glow: new GlowSprites(),
    };
    for (let i = 0; i < STREAKS; i++) {
      // Streaks fan out over the sky and the sides, never over the track ahead.
      const a = -Math.PI * (0.06 + 0.88 * rand(i, 3));
      this.streakAngle[i] = rand(i, 4) < 0.25 ? (rand(i, 5) < 0.5 ? 0.12 : Math.PI - 0.12) + a * 0.15 : a;
      this.streakSeed[i] = rand(i, 6);
    }
    this.gen = new TrackGenerator(this.rng, {
      obstacles: this.obstacles,
      coins: this.coinList,
      powers: this.powerList,
    });
    this.gen.warmup();
    if (this.hasBoost('head-start')) {
      this.powers.jetpack = this.powerTime(5);
      this.powers.magnet = this.powerTime(10);
      this.spawnJetpackCoins(this.powers.jetpack);
    }
    this.gen.fill(GEN_AHEAD);
  }

  // ------------------------------------------------------------------ simulation

  private multiplier(): number {
    return (
      Math.min(MAX_MULTIPLIER, 1 + Math.floor(this.distance / MILESTONE_M)) * (this.powers.double > 0 ? 2 : 1)
    );
  }

  protected tick(dt: number): void {
    if (this.input.pointer.touch) this.touchUi = true;
    if (this.crashed) {
      this.tickCrashed(dt);
      return;
    }
    this.bannerT += dt;
    this.milestoneT += dt;

    // Speed follows the eased progress curve (quick run-up during the first two seconds).
    this.speed += (speedAt(this.distance) - this.speed) * damp(this.time < 2 ? 2.5 : 0.6, dt);
    this.viewSpeed = this.speed;
    const kin = this.kin.update(this.speed);
    this.handleInput(kin);

    const step = this.speed * dt;
    this.distance += step;
    this.score += step * this.multiplier();
    this.runPhase += TAU * kin.strideHz * dt;
    this.rollAngle += dt * 13;
    this.landT += dt;
    this.takeoffT += dt;

    for (const k of POWER_KINDS) {
      if (this.powers[k] <= 0) continue;
      this.powers[k] = Math.max(0, this.powers[k] - dt);
      if (k === 'jetpack' && this.powers.jetpack === 0) this.endJetpack();
    }
    this.stumbleT = Math.max(0, this.stumbleT - dt);
    this.graceT = Math.max(0, this.graceT - dt);
    this.jumpBuffer = Math.max(0, this.jumpBuffer - dt);
    this.coyoteT = Math.max(0, this.coyoteT - dt);

    // Lateral movement: snappier lane changes at speed.
    this.prevPx = this.px;
    const tx = laneX(this.lane);
    this.px += (tx - this.px) * damp(kin.laneRate, dt);
    if (Math.abs(tx - this.px) < 0.01) this.px = tx;

    // Oncoming trains arm with a fixed warning time at the closing speed.
    for (const ob of this.obstacles) {
      if (ob.vz === 0) continue;
      if (!ob.armed && ob.z - this.distance < (this.speed - ob.vz) * 2.4) {
        ob.armed = true;
        this.audio.play('whoosh', { volume: 0.75, pitch: 0.55 });
      }
      if (ob.armed) ob.z += ob.vz * dt;
    }

    this.updateVertical(dt, kin);
    this.rollT = Math.max(0, this.rollT - dt);
    this.collide();
    if (!this.crashed) {
      this.collectCoins(dt);
      this.collectPowers();
    }
    this.cull();
    this.gen.fill(this.distance + GEN_AHEAD);
    this.checkMilestone();
    this.updateHints(dt);
    this.updateChaser(dt);
    this.updateCamera(dt);
    this.maxStat('distance', this.distance);
  }

  private tickCrashed(dt: number): void {
    this.crashT += dt;
    if (this.crashT > HIT_STOP) {
      // Stop within ~0.2 s; never slide past the obstacle that caused the crash.
      this.speed = Math.max(0, this.speed - 160 * dt);
      const ob = this.crashOb;
      const limit = ob ? ob.z - 0.45 : Infinity;
      if (this.distance > limit) this.distance += (limit - this.distance) * damp(18, dt);
      else this.distance = Math.min(limit, this.distance + this.speed * dt);
      // Fall to the surface below, ignoring the obstacle we hit, and never rise onto anything.
      this.vy -= this.kin.gravity * dt;
      const below = this.probeGround(this.px, ob);
      const floor = below > this.py + 0.05 ? 0 : below;
      this.py = Math.max(floor, this.py + this.vy * dt);
      if (this.py <= floor) this.vy = 0;
    }
    this.updateChaser(dt);
    this.updateCamera(dt);
  }

  private handleInput(kin: Kinematics): void {
    const sw = this.input.consumeSwipe();
    const left = this.input.wasPressed('left') || sw === 'left';
    const right = this.input.wasPressed('right') || sw === 'right';
    const up = this.input.wasPressed('up') || this.input.wasPressed('primary') || sw === 'up';
    const down = this.input.wasPressed('down') || sw === 'down';
    if (left) this.changeLane(-1);
    if (right) this.changeLane(1);
    if (up) {
      this.jumpBuffer = 0.2;
      this.dismissHint('jump', 'ramp');
    }
    if (down && this.powers.jetpack <= 0) {
      if (!this.grounded) this.vy = Math.min(this.vy, kin.slamV);
      if (this.rollT <= 0) {
        this.addStat('rolls');
        this.audio.play('whoosh', { volume: 0.5, pitch: 1.4 });
      }
      this.rollT = kin.rollTime;
      this.jumpBuffer = 0;
      this.dismissHint('roll');
    }
  }

  private changeLane(dir: number): void {
    const target = this.lane + dir;
    if (target < 0 || target > 2) {
      // Swiping into the outer wall just bounces off: no stumble, never lethal.
      this.px += dir * 0.3;
      this.audio.play('bump', { volume: 0.45, pitch: 1.2 });
      this.shake.add(0.12);
      this.services.haptic(15);
      return;
    }
    if (this.powers.jetpack <= 0 && this.laneBlocked(target)) {
      this.px += dir * 0.35;
      this.stumble();
      return;
    }
    this.lane = target;
    this.audio.play('whoosh', { volume: 0.35, pitch: 1.8 });
    this.dismissHint('lanes', 'dodge', 'oncoming');
  }

  /** A lane is blocked by the side of a train beside us, or one about to arrive while we move over. */
  private laneBlocked(lane: number): boolean {
    for (const ob of this.obstacles) {
      if (ob.lane !== lane || ob.kind !== 'train' || ob.dead) continue;
      const rel = ob.z - this.distance;
      const ahead = (this.speed + Math.abs(ob.vz)) * 0.12;
      if (rel - ahead <= 0.6 && rel + ob.len >= -0.4 && this.py < ob.h - 0.45) return true;
    }
    return false;
  }

  /** Bumping a train's side: slows the runner and brings the chaser close. A second bump is a hit. */
  private stumble(): void {
    this.audio.play('bump');
    this.shake.add(0.35);
    this.services.haptic(40);
    if (this.stumbleT > 0 && this.graceT <= 0) {
      this.hit(null);
      return;
    }
    this.stumbleT = 2.5;
    this.speed *= 0.85;
  }

  private updateVertical(dt: number, kin: Kinematics): void {
    if (this.powers.jetpack > 0) {
      this.py += (JETPACK_Y - this.py) * damp(4, dt);
      this.vy = 0;
      this.grounded = false;
      this.rollT = 0;
      this.coyoteT = 0;
      this.roofOb = null;
      return;
    }
    const h = this.probeGround(this.px);
    const kind = this.gKind;
    // Collisions are off during grace, so never let the runner sink into a train: vault onto it.
    if (this.graceT > 0 && kind === 'train' && this.py < h - 0.7 && this.vy <= 0) {
      this.vy = kin.vaultV;
      this.grounded = false;
    }
    if (this.jumpBuffer > 0 && (this.grounded || this.coyoteT > 0)) this.jump(kin);
    this.vy -= kin.gravity * dt;
    const prevY = this.py;
    this.py += this.vy * dt;
    // Snap onto a ramp or a roof only from above (or a small step up); beside a train the track is the floor.
    const canSnap = kind === 'ramp' || h - this.py < 0.7 || prevY >= h - 0.05;
    const floor = canSnap ? h : 0;
    const wasGrounded = this.grounded;
    if (this.py <= floor) {
      if (!wasGrounded && this.vy < -4) {
        this.audio.play('land', { volume: 0.6 });
        this.landT = 0;
      }
      this.py = floor;
      this.vy = 0;
      this.grounded = true;
    } else if (this.py > floor + 0.05) {
      // Running off the end of a roof leaves a short window to still jump.
      if (wasGrounded) this.coyoteT = 0.1;
      this.grounded = false;
    }
    if (this.grounded) {
      const roof = kind === 'train' && floor >= TRAIN_H - 0.05 ? this.gOb : null;
      if (roof && roof !== this.roofOb) {
        // Counted on every arrival on a new roof: up a ramp, a jump, or hopping roof to roof.
        this.addStat('trainsRidden');
        if (wasGrounded) this.audio.play('land', { volume: 0.4, pitch: 1.2 });
      }
      this.roofOb = roof;
    }
    if (this.grounded && this.jumpBuffer > 0) this.jump(kin);
  }

  private jump(kin: Kinematics): void {
    this.vy = this.powers.sneakers > 0 ? kin.superJumpV : kin.jumpV;
    this.grounded = false;
    this.jumpBuffer = 0;
    this.coyoteT = 0;
    this.rollT = 0;
    this.takeoffT = 0;
    this.addStat('jumps');
    this.audio.play('jump', { pitch: this.powers.sneakers > 0 ? 1.3 : 1 });
  }

  /**
   * Height of the surface under lateral position x (ramp slope or train roof), optionally ignoring
   * one obstacle. Also leaves the surface's kind and obstacle in gKind / gOb.
   */
  private probeGround(x: number, skip: Obstacle | null = null): number {
    const lane = laneOf(x);
    let h = 0;
    let kind: ObKind | null = null;
    let found: Obstacle | null = null;
    for (const ob of this.obstacles) {
      if (ob.lane !== lane || ob === skip || ob.dead) continue;
      const rel = ob.z - this.distance;
      if (ob.kind === 'train' && rel <= 0.3 && rel + ob.len >= -0.3) {
        if (ob.h > h) {
          h = ob.h;
          kind = 'train';
          found = ob;
        }
      } else if (ob.kind === 'ramp' && rel <= 0 && rel + ob.len >= 0) {
        const rh = ob.h * clamp(-rel / ob.len, 0, 1);
        if (rh > h) {
          h = rh;
          kind = 'ramp';
          found = ob;
        }
      }
    }
    this.gKind = kind;
    this.gOb = found;
    return h;
  }

  private collide(): void {
    if (this.powers.jetpack > 0 || this.graceT > 0) return;
    const height = this.rollT > 0 ? ROLL_H : STAND_H;
    for (const ob of this.obstacles) {
      if (ob.kind === 'ramp' || ob.dead) continue;
      const rel = ob.z - this.distance;
      if (rel > 0.35 || rel + ob.len < -0.35) continue;
      const ox = laneX(ob.lane);
      if (Math.abs(this.px - ox) > 1.15) continue;
      const hit =
        ob.kind === 'low'
          ? this.py < ob.h - 0.1
          : ob.kind === 'high'
            ? this.py + height > HIGH_BOTTOM - 0.05 && this.py < HIGH_TOP
            : this.py < ob.h - 0.45;
      if (!hit) continue;
      if (ob.kind === 'train' && rel < -0.2 && Math.abs(this.prevPx - ox) > 1.15) {
        // Moved sideways into a train whose front had already passed: a side-swipe, not a crash.
        this.px = this.prevPx;
        this.lane = laneOf(this.prevPx);
        this.stumble();
        return;
      }
      this.hit(ob);
      return;
    }
  }

  /** Every lethal hit goes through here so the Guardian shield is always honoured. */
  private hit(ob: Obstacle | null): void {
    if (this.shield) {
      this.shield = false;
      this.graceT = 1.6;
      this.stumbleT = 0;
      this.audio.play('pop');
      this.shake.add(0.4);
      this.burst('#7cf', 30);
      if (ob?.kind === 'train') {
        // Vault onto the roof instead of teleporting there.
        this.vy = this.kin.vaultV;
        this.grounded = false;
        this.rollT = 0;
      } else if (ob) ob.dead = true;
      this.texts.add(
        this.W / 2,
        this.framing.feetY - 300 * this.framing.unit,
        'GUARDIAN SAVE!',
        '#7cf',
        28 * this.hs,
      );
      return;
    }
    this.crash(ob);
  }

  private crash(ob: Obstacle | null): void {
    if (this.crashed) return;
    this.crashed = true;
    this.crashOb = ob;
    this.crashKind = ob?.kind === 'train' ? 1 : 2;
    this.vy = ob?.kind === 'train' ? 0 : 2.5;
    this.rollT = 0;
    this.audio.play('hit');
    this.shake.add(0.9);
    this.burst('#fff', 40);
    this.endGame(1.6);
  }

  private burst(color: string, count: number): void {
    this.cam.project(this.px, this.py + 1, 0);
    this.particles.emit({
      x: this.cam.px,
      y: this.cam.py,
      count,
      speed: 380 * this.framing.unit,
      life: 0.7,
      size: 5 * this.framing.unit,
      colors: [color, '#ffd23f', '#ff6b6b'],
      gravity: 600,
    });
  }

  /** When the jetpack runs out, steer the landing to a roof or a lane without a train front ahead. */
  private endJetpack(): void {
    this.graceT = Math.max(this.graceT, 1.4);
    const v = this.speed;
    let best = this.lane;
    let bestScore = -Infinity;
    for (let lane = 0; lane < 3; lane++) {
      let roof = false;
      let front = false;
      for (const ob of this.obstacles) {
        if (ob.lane !== lane || ob.kind !== 'train') continue;
        const rel = ob.z - this.distance;
        if (rel <= v * 0.35 && rel + ob.len >= v * 0.8) roof = true;
        else if (rel > -0.5 && rel < (v + Math.abs(ob.vz)) * 1.6) front = true;
      }
      const score = (roof ? 2 : front ? -5 : 0) - Math.abs(lane - this.lane) * 0.5;
      if (score > bestScore) {
        bestScore = score;
        best = lane;
      }
    }
    this.lane = best;
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
        this.cam.project(c.x, c.y, relz);
        this.particles.emit({
          x: this.cam.px,
          y: this.cam.py,
          count: 5,
          speed: 120 * this.framing.unit,
          life: 0.35,
          size: 3 * this.framing.unit,
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
        const info = POWER_INFO[pw.kind];
        const dur = this.powerTime(info.base);
        this.powers[pw.kind] = dur;
        if (pw.kind === 'jetpack') this.spawnJetpackCoins(dur);
        this.addStat('powerups');
        this.audio.play('powerup');
        this.texts.add(
          this.W / 2,
          this.framing.feetY - 260 * this.framing.unit,
          info.label,
          info.color,
          30 * this.hs,
        );
      }
    }
  }

  private spawnJetpackCoins(duration: number): void {
    let lane = this.lane;
    const start = this.distance + 12;
    const end = start + speedAt(this.distance) * duration - 10;
    for (let z = start; z < end; z += 3) {
      if (this.rng.chance(0.08)) lane = clamp(lane + (this.rng.chance(0.5) ? 1 : -1), 0, 2);
      this.coinList.push({ x: laneX(lane), y: JETPACK_Y + 0.9, z, taken: false, pulled: false, over: null });
    }
  }

  /** Drop everything behind the camera, compacting the arrays in place. */
  private cull(): void {
    const cut = this.distance - 14;
    let n = 0;
    for (const o of this.obstacles) if (!o.dead && o.z + o.len > cut) this.obstacles[n++] = o;
    this.obstacles.length = n;
    n = 0;
    for (const c of this.coinList) if (!c.taken && c.z > cut) this.coinList[n++] = c;
    this.coinList.length = n;
    n = 0;
    for (const p of this.powerList) if (!p.taken && p.z > cut) this.powerList[n++] = p;
    this.powerList.length = n;
  }

  private checkMilestone(): void {
    const m = Math.floor(this.distance / MILESTONE_M);
    if (m <= this.milestone) return;
    this.milestone = m;
    this.milestoneT = 0;
    this.audio.play('levelup');
    this.services.haptic(30);
  }

  private showHint(id: HintId): void {
    this.hint = id;
    this.hintT = 0;
    this.hintsShown.add(id);
  }

  private dismissHint(...ids: HintId[]): void {
    if (this.hint && ids.includes(this.hint) && this.hintT > 0.4) this.hintT = Math.max(this.hintT, 2.9);
  }

  /** Gentle onboarding: one control hint at a time, the first time each situation comes up. */
  private updateHints(dt: number): void {
    if (this.hint) {
      this.hintT += dt;
      if (this.hintT > 3.2) this.hint = null;
      return;
    }
    if (this.distance > HINT_UNTIL_M || this.powers.jetpack > 0) return;
    if (!this.hintsShown.has('lanes')) {
      if (this.time > 2.8) this.showHint('lanes');
      return;
    }
    let near: Obstacle | null = null;
    let nearRel = this.speed * 1.7;
    for (const ob of this.obstacles) {
      if (ob.lane !== this.lane || ob.dead) continue;
      const rel = ob.z - this.distance;
      if (rel > 0 && rel < nearRel) {
        near = ob;
        nearRel = rel;
      }
    }
    if (!near || this.py > 2) return;
    const id: HintId =
      near.kind === 'low'
        ? 'jump'
        : near.kind === 'high'
          ? 'roll'
          : near.kind === 'ramp'
            ? 'ramp'
            : near.vz !== 0
              ? 'oncoming'
              : 'dodge';
    if (!this.hintsShown.has(id)) this.showHint(id);
  }

  private updateChaser(dt: number): void {
    const chasing = this.stumbleT > 0 || (this.crashed && this.crashOb === null);
    this.chaserT = clamp(this.chaserT + (chasing ? dt * 2.5 : -dt * 1.2), 0, 1);
  }

  private updateCamera(dt: number): void {
    this.camX += (this.px * 0.55 - this.camX) * damp(6, dt);
    this.camLift += (Math.min(this.py, TRAIN_H) * 0.55 - this.camLift) * damp(4, dt);
  }

  // ------------------------------------------------------------------ rendering

  private setupCamera(): void {
    const rm = this.services.reducedMotion;
    const f = this.framing.update(this.W, this.H, this.insets);
    let zoom = 1;
    if (!rm) {
      // Slightly wider view at top speed, a short pulse on milestones, a dolly-in on a crash.
      zoom -= 0.04 * clamp((this.viewSpeed - 20) / 13, 0, 1);
      if (this.milestoneT < 0.7) zoom -= 0.035 * Math.sin((this.milestoneT / 0.7) * Math.PI);
    }
    if (this.crashed) zoom += 0.05 * Math.min(1, this.crashT / 0.35);
    const cam = this.cam;
    cam.f = f.focal * zoom;
    cam.hz = f.horizonFor(cam.f);
    cam.cx = this.W / 2;
    cam.x = this.camX;
    cam.h = 8.4 + this.camLift;
  }

  render(): void {
    const ctx = this.ctx;
    this.setupCamera();
    this.look.update(this.distance);
    const v = this.view;
    v.dist = this.distance;
    v.far = viewDistance(this.viewSpeed);
    v.time = this.time;
    v.speed = this.speed;
    this.scenery.begin(v);
    ctx.save();
    ctx.translate(this.shake.x, this.shake.y);
    this.scenery.drawSky(v);
    this.scenery.drawGround(v);
    this.scenery.drawHaze(v);
    this.scenery.drawSides(v);
    this.drawWorld();
    this.drawStreaks();
    this.particles.render(ctx);
    this.texts.render(ctx);
    ctx.restore();
    this.drawVignette();
    if (!this.preview) {
      this.hs = this.hudScale();
      this.drawHud();
    }
  }

  /**
   * The logical size can be shown at well under 1 CSS px per logical px (a 1706 px wide run on a
   * landscape phone, or a 540 px wide run on a 360 px phone), so the HUD grows until its main numbers
   * are at least ~15 CSS px tall and its smallest labels (18 px) at least ~12.5 CSS px.
   */
  private hudScale(): number {
    const canvas = this.ctx.canvas as HTMLCanvasElement | undefined;
    const cssH = canvas && typeof canvas.clientHeight === 'number' ? canvas.clientHeight : 0;
    if (!(cssH > 0)) return this.baseHs;
    const css = cssH / this.H;
    const need = Math.max(15 / (24 * this.baseHs * css), 12.5 / (18 * this.baseHs * css));
    return this.baseHs * clamp(need, 1, 1.8);
  }

  private pushItem(
    key: number,
    kind: number,
    rel: number,
    ob: Obstacle | null,
    coin: Coin | null,
    power: Power | null,
  ): void {
    let it = this.items[this.itemCount];
    if (!it) {
      it = { key: 0, kind: 0, rel: 0, ob: null, coin: null, power: null };
      this.items.push(it);
    }
    it.key = key;
    it.kind = kind;
    it.rel = rel;
    it.ob = ob;
    it.coin = coin;
    it.power = power;
    this.itemCount++;
  }

  /** Depth-sorted world pass over a preallocated item list (no closures, no per-frame allocation). */
  private drawWorld(): void {
    const v = this.view;
    const far = v.far;
    this.itemCount = 0;
    for (const ob of this.obstacles) {
      const rel = ob.z - this.distance;
      if (rel > far || rel + ob.len < NEAR) continue;
      this.pushItem(depthKey(rel, ob.len), ITEM_OBSTACLE, rel, ob, null, null);
    }
    const coinFar = far * 0.8;
    for (const c of this.coinList) {
      const rel = c.z - this.distance;
      if (rel > coinFar || rel < NEAR + 0.5) continue;
      let key = rel;
      if (c.over && !c.pulled && rel >= 0) key = depthKey(c.over.z - this.distance, c.over.len) - 1e-4;
      this.pushItem(key, ITEM_COIN, rel, null, c, null);
    }
    for (const p of this.powerList) {
      const rel = p.z - this.distance;
      if (rel > coinFar || rel < NEAR + 0.5) continue;
      this.pushItem(rel, ITEM_POWER, rel, null, null, p);
    }
    const firstGantry = Math.ceil((this.distance - 3) / GANTRY_EVERY);
    const lastGantry = Math.floor((this.distance + far) / GANTRY_EVERY);
    for (let k = firstGantry; k <= lastGantry; k++) {
      if (!gantryAt(k * GANTRY_EVERY)) continue;
      const rel = k * GANTRY_EVERY - this.distance;
      this.pushItem(rel, ITEM_GANTRY, rel, null, null, null);
    }
    this.pushItem(PLAYER_KEY, ITEM_PLAYER, 0, null, null, null);
    if (this.chaserT > 0.01) {
      const z = this.chaserZ();
      this.pushItem(z, ITEM_CHASER, z, null, null, null);
    }
    // Insertion sort, far to near: the order barely changes between frames.
    const items = this.items;
    for (let i = 1; i < this.itemCount; i++) {
      const it = items[i]!;
      let j = i - 1;
      while (j >= 0 && items[j]!.key < it.key) {
        items[j + 1] = items[j]!;
        j--;
      }
      items[j + 1] = it;
    }
    for (let i = 0; i < this.itemCount; i++) {
      const it = items[i]!;
      switch (it.kind) {
        case ITEM_OBSTACLE: {
          const ob = it.ob!;
          const a = fogAt(it.rel, far);
          if (ob.kind === 'train') drawTrain(v, ob, it.rel, a);
          else if (ob.kind === 'ramp') drawRamp(v, ob, it.rel, a);
          else drawBarrier(v, ob, it.rel, a);
          break;
        }
        case ITEM_COIN:
          this.drawCoin(it.coin!, it.rel, coinFar);
          break;
        case ITEM_POWER:
          drawPower(v, it.power!, it.rel, clamp((coinFar - it.rel) / 20, 0, 1));
          break;
        case ITEM_GANTRY:
          this.scenery.drawGantry(v, it.rel, clamp((it.rel + 3) / 3, 0, 1) * fogAt(it.rel, far));
          break;
        case ITEM_PLAYER:
          this.drawPlayer();
          break;
        default:
          this.drawChaser();
      }
    }
    this.ctx.globalAlpha = 1;
  }

  private drawCoin(c: Coin, rel: number, coinFar: number): void {
    const cam = this.cam.project(c.x, c.y, rel);
    // Fade in over the last 20 m of coin visibility instead of popping in, and out once passed.
    this.ctx.globalAlpha = clamp(Math.min((coinFar - rel) / 20, 1 + rel / 2), 0, 1);
    this.coinSprites.draw(
      this.ctx,
      cam.px,
      cam.py,
      Math.max(1.5, 0.36 * cam.ps),
      Math.cos(this.time * 5 + c.z * 0.3),
    );
    this.ctx.globalAlpha = 1;
  }

  private chaserZ(): number {
    const caught = this.crashed && this.crashOb === null ? Math.min(1, this.crashT * 2) : 0;
    return -9 + 6.6 * this.chaserT + 1.2 * caught;
  }

  private drawPlayer(): void {
    const ctx = this.ctx;
    const cam = this.cam;
    const ground = this.crashed ? this.probeGround(this.px, this.crashOb) : this.probeGround(this.px);
    const surface = Math.min(ground, this.py);
    // Shadow on whatever surface is under the runner.
    cam.project(this.px, surface + 0.01, 0);
    const shadow = clamp(1 - (this.py - surface) / 8, 0.3, 1);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.ellipse(cam.px, cam.py, 0.55 * cam.ps * shadow, 0.2 * cam.ps * shadow, 0, 0, TAU);
    ctx.fill();

    const p = this.pose;
    const speedK = clamp((this.speed - 13) / 20, 0, 1);
    p.phase = this.runPhase;
    p.stride = 0.8 + 0.3 * speedK;
    p.air = this.grounded || this.powers.jetpack > 0 ? 0 : clamp((this.py - surface) / 0.5, 0, 1);
    p.rising = this.vy > 0;
    p.rolling = this.rollT > 0 && !this.crashed;
    p.rollAngle = this.rollAngle;
    p.lean = this.crashed ? 0 : clamp((laneX(this.lane) - this.px) * 0.12, -0.25, 0.25);
    p.jetpack = this.powers.jetpack > 0;
    p.sneakers = this.powers.sneakers > 0;
    p.time = this.time;
    p.crash = this.crashKind;
    p.sqX = 1;
    p.sqY = 1;
    if (this.crashed) {
      const t = Math.min(1, this.crashT / 0.35);
      if (this.crashKind === 1) {
        p.sqX = 1.12;
        p.sqY = 0.88;
      } else {
        // Tripped: topple forward, away from the camera.
        p.sqY = 1 - 0.5 * t;
        p.sqX = 1 + 0.08 * t;
      }
      p.air = 0;
    } else if (this.landT < 0.1) {
      const k = 1 - this.landT / 0.1;
      p.sqY = 1 - 0.15 * k;
      p.sqX = 1 + 0.1 * k;
    } else if (this.takeoffT < 0.12) {
      const k = 1 - this.takeoffT / 0.12;
      p.sqY = 1 + 0.1 * k;
      p.sqX = 1 - 0.06 * k;
    }
    cam.project(this.px, this.py, 0);
    const bx = cam.px;
    const by = cam.py;
    const s = cam.ps;
    const blink = this.graceT > 0 && (this.services.reducedMotion || Math.floor(this.time * 14) % 2 === 0);
    if (blink) ctx.globalAlpha = 0.55;
    drawRig(ctx, bx, by, s, p, this.colors);
    ctx.globalAlpha = 1;
    if (this.shield || this.graceT > 0) {
      ctx.globalAlpha = this.shield ? 0.35 + 0.1 * Math.sin(this.time * 6) : 0.2;
      ctx.strokeStyle = '#7cf';
      ctx.lineWidth = Math.max(2, 0.05 * s);
      ctx.beginPath();
      ctx.arc(bx, by - 0.9 * s, 1.15 * s, 0, TAU);
      ctx.stroke();
      ctx.fillStyle = 'rgba(120,200,255,0.15)';
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  /** The guard who chases the runner after a stumble (Subway Surfers' inspector, in spirit). */
  private drawChaser(): void {
    const z = this.chaserZ();
    const cam = this.cam.project(this.px + 0.75, 0, z);
    const p = this.chaserPose;
    p.phase = this.runPhase + 1.1;
    p.stride = 1;
    p.lean = 0;
    this.ctx.globalAlpha = Math.min(1, this.chaserT * 1.5);
    drawRig(this.ctx, cam.px, cam.py, cam.ps, p, this.chaserColors);
    this.ctx.globalAlpha = 1;
  }

  /** Speed streaks from the vanishing point above 20 m/s (never with reduced motion). */
  private drawStreaks(): void {
    const k = (this.speed - 20) / 13;
    if (k <= 0 || this.services.reducedMotion || this.crashed) return;
    const ctx = this.ctx;
    const cam = this.cam;
    const R = Math.hypot(this.W, this.H) * 0.62;
    ctx.globalAlpha = Math.min(0.35, k * 0.35);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.6 * this.framing.unit;
    ctx.beginPath();
    for (let i = 0; i < STREAKS; i++) {
      const a = this.streakAngle[i]!;
      const t = (this.streakSeed[i]! + this.distance * (0.012 + 0.01 * this.streakSeed[i]!)) % 1;
      const r0 = R * (0.22 + 0.78 * t * t);
      const r1 = r0 + R * 0.1 * (0.4 + t);
      const c = Math.cos(a);
      const s = Math.sin(a);
      ctx.moveTo(cam.cx + c * r0, cam.hz + s * r0);
      ctx.lineTo(cam.cx + c * r1, cam.hz + s * r1);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  /** Red edge vignette while the chaser is close. */
  private drawVignette(): void {
    if (this.chaserT <= 0.01 || this.preview) return;
    const ctx = this.ctx;
    if (!this.vignette) {
      const r = Math.hypot(this.W, this.H) / 2;
      const g = ctx.createRadialGradient(this.W / 2, this.H / 2, r * 0.55, this.W / 2, this.H / 2, r);
      g.addColorStop(0, 'rgba(255,40,60,0)');
      g.addColorStop(1, 'rgba(255,40,60,0.45)');
      this.vignette = g;
    }
    const pulse = this.services.reducedMotion ? 1 : 0.8 + 0.2 * Math.sin(this.time * 8);
    ctx.globalAlpha = this.chaserT * pulse;
    ctx.fillStyle = this.vignette;
    ctx.fillRect(0, 0, this.W, this.H);
    ctx.globalAlpha = 1;
  }

  // ------------------------------------------------------------------ HUD

  private drawHud(): void {
    const ctx = this.ctx;
    const s = this.hs;
    const ins = this.insets;
    const top = ins.top + 14 * s;
    const left = ins.left + 14 * s;
    const right = this.W - ins.right - 14 * s;

    hudPill(ctx, left, top, 150 * s, 44 * s);
    this.coinSprites.draw(ctx, left + 24 * s, top + 22 * s, 13 * s, 1);
    text(ctx, `${this.coins}`, left + 46 * s, top + 23 * s, { size: 24 * s });

    const sw = 206 * s;
    hudPill(ctx, right - sw, top, sw, 44 * s);
    text(ctx, Math.floor(this.score).toLocaleString('en-US'), right - 16 * s, top + 23 * s, {
      size: 26 * s,
      align: 'right',
    });
    const mult = this.multiplier();
    text(ctx, `x${mult}`, right - sw + 16 * s, top + 23 * s, {
      size: 20 * s,
      color: this.powers.double > 0 ? '#ffc21a' : mult > 1 ? '#ffd23f' : '#aab',
    });
    // Distance and progress to the next milestone.
    text(ctx, `${Math.floor(this.distance)} m`, right - 6 * s, top + 62 * s, {
      size: 18 * s,
      align: 'right',
      color: '#e6e6f2',
    });
    progressBar(
      ctx,
      right - 112 * s,
      top + 77 * s,
      106 * s,
      6 * s,
      (this.distance % MILESTONE_M) / MILESTONE_M,
      '#ffd23f',
    );

    let y = top + 54 * s;
    for (const k of POWER_KINDS) {
      const t = this.powers[k];
      if (t <= 0) continue;
      const info = POWER_INFO[k];
      hudPill(ctx, left, y, POWER_PILL_W * s, 34 * s);
      drawPowerIcon(ctx, k, left + 20 * s, y + 17 * s, 9 * s, info.color);
      progressBar(ctx, left + 38 * s, y + 12 * s, 118 * s, 10 * s, t / this.powerTime(info.base), info.color);
      y += 40 * s;
    }
    if (this.shield) {
      hudPill(ctx, left, y, 124 * s, 34 * s);
      text(ctx, 'GUARDIAN', left + 62 * s, y + 17 * s, { size: 18 * s, align: 'center', color: '#7cf' });
      y += 40 * s;
    }

    // Announcements live in the sky between the HUD and the horizon, never over the track ahead.
    let banner: { title: string; sub: string; t: number; color: string } | null = null;
    if (this.bannerT < 1.8 && this.milestone === 0) {
      banner = { title: 'RUN!', sub: 'Grab coins · dodge trains', t: this.bannerT / 1.8, color: '#ffd23f' };
    } else if (this.milestoneT < 2.8) {
      const zone = zoneDef(this.milestone);
      banner = {
        title: `${(this.milestone * MILESTONE_M).toLocaleString('en-US')} m`,
        sub: `${zone.name} · SPEED UP · x${Math.min(MAX_MULTIPLIER, 1 + this.milestone)}`,
        t: this.milestoneT / 2.8,
        color: '#7cf6ff',
      };
    }
    const halfW = banner ? this.bannerHalfWidth(banner.title, banner.sub) : 0;
    const band = bannerBand(this.W, top, left, y, s, this.cam.hz - 40 * this.framing.unit, halfW);
    if (this.stumbleT > 0 && !this.crashed)
      text(ctx, 'CAREFUL!', band.carefulX, band.carefulY, {
        size: 26 * s,
        align: 'center',
        color: '#ff6b6b',
      });
    if (banner) this.drawBanner(banner.title, banner.sub, banner.t, band.y, banner.color);
    if (this.hint && !this.crashed) this.drawHint(this.hint, this.hintT);
  }

  /** Half the drawn width of a banner (title or subtitle, whichever is wider, plus its outline). */
  private bannerHalfWidth(title: string, sub: string): number {
    const ctx = this.ctx;
    const s = this.hs;
    ctx.font = `900 ${Math.min(54 * s, this.W / 8)}px ${FONT}`;
    const tw = ctx.measureText(title).width + 8 * s;
    ctx.font = `800 ${Math.min(19 * s, this.W / 26)}px ${FONT}`;
    const sw = ctx.measureText(sub).width + 4 * s;
    return Math.max(tw, sw) / 2;
  }

  private drawBanner(title: string, sub: string, t: number, y: number, color: string): void {
    const ctx = this.ctx;
    const s = this.hs;
    const a = t < 0.12 ? t / 0.12 : t > 0.78 ? (1 - t) / 0.22 : 1;
    const pop = this.services.reducedMotion || t >= 0.12 ? 1 : 0.7 + 0.3 * (t / 0.12);
    ctx.save();
    ctx.globalAlpha = clamp(a, 0, 1);
    ctx.translate(this.W / 2, y);
    ctx.scale(pop, pop);
    const size = Math.min(54 * s, this.W / 8);
    text(ctx, title, 0, -size * 0.2, { size, align: 'center', color, strokeWidth: 8 * s, weight: 900 });
    text(ctx, sub, 0, size * 0.62, { size: Math.min(19 * s, this.W / 26), align: 'center', weight: 800 });
    ctx.restore();
  }

  /** Bottom-centre pill with a gesture icon, clear of the runner and of any bottom inset. */
  private drawHint(id: HintId, t: number): void {
    const ctx = this.ctx;
    const s = this.hs;
    const info = HINTS[id];
    const label = this.touchUi ? info.touch : info.keys;
    const a = clamp(Math.min(t / 0.25, (3.2 - t) / 0.3), 0, 1);
    if (a <= 0) return;
    let size = 19 * s;
    ctx.font = `800 ${size}px ${FONT}`;
    let tw = ctx.measureText(label).width;
    const maxText = this.W - 24 * s - 76 * s;
    if (tw > maxText) {
      size *= maxText / tw;
      tw = maxText;
    }
    const h = 46 * s;
    const w = tw + 76 * s;
    const y = Math.min(this.framing.feetY + 0.09 * this.H, this.H - this.insets.bottom - h - 10 * s);
    const x = this.W / 2 - w / 2;
    ctx.globalAlpha = a;
    hudPill(ctx, x, y, w, h);
    const ix = x + 32 * s;
    const iy = y + h / 2;
    const nudge = this.services.reducedMotion ? 0 : Math.sin(t * 7) * 3 * s;
    ctx.strokeStyle = '#ffd23f';
    ctx.lineWidth = 4 * s;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    if (info.icon === 'lr') {
      for (let d = -1; d <= 1; d += 2) {
        const tip = ix + d * (15 * s + Math.abs(nudge));
        ctx.moveTo(tip - d * 7 * s, iy - 7 * s);
        ctx.lineTo(tip, iy);
        ctx.lineTo(tip - d * 7 * s, iy + 7 * s);
      }
    } else {
      const d = info.icon === 'up' ? -1 : 1;
      const tip = iy + d * (10 * s + Math.abs(nudge));
      ctx.moveTo(ix - 8 * s, tip - d * 8 * s);
      ctx.lineTo(ix, tip);
      ctx.lineTo(ix + 8 * s, tip - d * 8 * s);
      ctx.moveTo(ix, tip);
      ctx.lineTo(ix, tip - d * 20 * s);
    }
    ctx.stroke();
    ctx.lineCap = 'butt';
    text(ctx, label, x + 58 * s, iy + 1, { size, color: '#ffffff', stroke: null });
    ctx.globalAlpha = 1;
  }
}
