import { clamp, damp, TAU } from '../../core/math';
import { BaseGame } from '../base';
import { banner, fillRoundRect, hudPill, progressBar, text } from '../draw';
import type { GameServices } from '../types';
import {
  BALLOON_DY,
  BALLOON_RX,
  BALLOON_RY,
  type Cloud,
  CRATE_HALF,
  drawCrate,
  drawDog,
  drawDuckSprite,
  Scenery,
  trackerDuck,
} from './art';
import {
  AIM,
  COINS,
  DUCK_INFO,
  DUCKS_PER_ROUND,
  type DuckKind,
  type FlightPattern,
  flyTime,
  HISTORY,
  hitRadius,
  kindWeights,
  PACE,
  POWER_INFO,
  type PowerKind,
  requiredHits,
  shellsFor,
  SLOWMO_SCALE,
  speedScale,
  turnAngle,
  turnInterval,
  wavePlan,
  zigzagChance,
} from './tuning';

type Phase = 'intro' | 'wave' | 'waveEnd' | 'roundEnd' | 'over';
/** One entry of the round's hit tracker: the kind that was shot, a miss, or still to come. */
type Slot = 'pending' | 'miss' | DuckKind;

interface Duck {
  kind: DuckKind;
  pattern: FlightPattern;
  x: number;
  y: number;
  vx: number;
  vy: number;
  speed: number;
  state: 'fly' | 'hit' | 'fall' | 'escape' | 'gone';
  /** Shot down (as opposed to escaped). */
  hit: boolean;
  t: number;
  turnT: number;
  flap: number;
  /** Positions at the end of the previous HISTORY steps, newest first (lag-compensated hits). */
  hx: number[];
  hy: number[];
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
  hit: boolean;
}

interface BarLayout {
  x: number;
  y: number;
  w: number;
  h: number;
  /** HUD scale factor. */
  s: number;
}

const HOLE_LIFE = 0.4;
/** Status pill widths (logical px at HUD scale 1). */
const PILL = { power: 210, guardian: 140, combo: 118, gap: 8 } as const;
/** Zig-zag ducks climb or dive at this angle (radians) from the horizontal. */
const ZIGZAG_ANGLE = 0.55;
/** Minimum horizontal gap between ducks of the same wave when they take off. */
const MIN_SPAWN_GAP = 110;
/** Seconds between ambient quacks while ducks are in the air. */
const QUACK_EVERY = 2.2;

export class DuckGame extends BaseGame {
  private round = 1;
  private phase: Phase = 'intro';
  private phaseT = 0;
  private plan: number[] = [];
  private waveIndex = 0;
  /** Tracker index of the current wave's first duck. */
  private waveStart = 0;
  /** The current wave. */
  private ducks: Duck[] = [];
  /** Ducks of a finished wave that are still falling or flying off. */
  private leaving: Duck[] = [];
  private crates: Crate[] = [];
  private holes: Hole[] = [];
  private readonly results: Slot[] = Array.from({ length: DUCKS_PER_ROUND }, (): Slot => 'pending');
  private shots = 0;
  private waveShells = 0;
  private waveT = 0;
  private waveFly = 0;
  /** Seconds since the last shell was fired. */
  private shotT = 0;
  private hurryWarned = false;
  private combo = 0;
  private flash = 0;
  private escapeFlash = 0;
  private aimX: number;
  private aimY: number;
  private aimVX = 0;
  private aimVY = 0;
  private aimHold = 0;
  /** Seconds left in which keys can't move the crosshair, after a snap onto a duck. */
  private snapLock = 0;
  /** Keyboard / gamepad steers the crosshair (until the pointer moves or presses again). */
  private aimByKeys = false;
  /** The pointer driving the crosshair is a finger: larger hit radius. */
  private touchAim = false;
  private lastPtrX: number;
  private lastPtrY: number;
  private readonly powers: Record<'slowmo' | 'scatter', number> = { slowmo: 0, scatter: 0 };
  /** Power Start boost: scatter shot for the whole first round, independent of crates. */
  private headStart: boolean;
  private guardian: boolean;
  /** The current round is a Guardian retry. */
  private retry = false;
  /** Seconds since the round started (drives the round banner). */
  private introT = 0;
  private dogMode: 'none' | 'happy' | 'laugh' = 'none';
  /** The dog pops up as soon as the finished wave's ducks have landed or flown off. */
  private dogPending = false;
  private dogT = 0;
  private dogX = 0;
  /** Game over: the dog rises and stays. */
  private dogStay = false;
  private readonly dogKinds: DuckKind[] = [];
  private laughStep = 0;
  private quackT = 1;
  private readonly clouds: Cloud[] = [];
  private readonly grassTop: number;
  private readonly scenery: Scenery;
  private readonly bar: BarLayout = { x: 0, y: 0, w: 0, h: 0, s: 1 };

