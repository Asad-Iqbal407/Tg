import { clamp, damp, TAU } from '../../core/math';
import { BaseGame } from '../base';
import { banner, drawCoin, fillRoundRect, hash1, hudPill, progressBar, shade, text } from '../draw';
import type { GameServices } from '../types';

type EnemyKind = 'scout' | 'fighter' | 'tank' | 'kamikaze' | 'boss';
type Behavior = 'sine' | 'hover' | 'curve' | 'dive' | 'boss';
type DropKind = 'power' | 'bomb' | 'shield' | 'coin';

interface Enemy {
  kind: EnemyKind;
  behavior: Behavior;
  x: number;
  y: number;
  vx: number;
  vy: number;
  hp: number;
  maxHp: number;
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
  boss: { hp: 160, r: 70, points: 10000 },
};

const MAX_WEAPON = 5;

export class GalaxyGame extends BaseGame {
  private shipX: number;
  private shipY: number;
  private lives: number;
  private bombs = 2;
  private weapon: number;
  private shield: boolean;
  private invuln = 2;
  private fireT = 0;
  private wave = 0;
  private waveQueue: (() => void)[] = [];
  private spawnT = 0;
  private waveBannerT = 0;
  private betweenWaves = 1.2;
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

  constructor(s: GameServices) {
    super(s);
    this.shipX = this.W / 2;
    this.shipY = this.H - 140;
    this.lives = this.skinParam('lives', 3);
    this.speedMul = this.skinParam('speed', 1);
    this.weapon = clamp(this.skinParam('weapon', 1) + (this.hasBoost('head-start') ? 2 : 0), 1, MAX_WEAPON);
    this.shield = this.hasBoost('shield');
    for (let i = 0; i < 140; i++)
      this.stars.push({
        x: this.rng.range(0, this.W),
        y: this.rng.range(0, this.H),
        z: this.rng.range(0.2, 1),
      });
  }

  // ------------------------------------------------------------------ waves

  private nextWave(): void {
    this.wave++;
    this.waveBannerT = 0;
    this.maxStat('wave', this.wave);
    const w = this.wave;
    if (w % 5 === 0) {
      this.waveQueue = [() => this.spawnBoss()];
      this.audio.play('warning');
      return;
    }
    const groups = 3 + Math.floor(w / 2);
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
    this.spawnT = 0.6;
  }

  private hpScale(): number {
    return 1 + (this.wave - 1) * 0.12;
  }

