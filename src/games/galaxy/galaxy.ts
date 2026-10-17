import { clamp, damp, TAU } from '../../core/math';
import { BaseGame } from '../base';
import { banner, drawCoin, fillRoundRect, hash1, hudPill, progressBar, shade, text } from '../draw';
import type { GameServices } from '../types';

type EnemyKind = 'scout' | 'fighter' | 'tank' | 'kamikaze' | 'boss';
type Behavior = 'sine' | 'hover' | 'curve' | 'dive' | 'boss';
type DropKind = 'power' | 'bomb' | 'shield' | 'coin';
type Point = readonly [number, number];

interface Enemy {
  kind: EnemyKind;
  behavior: Behavior;
  x: number;
  y: number;
  vx: number;
  vy: number;
  hp: number;
  maxHp: number;
  /** Collision radius of ordinary enemies. The boss collides through BOSS_HIT instead. */
  r: number;
  t: number;
  x0: number;
  y0: number;
  phase: number;
  fireT: number;
  hitT: number;
  alive: boolean;
  points: number;
  // curve control points
  c: number[];
  dur: number;
  targetY: number;
  heading: number;
  /** Kamikaze: 0 = descending, 1 = locked and telegraphing, 2 = diving. */
  stage: number;
  /** Kamikaze: seconds left in the lock-on telegraph. */
  lockT: number;
  /** Kamikaze: unit direction of the dive, fixed at lock-on. */
  dirX: number;
  dirY: number;
  /** Boss: rage level 0-2, reached at 66% and 33% HP. */
  rage: number;
  /** Boss: seconds left before the telegraphed volley fires, or 0. */
  windT: number;
  /** Boss: pattern of the volley being wound up. */
  pattern: number;
  /** Boss: white flash timer after a rage change. */
  flashT: number;
}

interface Bullet {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  dmg: number;
  alive: boolean;
  color: string;
}

interface Drop {
  kind: DropKind;
  x: number;
  y: number;
  vy: number;
  alive: boolean;
}

interface Ring {
  x: number;
  y: number;
  r: number;
  life: number;
  color: string;
}

const ENEMY_STATS: Record<EnemyKind, { hp: number; r: number; points: number }> = {
  scout: { hp: 1, r: 16, points: 100 },
  fighter: { hp: 4, r: 20, points: 250 },
  tank: { hp: 16, r: 32, points: 600 },
  kamikaze: { hp: 2, r: 16, points: 200 },
  // The boss takes its HP from bossHp(); its collision comes from BOSS_HIT.
  boss: { hp: 0, r: 110, points: 5000 },
};

const ENEMY_COLOR: Record<EnemyKind, string> = {
  scout: '#ff4d6d',
  fighter: '#7b5cff',
  tank: '#4a5568',
  kamikaze: '#ff9f1c',
  boss: '#b06bff',
};

/** Boss collision circles in hull units (the hull is about 220 wide): core, two wings, belly. */
const BOSS_HIT: readonly { x: number; y: number; r: number }[] = [
  { x: 0, y: 0, r: 48 },
  { x: -70, y: -6, r: 36 },
  { x: 70, y: -6, r: 36 },
  { x: 0, y: 30, r: 26 },
];

const BOSS_HULL: readonly Point[] = [
  [-110, -10],
  [-70, -50],
  [70, -50],
  [110, -10],
  [80, 30],
  [30, 46],
  [-30, 46],
  [-80, 30],
];
const SCOUT_HULL: readonly Point[] = [
  [0, 18],
  [14, -10],
  [0, -4],
  [-14, -10],
];
const FIGHTER_HULL: readonly Point[] = [
  [0, 22],
  [10, 4],
  [24, 8],
  [20, -12],
  [6, -6],
  [0, -18],
  [-6, -6],
  [-20, -12],
  [-24, 8],
  [-10, 4],
];
const TANK_HULL: readonly Point[] = Array.from({ length: 6 }, (_, i): Point => {
  const a = (i * TAU) / 6 + Math.PI / 6;
  return [Math.cos(a) * 34, Math.sin(a) * 30];
});
const KAMI_HULL: readonly Point[] = Array.from({ length: 8 }, (_, i): Point => {
  const a = (i * TAU) / 8;
  const r = i % 2 === 0 ? 18 : 9;
  return [Math.cos(a) * r, Math.sin(a) * r];
});
const SHIP_HULL: readonly Point[] = [
  [0, -30],
  [10, -8],
  [26, 14],
  [10, 18],
  [0, 24],
  [-10, 18],
  [-26, 14],
  [-10, -8],
];
const SHIP_VIPER: readonly Point[] = [
  [0, -34],
  [8, -6],
  [28, 18],
  [8, 14],
  [0, 24],
  [-8, 14],
  [-28, 18],
  [-8, -6],
];
const SHIP_TITAN: readonly Point[] = [
  [0, -28],
  [16, -14],
  [32, 8],
  [30, 22],
  [10, 18],
  [0, 26],
  [-10, 18],
  [-30, 22],
  [-32, 8],
  [-16, -14],
];
const SHIP_PHANTOM: readonly Point[] = [
  [0, -32],
  [10, -2],
  [30, -12],
  [22, 20],
  [0, 12],
  [-22, 20],
  [-30, -12],
  [-10, -2],
];

const OUTLINE = '#0b0614';
const BULLET_RED = '#ff4d6d';
const BULLET_ORANGE = '#ff9f1c';
const BULLET_MAGENTA = '#ff4dd2';
const BULLET_YELLOW = '#ffd23f';
const NEBULA_COLORS = ['rgba(176,107,255,0.18)', 'rgba(77,217,255,0.14)', 'rgba(255,77,109,0.12)'];

const MAX_WEAPON = 5;
const SHOT_SPEED = 820;
/** Seconds a boss should take to fall at the design weapon level. */
const BOSS_SECONDS = 22;
/** Expected effective boss damage per second at each weapon level (after spread and range losses). */
const WEAPON_DPS = [7, 14, 24, 31, 46];
/** Bosses gain HP per boss index, up to this multiplier. */
const BOSS_GROWTH_CAP = 2;
/** Scaling stops growing at this wave, so late waves push through mix rather than raw numbers. */
const SCALE_WAVE_CAP = 15;
const WIND_UP = 0.4;
const OVERDRIVE_SEC = 6;
const CHAIN_SEC = 1.2;
/** Enemies only fire while they are at least this far above the ship. */
const FIRE_CLEARANCE = 220;
/** Kamikazes lock on once their centre is this far down the screen (on-screen). */
const KAMI_LOCK_Y = 70;
const KAMI_LOCK_SEC = 0.35;
const RAM_PAD = 12;
const BOSS_RAM_PAD = 8;
/** Radius of the ship for bullet collisions; drawn as the hitbox marker. */
const SHIP_HIT = 6;
/** Mouse steering keeps the ship this far above the cursor so the cursor never covers it. */
const MOUSE_LIFT = 60;

/** Pick the ship hull for a skin style. */
function shipHull(style: number): readonly Point[] {
  if (style === 1) return SHIP_VIPER;
  if (style === 2) return SHIP_TITAN;
  if (style === 3) return SHIP_PHANTOM;
  return SHIP_HULL;
}