  constructor(s: GameServices) {
    super(s);
    this.grassTop = this.H - 140;
    this.scenery = new Scenery(this.ctx, this.W, this.H, this.grassTop);
    this.aimX = this.W / 2;
    this.aimY = this.grassTop * 0.55;
    this.lastPtrX = this.input.pointer.x;
    this.lastPtrY = this.input.pointer.y;
    this.guardian = this.hasBoost('shield');
    this.headStart = this.hasBoost('head-start');
    const clouds = Math.round(this.W / 160);
    for (let i = 0; i < clouds; i++)
      this.clouds.push({
        x: this.rng.range(0, this.W),
        y: this.rng.range(30, this.grassTop * 0.5),
        s: this.rng.range(0.6, 1.3),
      });
    this.startRound();
  }

  private get required(): number {
    return requiredHits(this.round);
  }

  private get scatterActive(): boolean {
    return this.headStart || this.powers.scatter > 0;
  }

  private get multiplier(): number {
    return Math.min(5, 1 + Math.floor(this.combo / 3));
  }

  private hitCount(): number {
    let n = 0;
    for (const r of this.results) if (r !== 'pending' && r !== 'miss') n++;
    return n;
  }

  private startRound(): void {
    this.phase = 'intro';
    this.phaseT = 0;
    this.introT = 0;
    this.waveIndex = 0;
    this.waveStart = 0;
    this.results.fill('pending');
    this.ducks = [];
    this.plan = wavePlan(this.round, this.rng);
    const first = this.plan[0] ?? 2;
    this.waveShells = this.shots = shellsFor(first);
  }

  private startWave(): void {
    const n = this.plan[this.waveIndex] ?? 2;
    this.phase = 'wave';
    this.phaseT = 0;
    this.waveT = 0;
    this.shotT = 0;
    this.hurryWarned = false;
    this.waveShells = this.shots = shellsFor(n);
    this.waveFly = flyTime(this.round, n);
    this.ducks = [];
    for (let i = 0; i < n; i++) this.ducks.push(this.makeDuck());
    if (this.rng.chance(0.2)) {
      const kind = this.rng.pick<PowerKind>(['slowmo', 'scatter', 'ammo']);
      this.crates.push({
        kind,
        x: this.rng.range(120, this.W - 120),
        // The box starts just above the grass so it is visible, not only its balloon.
        y: this.grassTop - 10,
        vy: -this.rng.range(55, 80),
        alive: true,
      });
      this.audio.play('pop');
    }
    this.quackT = 0.9;
    this.audio.play('quack');
  }

  private makeDuck(): Duck {
    const kind = this.rng.weighted(kindWeights(this.round));
    const pattern: FlightPattern = this.rng.chance(zigzagChance(this.round)) ? 'zigzag' : 'wander';
    const speed = DUCK_INFO[kind].speed * speedScale(this.round);
    const angle = -Math.PI / 2 + this.rng.range(-0.9, 0.9);
    const lo = 140;
    const hi = this.W - 140;
    let x = this.rng.range(lo, hi);
    // Keep wave-mates apart at take-off (no extra RNG draws, so seeds play the same).
    for (const other of this.ducks) {
      if (Math.abs(other.x - x) < MIN_SPAWN_GAP)
        x = x + MIN_SPAWN_GAP * 2 > hi ? x - MIN_SPAWN_GAP * 2 : x + MIN_SPAWN_GAP * 2;
    }
    const y = this.grassTop + 30;
    return {
      kind,
      pattern,
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      speed,
      state: 'fly',
      hit: false,
      t: 0,
      turnT: turnInterval(this.round, kind, this.rng),
      flap: this.rng.next() * TAU,
      hx: new Array<number>(HISTORY).fill(x),
      hy: new Array<number>(HISTORY).fill(y),
    };
  }

  // ------------------------------------------------------------------ update

  protected tick(dt: number): void {
    this.phaseT += dt;
    this.introT += dt;
    this.dogT += dt;
    this.shotT += dt;
    this.flash = Math.max(0, this.flash - dt);
    this.escapeFlash = Math.max(0, this.escapeFlash - dt);
    this.powers.slowmo = Math.max(0, this.powers.slowmo - dt);
    this.powers.scatter = Math.max(0, this.powers.scatter - dt);
    for (const c of this.clouds) {
      c.x += 8 * c.s * dt;
      if (c.x > this.W + 120) c.x = -160;
    }
    for (const h of this.holes) h.life -= dt;
    if (this.holes.length > 0 && (this.holes[0]?.life ?? 1) <= 0)
      this.holes = this.holes.filter((h) => h.life > 0);
    this.updateDogVoice();

    const ptr = this.input.pointer;
    // Presses off the canvas (letterbox bars) never fire.
    const ptrPress = ptr.pressed && ptr.inside;
    const fire = ptrPress || this.input.wasPressed('primary');
    this.updateAim(dt, ptrPress);
    const slow = this.powers.slowmo > 0 ? SLOWMO_SCALE : 1;
    // Shots are tested before the ducks move: against what the last rendered frame showed.
    if (this.phase === 'wave' && fire) this.shoot();
    this.updateDucks(this.ducks, dt * slow);
    this.updateDucks(this.leaving, dt * slow);
    this.updateCrates(dt);
    if (this.dogPending && countState(this.leaving, 'gone') === this.leaving.length) this.showDog();

    switch (this.phase) {
      case 'intro':
        // The first pair takes off while the round banner is still fading out.
        if (this.phaseT >= PACE.introWave) this.startWave();
        break;
      case 'wave':
        this.waveT += dt * slow;
        this.updateQuacks(dt);
        this.checkWaveEnd();
        break;
      case 'waveEnd':
        if (this.waveIndex + 1 < this.plan.length) {
          // The next ducks take off while the last ones are still falling.
          if (this.phaseT >= PACE.nextWave) {
            this.waveStart += this.plan[this.waveIndex] ?? 2;
            this.waveIndex++;
            this.startWave();
          }
        } else if (!this.dogPending && this.dogT >= PACE.lastWaveHold) {
          this.endRound();
        }
        break;
      case 'roundEnd':
        if (this.phaseT >= PACE.roundEnd || (fire && this.phaseT >= PACE.roundSkip)) this.afterRound();
        break;
      case 'over':
        break;
    }
  }