  private makeEnemy(kind: EnemyKind, behavior: Behavior, x: number, y: number): Enemy {
    const st = ENEMY_STATS[kind];
    const hp = Math.ceil(st.hp * (kind === 'boss' ? 1 + this.wave * 0.2 : this.hpScale()));
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
    };
    this.enemies.push(e);
    return e;
  }

  private groupSine(): void {
    const n = 5 + Math.min(4, Math.floor(this.wave / 3));
    const x0 = this.rng.range(120, this.W - 120);
    const kind: EnemyKind = this.wave > 3 && this.rng.chance(0.35) ? 'fighter' : 'scout';
    for (let i = 0; i < n; i++) {
      const e = this.makeEnemy(kind, 'sine', x0, -40 - i * 55);
      e.vy = 150 + this.wave * 6;
      e.phase = i * 0.5;
    }
  }

  private groupHover(): void {
    const n = 3 + Math.min(3, Math.floor(this.wave / 3));
    for (let i = 0; i < n; i++) {
      const x = ((i + 1) / (n + 1)) * this.W;
      const e = this.makeEnemy('fighter', 'hover', x, -40 - Math.abs(i - (n - 1) / 2) * 50);
      e.targetY = 140 + Math.abs(i - (n - 1) / 2) * 40;
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
      const e = this.makeEnemy('kamikaze', 'dive', this.rng.range(60, this.W - 60), -40 - i * 70);
      e.vy = 140;
    }
  }

  private groupTank(): void {
    const n = this.wave >= 7 ? 2 : 1;
    for (let i = 0; i < n; i++) {
      const e = this.makeEnemy('tank', 'hover', ((i + 1) / (n + 1)) * this.W, -60);
      e.targetY = 190;
      e.dur = 12;
    }
  }

  private spawnBoss(): void {
    const e = this.makeEnemy('boss', 'boss', this.W / 2, -120);
    e.targetY = 170;
    this.boss = e;
  }

  // ------------------------------------------------------------------ update

  protected tick(dt: number): void {
    this.scroll += dt;
    this.bombFlash = Math.max(0, this.bombFlash - dt);
    this.waveBannerT += dt;
    this.chainT -= dt;
    if (this.chainT <= 0) this.chain = 0;
    for (const s of this.stars) {
      s.y += (40 + 220 * s.z) * dt;
      if (s.y > this.H) {
        s.y -= this.H;
        s.x = this.rng.range(0, this.W);
      }
    }

    if (!this.dead) this.updateShip(dt);

    // Wave flow
    if (this.waveQueue.length > 0) {
      this.spawnT -= dt;
      if (this.spawnT <= 0) {
        const spawn = this.waveQueue.shift();
        spawn?.();
        this.spawnT = Math.max(1.1, 2.6 - this.wave * 0.08);
      }
    } else if (this.enemies.length === 0 && !this.dead) {
      this.betweenWaves -= dt;
      if (this.betweenWaves <= 0) {
        this.betweenWaves = 1.6;
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
    const speed = 400 * this.speedMul;
    const ptr = this.input.pointer;
    const keyAxis = this.input.axisX() !== 0 || this.input.axisY() !== 0;
    if (keyAxis) ptr.active = false;
    if (!keyAxis && (ptr.touch ? ptr.down : ptr.active)) {
      const tx = ptr.x;
      const ty = ptr.y - (ptr.touch ? 80 : 0);
      const k = damp(ptr.touch ? 18 : 14, dt);
      const nx = this.shipX + (tx - this.shipX) * k;
      const ny = this.shipY + (ty - this.shipY) * k;
      const maxStep = speed * 1.6 * dt;
      const dx = clamp(nx - this.shipX, -maxStep, maxStep);
      const dy = clamp(ny - this.shipY, -maxStep, maxStep);
      this.shipX += dx;
      this.shipY += dy;
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
    this.shipX = clamp(this.shipX, 24, this.W - 24);
    this.shipY = clamp(this.shipY, 120, this.H - 40);
    this.invuln = Math.max(0, this.invuln - dt);

    this.fireT -= dt;
    if (this.fireT <= 0) {
      this.fire();
      this.fireT = this.weapon >= 5 ? 0.09 : this.weapon >= 3 ? 0.11 : 0.13;
    }
    if (this.input.wasPressed('secondary')) this.useBomb();

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
    const shot = (dx: number, angle: number, dmg = 1) => {
      const sp = 820;
      this.shots.push({
        x: x + dx,
        y,
        vx: Math.sin(angle) * sp,
        vy: -Math.cos(angle) * sp,
        r: 4,
        dmg,
        alive: true,
        color: '#9ff',
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
        shot(-10, -0.12);
        shot(10, 0.12);
        break;
      case 4:
        shot(-6, 0);
        shot(6, 0);
        shot(-12, -0.18);
        shot(12, 0.18);
        break;
      default:
        shot(0, 0, 2);
        shot(-8, -0.1);
        shot(8, 0.1);
        shot(-14, -0.26);
        shot(14, 0.26);
    }
    this.audio.play('shoot', { volume: 0.25 });
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
      this.damage(e, e.kind === 'boss' ? Math.ceil(e.maxHp * 0.08) : 30);
    }
  }

  private updateEnemies(dt: number): void {
    for (const e of this.enemies) {
      if (!e.alive) continue;
      e.t += dt;
      e.hitT = Math.max(0, e.hitT - dt);
      const lastX = e.x;
      const lastY = e.y;
      this.moveEnemy(e, dt);
      const mdx = e.x - lastX;
      const mdy = e.y - lastY;
      if (mdx * mdx + mdy * mdy > 0.01) e.heading = Math.atan2(mdy, mdx);
      if (e.y > this.H + 80 || e.x < -150 || e.x > this.W + 150) {
        if (e.t > 1) e.alive = false;
      }

      // Firing
      if (
        e.y > 20 &&
        e.y < this.H * 0.75 &&
        e.kind !== 'scout' &&
        e.kind !== 'kamikaze' &&
        e.kind !== 'boss' &&
        !this.dead
      ) {
        e.fireT -= dt;
        if (e.fireT <= 0) {
          e.fireT =
            Math.max(0.7, (e.kind === 'tank' ? 2.4 : 2.0) - this.wave * 0.06) * this.rng.range(0.8, 1.3);
          const a = Math.atan2(this.shipY - e.y, this.shipX - e.x);
          const sp = 220 + this.wave * 6;
          if (e.kind === 'tank')
            for (let k = -2; k <= 2; k++) this.enemyShot(e.x, e.y + 20, a + k * 0.2, sp, '#ff9f1c');
          else this.enemyShot(e.x, e.y + 14, a, sp, '#ff4d6d');
        }
      }

      // Ramming
      if (!this.dead && this.invuln <= 0 && Math.hypot(e.x - this.shipX, e.y - this.shipY) < e.r + 12) {
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
        e.x = e.x0 + Math.sin(e.t * 2.2 + e.phase) * 110;
        break;
      case 'hover': {
        if (e.t < e.dur) {
          e.y += (e.targetY - e.y) * damp(2, dt);
          e.x = e.x0 + Math.sin(e.t * 0.9) * 60;
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
      case 'dive': {
        if (e.t < 1.1) {
          e.y += e.vy * dt;
        } else {
          if (e.phase === 0) {
            e.phase = 1;
            const a = Math.atan2(this.shipY - e.y, this.shipX - e.x);
            const sp = 420 + this.wave * 10;
            e.vx = Math.cos(a) * sp;
            e.vy = Math.sin(a) * sp;
            this.audio.play('whoosh', { volume: 0.4, pitch: 1.6 });
          }
          e.x += e.vx * dt;
          e.y += e.vy * dt;
        }
        break;
      }
      case 'boss':
        this.updateBoss(e, dt);
        break;
    }
  }

  private updateBoss(e: Enemy, dt: number): void {
    if (e.t < 3) {
      e.y += (e.targetY - e.y) * damp(1.4, dt);
      return;
    }
    const rage = e.hp / e.maxHp < 0.33 ? 2 : e.hp / e.maxHp < 0.66 ? 1 : 0;
    e.x = this.W / 2 + Math.sin(e.t * (0.5 + rage * 0.15)) * (this.W / 2 - 110);
    e.y = e.targetY + Math.sin(e.t * 1.3) * 20;
    e.fireT -= dt;
    if (e.fireT > 0 || this.dead) return;
    const pattern = Math.floor(e.t / 4) % 3;
    if (pattern === 0) {
      // Rotating spiral
      const n = 10 + rage * 4;
      for (let i = 0; i < n; i++)
        this.enemyShot(e.x, e.y + 30, e.t * 1.7 + (i * TAU) / n, 180 + rage * 30, '#ff4dd2');
      e.fireT = 0.55 - rage * 0.1;
    } else if (pattern === 1) {
      // Aimed burst
      const a = Math.atan2(this.shipY - e.y, this.shipX - e.x);
      for (let k = -2; k <= 2; k++) this.enemyShot(e.x, e.y + 40, a + k * 0.12, 300 + rage * 40, '#ff9f1c');
      e.fireT = 0.7 - rage * 0.12;
    } else {
      // Twin cannons fan
      for (const side of [-1, 1]) {
        for (let k = 0; k < 3 + rage; k++)
          this.enemyShot(e.x + side * 60, e.y + 20, Math.PI / 2 + side * 0.15 * k, 240, '#4dd9ff');
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
        const dx = e.x - b.x;
        const dy = e.y - b.y;
        const rr = e.r + b.r;
        if (dx * dx + dy * dy < rr * rr) {
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
        if (dx * dx + dy * dy < (b.r + 6) ** 2) {
          b.alive = false;
          this.hitShip();
        }
      }
    }
    this.enemyShots = this.enemyShots.filter((b) => b.alive);
  }

  private damage(e: Enemy, amount: number): void {
    if (!e.alive) return;
    e.hp -= amount;
    e.hitT = 0.08;
    if (e.hp > 0) return;
    e.alive = false;
    this.chain++;
    this.chainT = 1.2;
    const mult = Math.min(8, 1 + Math.floor(this.chain / 5));
    const pts = Math.round(e.points * (1 + (this.wave - 1) * 0.05)) * mult;
    this.score += pts;
    this.addStat('enemies');
    const big = e.kind === 'boss' || e.kind === 'tank';
    this.audio.play(big ? 'bomb' : 'explode', { volume: big ? 1 : 0.5 });
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
    this.rings.push({ x: e.x, y: e.y, r: e.r * 0.5, life: 0.4, color: '#ffd166' });
    if (mult > 1 || big)
      this.texts.add(e.x, e.y - 20, mult > 1 ? `${pts} x${mult}` : `${pts}`, '#ffd23f', big ? 28 : 18);
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
      this.texts.add(this.W / 2, this.H / 2 - 100, 'BOSS DEFEATED!', '#7CFC00', 36);
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
        if (this.weapon < MAX_WEAPON) this.weapon++;
        else this.score += 2000;
        this.addStat('powerups');
        this.audio.play('powerup');
        this.texts.add(
          this.shipX,
          this.shipY - 50,
          this.weapon < MAX_WEAPON ? 'POWER UP!' : 'MAX POWER +2000',
          '#4dd9ff',
          22,
        );
        break;
      case 'bomb':
        this.bombs = Math.min(5, this.bombs + 1);
        this.audio.play('select');
        this.texts.add(this.shipX, this.shipY - 50, '+1 BOMB', '#ff9f1c', 22);
        break;
      case 'shield':
        this.shield = true;
        this.audio.play('powerup');
        this.texts.add(this.shipX, this.shipY - 50, 'SHIELD', '#7cf', 22);
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
    for (const b of this.shots) {
      ctx.fillStyle = b.color;
      fillRoundRect(ctx, b.x - 2.5, b.y - 9, 5, 18, 2.5, b.dmg > 1 ? '#fff' : b.color);
    }
    this.particles.render(ctx);
    if (!this.dead && !(this.invuln > 0 && Math.floor(this.time * 15) % 2 === 0))
      this.drawShip(this.shipX, this.shipY);
    for (const b of this.enemyShots) {
      ctx.fillStyle = b.color;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, TAU);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r * 0.45, 0, TAU);
      ctx.fill();
    }
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
    ctx.restore();
    if (this.bombFlash > 0 && !this.services.reducedMotion) {
      ctx.fillStyle = `rgba(255,255,255,${this.bombFlash})`;
      ctx.fillRect(0, 0, this.W, this.H);
    }
    this.drawHud();
  }

  private drawSpace(): void {
    const ctx = this.ctx;
    const g = ctx.createLinearGradient(0, 0, 0, this.H);
    g.addColorStop(0, '#050816');
    g.addColorStop(1, '#140a2e');
    ctx.fillStyle = g;
    ctx.fillRect(-20, -20, this.W + 40, this.H + 40);
    // Drifting nebulae
    for (let i = 0; i < 3; i++) {
      const y = ((this.scroll * 18 + i * 420) % (this.H + 600)) - 300;
      const x = hash1(i + Math.floor((this.scroll * 18 + i * 420) / (this.H + 600)) * 7) * this.W;
      const colors = ['rgba(176,107,255,0.18)', 'rgba(77,217,255,0.14)', 'rgba(255,77,109,0.12)'];
      const ng = ctx.createRadialGradient(x, y, 10, x, y, 240);
      ng.addColorStop(0, colors[i] as string);
      ng.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = ng;
      ctx.fillRect(x - 240, y - 240, 480, 480);
    }
    for (const s of this.stars) {
      ctx.globalAlpha = 0.3 + s.z * 0.7;
      ctx.fillStyle = s.z > 0.8 ? '#cfe8ff' : '#fff';
      const len = 1 + s.z * 4;
      ctx.fillRect(s.x, s.y, s.z > 0.7 ? 2 : 1, len);
    }
    ctx.globalAlpha = 1;
  }

  private drawShip(x: number, y: number): void {
    const ctx = this.ctx;
    const body = this.skinColor('body', '#4dd9ff');
    const accent = this.skinColor('accent', '#ffffff');
    const style = this.skinParam('style', 0);
    ctx.save();
    ctx.translate(x, y);
    const tilt = clamp(this.input.axisX(), -1, 1) * 0.12;
    ctx.rotate(tilt);
    // Engine glow
    const eg = ctx.createRadialGradient(0, 26, 2, 0, 26, 26 + Math.sin(this.time * 40) * 4);
    eg.addColorStop(0, this.skinColor('engine', '#ffb703'));
    eg.addColorStop(1, 'rgba(255,120,0,0)');
    ctx.fillStyle = eg;
    ctx.fillRect(-30, 6, 60, 50);
    ctx.fillStyle = body;
    ctx.beginPath();
    if (style === 1) {
      // Viper: needle hull with swept wings
      ctx.moveTo(0, -34);
      ctx.lineTo(8, -6);
      ctx.lineTo(28, 18);
      ctx.lineTo(8, 14);
      ctx.lineTo(0, 24);
      ctx.lineTo(-8, 14);
      ctx.lineTo(-28, 18);
      ctx.lineTo(-8, -6);
    } else if (style === 2) {
      // Titan: broad armoured hull
      ctx.moveTo(0, -28);
      ctx.lineTo(16, -14);
      ctx.lineTo(32, 8);
      ctx.lineTo(30, 22);
      ctx.lineTo(10, 18);
      ctx.lineTo(0, 26);
      ctx.lineTo(-10, 18);
      ctx.lineTo(-30, 22);
      ctx.lineTo(-32, 8);
      ctx.lineTo(-16, -14);
    } else if (style === 3) {
      // Phantom: forward-swept stealth wing
      ctx.moveTo(0, -32);
      ctx.lineTo(10, -2);
      ctx.lineTo(30, -12);
      ctx.lineTo(22, 20);
      ctx.lineTo(0, 12);
      ctx.lineTo(-22, 20);
      ctx.lineTo(-30, -12);
      ctx.lineTo(-10, -2);
    } else {
      ctx.moveTo(0, -30);
      ctx.lineTo(10, -8);
      ctx.lineTo(26, 14);
      ctx.lineTo(10, 18);
      ctx.lineTo(0, 24);
      ctx.lineTo(-10, 18);
      ctx.lineTo(-26, 14);
      ctx.lineTo(-10, -8);
    }
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = accent;
    ctx.lineWidth = 2;
    ctx.stroke();
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
    // Hitbox indicator
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, TAU);
    ctx.fill();
  }

  private drawEnemy(e: Enemy): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(e.x, e.y);
    const flash = e.hitT > 0;
    switch (e.kind) {
      case 'scout': {
        ctx.rotate(e.heading - Math.PI / 2);
        ctx.fillStyle = flash ? shade('#ff4d6d', 0.45) : '#ff4d6d';
        ctx.beginPath();
        ctx.moveTo(0, 18);
        ctx.lineTo(14, -10);
        ctx.lineTo(0, -4);
        ctx.lineTo(-14, -10);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#ffd6de';
        ctx.beginPath();
        ctx.arc(0, 2, 4, 0, TAU);
        ctx.fill();
        break;
      }
      case 'fighter': {
        ctx.fillStyle = flash ? shade('#7b5cff', 0.45) : '#7b5cff';
        ctx.beginPath();
        ctx.moveTo(0, 22);
        ctx.lineTo(10, 4);
        ctx.lineTo(24, 8);
        ctx.lineTo(20, -12);
        ctx.lineTo(6, -6);
        ctx.lineTo(0, -18);
        ctx.lineTo(-6, -6);
        ctx.lineTo(-20, -12);
        ctx.lineTo(-24, 8);
        ctx.lineTo(-10, 4);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#7CFC00';
        ctx.beginPath();
        ctx.arc(0, 2, 5, 0, TAU);
        ctx.fill();
        break;
      }
      case 'tank': {
        ctx.fillStyle = flash ? shade('#4a5568', 0.45) : '#4a5568';
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
          const a = (i * TAU) / 6 + Math.PI / 6;
          ctx.lineTo(Math.cos(a) * 34, Math.sin(a) * 30);
        }
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = '#ff9f1c';
        ctx.lineWidth = 3;
        ctx.stroke();
        ctx.fillStyle = '#ff9f1c';
        ctx.beginPath();
        ctx.arc(0, 0, 10 + Math.sin(this.time * 6) * 2, 0, TAU);
        ctx.fill();
        fillRoundRect(ctx, -26, 14, 10, 16, 3, '#2d3748');
        fillRoundRect(ctx, 16, 14, 10, 16, 3, '#2d3748');
        progressBar(ctx, -26, -42, 52, 5, e.hp / e.maxHp, '#ff9f1c');
        break;
      }
      case 'kamikaze': {
        ctx.rotate(e.phase === 1 ? e.heading - Math.PI / 2 : this.time * 8);
        ctx.fillStyle = flash ? shade('#ff9f1c', 0.45) : '#ff9f1c';
        ctx.beginPath();
        for (let i = 0; i < 8; i++) {
          const a = (i * TAU) / 8;
          const r = i % 2 === 0 ? 18 : 9;
          ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
        }
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#ff4d6d';
        ctx.beginPath();
        ctx.arc(0, 0, 5, 0, TAU);
        ctx.fill();
        break;
      }
      case 'boss': {
        const body = flash ? shade('#3b1f5c', 0.45) : '#3b1f5c';
        ctx.fillStyle = body;
        ctx.beginPath();
        ctx.moveTo(-110, -10);
        ctx.lineTo(-70, -50);
        ctx.lineTo(70, -50);
        ctx.lineTo(110, -10);
        ctx.lineTo(80, 30);
        ctx.lineTo(30, 46);
        ctx.lineTo(-30, 46);
        ctx.lineTo(-80, 30);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = '#b06bff';
        ctx.lineWidth = 3;
        ctx.stroke();
        for (const side of [-1, 1]) {
          fillRoundRect(ctx, side * 60 - 10, 16, 20, 30, 5, '#22163a');
          ctx.fillStyle = '#4dd9ff';
          ctx.beginPath();
          ctx.arc(side * 60, 44, 5, 0, TAU);
          ctx.fill();
        }
        const core = ctx.createRadialGradient(0, 0, 4, 0, 0, 34);
        core.addColorStop(0, '#fff');
        core.addColorStop(0.4, '#ff4dd2');
        core.addColorStop(1, 'rgba(255,77,210,0)');
        ctx.fillStyle = core;
        ctx.beginPath();
        ctx.arc(0, 0, 30 + Math.sin(this.time * 5) * 4, 0, TAU);
        ctx.fill();
        break;
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
    hudPill(ctx, 12, 12, 220, 40);
    text(ctx, Math.floor(this.score).toLocaleString('en-US'), 30, 33, { size: 22 });
    if (this.chain >= 5)
      text(ctx, `x${Math.min(8, 1 + Math.floor(this.chain / 5))}`, 222, 33, {
        size: 18,
        align: 'right',
        color: '#ffd23f',
      });
    hudPill(ctx, this.W - 132, 12, 120, 40);
    drawCoin(ctx, this.W - 108, 32, 11);
    text(ctx, `${this.coins}`, this.W - 90, 33, { size: 20 });
    // Lives and bombs
    for (let i = 0; i < Math.max(0, this.lives); i++) {
      ctx.save();
      ctx.translate(26 + i * 28, this.H - 30);
      ctx.scale(0.5, 0.5);
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
    for (let i = 0; i < this.bombs; i++) {
      ctx.fillStyle = '#ff9f1c';
      ctx.beginPath();
      ctx.arc(this.W - 26 - i * 26, this.H - 30, 9, 0, TAU);
      ctx.fill();
      text(ctx, 'B', this.W - 26 - i * 26, this.H - 29, {
        size: 11,
        align: 'center',
        color: '#3a1a00',
        stroke: null,
      });
    }
    // Weapon level
    hudPill(ctx, this.W / 2 - 70, this.H - 48, 140, 34);
    text(ctx, 'PWR', this.W / 2 - 54, this.H - 31, { size: 13, color: '#9ff' });
    for (let i = 0; i < MAX_WEAPON; i++) {
      fillRoundRect(
        ctx,
        this.W / 2 - 18 + i * 16,
        this.H - 38,
        12,
        14,
        3,
        i < this.weapon ? '#4dd9ff' : 'rgba(255,255,255,0.15)',
      );
    }
    if (this.boss) {
      progressBar(ctx, 40, 64, this.W - 80, 10, this.boss.hp / this.boss.maxHp, '#ff4dd2');
      text(ctx, 'MOTHERSHIP', this.W / 2, 86, { size: 13, align: 'center', color: '#ffb3ec' });
    }
    if (this.waveBannerT < 2.2 && this.wave > 0) {
      const isBoss = this.wave % 5 === 0;
      banner(
        ctx,
        this.W,
        this.H,
        isBoss ? 'WARNING!' : `WAVE ${this.wave}`,
        isBoss ? 'Mothership approaching' : 'Get ready',
        this.waveBannerT / 2.2,
        isBoss ? '#ff4d6d' : '#4dd9ff',
      );
    }
  }
}