/** Fill and outline a closed polygon in the current transform. */
function paintPolygon(
  ctx: CanvasRenderingContext2D,
  pts: readonly Point[],
  fill: string,
  stroke = OUTLINE,
  lineWidth = 2,
): void {
  ctx.beginPath();
  pts.forEach(([x, y], i) => {
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = stroke;
  ctx.lineWidth = lineWidth;
  ctx.stroke();
}

export class GalaxyGame extends BaseGame {
  private shipX: number;
  private shipY: number;
  private bank = 0;
  /** Offset from the ship to the finger when a touch drag started (relative steering). */
  private touchDrag: { dx: number; dy: number } | null = null;
  private lives: number;
  private readonly startLives: number;
  private bombs = 2;
  private weapon: number;
  private shield: boolean;
  private invuln = 2;
  private fireT = 0;
  private overdriveT = 0;
  private overdriveMax = 1;
  private wave = 0;
  private waveQueue: (() => void)[] = [];
  private spawnT = 0;
  private waveBannerT = 0;
  private betweenWaves = 1;
  private chain = 0;
  private chainT = 0;
  private bombFlash = 0;
  private dead = false;
  private enemies: Enemy[] = [];
  private shots: Bullet[] = [];
  private enemyShots: Bullet[] = [];
  private drops: Drop[] = [];
  private rings: Ring[] = [];
  private readonly stars: { x: number; y: number; z: number }[] = [];
  private scroll = 0;
  private readonly speedMul: number;
  private boss: Enemy | null = null;
  /** Hull scale for the Mothership: 1 on the narrowest layout, up to 1.33 on the widest. */
  private readonly bossScale: number;
  private readonly bgGradient: CanvasGradient;
  /** Radial nebula gradients centred on the origin; drawn translated to each nebula's position. */
  private readonly nebulae: CanvasGradient[] = [];
  private readonly engineGlow: CanvasGradient;

  constructor(s: GameServices) {
    super(s);
    this.shipX = this.W / 2;
    this.shipY = this.H - 140;
    this.startLives = this.skinParam('lives', 3);
    this.lives = this.startLives;
    this.speedMul = this.skinParam('speed', 1);
    this.weapon = clamp(this.skinParam('weapon', 1) + (this.hasBoost('head-start') ? 2 : 0), 1, MAX_WEAPON);
    this.shield = this.hasBoost('shield');
    this.bossScale = clamp(this.W / 540, 1, 1.33);
    // Starfield is cosmetic: it draws from the forked RNG so gameplay randomness is untouched.
    for (let i = 0; i < 140; i++)
      this.stars.push({
        x: this.fxRng.range(0, this.W),
        y: this.fxRng.range(0, this.H),
        z: this.fxRng.range(0.2, 1),
      });
    this.bgGradient = this.ctx.createLinearGradient(0, 0, 0, this.H);
    this.bgGradient.addColorStop(0, '#050816');
    this.bgGradient.addColorStop(1, '#140a2e');
    for (const color of NEBULA_COLORS) {
      const g = this.ctx.createRadialGradient(0, 0, 10, 0, 0, 240);
      g.addColorStop(0, color);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      this.nebulae.push(g);
    }
    this.engineGlow = this.ctx.createRadialGradient(0, 0, 2, 0, 0, 26);
    this.engineGlow.addColorStop(0, this.skinColor('engine', '#ffb703'));
    this.engineGlow.addColorStop(1, 'rgba(255,120,0,0)');
  }

  // ------------------------------------------------------------------ scaling

  /** Wave number used for difficulty, capped so late waves stop growing numerically. */
  private level(): number {
    return Math.min(this.wave, SCALE_WAVE_CAP);
  }

  /** Vertical layout scale relative to the 960-px design height. */
  private band(): number {
    return this.H / 960;
  }

  /**
   * HUD and popup size factor. A phone draws the canvas at fewer CSS px per logical px, so the HUD
   * grows to keep its text near 12 CSS px on screen. Reads 1 when the canvas is not laid out (tests).
   */
  private hudScale(): number {
    const css = (this.ctx.canvas as HTMLCanvasElement | undefined)?.clientWidth ?? 0;
    return css > 0 ? clamp(0.9 / (css / this.W), 1, 1.5) : 1;
  }

  /** Floating popup, sized with the HUD so it stays readable on a phone. */
  private popup(x: number, y: number, label: string, color: string, size: number): void {
    this.texts.add(x, y, label, color, size * this.hudScale());
  }

  private hpScale(): number {
    return 1 + (this.level() - 1) * 0.08;
  }

  /** Boss HP that falls in about BOSS_SECONDS at the player's current weapon level. */
  private bossHp(): number {
    const index = Math.floor(this.wave / 5);
    const dps = WEAPON_DPS[this.weapon - 1] ?? WEAPON_DPS[0] ?? 7;
    return BOSS_SECONDS * dps * Math.min(BOSS_GROWTH_CAP, 1 + 0.25 * (index - 1));
  }

  private multiplier(): number {
    return Math.min(8, 1 + Math.floor(this.chain / 5));
  }

  private fireInterval(): number {
    const base = this.weapon >= 5 ? 0.09 : this.weapon >= 3 ? 0.11 : 0.13;
    return this.overdriveT > 0 ? base * 0.65 : base;
  }

  private inField(x: number, y: number): boolean {
    return x >= 0 && x <= this.W && y >= 0 && y <= this.H;
  }

  /** Whether a circle of radius `rad` at (x, y) touches enemy `e`'s hit shape. */
  private touches(e: Enemy, x: number, y: number, rad: number): boolean {
    if (e.kind !== 'boss') {
      const dx = e.x - x;
      const dy = e.y - y;
      const rr = e.r + rad;
      return dx * dx + dy * dy < rr * rr;
    }
    const s = this.bossScale;
    for (const c of BOSS_HIT) {
      const dx = e.x + c.x * s - x;
      const dy = e.y + c.y * s - y;
      const rr = c.r * s + rad;
      if (dx * dx + dy * dy < rr * rr) return true;
    }
    return false;
  }

  // ------------------------------------------------------------------ waves

  private nextWave(): void {
    this.wave++;
    this.waveBannerT = 0;
    this.maxStat('wave', this.wave);
    const w = this.wave;
    this.spawnT = 0.35;
    if (w % 5 === 0) {
      this.waveQueue = [() => this.spawnBoss()];
      this.audio.play('warning');
      return;
    }
    const groups = Math.min(9, 3 + Math.floor(w / 2));
    const q: (() => void)[] = [];
    for (let g = 0; g < groups; g++) {
      const roll = this.rng.next();
      if (roll < 0.3) q.push(() => this.groupSine());
      else if (roll < 0.52) q.push(() => this.groupHover());
      else if (roll < 0.72) q.push(() => this.groupCurve());
      else if (roll < 0.88 && w >= 2) q.push(() => this.groupKamikaze());
      else if (w >= 3) q.push(() => this.groupTank());
      else q.push(() => this.groupSine());
    }
    this.waveQueue = q;
  }

  private makeEnemy(kind: EnemyKind, behavior: Behavior, x: number, y: number): Enemy {
    const st = ENEMY_STATS[kind];
    const hp = kind === 'boss' ? this.bossHp() : st.hp * this.hpScale();
    const e: Enemy = {
      kind,
      behavior,
      x,
      y,
      vx: 0,
      vy: 0,
      hp,
      maxHp: hp,
      r: st.r,
      t: 0,
      x0: x,
      y0: y,
      phase: 0,
      fireT: this.rng.range(0.8, 2.2),
      hitT: 0,
      alive: true,
      points: st.points,
      c: [],
      dur: 0,
      targetY: 0,
      heading: Math.PI / 2,
      stage: 0,
      lockT: 0,
      dirX: 0,
      dirY: 1,
      rage: 0,
      windT: 0,
      pattern: 0,
      flashT: 0,
    };
    this.enemies.push(e);
    return e;
  }

  private groupSine(): void {
    const n = 5 + Math.min(4, Math.floor(this.wave / 3));
    const x0 = this.rng.range(140, this.W - 140);
    const kind: EnemyKind = this.wave > 3 && this.rng.chance(0.35) ? 'fighter' : 'scout';
    for (let i = 0; i < n; i++) {
      const e = this.makeEnemy(kind, 'sine', x0, -40 - i * 55);
      e.vy = 150 + this.level() * 5;
      e.phase = i * 0.5;
    }
  }

  private groupHover(): void {
    const n = 3 + Math.min(3, Math.floor(this.wave / 3));
    for (let i = 0; i < n; i++) {
      const x = ((i + 1) / (n + 1)) * this.W;
      const offset = Math.abs(i - (n - 1) / 2);
      const e = this.makeEnemy('fighter', 'hover', x, -40 - offset * 50);
      e.targetY = (140 + offset * 40) * this.band();
      e.dur = 7 + this.rng.range(0, 2);
    }
  }

  private groupCurve(): void {
    const n = 6;
    const fromLeft = this.rng.chance(0.5);
    for (let i = 0; i < n; i++) {
      const e = this.makeEnemy('scout', 'curve', fromLeft ? -40 : this.W + 40, 120);
      const s = fromLeft ? 1 : -1;
      const cx = this.W / 2;
      e.c = [
        cx - s * (this.W / 2 + 40),
        80,
        cx - s * 50,
        700,
        cx + s * 120,
        -100,
        cx + s * (this.W / 2 + 60),
        500,
      ];
      e.dur = 4.2;
      e.t = -i * 0.28;
    }
  }

  private groupKamikaze(): void {
    const n = 2 + Math.min(4, Math.floor(this.wave / 3));
    for (let i = 0; i < n; i++) {
      const e = this.makeEnemy('kamikaze', 'dive', this.rng.range(60, this.W - 60), -40 - i * 50);
      e.vy = 140;
    }
  }

  private groupTank(): void {
    const n = this.wave >= 7 ? 2 : 1;
    for (let i = 0; i < n; i++) {
      const e = this.makeEnemy('tank', 'hover', ((i + 1) / (n + 1)) * this.W, -60);
      e.targetY = 190 * this.band();
      e.dur = 12;
    }
  }

  private spawnBoss(): void {
    const e = this.makeEnemy('boss', 'boss', this.W / 2, -120);
    e.targetY = 170 * this.band();
    this.boss = e;
  }

  // ------------------------------------------------------------------ update

  protected tick(dt: number): void {
    this.scroll += dt;
    this.bombFlash = Math.max(0, this.bombFlash - dt);
    this.waveBannerT += dt;
    this.overdriveT = Math.max(0, this.overdriveT - dt);
    this.chainT -= dt;
    if (this.chainT <= 0 && this.chain > 0) {
      if (this.chain >= 10) this.popup(this.shipX, this.shipY - 60, 'CHAIN LOST', '#ff6b6b', 18);
      this.chain = 0;
    }
    for (const s of this.stars) {
      s.y += (40 + 220 * s.z) * dt;
      if (s.y > this.H) {
        s.y -= this.H;
        s.x = this.fxRng.range(0, this.W);
      }
    }

    if (!this.dead) this.updateShip(dt);

    // Wave flow: groups trickle in, and the next wave follows quickly once the field is clear.
    if (this.waveQueue.length > 0) {
      if (this.enemies.length === 0) this.spawnT = Math.min(this.spawnT, 0.35);
      this.spawnT -= dt;
      if (this.spawnT <= 0) {
        this.waveQueue.shift()?.();
        this.spawnT = Math.max(1.2, 2.4 - this.wave * 0.07);
      }
    } else if (this.enemies.length === 0 && !this.dead) {
      this.betweenWaves -= dt;
      if (this.betweenWaves <= 0) {
        this.betweenWaves = 1;
        this.nextWave();
      }
    }

    this.updateEnemies(dt);
    this.updateBullets(dt);
    this.updateDrops(dt);
    for (const r of this.rings) {
      r.life -= dt;
      r.r += 260 * dt;
    }
    this.rings = this.rings.filter((r) => r.life > 0);
  }

  private updateShip(dt: number): void {
    const ptr = this.input.pointer;
    const speed = 400 * this.speedMul;
    const prevX = this.shipX;
    const keyAxis = this.input.axisX() !== 0 || this.input.axisY() !== 0;
    let target: { x: number; y: number; rate: number } | null = null;
    if (keyAxis) {
      // Keys take over from the pointer until the mouse moves again.
      ptr.active = false;
      this.touchDrag = null;
    } else if (ptr.touch) {
      // Touch steering is relative: the ship keeps the offset it had when the finger went down.
      if (!ptr.down || ptr.released) this.touchDrag = null;
      else {
        if (!this.touchDrag) this.touchDrag = { dx: this.shipX - ptr.x, dy: this.shipY - ptr.y };
        target = { x: ptr.x + this.touchDrag.dx, y: ptr.y + this.touchDrag.dy, rate: 24 };
      }
    } else if (ptr.active && ptr.inside && this.inField(ptr.x, ptr.y)) {
      // Mouse: hover just above the cursor, so the pointer never covers the ship.
      target = { x: ptr.x, y: ptr.y - MOUSE_LIFT, rate: 14 };
    }

    if (target) {
      const k = damp(target.rate, dt);
      const maxStep = speed * 1.6 * dt;
      this.shipX += clamp((target.x - this.shipX) * k, -maxStep, maxStep);
      this.shipY += clamp((target.y - this.shipY) * k, -maxStep, maxStep);
    } else {
      let ax = this.input.axisX();
      let ay = this.input.axisY();
      if (ax !== 0 && ay !== 0) {
        ax *= Math.SQRT1_2;
        ay *= Math.SQRT1_2;
      }
      this.shipX += ax * speed * dt;
      this.shipY += ay * speed * dt;
    }
    // Keep the ship above the bottom HUD row and touch controls, and out of the top quarter so
    // formations never spawn on top of it.
    this.shipX = clamp(this.shipX, 24, this.W - 24);
    this.shipY = clamp(this.shipY, this.H * 0.25, this.H - 96 - this.insets.bottom);
    if (dt > 0) this.bank += (clamp((this.shipX - prevX) / dt / 300, -1, 1) - this.bank) * damp(10, dt);
    this.invuln = Math.max(0, this.invuln - dt);

    this.fireT -= dt;
    if (this.fireT <= 0) {
      this.fire();
      this.fireT = this.fireInterval();
    }
    if (this.input.wasPressed('secondary') || this.input.wasPressed('primary')) this.useBomb();

    if (this.time % 0.04 < dt) {
      this.particles.emit({
        x: this.shipX,
        y: this.shipY + 26,
        count: 1,
        speed: 160,
        angle: Math.PI / 2,
        spread: 0.4,
        life: 0.25,
        size: 4,
        colors: [this.skinColor('engine', '#ffb703'), '#fff'],
      });
    }
  }

  private fire(): void {
    const x = this.shipX;
    const y = this.shipY - 26;
    const od = this.overdriveT > 0;
    const shot = (dx: number, angle: number, dmg = 1) => {
      // Heavy centre rounds are white; overdrive lights every round yellow and doubles damage.
      const color = dmg > 1 ? '#fff' : od ? '#ffe066' : '#9ff';
      this.shots.push({
        x: x + dx,
        y,
        vx: Math.sin(angle) * SHOT_SPEED,
        vy: -Math.cos(angle) * SHOT_SPEED,
        r: 4,
        dmg: od ? dmg * 2 : dmg,
        alive: true,
        color,
      });
    };
    switch (this.weapon) {
      case 1:
        shot(0, 0);
        break;
      case 2:
        shot(-8, 0);
        shot(8, 0);
        break;
      case 3:
        shot(0, 0);
        shot(-10, -0.06);
        shot(10, 0.06);
        break;
      case 4:
        shot(-6, 0);
        shot(6, 0);
        shot(-12, -0.12);
        shot(12, 0.12);
        break;
      default:
        shot(0, 0, 2);
        shot(-8, -0.06);
        shot(8, 0.06);
        shot(-14, -0.16);
        shot(14, 0.16);
    }
    this.audio.play('shoot', { volume: 0.25, pitch: od ? 1.25 : 1 });
  }

  private useBomb(): void {
    if (this.bombs <= 0 || this.dead) return;
    this.bombs--;
    this.bombFlash = 0.5;
    this.audio.play('bomb');
    this.shake.add(0.8);
    this.services.haptic(80);
    this.addStat('bombs');
    this.rings.push({ x: this.shipX, y: this.shipY, r: 20, life: 0.8, color: '#fff' });
    for (const b of this.enemyShots) b.alive = false;
    for (const e of this.enemies) {
      if (!e.alive || e.y < -20) continue;
      this.damage(e, e.kind === 'boss' ? e.maxHp * 0.08 : 30);
    }
  }

  private updateEnemies(dt: number): void {
    for (const e of this.enemies) {
      if (!e.alive) continue;
      e.t += dt;
      e.hitT = Math.max(0, e.hitT - dt);
      e.flashT = Math.max(0, e.flashT - dt);
      const lastX = e.x;
      const lastY = e.y;
      this.moveEnemy(e, dt);
      const mdx = e.x - lastX;
      const mdy = e.y - lastY;
      if (mdx * mdx + mdy * mdy > 0.01) e.heading = Math.atan2(mdy, mdx);
      if (e.y > this.H + 80 || e.x < -150 || e.x > this.W + 150) {
        if (e.t > 1) e.alive = false;
      }

      // Firing: only once on screen and well clear of the ship, so shots are never point-blank.
      if (
        !this.dead &&
        e.y > 20 &&
        e.y < this.shipY - FIRE_CLEARANCE &&
        e.kind !== 'scout' &&
        e.kind !== 'kamikaze' &&
        e.kind !== 'boss'
      ) {
        e.fireT -= dt;
        if (e.fireT <= 0) {
          const base = e.kind === 'tank' ? 2.4 : 2.0;
          e.fireT = Math.max(0.8, base - this.wave * 0.05) * this.rng.range(0.8, 1.3);
          const a = Math.atan2(this.shipY - e.y, this.shipX - e.x);
          const sp = 220 + 7 * this.level();
          if (e.kind === 'tank')
            for (let k = -2; k <= 2; k++) this.enemyShot(e.x, e.y + 20, a + k * 0.2, sp, BULLET_ORANGE);
          else this.enemyShot(e.x, e.y + 14, a, sp, BULLET_RED);
        }
      }

      // Ramming
      const pad = e.kind === 'boss' ? BOSS_RAM_PAD : RAM_PAD;
      if (!this.dead && this.invuln <= 0 && this.touches(e, this.shipX, this.shipY, pad)) {
        if (e.kind !== 'boss') this.damage(e, 99);
        this.hitShip();
      }
    }
    this.enemies = this.enemies.filter((e) => e.alive);
  }

  private moveEnemy(e: Enemy, dt: number): void {
    switch (e.behavior) {
      case 'sine':
        e.y += e.vy * dt;
        e.x = e.x0 + Math.sin(e.t * 2.2 + e.phase) * 100;
        break;
      case 'hover': {
        if (e.t < e.dur) {
          e.y += (e.targetY - e.y) * damp(2, dt);
          // The sway stops at the edges, so the outer ships of a full line never leave the screen.
          e.x = clamp(e.x0 + Math.sin(e.t * 0.9) * 60, e.r + 6, this.W - e.r - 6);
        } else {
          e.vy = Math.min(420, e.vy + 300 * dt);
          e.y += e.vy * dt;
        }
        break;
      }
      case 'curve': {
        if (e.t < 0) {
          e.y = -100;
          break;
        }
        const u = e.t / e.dur;
        if (u >= 1) {
          e.alive = false;
          break;
        }
        const c = e.c as [number, number, number, number, number, number, number, number];
        const v = 1 - u;
        e.x = v * v * v * c[0] + 3 * v * v * u * c[2] + 3 * v * u * u * c[4] + u * u * u * c[6];
        e.y = v * v * v * c[1] + 3 * v * v * u * c[3] + 3 * v * u * u * c[5] + u * u * u * c[7];
        break;
      }
      case 'dive':
        this.updateKamikaze(e, dt);
        break;
      case 'boss':
        this.updateBoss(e, dt);
        break;
    }
  }

  /** Descend until on screen, lock on and telegraph for a moment, then dive along the locked line. */
  private updateKamikaze(e: Enemy, dt: number): void {
    if (e.stage === 0) {
      e.y += e.vy * dt;
      if (e.y >= KAMI_LOCK_Y) {
        e.stage = 1;
        e.lockT = KAMI_LOCK_SEC;
        const dx = this.shipX - e.x;
        const dy = this.shipY - e.y;
        const d = Math.hypot(dx, dy) || 1;
        e.dirX = dx / d;
        e.dirY = dy / d;
        this.audio.play('select', { volume: 0.4, pitch: 0.6 });
      }
      return;
    }
    if (e.stage === 1) {
      e.lockT -= dt;
      if (e.lockT <= 0) {
        e.stage = 2;
        const sp = Math.min(540, 420 + 8 * this.level());
        e.vx = e.dirX * sp;
        e.vy = e.dirY * sp;
        this.audio.play('whoosh', { volume: 0.4, pitch: 1.6 });
      }
      return;
    }
    e.x += e.vx * dt;
    e.y += e.vy * dt;
  }

  private updateBoss(e: Enemy, dt: number): void {
    if (e.t < 3) {
      e.y += (e.targetY - e.y) * damp(1.4, dt);
      return;
    }
    const s = this.bossScale;
    // The sway runs on an accumulated phase, so a rage change alters its speed, never its position.
    e.phase += dt * (0.5 + e.rage * 0.15);
    e.x = this.W / 2 + Math.sin(e.phase) * (this.W / 2 - 110 * s);
    e.y = e.targetY + Math.sin(e.t * 1.3) * 20;
    if (this.dead) return;
    if (e.windT > 0) {
      e.windT -= dt;
      if (e.windT <= 0) this.bossVolley(e);
      return;
    }
    e.fireT -= dt;
    if (e.fireT > 0) return;
    // Every volley is telegraphed for WIND_UP seconds before it leaves the hull.
    e.pattern = Math.floor(e.t / 4) % 3;
    e.windT = WIND_UP;
    this.audio.play('select', { volume: 0.5, pitch: 0.5 });
  }

  private bossVolley(e: Enemy): void {
    const s = this.bossScale;
    const rage = e.rage;
    if (e.pattern === 0) {
      // Rotating spiral
      const n = 10 + rage * 4;
      for (let i = 0; i < n; i++)
        this.enemyShot(e.x, e.y + 30 * s, e.t * 1.7 + (i * TAU) / n, 180 + rage * 30, BULLET_MAGENTA);
      e.fireT = 0.55 - rage * 0.1;
    } else if (e.pattern === 1) {
      // Aimed burst
      const a = Math.atan2(this.shipY - e.y, this.shipX - e.x);
      for (let k = -2; k <= 2; k++)
        this.enemyShot(e.x, e.y + 40 * s, a + k * 0.12, 300 + rage * 40, BULLET_ORANGE);
      e.fireT = 0.7 - rage * 0.12;
    } else {
      // Twin cannons fan
      for (const side of [-1, 1]) {
        for (let k = 0; k < 3 + rage; k++)
          this.enemyShot(
            e.x + side * 60 * s,
            e.y + 44 * s,
            Math.PI / 2 + side * 0.15 * k,
            240,
            BULLET_YELLOW,
          );
      }
      e.fireT = 0.45 - rage * 0.06;
    }
    this.audio.play('laser', { volume: 0.3, pitch: 0.6 });
  }

  private enemyShot(x: number, y: number, angle: number, speed: number, color: string): void {
    if (this.enemyShots.length > 400) return;
    this.enemyShots.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      r: 6,
      dmg: 1,
      alive: true,
      color,
    });
  }

  private updateBullets(dt: number): void {
    for (const b of this.shots) {
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      if (b.y < -20 || b.x < -20 || b.x > this.W + 20) {
        b.alive = false;
        continue;
      }
      for (const e of this.enemies) {
        if (!e.alive || e.y < -10) continue;
        if (this.touches(e, b.x, b.y, b.r)) {
          b.alive = false;
          this.damage(e, b.dmg);
          this.particles.emit({
            x: b.x,
            y: b.y,
            count: 2,
            speed: 120,
            life: 0.2,
            size: 2,
            colors: ['#9ff', '#fff'],
          });
          break;
        }
      }
    }
    this.shots = this.shots.filter((b) => b.alive);
    for (const b of this.enemyShots) {
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      if (b.y > this.H + 20 || b.y < -40 || b.x < -20 || b.x > this.W + 20) {
        b.alive = false;
        continue;
      }
      if (!this.dead && this.invuln <= 0) {
        const dx = b.x - this.shipX;
        const dy = b.y - this.shipY;
        if (dx * dx + dy * dy < (b.r + SHIP_HIT) ** 2) {
          b.alive = false;
          this.hitShip();
        }
      }
    }
    this.enemyShots = this.enemyShots.filter((b) => b.alive);
  }

  /** The boss escalates at 66% and 33% HP: a power-up drop, a rage ring, a pause and a bullet wipe. */
  private bossThreshold(e: Enemy): void {
    const frac = e.hp / e.maxHp;
    const level = frac <= 0.33 ? 2 : frac <= 0.66 ? 1 : 0;
    const s = this.bossScale;
    while (e.rage < level) {
      e.rage++;
      this.drops.push({ kind: 'power', x: e.x, y: e.y + 30 * s, vy: 90, alive: true });
      e.fireT = Math.max(e.fireT, 0.6);
      e.flashT = 0.5;
      this.shake.add(0.5);
      this.rings.push({ x: e.x, y: e.y, r: e.r * 0.6, life: 0.6, color: BULLET_MAGENTA });
      for (const b of this.enemyShots) if (Math.hypot(b.x - e.x, b.y - e.y) < 160) b.alive = false;
      this.popup(this.W / 2, this.H * 0.3, e.rage === 2 ? 'RAGE II' : 'RAGE I', BULLET_MAGENTA, 26);
      this.audio.play('warning', { volume: 0.6 });
    }
  }

  private damage(e: Enemy, amount: number): void {
    if (!e.alive) return;
    e.hp -= amount;
    e.hitT = 0.08;
    if (e.kind === 'boss' && e.hp > 0) this.bossThreshold(e);
    if (e.hp > 0) return;
    e.alive = false;
    const prevMult = this.multiplier();
    this.chain++;
    this.chainT = CHAIN_SEC;
    const mult = this.multiplier();
    const pts = Math.round(e.points * (1 + (this.level() - 1) * 0.05)) * mult;
    this.score += pts;
    this.addStat('enemies');
    const big = e.kind === 'boss' || e.kind === 'tank';
    this.audio.play(big ? 'bomb' : 'explode', {
      volume: big ? 1 : 0.5,
      pitch: 0.9 + this.fxRng.next() * 0.2,
    });
    this.shake.add(big ? 0.7 : 0.12);
    this.particles.emit({
      x: e.x,
      y: e.y,
      count: big ? 70 : 18,
      speed: big ? 420 : 240,
      life: big ? 1.1 : 0.6,
      size: big ? 6 : 4,
      colors: ['#fff', '#ffd166', '#ff6b35', '#ef476f'],
    });
    // Tumbling hull shards in the enemy's own colour
    this.particles.emit({
      x: e.x,
      y: e.y,
      count: big ? 8 : 4,
      speed: 300,
      speedVar: 0.5,
      life: 0.7,
      size: 5,
      shape: 'square',
      gravity: 260,
      colors: [ENEMY_COLOR[e.kind], '#fff'],
    });
    this.rings.push({ x: e.x, y: e.y, r: e.r * 0.5, life: 0.4, color: '#ffd166' });
    this.rings.push({ x: e.x, y: e.y, r: e.r * 0.3, life: 0.12, color: '#fff' });
    if (big) this.rings.push({ x: e.x, y: e.y, r: e.r * 0.9, life: 0.6, color: ENEMY_COLOR[e.kind] });
    if (mult > 1 || big)
      this.popup(e.x, e.y - 20, mult > 1 ? `${pts} x${mult}` : `${pts}`, '#ffd23f', big ? 28 : 18);
    if (mult > prevMult) this.popup(e.x, e.y + 26, `CHAIN x${mult}!`, BULLET_ORANGE, 16);
    if (e.kind === 'boss') {
      this.boss = null;
      this.addStat('bosses');
      for (let i = 0; i < 20; i++)
        this.drops.push({
          kind: 'coin',
          x: e.x + this.rng.range(-60, 60),
          y: e.y + this.rng.range(-40, 40),
          vy: this.rng.range(60, 140),
          alive: true,
        });
      this.drops.push({ kind: 'power', x: e.x, y: e.y, vy: 90, alive: true });
      this.drops.push({ kind: 'bomb', x: e.x + 40, y: e.y, vy: 90, alive: true });
      if (this.lives < this.startLives) {
        this.lives++;
        this.popup(this.W / 2, this.H / 2 - 60, '1UP', '#7CFC00', 30);
      }
      this.popup(this.W / 2, this.H / 2 - 100, 'BOSS DEFEATED!', '#7CFC00', 36);
      return;
    }
    const r = this.rng.next();
    const kind: DropKind | null =
      r < 0.06 ? 'power' : r < 0.085 ? 'bomb' : r < 0.105 ? 'shield' : r < 0.4 ? 'coin' : null;
    if (kind) this.drops.push({ kind, x: e.x, y: e.y, vy: 110, alive: true });
  }

  private hitShip(): void {
    if (this.invuln > 0 || this.dead) return;
    if (this.shield) {
      this.shield = false;
      this.invuln = 1.2;
      this.audio.play('pop');
      this.rings.push({ x: this.shipX, y: this.shipY, r: 30, life: 0.5, color: '#7cf' });
      return;
    }
    this.lives--;
    this.weapon = Math.max(1, this.weapon - 1);
    this.audio.play('explode');
    this.shake.add(0.6);
    this.services.haptic(120);
    this.particles.emit({
      x: this.shipX,
      y: this.shipY,
      count: 40,
      speed: 320,
      life: 0.8,
      size: 5,
      colors: ['#fff', this.skinColor('body', '#4dd9ff'), '#ffd166'],
    });
    for (const b of this.enemyShots)
      if (Math.hypot(b.x - this.shipX, b.y - this.shipY) < 220) b.alive = false;
    if (this.lives <= 0) {
      this.dead = true;
      this.endGame(2);
    } else {
      this.invuln = 2.2;
    }
  }

  private updateDrops(dt: number): void {
    for (const d of this.drops) {
      const dx = this.shipX - d.x;
      const dy = this.shipY - d.y;
      const dist = Math.hypot(dx, dy);
      if (!this.dead && dist < 130) {
        d.x += (dx / dist) * 420 * dt;
        d.y += (dy / dist) * 420 * dt;
      } else d.y += d.vy * dt;
      if (d.y > this.H + 30) d.alive = false;
      if (!this.dead && dist < 26) {
        d.alive = false;
        this.collect(d.kind);
      }
    }
    this.drops = this.drops.filter((d) => d.alive);
  }

  private collect(kind: DropKind): void {
    switch (kind) {
      case 'coin':
        this.coins++;
        this.score += 50;
        this.audio.play('coin', { volume: 0.5 });
        break;
      case 'power':
        this.addStat('powerups');
        this.audio.play('powerup');
        if (this.weapon < MAX_WEAPON) {
          this.weapon++;
          this.popup(this.shipX, this.shipY - 50, 'POWER UP!', '#4dd9ff', 22);
        } else {
          // Surplus power becomes Overdrive: faster fire and double damage, lengthened by Overclock.
          this.overdriveMax = this.powerTime(OVERDRIVE_SEC);
          this.overdriveT = this.overdriveMax;
          this.score += 300;
          this.popup(this.shipX, this.shipY - 50, 'OVERDRIVE!', '#ffd23f', 22);
        }
        break;
      case 'bomb':
        this.bombs = Math.min(5, this.bombs + 1);
        this.audio.play('select');
        this.popup(this.shipX, this.shipY - 50, '+1 BOMB', '#ff9f1c', 22);
        break;
      case 'shield':
        if (this.shield) {
          // Already shielded: the spare becomes a bomb instead of being wasted.
          this.bombs = Math.min(5, this.bombs + 1);
          this.popup(this.shipX, this.shipY - 50, '+1 BOMB', '#ff9f1c', 22);
        } else {
          this.shield = true;
          this.popup(this.shipX, this.shipY - 50, 'SHIELD', '#7cf', 22);
        }
        this.audio.play('powerup');
        break;
    }
  }

  // ------------------------------------------------------------------ render

  render(): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(this.shake.x, this.shake.y);
    this.drawSpace();
    for (const d of this.drops) this.drawDrop(d);
    for (const e of this.enemies) this.drawEnemy(e);
    for (const b of this.shots) this.drawShot(b);
    this.particles.render(ctx);
    if (!this.dead && !(this.invuln > 0 && Math.floor(this.time * 15) % 2 === 0))
      this.drawShip(this.shipX, this.shipY);
    for (const r of this.rings) {
      ctx.globalAlpha = Math.max(0, r.life * 2);
      ctx.strokeStyle = r.color;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(r.x, r.y, r.r, 0, TAU);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    this.texts.render(ctx);
    // Enemy fire goes last, so it is never hidden behind player shots, rings or popups.
    for (const b of this.enemyShots) this.drawEnemyShot(b);
    ctx.restore();
    if (this.bombFlash > 0 && !this.services.reducedMotion) {
      ctx.fillStyle = `rgba(255,255,255,${this.bombFlash})`;
      ctx.fillRect(0, 0, this.W, this.H);
    }
    if (!this.services.preview) this.drawHud();
  }

  private drawSpace(): void {
    const ctx = this.ctx;
    ctx.fillStyle = this.bgGradient;
    ctx.fillRect(-20, -20, this.W + 40, this.H + 40);
    // Drifting nebulae
    const cycle = this.H + 600;
    for (let i = 0; i < this.nebulae.length; i++) {
      const travel = this.scroll * 18 + i * 420;
      const x = hash1(i + Math.floor(travel / cycle) * 7) * this.W;
      const y = (travel % cycle) - 300;
      ctx.save();
      ctx.translate(x, y);
      ctx.fillStyle = this.nebulae[i] ?? this.bgGradient;
      ctx.fillRect(-240, -240, 480, 480);
      ctx.restore();
    }
    for (const s of this.stars) {
      ctx.globalAlpha = 0.3 + s.z * 0.7;
      ctx.fillStyle = s.z > 0.8 ? '#cfe8ff' : '#fff';
      const len = 1 + s.z * 4;
      ctx.fillRect(s.x, s.y, s.z > 0.7 ? 2 : 1, len);
    }
    ctx.globalAlpha = 1;
  }

  private drawShot(b: Bullet): void {
    const ctx = this.ctx;
    // Player fire is translucent so it never hides enemy rounds.
    ctx.globalAlpha = 0.55;
    fillRoundRect(ctx, b.x - 2, b.y - 9, 4, 18, 2, b.color);
    ctx.globalAlpha = 1;
  }

  /** Warm, outlined rounds with a glow, so they read at phone scale against any background. */
  private drawEnemyShot(b: Bullet): void {
    const ctx = this.ctx;
    ctx.globalAlpha = 0.3;
    ctx.fillStyle = b.color;
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.r + 4, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.r, 0, TAU);
    ctx.fillStyle = b.color;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = OUTLINE;
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.r * 0.4, 0, TAU);
    ctx.fill();
  }

  private drawShip(x: number, y: number): void {
    const ctx = this.ctx;
    const body = this.skinColor('body', '#4dd9ff');
    const accent = this.skinColor('accent', '#ffffff');
    const hull = shipHull(this.skinParam('style', 0));
    // Engine glow, pulsing with the flame
    ctx.save();
    ctx.translate(x, y + 26);
    ctx.globalAlpha = 0.6 + 0.4 * Math.sin(this.time * 40);
    ctx.fillStyle = this.engineGlow;
    ctx.fillRect(-30, -26, 60, 52);
    ctx.restore();
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(this.bank * 0.2);
    if (this.overdriveT > 0) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = `rgba(255,210,63,${0.14 + 0.08 * Math.sin(this.time * 14)})`;
      ctx.beginPath();
      ctx.arc(0, 0, 40, 0, TAU);
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
    }
    paintPolygon(ctx, hull, body, accent, 2);
    ctx.fillStyle = '#0b1d3a';
    ctx.beginPath();
    ctx.ellipse(0, -6, 5, 10, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = 'rgba(160,230,255,0.8)';
    ctx.beginPath();
    ctx.ellipse(-1.5, -9, 2, 4, 0, 0, TAU);
    ctx.fill();
    ctx.restore();
    if (this.shield) {
      ctx.strokeStyle = `rgba(120,200,255,${0.5 + 0.2 * Math.sin(this.time * 6)})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(x, y, 38, 0, TAU);
      ctx.stroke();
      ctx.fillStyle = 'rgba(120,200,255,0.1)';
      ctx.fill();
    }
    // Hitbox marker at the real collision radius, so near misses look like near misses.
    ctx.beginPath();
    ctx.arc(x, y, SHIP_HIT, 0, TAU);
    ctx.fillStyle = '#fff';
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = OUTLINE;
    ctx.stroke();
  }

  private drawEnemy(e: Enemy): void {
    if (e.kind === 'boss') {
      this.drawBoss(e);
      return;
    }
    const ctx = this.ctx;
    const base = ENEMY_COLOR[e.kind];
    const flash = e.hitT > 0;
    const body = flash ? shade(base, 0.45) : base;
    ctx.save();
    ctx.translate(e.x, e.y);
    // Soft halo so silhouettes read against the nebulae
    ctx.globalAlpha = 0.22;
    ctx.fillStyle = base;
    ctx.beginPath();
    ctx.arc(0, 0, e.r * 1.5, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 1;
    switch (e.kind) {
      case 'scout': {
        ctx.rotate(e.heading - Math.PI / 2);
        paintPolygon(ctx, SCOUT_HULL, body);
        ctx.fillStyle = '#ffd6de';
        ctx.beginPath();
        ctx.arc(0, 2, 4, 0, TAU);
        ctx.fill();
        break;
      }
      case 'fighter': {
        paintPolygon(ctx, FIGHTER_HULL, body);
        ctx.fillStyle = '#7CFC00';
        ctx.beginPath();
        ctx.arc(0, 2, 5, 0, TAU);
        ctx.fill();
        break;
      }
      case 'tank': {
        paintPolygon(ctx, TANK_HULL, body, BULLET_ORANGE, 3);
        ctx.fillStyle = BULLET_ORANGE;
        ctx.beginPath();
        ctx.arc(0, 0, 10 + Math.sin(this.time * 6) * 2, 0, TAU);
        ctx.fill();
        fillRoundRect(ctx, -26, 14, 10, 16, 3, '#2d3748');
        fillRoundRect(ctx, 16, 14, 10, 16, 3, '#2d3748');
        progressBar(ctx, -26, -42, 52, 5, e.hp / e.maxHp, BULLET_ORANGE);
        break;
      }
      case 'kamikaze': {
        if (e.stage === 1) {
          // Telegraph: a dashed line along the locked dive path.
          ctx.strokeStyle = 'rgba(255,77,109,0.8)';
          ctx.lineWidth = 2;
          ctx.setLineDash([6, 8]);
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.lineTo(e.dirX * 600, e.dirY * 600);
          ctx.stroke();
          ctx.setLineDash([]);
        }
        ctx.rotate(e.stage === 2 ? e.heading - Math.PI / 2 : this.time * 8);
        const blink = e.stage === 1 && Math.floor(this.time * 14) % 2 === 0;
        paintPolygon(ctx, KAMI_HULL, blink ? '#fff' : body);
        ctx.fillStyle = BULLET_RED;
        ctx.beginPath();
        ctx.arc(0, 0, 5, 0, TAU);
        ctx.fill();
        break;
      }
    }
    ctx.restore();
  }

  private drawBoss(e: Enemy): void {
    const ctx = this.ctx;
    const s = this.bossScale;
    const enraged = e.rage >= 2;
    const hot = e.hitT > 0 || (e.flashT > 0 && Math.floor(this.time * 20) % 2 === 0);
    const hull = enraged ? '#5a1b4a' : '#3b1f5c';
    ctx.save();
    ctx.translate(e.x, e.y);
    ctx.scale(s, s);
    if (e.windT > 0) this.drawBossWarning(e);
    ctx.globalAlpha = 0.25;
    ctx.fillStyle = enraged ? BULLET_RED : '#b06bff';
    ctx.beginPath();
    ctx.arc(0, 0, 130, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 1;
    paintPolygon(ctx, BOSS_HULL, hot ? shade(hull, 0.45) : hull, '#b06bff', 3);
    if (e.rage >= 1) {
      // Hull cracks open at 66% and 33% HP
      ctx.strokeStyle = OUTLINE;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-44, -30);
      ctx.lineTo(-24, -14);
      ctx.lineTo(-36, -2);
      ctx.lineTo(-18, 12);
      ctx.moveTo(40, -36);
      ctx.lineTo(26, -20);
      ctx.lineTo(34, -6);
      if (e.rage >= 2) {
        ctx.moveTo(-70, 0);
        ctx.lineTo(-56, 14);
        ctx.moveTo(66, 10);
        ctx.lineTo(54, 26);
        ctx.lineTo(62, 38);
      }
      ctx.stroke();
    }
    for (const side of [-1, 1]) {
      fillRoundRect(ctx, side * 60 - 10, 16, 20, 30, 5, '#22163a');
      const lit = e.windT > 0 && e.pattern === 2;
      ctx.fillStyle = lit ? BULLET_YELLOW : '#4dd9ff';
      ctx.beginPath();
      ctx.arc(side * 60, 44, lit ? 8 : 5, 0, TAU);
      ctx.fill();
    }
    const pulse = Math.sin(this.time * (enraged ? 9 : 5));
    ctx.fillStyle = enraged ? BULLET_RED : BULLET_MAGENTA;
    ctx.beginPath();
    ctx.arc(0, 0, 30 + pulse * 4, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(0, 0, 10, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  /** Wind-up telegraph for the next volley, in hull units (called inside the boss transform). */
  private drawBossWarning(e: Enemy): void {
    const ctx = this.ctx;
    const s = this.bossScale;
    const p = 1 - e.windT / WIND_UP;
    ctx.save();
    ctx.globalAlpha = 0.3 + 0.6 * p;
    if (e.pattern === 0) {
      ctx.strokeStyle = BULLET_MAGENTA;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, 30, 40 + 60 * p, 0, TAU);
      ctx.stroke();
    } else if (e.pattern === 1) {
      ctx.strokeStyle = BULLET_ORANGE;
      ctx.lineWidth = 2;
      ctx.setLineDash([10, 10]);
      ctx.beginPath();
      ctx.moveTo(0, 40);
      ctx.lineTo((this.shipX - e.x) / s, (this.shipY - e.y) / s);
      ctx.stroke();
    } else {
      ctx.fillStyle = BULLET_YELLOW;
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.arc(side * 60, 44, 6 + 8 * p, 0, TAU);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  private drawDrop(d: Drop): void {
    const ctx = this.ctx;
    if (d.kind === 'coin') {
      drawCoin(ctx, d.x, d.y, 10, Math.cos(this.time * 6 + d.x));
      return;
    }
    const color = d.kind === 'power' ? '#4dd9ff' : d.kind === 'bomb' ? '#ff9f1c' : '#7cf';
    const label = d.kind === 'power' ? 'P' : d.kind === 'bomb' ? 'B' : 'S';
    ctx.save();
    ctx.translate(d.x, d.y);
    ctx.rotate(Math.sin(this.time * 3) * 0.3);
    fillRoundRect(ctx, -14, -14, 28, 28, 7, color);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.strokeRect(-11, -11, 22, 22);
    text(ctx, label, 0, 1, { size: 18, align: 'center', color: '#0b1d3a', stroke: null });
    ctx.restore();
  }

  private drawHud(): void {
    const ctx = this.ctx;
    const W = this.W;
    const { top, right, bottom, left } = this.insets;
    const k = this.hudScale();
    // Bottom row sits above touch controls; the top row starts below them.
    const row = this.H - 31 * k - bottom;

    hudPill(ctx, 12 + left, 12 + top, 220 * k, 40 * k);
    text(ctx, Math.floor(this.score).toLocaleString('en-US'), 12 + left + 18 * k, 12 + top + 21 * k, {
      size: 22 * k,
    });
    const coinX = W - 12 - right - 120 * k;
    hudPill(ctx, coinX, 12 + top, 120 * k, 40 * k);
    drawCoin(ctx, coinX + 24 * k, 12 + top + 20 * k, 11 * k);
    text(ctx, `${this.coins}`, coinX + 42 * k, 12 + top + 21 * k, { size: 20 * k });
    if (this.chain >= 2) this.drawChain(12 + left, 12 + top + 48 * k, k);

    if (this.boss) {
      progressBar(
        ctx,
        12 + left,
        12 + top + 84 * k,
        W - 24 - left - right,
        10 * k,
        this.boss.hp / this.boss.maxHp,
        '#ff4dd2',
      );
    }

    // Lives (bottom left)
    for (let i = 0; i < Math.max(0, this.lives); i++) {
      ctx.save();
      ctx.translate(26 * k + left + i * 28 * k, row);
      ctx.scale(0.5 * k, 0.5 * k);
      ctx.fillStyle = this.skinColor('body', '#4dd9ff');
      ctx.beginPath();
      ctx.moveTo(0, -24);
      ctx.lineTo(22, 16);
      ctx.lineTo(0, 8);
      ctx.lineTo(-22, 16);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    // Bombs (bottom right)
    for (let i = 0; i < this.bombs; i++) {
      const bx = W - (26 + i * 26) * k - right;
      ctx.fillStyle = '#ff9f1c';
      ctx.beginPath();
      ctx.arc(bx, row, 9 * k, 0, TAU);
      ctx.fill();
      text(ctx, 'B', bx, row + k, { size: 14 * k, align: 'center', color: '#3a1a00', stroke: null });
    }
    // Weapon level (bottom centre)
    hudPill(ctx, W / 2 - 70 * k, row - 17 * k, 140 * k, 34 * k);
    text(ctx, 'PWR', W / 2 - 62 * k, row, { size: 14 * k, color: '#9ff' });
    for (let i = 0; i < MAX_WEAPON; i++) {
      fillRoundRect(
        ctx,
        W / 2 - (14 - i * 15) * k,
        row - 7 * k,
        11 * k,
        14 * k,
        3 * k,
        i < this.weapon ? '#4dd9ff' : 'rgba(255,255,255,0.15)',
      );
    }
    if (this.overdriveT > 0) {
      text(ctx, 'OVERDRIVE', W / 2, row - 34 * k, { size: 14 * k, align: 'center', color: '#ffd23f' });
      progressBar(
        ctx,
        W / 2 - 70 * k,
        row - 28 * k,
        140 * k,
        6 * k,
        this.overdriveT / this.overdriveMax,
        '#ffd23f',
      );
    }
    if (this.waveBannerT < 2.2 && this.wave > 0) {
      const isBoss = this.wave % 5 === 0;
      banner(
        ctx,
        W,
        this.H,
        isBoss ? 'WARNING!' : `WAVE ${this.wave}`,
        isBoss ? 'Mothership approaching' : 'Get ready',
        this.waveBannerT / 2.2,
        isBoss ? '#ff4d6d' : '#4dd9ff',
      );
    }
  }

  /** Chain meter under the score: the count, a bar that drains until the chain breaks, and the multiplier. */
  private drawChain(x: number, y: number, k: number): void {
    const ctx = this.ctx;
    const mult = this.multiplier();
    const hot = mult > 1;
    hudPill(ctx, x, y, 220 * k, 26 * k);
    text(ctx, `CHAIN ${this.chain}`, x + 12 * k, y + 13 * k, {
      size: 14 * k,
      color: hot ? '#ffd23f' : '#cfe8ff',
    });
    progressBar(
      ctx,
      x + 104 * k,
      y + 10 * k,
      84 * k,
      6 * k,
      this.chainT / CHAIN_SEC,
      hot ? '#ffd23f' : '#9ff',
    );
    text(ctx, `x${mult}`, x + 208 * k, y + 13 * k, { size: 15 * k, align: 'right', color: '#ffd23f' });
  }
}