  private updateAim(dt: number, ptrPress: boolean): void {
    const ptr = this.input.pointer;
    // The pointer steers whenever it moves or presses; keys take over until it does again.
    if (ptr.active && (ptrPress || ptr.x !== this.lastPtrX || ptr.y !== this.lastPtrY)) {
      this.aimByKeys = false;
      this.touchAim = ptr.touch;
      this.aimX = ptr.x;
      this.aimY = ptr.y;
      this.aimVX = this.aimVY = 0;
    }
    this.lastPtrX = ptr.x;
    this.lastPtrY = ptr.y;
    if (this.phase === 'wave' && this.input.wasPressed('secondary')) this.snapToDuck();
    this.snapLock = Math.max(0, this.snapLock - dt);
    // Right after a snap the keys wait, so the reticle stays on the duck long enough to shoot.
    let ax = this.snapLock > 0 ? 0 : this.input.axisX();
    let ay = this.snapLock > 0 ? 0 : this.input.axisY();
    if (ax !== 0 || ay !== 0) {
      if (ax !== 0 && ay !== 0) {
        ax *= Math.SQRT1_2;
        ay *= Math.SQRT1_2;
      }
      this.aimByKeys = true;
      this.touchAim = false;
      this.aimHold += dt;
    } else {
      this.aimHold = 0;
    }
    if (this.aimByKeys) {
      // Accelerate while held (precise taps, fast sweeps) and ease velocity changes so digital
      // keys and d-pads feel analog.
      const k = clamp(this.aimHold / AIM.ramp, 0, 1);
      const speed = AIM.minSpeed + (AIM.maxSpeed - AIM.minSpeed) * k * k * (3 - 2 * k);
      const resp = damp(AIM.response, dt);
      this.aimVX += (ax * speed - this.aimVX) * resp;
      this.aimVY += (ay * speed - this.aimVY) * resp;
      this.aimX += this.aimVX * dt;
      this.aimY += this.aimVY * dt;
      if (Math.hypot(this.aimVX, this.aimVY) < AIM.assistMaxSpeed) this.assistAim(dt);
    }
    this.aimX = clamp(this.aimX, 0, this.W);
    this.aimY = clamp(this.aimY, 0, this.H);
  }

  /** Light magnetism for keys and pads: drift with a nearby duck and ease onto it. */
  private assistAim(dt: number): void {
    const best = this.nearestFlying(this.aimX, this.aimY, AIM.assistRadius);
    if (!best) return;
    this.aimX += (best.x - (best.hx[0] ?? best.x)) * AIM.assistFollow;
    this.aimY += (best.y - (best.hy[0] ?? best.y)) * AIM.assistFollow;
    const k = damp(AIM.assistPull, dt);
    this.aimX += (best.x - this.aimX) * k;
    this.aimY += (best.y - this.aimY) * k;
  }

  /** The flying duck closest to (x, y), if one lies within `within` px. */
  private nearestFlying(x: number, y: number, within: number): Duck | null {
    let best: Duck | null = null;
    let bestD = within;
    for (const d of this.ducks) {
      if (d.state !== 'fly') continue;
      const dd = Math.hypot(d.x - x, d.y - y);
      if (dd < bestD) {
        bestD = dd;
        best = d;
      }
    }
    return best;
  }

  /** Secondary action: jump the crosshair onto the nearest flying duck and hold it there briefly. */
  private snapToDuck(): void {
    const d = this.nearestFlying(this.aimX, this.aimY, Infinity);
    if (!d) return;
    this.aimX = d.x;
    this.aimY = d.y;
    this.aimVX = this.aimVY = 0;
    this.aimByKeys = true;
    this.touchAim = false;
    this.snapLock = AIM.snapLock;
  }

  /** Current hit radius: the reticle ring is drawn at exactly this size. */
  private get shotRadius(): number {
    return hitRadius(this.round, this.touchAim, this.scatterActive);
  }

  private shoot(): void {
    if (this.shots <= 0) {
      this.audio.play('empty');
      return;
    }
    this.shots--;
    this.shotT = 0;
    this.addStat('shots');
    this.audio.play('gun');
    this.flash = 0.06;
    this.shake.add(0.18);
    this.services.haptic(25);
    const x = this.aimX;
    const y = this.aimY;
    const r = this.shotRadius;
    let crateHit = false;
    for (const c of this.crates) {
      if (!c.alive || !crateInReach(c, x, y, r)) continue;
      c.alive = false;
      crateHit = true;
      this.activatePower(c.kind);
      this.particles.emit({
        x: c.x,
        y: c.y - BALLOON_DY / 2,
        count: 18,
        speed: 220,
        life: 0.6,
        size: 4,
        colors: ['#c58b4a', '#fff', POWER_INFO[c.kind].color],
        shape: 'square',
        gravity: 400,
      });
    }
    let hits = 0;
    for (const d of this.ducks) {
      if (d.state === 'fly' && duckInReach(d, x, y, r)) {
        hits++;
        this.hitDuck(d);
      }
    }
    this.holes.push({ x, y, life: HOLE_LIFE, hit: hits > 0 || crateHit });
    if (hits === 0 && !crateHit) {
      // A miss breaks the combo; supply crates never do.
      this.combo = 0;
      this.texts.add(x, y - 34, 'MISS', '#e6e9f5', 16, 0.5);
      this.particles.emit({
        x,
        y,
        count: 7,
        speed: 110,
        life: 0.45,
        size: 3,
        colors: ['#ffffff', '#ded6c2', '#b9b2a0'],
        gravity: 260,
        drag: 3,
      });
    } else if (hits > 1) {
      this.addStat('doubleKills');
      this.coins += COINS.multiKill * (hits - 1);
      const bonus = hits > 2 ? 5000 : 2000;
      this.score += bonus;
      this.texts.add(x, y - 54, `${hits > 2 ? 'TRIPLE' : 'DOUBLE'}! +${bonus}`, '#ffd23f', 26);
    }
  }

  private hitDuck(d: Duck): void {
    d.state = 'hit';
    d.hit = true;
    d.t = 0;
    const before = this.multiplier;
    this.combo++;
    const mult = this.multiplier;
    const pts = Math.round(DUCK_INFO[d.kind].points * (1 + (this.round - 1) * 0.1)) * mult;
    this.score += pts;
    this.addStat('ducks');
    this.addStat('hits');
    if (d.kind === 'gold') {
      this.coins += COINS.gold;
      this.addStat('goldenDucks');
      this.audio.play('reward');
    }
    this.audio.play('quack', { pitch: 1.4 });
    const idx = this.results.indexOf('pending');
    if (idx >= 0) this.results[idx] = d.kind;
    this.texts.add(
      d.x,
      d.y - 30,
      mult > 1 ? `${pts} x${mult}` : `${pts}`,
      d.kind === 'gold' ? '#ffd23f' : '#fff',
      22,
    );
    if (mult > before) {
      this.audio.play('coin', { pitch: 1 + 0.12 * mult });
      this.texts.add(d.x, d.y - 56, `COMBO x${mult}`, '#ffb703', 20);
    }
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
  }

  private activatePower(kind: PowerKind): void {
    this.audio.play('powerup');
    this.addStat('powerups');
    this.texts.add(this.W / 2, this.grassTop * 0.45, POWER_INFO[kind].label, POWER_INFO[kind].color, 30);
    if (kind === 'ammo') this.shots += 3;
    // Never shortens a running power; the Overclock upgrade stretches every pickup.
    else this.powers[kind] = Math.max(this.powers[kind], this.powerTime(POWER_INFO[kind].dur));
  }

  private updateDucks(ducks: readonly Duck[], dt: number): void {
    for (const d of ducks) {
      d.t += dt;
      d.flap += dt * (d.state === 'fly' ? 14 : 22);
      switch (d.state) {
        case 'fly':
          this.flyDuck(d, dt);
          break;
        case 'hit':
          if (d.t >= PACE.hitFreeze) {
            d.state = 'fall';
            d.vy = 0;
            d.t = 0;
          }
          break;
        case 'fall':
          d.vy = Math.min(PACE.fallMaxSpeed, d.vy + PACE.fallGravity * dt);
          d.y += d.vy * dt;
          if (d.y > this.grassTop + 40) {
            d.state = 'gone';
            this.audio.play('land');
          }
          break;
        case 'escape':
          d.vy = -PACE.escapeSpeed;
          d.vx *= Math.exp(-1.2 * dt);
          d.x += d.vx * dt;
          d.y += d.vy * dt;
          if (d.y < -80) d.state = 'gone';
          break;
        case 'gone':
          break;
      }
    }
  }

  private flyDuck(d: Duck, dt: number): void {
    for (let i = HISTORY - 1; i > 0; i--) {
      d.hx[i] = d.hx[i - 1] ?? d.x;
      d.hy[i] = d.hy[i - 1] ?? d.y;
    }
    d.hx[0] = d.x;
    d.hy[0] = d.y;
    d.turnT -= dt;
    const emerging = d.t < PACE.emerge && d.y > this.grassTop - 40;
    if (d.turnT <= 0 && !emerging) {
      if (d.pattern === 'zigzag') {
        d.turnT = this.rng.range(0.42, 0.58);
        const dir = d.vx >= 0 ? 1 : -1;
        d.vx = dir * Math.cos(ZIGZAG_ANGLE) * d.speed;
        d.vy = (d.vy > 0 ? -1 : 1) * Math.sin(ZIGZAG_ANGLE) * d.speed;
      } else {
        d.turnT = turnInterval(this.round, d.kind, this.rng);
        const a = Math.atan2(d.vy, d.vx) + this.rng.range(-1, 1) * turnAngle(d.kind);
        d.vx = Math.cos(a) * d.speed;
        d.vy = Math.sin(a) * d.speed;
      }
    }
    d.x += d.vx * dt;
    d.y += d.vy * dt;
    if (d.x < 34 && d.vx < 0) d.vx = -d.vx;
    if (d.x > this.W - 34 && d.vx > 0) d.vx = -d.vx;
    if (d.y < 44 && d.vy < 0) d.vy = -d.vy;
    if (!emerging && d.y > this.grassTop - 50 && d.vy > 0) d.vy = -Math.abs(d.vy);
  }

  private updateCrates(dt: number): void {
    for (const c of this.crates) {
      c.y += c.vy * dt;
      if (c.y < -60) c.alive = false;
    }
    if (this.crates.some((c) => !c.alive)) this.crates = this.crates.filter((c) => c.alive);
  }

  /** Occasional quack from the duck nearest the crosshair (not a constant chorus). */
  private updateQuacks(dt: number): void {
    this.quackT -= dt;
    if (this.quackT > 0) return;
    this.quackT = QUACK_EVERY;
    const best = this.nearestFlying(this.aimX, this.aimY, Infinity);
    if (best) this.audio.play('quack', { volume: 0.3, pitch: best.kind === 'gold' ? 1.25 : 1 });
  }

  private updateDogVoice(): void {
    // A short descending chuckle when the dog laughs.
    if (this.dogMode !== 'laugh' || this.laughStep >= 3 || this.dogT < this.laughStep * 0.14) return;
    this.audio.play('stomp', { pitch: 1.6 - 0.18 * this.laughStep, volume: 0.6 });
    this.laughStep++;
  }

  private checkWaveEnd(): void {
    if (countState(this.ducks, 'fly') > 0) {
      if (!this.hurryWarned && this.waveT > this.waveFly - PACE.hurry) {
        this.hurryWarned = true;
        this.audio.play('warning', { volume: 0.5 });
      }
      // Out of shells: the rest fly off right away instead of idling until the clock runs out.
      const dry = this.shots <= 0 && this.shotT >= PACE.outOfShells;
      if (this.waveT > this.waveFly || dry) this.escapeAll();
      if (countState(this.ducks, 'fly') > 0) return;
    }
    // Every duck of the wave was shot or fled: hand them over to the dog and move on.
    for (const d of this.ducks) this.leaving.push(d);
    this.ducks = [];
    this.dogPending = true;
    this.phase = 'waveEnd';
    this.phaseT = 0;
  }

  private escapeAll(): void {
    for (const d of this.ducks) {
      if (d.state !== 'fly') continue;
      d.state = 'escape';
      d.t = 0;
      const idx = this.results.indexOf('pending');
      if (idx >= 0) this.results[idx] = 'miss';
      this.texts.add(
        clamp(d.x, 80, this.W - 80),
        clamp(d.y, 60, this.grassTop) - 30,
        'FLEW AWAY',
        '#ffd0e0',
        18,
      );
    }
    this.combo = 0;
    this.escapeFlash = 1.2;
    this.audio.play('whoosh');
  }

  private showDog(): void {
    this.dogKinds.length = 0;
    let sumX = 0;
    for (const d of this.leaving) {
      if (!d.hit) continue;
      this.dogKinds.push(d.kind);
      sumX += d.x;
    }
    this.leaving = [];
    this.dogPending = false;
    const n = this.dogKinds.length;
    this.dogX = n > 0 ? sumX / n : this.W / 2;
    this.dogMode = n > 0 ? 'happy' : 'laugh';
    this.dogT = 0;
    this.dogStay = false;
    this.laughStep = 0;
    if (n > 0) this.audio.play(n > 1 ? 'coin' : 'select');
  }

  private endRound(): void {
    this.phase = 'roundEnd';
    this.phaseT = 0;
    const hits = this.hitCount();
    if (hits >= this.required) {
      this.audio.play('win');
      if (hits === DUCKS_PER_ROUND) {
        this.score += 10000;
        this.coins += COINS.perfect;
        this.addStat('perfectRounds');
        this.texts.add(this.W / 2, this.grassTop * 0.75, 'PERFECT! +10000', '#ffd23f', 34, 1.6);
      }
    } else {
      // The Guardian will retry the round: not a game-over sting.
      this.audio.play(this.guardian ? 'warning' : 'gameover');
    }
  }

  private afterRound(): void {
    const pass = this.hitCount() >= this.required;
    this.headStart = false;
    this.retry = false;
    if (pass) {
      this.addStat('rounds');
      this.maxStat('bestRound', this.round);
      this.round++;
      this.startRound();
    } else if (this.guardian) {
      this.guardian = false;
      this.retry = true;
      this.audio.play('powerup');
      this.startRound();
    } else {
      this.phase = 'over';
      this.phaseT = 0;
      this.dogMode = 'laugh';
      this.dogX = this.W / 2;
      this.dogT = 0;
      this.dogStay = true;
      this.laughStep = 0;
      this.endGame(2.2, false);
    }
  }

  // ------------------------------------------------------------------ render

  render(): void {
    const ctx = this.ctx;
    const calm = this.services.reducedMotion;
    ctx.save();
    ctx.translate(this.shake.x, this.shake.y);
    this.scenery.drawBack(this.round, this.time, this.clouds);
    if (this.escapeFlash > 0 && !calm) {
      ctx.fillStyle = `rgba(255,140,180,${Math.min(0.4, this.escapeFlash * 0.45)})`;
      ctx.fillRect(-20, -20, this.W + 40, this.grassTop + 20);
    }
    const rise = this.dogRise();
    if (rise > 0 && this.dogMode !== 'none') {
      drawDog(
        ctx,
        clamp(this.dogX, 120, this.W - 120),
        this.grassTop + 62,
        rise,
        this.dogMode,
        this.dogKinds,
        this.time,
      );
    }
    for (const c of this.crates) drawCrate(ctx, c);
    for (const d of this.leaving) if (d.state !== 'gone') this.drawDuck(d);
    for (const d of this.ducks) if (d.state !== 'gone') this.drawDuck(d);
    this.scenery.drawFront(this.round, this.time);
    this.particles.render(ctx);
    this.drawHoles();
    this.texts.render(ctx);
    ctx.restore();
    if (this.flash > 0 && !calm) {
      ctx.fillStyle = `rgba(255,255,255,${this.flash * 3})`;
      ctx.fillRect(0, 0, this.W, this.H);
    }
    if (!this.services.preview) this.drawHud();
    this.drawCrosshair();
  }

  /** How far the dog has risen out of the grass, 0..1. */
  private dogRise(): number {
    const t = this.dogT;
    if (this.dogStay) return Math.min(1, t / 0.3);
    if (this.dogMode === 'none' || t >= PACE.dog) return 0;
    if (t < PACE.dogRise) {
      const k = 1 - t / PACE.dogRise;
      return 1 - k * k;
    }
    const sink = PACE.dog - PACE.dogSink;
    return t > sink ? 1 - (t - sink) / PACE.dogSink : 1;
  }

  private drawDuck(d: Duck): void {
    const facing = d.vx >= 0 ? 1 : -1;
    let rot = 0;
    if (d.state === 'fall') rot = d.t * 14;
    else if (d.state === 'fly' || d.state === 'escape')
      rot = clamp(Math.atan2(d.vy, Math.abs(d.vx)) * 0.4, -0.5, 0.5) * facing;
    drawDuckSprite(this.ctx, d.kind, d.x, d.y, {
      facing,
      rot,
      wing: d.state === 'hit' ? -1.2 : Math.sin(d.flap),
      dead: d.state === 'hit' || d.state === 'fall',
      scale: 1.1,
    });
    if (d.state === 'hit' && d.t < 0.12) {
      const ctx = this.ctx;
      ctx.globalAlpha = 1 - d.t / 0.12;
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(d.x, d.y, 30 + d.t * 200, 0, TAU);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  private drawHoles(): void {
    const ctx = this.ctx;
    for (const h of this.holes) {
      const k = h.life / HOLE_LIFE;
      ctx.globalAlpha = k;
      ctx.strokeStyle = h.hit ? '#ffd23f' : '#fff';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(h.x, h.y, (1 - k) * 40 + 6, 0, TAU);
      ctx.stroke();
      // Muzzle spark for the first few frames.
      if (k > 0.8) {
        ctx.fillStyle = '#fffbe0';
        ctx.beginPath();
        ctx.arc(h.x, h.y, 9 * (k - 0.8) * 5, 0, TAU);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  private drawCrosshair(): void {
    const ctx = this.ctx;
    const main = this.skinColor('main', '#ff3b3b');
    const accent = this.skinColor('accent', '#ffffff');
    const style = this.skinParam('style', 0);
    const r = this.shotRadius;
    const x = this.aimX;
    const y = this.aimY;
    ctx.save();
    if (this.phase === 'wave' && this.shots <= 0) ctx.globalAlpha = 0.45;
    // A soft fill tells you a duck is inside the ring right now.
    if (this.phase === 'wave' && this.onTarget(r)) {
      ctx.fillStyle = 'rgba(255,255,255,0.16)';
      ctx.beginPath();
      ctx.arc(x, y, r, 0, TAU);
      ctx.fill();
    }
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
      ctx.moveTo(x + gap, y);
      ctx.lineTo(x + len, y);
      ctx.moveTo(x - gap, y);
      ctx.lineTo(x - len, y);
      ctx.moveTo(x, y + gap);
      ctx.lineTo(x, y + len);
      ctx.moveTo(x, y - gap);
      ctx.lineTo(x, y - len);
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

  private onTarget(r: number): boolean {
    for (const d of this.ducks)
      if (d.state === 'fly' && Math.hypot(d.x - this.aimX, d.y - this.aimY) < r) return true;
    return false;
  }

  /** CSS px per logical px on screen. Reads 1 when the canvas is not laid out (tests). */
  private cssPerLogical(): number {
    const css = (this.ctx.canvas as HTMLCanvasElement | undefined)?.clientWidth ?? 0;
    return css > 0 ? css / this.W : 1;
  }

  /**
   * Extra HUD size on small screens. A phone draws the canvas at few CSS px per logical px, so the
   * text needs more logical px to stay readable.
   */
  private phoneScale(): number {
    return clamp(0.8 / this.cssPerLogical(), 1, 1.2);
  }

  /** Bottom HUD bar: anchored to the canvas edges and lifted above the bottom inset. */
  private layoutBar(): BarLayout {
    const b = this.bar;
    const ins = this.insets;
    b.s = clamp(this.H / 540, 1, 1.5) * this.phoneScale();
    b.h = 58 * b.s;
    b.x = 10 + ins.left;
    b.w = Math.max(0, this.W - ins.left - ins.right - 20);
    b.y = Math.max(4, this.H - ins.bottom - b.h - 10);
    return b;
  }

  private drawHud(): void {
    const ctx = this.ctx;
    const b = this.layoutBar();
    const s = b.s;
    const cy = b.y + b.h / 2;
    const right = b.x + b.w;
    fillRoundRect(ctx, b.x, b.y, b.w, b.h, 16 * s, 'rgba(10,12,30,0.74)');
    // Round number and shells on the left.
    let x = b.x + 16 * s;
    const roundLabel = `R${this.round}`;
    text(ctx, roundLabel, x, cy, { size: 28 * s, color: '#7CFC00' });
    x += ctx.measureText(roundLabel).width + 14 * s;
    const shells = Math.max(this.waveShells, this.shots);
    const sw = 12 * s;
    const step = (shells > 4 ? 17 : 20) * s;
    for (let i = 0; i < shells; i++) {
      const filled = i < this.shots;
      const sx = x + i * step;
      fillRoundRect(ctx, sx, cy - 14 * s, sw, 28 * s, 4 * s, filled ? '#e63946' : 'rgba(255,255,255,0.15)');
      if (filled) fillRoundRect(ctx, sx, cy + 7 * s, sw, 7 * s, 2 * s, '#ffd23f');
    }
    const leftEnd = x + shells * step + 8 * s;
    // Score on the right.
    const scoreLabel = Math.floor(this.score).toLocaleString('en-US');
    text(ctx, scoreLabel, right - 16 * s, cy, { size: 30 * s, align: 'right' });
    const rightStart = right - 16 * s - Math.max(ctx.measureText(scoreLabel).width, 90 * s) - 16 * s;
    this.drawTracker(leftEnd, rightStart, cy, s);
    this.drawStatusRow(b);
    if (
      this.phase === 'wave' &&
      this.waveT > this.waveFly - PACE.hurry &&
      countState(this.ducks, 'fly') > 0
    ) {
      const pulse = 1 + 0.08 * Math.sin(this.time * 14);
      text(ctx, 'HURRY!', this.W / 2, b.y - 66 * s, {
        size: 30 * s * pulse,
        align: 'center',
        color: '#ff6b6b',
      });
    }
    this.drawBanners();
  }

  /** The ten-duck tracker with the required-hits marker, centred in the space left over. */
  private drawTracker(left: number, right: number, cy: number, s: number): void {
    const ctx = this.ctx;
    const labelW = 44 * s;
    const sp = clamp((right - left - labelW) / DUCKS_PER_ROUND, 22 * s, 34 * s);
    const icon = Math.min(1, sp / (32 * s)) * s;
    const x0 = (left + right) / 2 - (labelW + sp * DUCKS_PER_ROUND) / 2;
    text(ctx, 'HIT', x0, cy, { size: 19 * s, color: '#ccd' });
    const first = this.waveStart;
    const last = first + (this.plan[this.waveIndex] ?? 2);
    const blink = 0.5 + 0.5 * Math.sin(this.time * 10);
    for (let i = 0; i < DUCKS_PER_ROUND; i++) {
      const r = this.results[i] ?? 'pending';
      const cx = x0 + labelW + (i + 0.4) * sp;
      const iy = cy + 3 * s;
      ctx.fillStyle =
        r === 'pending'
          ? '#fff'
          : r === 'miss'
            ? 'rgba(255,255,255,0.18)'
            : r === 'gold'
              ? '#ffd23f'
              : '#ff4d6d';
      trackerDuck(ctx, cx, iy, icon);
      // The ducks in the air right now get a pulsing yellow ring.
      if (this.phase === 'wave' && r === 'pending' && i >= first && i < last) {
        ctx.strokeStyle = `rgba(255,210,63,${0.45 + 0.55 * blink})`;
        ctx.lineWidth = 2.5 * s;
        ctx.beginPath();
        ctx.ellipse(cx + 3 * icon, iy - 2 * icon, 16 * icon, 13 * icon, 0, 0, TAU);
        ctx.stroke();
      }
    }
    ctx.fillStyle = '#4dd9ff';
    ctx.fillRect(x0 + labelW + this.required * sp - 0.18 * sp - 1.5 * s, cy - 22 * s, 3 * s, 44 * s);
  }

  /**
   * Power timers (left), combo and Guardian (right), just above the bar and below the flight band.
   * The whole row shrinks when its pills would not fit the bar.
   */
  private drawStatusRow(b: BarLayout): void {
    const ctx = this.ctx;
    const mult = this.multiplier;
    // Scatter also shows while the Power Start runs, even with no crate timer.
    const kinds = (['slowmo', 'scatter'] as const).filter(
      (k) => this.powers[k] > 0 || (k === 'scatter' && this.headStart),
    );
    const widths = [
      ...kinds.map(() => PILL.power),
      ...(this.guardian ? [PILL.guardian] : []),
      ...(mult > 1 ? [PILL.combo] : []),
    ];
    if (widths.length === 0) return;
    const total = widths.reduce((a, w) => a + w, 0) + PILL.gap * (widths.length - 1);
    const s = Math.min(b.s, b.w / total);
    const h = 40 * s;
    const y = b.y - h - PILL.gap * s;
    let x = b.x;
    for (const k of kinds) {
      const v = this.powers[k];
      const info = POWER_INFO[k];
      const w = PILL.power * s;
      hudPill(ctx, x, y, w, h);
      // Only the Power Start is running: the timer is still full and says so.
      text(ctx, v > 0 ? info.label : `${info.label} · ROUND 1`, x + 18 * s, y + 14 * s, {
        size: 15 * s,
        color: info.color,
      });
      const frac = v > 0 ? v / this.powerTime(info.dur) : 1;
      progressBar(ctx, x + 18 * s, y + 25 * s, w - 36 * s, 7 * s, frac, info.color);
      x += w + PILL.gap * s;
    }
    let rx = b.x + b.w;
    if (this.guardian) {
      const w = PILL.guardian * s;
      rx -= w;
      hudPill(ctx, rx, y, w, h);
      text(ctx, 'GUARDIAN', rx + w / 2, y + h / 2, { size: 16 * s, align: 'center', color: '#7cf' });
      rx -= PILL.gap * s;
    }
    if (mult > 1) {
      const w = PILL.combo * s;
      rx -= w;
      hudPill(ctx, rx, y, w, h);
      text(ctx, `COMBO x${mult}`, rx + w / 2, y + h / 2, { size: 16 * s, align: 'center', color: '#ffb703' });
    }
  }

  private drawBanners(): void {
    const ctx = this.ctx;
    if (this.introT < PACE.intro) {
      const goal = `Hit ${this.required} of ${DUCKS_PER_ROUND} ducks`;
      banner(
        ctx,
        this.W,
        this.H,
        `ROUND ${this.round}`,
        this.retry ? `Guardian retry · ${goal}` : goal,
        this.introT / PACE.intro,
        this.retry ? '#77ccff' : '#7CFC00',
      );
    } else if (this.phase === 'roundEnd') {
      const hits = this.hitCount();
      const pass = hits >= this.required;
      const sub = `${hits} / ${DUCKS_PER_ROUND} ducks${!pass && this.guardian ? ' · Guardian retry' : ''}`;
      const t = this.phaseT / PACE.roundEnd;
      banner(
        ctx,
        this.W,
        this.H,
        pass ? 'ROUND CLEAR!' : 'ROUND FAILED',
        sub,
        t,
        pass ? '#ffd23f' : '#ff6b6b',
      );
      if (this.phaseT >= PACE.roundSkip && t < 0.8) {
        text(ctx, 'Click or shoot to continue', this.W / 2, this.H * 0.38 + 92, {
          // Keeps at least 13 CSS px on a phone.
          size: Math.max(17, 13 / this.cssPerLogical()),
          align: 'center',
          weight: 700,
          color: 'rgba(255,255,255,0.85)',
        });
      }
    } else if (this.phase === 'over') {
      banner(ctx, this.W, this.H, 'GAME OVER', '', Math.min(0.5, this.phaseT / 1.5), '#ff6b6b');
    }
  }
}

function countState(ducks: readonly Duck[], state: Duck['state']): number {
  let n = 0;
  for (const d of ducks) if (d.state === state) n++;
  return n;
}

/** Shot circle (x, y, r) against the crate box or its balloon. */
function crateInReach(c: Crate, x: number, y: number, r: number): boolean {
  if (Math.hypot(c.x - x, c.y - y) < r + CRATE_HALF) return true;
  return Math.hypot(c.x - x, c.y - BALLOON_DY - y) < r + (BALLOON_RX + BALLOON_RY) / 2;
}

/**
 * Shot circle against the duck where it was shown in the last rendered frame or the few frames
 * before it (about 50 ms of input latency), so fast ducks can't slip out from under the reticle.
 */
function duckInReach(d: Duck, x: number, y: number, r: number): boolean {
  const r2 = r * r;
  let dx = d.x - x;
  let dy = d.y - y;
  if (dx * dx + dy * dy <= r2) return true;
  for (let i = 0; i < HISTORY; i++) {
    dx = (d.hx[i] ?? d.x) - x;
    dy = (d.hy[i] ?? d.y) - y;
    if (dx * dx + dy * dy <= r2) return true;
  }
  return false;
}
