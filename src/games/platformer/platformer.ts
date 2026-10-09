import { clamp, damp, rectsOverlap, TAU } from '../../core/math';
import { BaseGame } from '../base';
import { banner, drawCoin, fillRoundRect, hash1, hudPill, shade, text } from '../draw';
import { drawSprite, type SpritePalette } from '../sprite';
import type { GameServices } from '../types';
import { buildLevel, ROWS, T, Tile, type EnemyKind, type LevelData, type TileId } from './level';
import { FIREBALL, FLOWER, HERO, MUSHROOM, SHELL, SHELLBACK, SPIKY, WALKER, type HeroPose } from './sprites';

const PHYS = {
  accel: 1500,
  airAccel: 1050,
  friction: 1900,
  walkMax: 215,
  runMax: 335,
  jumpV: 800,
  gHold: 1750,
  gRelease: 3400,
  gFall: 2600,
  maxFall: 950,
  coyote: 0.09,
  buffer: 0.12,
};
const PX = 2.25;
const LEVEL_TIME = 150;
const STOMP_POINTS = [100, 200, 400, 500, 800, 1000, 2000, 4000, 5000, 8000];

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
  vx: number;
  vy: number;
  onGround: boolean;
}

interface Player extends Box {
  power: 0 | 1 | 2;
  facing: 1 | -1;
  invuln: number;
  coyote: number;
  jumpBuf: number;
  jumping: boolean;
  anim: number;
  dead: boolean;
  combo: number;
  fireCooldown: number;
}

interface Enemy extends Box {
  kind: EnemyKind;
  state: 'walk' | 'shell' | 'shellMove' | 'squished' | 'dead';
  timer: number;
  active: boolean;
  dir: number;
  chain: number;
  kickGrace: number;
}

interface Item extends Box {
  kind: 'mushroom' | 'flower' | 'oneup';
  emerge: number;
  targetY: number;
}

interface Fireball {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
}

interface PopCoin {
  x: number;
  y: number;
  vy: number;
  life: number;
}

interface Debris {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
}

type Phase = 'play' | 'dying' | 'flag' | 'walkoff' | 'tally';

const THEMES = [
  {
    name: 'Grassland',
    sky: ['#5c94fc', '#a8d0ff'],
    hill: '#47b04f',
    hillFar: '#8fd18f',
    ground: '#c8743c',
    grass: '#62d162',
    stars: false,
  },
  {
    name: 'Sunset Ridge',
    sky: ['#6a3d9a', '#ff9a62'],
    hill: '#8c3f6e',
    hillFar: '#c06b8a',
    ground: '#a8603a',
    grass: '#f2b34c',
    stars: false,
  },
  {
    name: 'Starlight Hills',
    sky: ['#081430', '#253a6e'],
    hill: '#1f4d5c',
    hillFar: '#2c3e70',
    ground: '#5c4f86',
    grass: '#46d9c4',
    stars: true,
  },
] as const;

export class PlatformerGame extends BaseGame {
  private readonly seed: number;
  private levelNum = 1;
  private level!: LevelData;
  private phase: Phase = 'play';
  private phaseT = 0;
  private lives: number;
  private timeLeft = LEVEL_TIME;
  private camX = 0;
  private checkpointReached = false;
  private coinCounter = 0;
  private flagY = 0;
  private bannerT = 0;
  private readonly bumps = new Map<number, number>();
  private player!: Player;
  private enemies: Enemy[] = [];
  private items: Item[] = [];
  private fireballs: Fireball[] = [];
  private popCoins: PopCoin[] = [];
  private debris: Debris[] = [];
  private readonly heroPal: Record<'normal' | 'fire', SpritePalette>;

  constructor(s: GameServices) {
    super(s);
    this.seed = this.rng.int(1, 1_000_000);
    this.lives = 3 + (this.hasBoost('shield') ? 1 : 0);
    const base = {
      H: this.skinColor('hat', '#e63946'),
      V: shade(this.skinColor('hat', '#e63946'), -0.3),
      h: this.skinColor('hair', '#5a3214'),
      S: this.skinColor('skin', '#f6c18f'),
      E: '#1b1b2f',
      m: '#7a2e2e',
      C: this.skinColor('shirt', '#e63946'),
      O: this.skinColor('overalls', '#1d4ed8'),
      B: '#ffd23f',
      F: '#6b3a1e',
    };
    this.heroPal = {
      normal: base,
      fire: { ...base, H: '#ffffff', V: '#d0d0d0', C: '#ffffff', O: this.skinColor('fire', '#e63946') },
    };
    this.loadLevel(true);
    if (this.hasBoost('head-start')) this.player.power = 2;
    this.syncPlayerSize();
  }

  // ------------------------------------------------------------------ level lifecycle

  private loadLevel(fresh: boolean): void {
    this.level = buildLevel(this.levelNum, this.seed);
    this.bumps.clear();
    this.items = [];
    this.fireballs = [];
    this.popCoins = [];
    this.debris = [];
    this.enemies = this.level.spawns.map((sp) => this.makeEnemy(sp.kind, sp.x, sp.y));
    const spawn = this.checkpointReached && !fresh ? this.level.checkpoint : this.level.start;
    const prevPower = this.player?.power ?? 0;
    this.player = {
      x: spawn.x,
      y: spawn.y - 32,
      w: 22,
      h: 32,
      vx: 0,
      vy: 0,
      onGround: false,
      power: fresh ? prevPower : 0,
      facing: 1,
      invuln: 0,
      coyote: 0,
      jumpBuf: 0,
      jumping: false,
      anim: 0,
      dead: false,
      combo: 0,
      fireCooldown: 0,
    };
    this.syncPlayerSize();
    this.timeLeft = LEVEL_TIME;
    this.phase = 'play';
    this.phaseT = 0;
    this.flagY = 0;
    this.bannerT = 0;
    this.camX = clamp(this.player.x - this.W * 0.4, 0, this.level.cols * T - this.W);
  }

  private makeEnemy(kind: EnemyKind, x: number, feetY: number): Enemy {
    const h = kind === 'walker' ? 26 : kind === 'shellback' ? 28 : 24;
    return {
      kind,
      x: x - 13,
      y: feetY - h,
      w: 26,
      h,
      vx: 0,
      vy: 0,
      onGround: false,
      state: 'walk',
      timer: 0,
      active: false,
      dir: -1,
      chain: 0,
      kickGrace: 0,
    };
  }

  private syncPlayerSize(): void {
    const p = this.player;
    const h = p.power > 0 ? 50 : 32;
    if (p.h !== h) {
      p.y += p.h - h;
      p.h = h;
    }
  }

  // ------------------------------------------------------------------ tile helpers

  private tileAt(col: number, row: number): TileId {
    if (col < 0 || col >= this.level.cols) return Tile.Hard;
    if (row < 0 || row >= ROWS) return Tile.Empty;
    return (this.level.tiles[row * this.level.cols + col] ?? Tile.Empty) as TileId;
  }

  private solid(col: number, row: number): boolean {
    return this.tileAt(col, row) !== Tile.Empty;
  }

  /** Move along x, resolving against the leading column only (step < 1 tile). */
  private moveX(b: Box, dx: number): boolean {
    if (dx === 0) return false;
    const oldL = b.x;
    const oldR = b.x + b.w;
    b.x += dx;
    const r0 = Math.floor(b.y / T);
    const r1 = Math.floor((b.y + b.h - 0.01) / T);
    if (dx > 0) {
      const col = Math.floor((b.x + b.w - 0.01) / T);
      if (col * T >= oldR - 0.5) {
        for (let r = r0; r <= r1; r++) {
          if (this.solid(col, r)) {
            b.x = col * T - b.w;
            return true;
          }
        }
      }
    } else {
      const col = Math.floor(b.x / T);
      if ((col + 1) * T <= oldL + 0.5) {
        for (let r = r0; r <= r1; r++) {
          if (this.solid(col, r)) {
            b.x = (col + 1) * T;
            return true;
          }
        }
      }
    }
    return false;
  }

  /** Move along y; returns the column of a ceiling hit (for block bumps), -1 for floor, null otherwise. */
  private moveY(b: Box, dy: number): number | null {
    b.onGround = false;
    if (dy === 0) dy = 0.001;
    const oldT = b.y;
    const oldB = b.y + b.h;
    b.y += dy;
    const c0 = Math.floor((b.x + 0.5) / T);
    const c1 = Math.floor((b.x + b.w - 0.5) / T);
    if (dy > 0) {
      const row = Math.floor((b.y + b.h - 0.01) / T);
      if (row * T >= oldB - 0.5) {
        for (let c = c0; c <= c1; c++) {
          if (this.solid(c, row)) {
            b.y = row * T - b.h;
            b.vy = 0;
            b.onGround = true;
            return -1;
          }
        }
      }
    } else {
      const row = Math.floor(b.y / T);
      if ((row + 1) * T <= oldT + 0.5) {
        let best: number | null = null;
        let bestDist = Infinity;
        const center = b.x + b.w / 2;
        for (let c = c0; c <= c1; c++) {
          if (this.solid(c, row)) {
            const d = Math.abs(c * T + T / 2 - center);
            if (d < bestDist) {
              bestDist = d;
              best = c;
            }
          }
        }
        if (best !== null) {
          b.y = (row + 1) * T;
          b.vy = Math.max(0, b.vy);
          return best;
        }
      }
    }
    return null;
  }

  // ------------------------------------------------------------------ update

  protected tick(dt: number): void {
    this.phaseT += dt;
    this.bannerT += dt;
    this.updateBlocks(dt);
    this.updatePopCoins(dt);
    switch (this.phase) {
      case 'play':
        this.updatePlay(dt);
        break;
      case 'dying':
        this.updateDying(dt);
        break;
      case 'flag':
        this.updateFlag(dt);
        break;
      case 'walkoff':
        this.updateWalkoff(dt);
        break;
      case 'tally':
        this.updateTally(dt);
        break;
    }
    const target = clamp(this.player.x - this.W * 0.4, 0, this.level.cols * T - this.W);
    this.camX += (target - this.camX) * damp(10, dt);
  }

  private updatePlay(dt: number): void {
    const p = this.player;
    this.timeLeft -= dt;
    if (this.timeLeft <= 0) {
      this.timeLeft = 0;
      this.die();
      return;
    }
    p.invuln = Math.max(0, p.invuln - dt);
    p.fireCooldown = Math.max(0, p.fireCooldown - dt);

    // Horizontal control
    const ax = this.input.axisX();
    const running = this.input.isDown('secondary');
    const max = running ? PHYS.runMax : PHYS.walkMax;
    if (ax !== 0) {
      const accel = p.onGround ? PHYS.accel : PHYS.airAccel;
      const turning = Math.sign(p.vx) !== ax && p.vx !== 0;
      p.vx += ax * accel * (turning ? 1.8 : 1) * dt;
      p.vx = clamp(p.vx, -max, max);
      p.facing = ax > 0 ? 1 : -1;
    } else if (p.onGround) {
      const f = PHYS.friction * dt;
      p.vx = Math.abs(p.vx) <= f ? 0 : p.vx - Math.sign(p.vx) * f;
    }
    if (Math.abs(p.vx) > max && p.onGround) p.vx -= Math.sign(p.vx) * PHYS.friction * dt;

    // Jump with coyote time and input buffering
    p.coyote = p.onGround ? PHYS.coyote : Math.max(0, p.coyote - dt);
    if (this.input.wasPressed('primary') || this.input.wasPressed('up')) p.jumpBuf = PHYS.buffer;
    else p.jumpBuf = Math.max(0, p.jumpBuf - dt);
    const holding = this.input.isDown('primary') || this.input.isDown('up');
    if (p.jumpBuf > 0 && p.coyote > 0) {
      p.vy = -(PHYS.jumpV + Math.abs(p.vx) * 0.18);
      p.jumping = true;
      p.jumpBuf = 0;
      p.coyote = 0;
      p.onGround = false;
      this.addStat('jumps');
      this.audio.play('jump', { pitch: p.power > 0 ? 0.9 : 1.1 });
    }
    const g = p.vy < 0 ? (holding && p.jumping ? PHYS.gHold : PHYS.gRelease) : PHYS.gFall;
    p.vy = Math.min(PHYS.maxFall, p.vy + g * dt);

    // Fireballs
    if (
      p.power === 2 &&
      this.input.wasPressed('secondary') &&
      p.fireCooldown <= 0 &&
      this.fireballs.length < 2
    ) {
      this.fireballs.push({
        x: p.x + p.w / 2 + p.facing * 12,
        y: p.y + 16,
        vx: p.facing * 460,
        vy: 120,
        life: 2.5,
      });
      p.fireCooldown = 0.18;
      this.audio.play('shoot', { pitch: 0.7 });
    }

    const prevBottom = p.y + p.h;
    this.moveX(p, p.vx * dt);
    if (p.x < 0) {
      p.x = 0;
      p.vx = 0;
    }
    const wasAir = !p.onGround;
    const hit = this.moveY(p, p.vy * dt);
    if (hit !== null && hit >= 0) {
      const row = Math.floor(p.y / T) - 1;
      this.bumpBlock(hit, row);
      p.jumping = false;
    }
    if (p.onGround) {
      p.jumping = false;
      p.combo = 0;
      if (wasAir) this.audio.play('land', { volume: 0.4 });
    }
    p.anim += Math.abs(p.vx) * dt * 0.05;

    if (p.y > ROWS * T + 40) {
      this.die();
      return;
    }

    if (!this.checkpointReached && p.x > this.level.checkpoint.x) {
      this.checkpointReached = true;
      this.audio.play('select');
      this.texts.add(
        this.level.checkpoint.x - this.camX,
        this.level.checkpoint.y - 90,
        'CHECKPOINT',
        '#7cf',
        22,
      );
    }

    this.collectCoins();
    this.updateItems(dt);
    this.updateEnemies(dt, prevBottom);
    this.updateFireballs(dt);
    this.updateDebris(dt);

    if (p.x + p.w / 2 >= this.level.flagX - 6) this.startFlag();
  }

  private collectCoins(): void {
    const p = this.player;
    for (const c of this.level.coins) {
      if (c.taken) continue;
      if (c.x > p.x - 10 && c.x < p.x + p.w + 10 && c.y > p.y - 10 && c.y < p.y + p.h + 10) {
        c.taken = true;
        this.gainCoin(c.x, c.y);
      }
    }
  }

  private gainCoin(x: number, y: number): void {
    this.coins++;
    this.coinCounter++;
    this.score += 200;
    this.audio.play('coin', { volume: 0.7 });
    this.particles.emit({
      x: x - this.camX,
      y,
      count: 6,
      speed: 120,
      life: 0.35,
      size: 3,
      colors: ['#ffe066', '#fff'],
    });
    if (this.coinCounter >= 100) {
      this.coinCounter -= 100;
      this.gainLife(x, y);
    }
  }

  private gainLife(x: number, y: number): void {
    this.lives++;
    this.audio.play('levelup');
    this.texts.add(x - this.camX, y - 20, '1UP', '#5f5', 26);
  }

  private bumpBlock(col: number, row: number): void {
    const tile = this.tileAt(col, row);
    const idx = row * this.level.cols + col;
    const p = this.player;
    if (tile === Tile.Question) {
      const content = this.level.contents.get(idx) ?? 'coin';
      this.level.tiles[idx] = Tile.Used;
      this.bumps.set(idx, 0.15);
      if (content === 'coin') {
        this.popCoins.push({ x: col * T + T / 2, y: row * T, vy: -520, life: 0.55 });
        this.gainCoin(col * T + T / 2, row * T);
      } else {
        const kind = content === 'oneup' ? 'oneup' : p.power === 0 ? 'mushroom' : 'flower';
        this.items.push({
          kind,
          x: col * T + 4,
          y: row * T,
          w: 28,
          h: 28,
          vx: 0,
          vy: 0,
          onGround: false,
          emerge: 0.6,
          targetY: row * T - 28,
        });
        this.audio.play('pop');
      }
      this.killOnTop(col, row);
    } else if (tile === Tile.Brick) {
      if (p.power > 0) {
        this.level.tiles[idx] = Tile.Empty;
        this.score += 50;
        this.addStat('bricks');
        this.audio.play('explode', { volume: 0.4, pitch: 2 });
        for (let i = 0; i < 4; i++) {
          this.debris.push({
            x: col * T + (i % 2) * 18 + 9,
            y: row * T + Math.floor(i / 2) * 18 + 9,
            vx: (i % 2 === 0 ? -1 : 1) * this.rng.range(80, 160),
            vy: -this.rng.range(380, 560) + Math.floor(i / 2) * 120,
            rot: 0,
          });
        }
      } else {
        this.bumps.set(idx, 0.15);
        this.audio.play('bump');
      }
      this.killOnTop(col, row);
    } else {
      this.audio.play('bump', { volume: 0.6 });
    }
  }

  private killOnTop(col: number, row: number): void {
    const top = row * T;
    const box = { x: col * T, y: top - 6, w: T, h: 8 };
    for (const e of this.enemies) {
      if (e.state === 'dead' || e.state === 'squished') continue;
      if (rectsOverlap(box, { x: e.x, y: e.y + e.h - 2, w: e.w, h: 4 }))
        this.killEnemy(e, 100, e.x < col * T ? -1 : 1);
    }
    for (const it of this.items) {
      if (it.emerge <= 0 && rectsOverlap(box, { x: it.x, y: it.y + it.h - 2, w: it.w, h: 4 })) {
        it.vy = -420;
        it.vx = (it.x + it.w / 2 < col * T + T / 2 ? -1 : 1) * Math.abs(it.vx || 100);
      }
    }
  }

  private updateBlocks(dt: number): void {
    for (const [k, v] of this.bumps) {
      if (v - dt <= 0) this.bumps.delete(k);
      else this.bumps.set(k, v - dt);
    }
  }

  private updatePopCoins(dt: number): void {
    for (const c of this.popCoins) {
      c.life -= dt;
      c.vy += 1800 * dt;
      c.y += c.vy * dt;
    }
    this.popCoins = this.popCoins.filter((c) => c.life > 0);
  }

  private updateItems(dt: number): void {
    const p = this.player;
    for (const it of this.items) {
      if (it.emerge > 0) {
        it.emerge -= dt;
        it.y = it.targetY + (it.emerge / 0.6) * it.h;
        if (it.emerge <= 0) {
          it.y = it.targetY;
          it.vx = it.kind === 'flower' ? 0 : it.kind === 'oneup' ? 120 : 100;
        }
      } else if (it.kind !== 'flower') {
        it.vy = Math.min(PHYS.maxFall, it.vy + PHYS.gFall * dt);
        if (this.moveX(it, it.vx * dt)) it.vx = -it.vx;
        this.moveY(it, it.vy * dt);
      }
      if (rectsOverlap(p, it) && it.emerge < 0.3) {
        it.y = 99999;
        if (it.kind === 'oneup') {
          this.gainLife(it.x, p.y);
        } else {
          this.score += 1000;
          this.addStat('powerups');
          this.audio.play('powerup');
          this.texts.add(p.x - this.camX + p.w / 2, p.y - 10, '1000', '#fff', 20);
          if (it.kind === 'mushroom') p.power = Math.max(p.power, 1) as 1 | 2;
          else p.power = 2;
          this.syncPlayerSize();
        }
      }
    }
    this.items = this.items.filter((it) => it.y < ROWS * T + 100);
  }

  private updateEnemies(dt: number, prevBottom: number): void {
    const p = this.player;
    const viewL = this.camX - 3 * T;
    const viewR = this.camX + this.W + 3 * T;
    for (const e of this.enemies) {
      if (!e.active) {
        if (e.x < viewR && e.x + e.w > viewL) {
          e.active = true;
          e.vx = e.dir * (e.kind === 'spiky' ? 50 : 60);
        } else continue;
      }
      if (e.state === 'dead') {
        e.vy += PHYS.gFall * dt;
        e.y += e.vy * dt;
        e.x += e.vx * dt;
        continue;
      }
      if (e.state === 'squished') {
        e.timer -= dt;
        continue;
      }
      e.kickGrace = Math.max(0, e.kickGrace - dt);
      e.vy = Math.min(PHYS.maxFall, e.vy + PHYS.gFall * dt);
      if (this.moveX(e, e.vx * dt)) {
        e.vx = -e.vx;
        if (e.state === 'shellMove') this.audio.play('bump', { volume: 0.5 });
      }
      this.moveY(e, e.vy * dt);
      if (e.y > ROWS * T + 60) e.state = 'dead';
      if (e.x + e.w < this.camX - this.W || e.x > this.camX + this.W * 2.5) {
        if (e.state === 'shellMove') e.state = 'dead';
      }

      // Moving shells clear out other enemies.
      if (e.state === 'shellMove') {
        for (const o of this.enemies) {
          if (o === e || o.state === 'dead' || o.state === 'squished' || !o.active) continue;
          if (rectsOverlap(e, o)) {
            e.chain++;
            this.killEnemy(o, 100 * Math.pow(2, Math.min(6, e.chain)), Math.sign(e.vx));
          }
        }
      } else if (e.state === 'walk') {
        for (const o of this.enemies) {
          if (o === e || o.state !== 'walk' || !o.active) continue;
          if (rectsOverlap(e, o) && Math.sign(e.vx) === Math.sign(o.x - e.x)) e.vx = -e.vx;
        }
      }

      if (p.dead || this.phase !== 'play') continue;
      if (!rectsOverlap(p, e)) continue;
      const stomping = p.vy > 0 && prevBottom <= e.y + 10;
      if (stomping && e.kind !== 'spiky') {
        this.stomp(e);
      } else if (e.state === 'shell') {
        e.state = 'shellMove';
        e.vx = (p.x + p.w / 2 < e.x + e.w / 2 ? 1 : -1) * 430;
        e.kickGrace = 0.25;
        e.chain = 0;
        this.score += 400;
        this.audio.play('stomp');
      } else if (e.kickGrace <= 0) {
        this.hurt();
      }
    }
    this.enemies = this.enemies.filter(
      (e) => !(e.state === 'dead' && e.y > ROWS * T + 80) && !(e.state === 'squished' && e.timer <= 0),
    );
  }

  private stomp(e: Enemy): void {
    const p = this.player;
    const pts = STOMP_POINTS[Math.min(p.combo, STOMP_POINTS.length - 1)] ?? 100;
    p.combo++;
    if (p.combo > STOMP_POINTS.length) this.gainLife(e.x, e.y);
    else {
      this.score += pts;
      this.texts.add(e.x - this.camX + e.w / 2, e.y - 6, `${pts}`, '#fff', 18);
    }
    p.vy = this.input.isDown('primary') || this.input.isDown('up') ? -720 : -460;
    p.jumping = true;
    this.addStat('stomps');
    this.audio.play('stomp');
    this.services.haptic(20);
    if (e.kind === 'walker') {
      e.state = 'squished';
      e.timer = 0.45;
      this.addStat('enemies');
    } else if (e.kind === 'shellback') {
      if (e.state === 'walk') {
        this.addStat('enemies');
        e.h = 18;
        e.y += 10;
      }
      e.state = 'shell';
      e.vx = 0;
    }
  }

  private killEnemy(e: Enemy, points: number, dir: number): void {
    if (e.state === 'dead') return;
    e.state = 'dead';
    e.vy = -380;
    e.vx = dir * 80;
    this.score += points;
    this.addStat('enemies');
    this.audio.play('stomp', { pitch: 1.3 });
    this.texts.add(e.x - this.camX + e.w / 2, e.y - 6, `${points}`, '#fff', 18);
  }

  private hurt(): void {
    const p = this.player;
    if (p.invuln > 0) return;
    if (p.power > 0) {
      p.power = 0;
      p.invuln = 1.8;
      this.syncPlayerSize();
      this.audio.play('hit', { volume: 0.7 });
      this.shake.add(0.3);
      this.services.haptic(60);
      return;
    }
    this.die();
  }

  private die(): void {
    const p = this.player;
    if (p.dead) return;
    p.dead = true;
    p.vy = -720;
    p.vx = 0;
    p.power = 0;
    this.phase = 'dying';
    this.phaseT = 0;
    this.lives--;
    this.addStat('deaths');
    this.audio.play('hit');
    this.shake.add(0.5);
    this.services.haptic(150);
  }

  private updateDying(dt: number): void {
    const p = this.player;
    if (this.phaseT > 0.4) {
      p.vy += PHYS.gFall * 0.6 * dt;
      p.y += p.vy * dt;
    }
    this.updateDebris(dt);
    if (this.phaseT > 2.4) {
      if (this.lives <= 0) {
        this.endGame(0.2);
        this.phaseT = -99;
      } else if (!this.isEnding) {
        this.loadLevel(false);
      }
    }
  }

  private startFlag(): void {
    const p = this.player;
    this.phase = 'flag';
    this.phaseT = 0;
    p.vx = 0;
    p.vy = 0;
    p.x = this.level.flagX - p.w - 2;
    const groundY = 13 * T;
    const poleTop = 4 * T;
    const t = clamp((groundY - (p.y + p.h)) / (groundY - poleTop), 0, 1);
    const pts = t > 0.85 ? 5000 : t > 0.6 ? 2000 : t > 0.35 ? 800 : t > 0.15 ? 400 : 100;
    this.score += pts;
    this.texts.add(this.level.flagX - this.camX + 30, p.y, `${pts}`, '#ffd23f', 24);
    this.audio.play('win');
  }

  private updateFlag(dt: number): void {
    const p = this.player;
    const groundY = 13 * T;
    p.y = Math.min(groundY - p.h, p.y + 300 * dt);
    this.flagY = Math.min(groundY - 4 * T - 56, this.flagY + 300 * dt);
    if (this.phaseT > 1.3) {
      this.phase = 'walkoff';
      this.phaseT = 0;
      p.facing = 1;
    }
  }

  private updateWalkoff(dt: number): void {
    const p = this.player;
    p.vx = 150;
    p.vy = Math.min(PHYS.maxFall, p.vy + PHYS.gFall * dt);
    this.moveX(p, p.vx * dt);
    this.moveY(p, p.vy * dt);
    p.anim += p.vx * dt * 0.05;
    if (p.x > this.level.castleX + T) {
      this.phase = 'tally';
      this.phaseT = 0;
    }
  }

  private updateTally(dt: number): void {
    if (this.timeLeft > 0) {
      const step = Math.min(this.timeLeft, 90 * dt);
      this.timeLeft -= step;
      this.score += step * 50;
      if (Math.floor(this.phaseT * 20) % 2 === 0) this.audio.play('click', { volume: 0.3 });
      return;
    }
    if (this.phaseT > 2.6) {
      this.addStat('levels');
      this.levelNum++;
      this.maxStat('world', this.levelNum - 1);
      this.checkpointReached = false;
      this.loadLevel(true);
    }
  }

  private updateFireballs(dt: number): void {
    for (const f of this.fireballs) {
      f.life -= dt;
      f.vy = Math.min(700, f.vy + 2200 * dt);
      const box: Box = { x: f.x - 7, y: f.y - 7, w: 14, h: 14, vx: f.vx, vy: f.vy, onGround: false };
      if (this.moveX(box, f.vx * dt)) f.life = 0;
      const hit = this.moveY(box, f.vy * dt);
      f.x = box.x + 7;
      f.y = box.y + 7;
      f.vy = hit === -1 ? -380 : box.vy;
      for (const e of this.enemies) {
        if (e.state === 'dead' || e.state === 'squished' || !e.active) continue;
        if (rectsOverlap(box, e)) {
          this.killEnemy(e, 200, Math.sign(f.vx));
          f.life = 0;
          break;
        }
      }
      if (f.x < this.camX - 40 || f.x > this.camX + this.W + 40) f.life = 0;
      if (f.life <= 0)
        this.particles.emit({
          x: f.x - this.camX,
          y: f.y,
          count: 8,
          speed: 140,
          life: 0.3,
          size: 3,
          colors: ['#ffb703', '#fb5607'],
        });
    }
    this.fireballs = this.fireballs.filter((f) => f.life > 0);
  }

  private updateDebris(dt: number): void {
    for (const d of this.debris) {
      d.vy += 2000 * dt;
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      d.rot += dt * 12;
    }
    this.debris = this.debris.filter((d) => d.y < ROWS * T + 50);
  }

  // ------------------------------------------------------------------ render

  private get theme() {
    return THEMES[(this.levelNum - 1) % THEMES.length] ?? THEMES[0];
  }

  render(): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(Math.round(this.shake.x), Math.round(this.shake.y));
    this.drawBackground();
    ctx.save();
    ctx.translate(-Math.round(this.camX), 0);
    this.drawFlagAndCastle();
    this.drawItems();
    this.drawTiles();
    this.drawCoins();
    this.drawEnemies();
    this.drawFireballs();
    this.drawDebris();
    this.drawPlayer();
    ctx.restore();
    this.particles.render(ctx);
    this.texts.render(ctx);
    ctx.restore();
    this.drawHud();
  }

  private drawBackground(): void {
    const ctx = this.ctx;
    const th = this.theme;
    const g = ctx.createLinearGradient(0, 0, 0, this.H);
    g.addColorStop(0, th.sky[0]);
    g.addColorStop(1, th.sky[1]);
    ctx.fillStyle = g;
    ctx.fillRect(-10, -10, this.W + 20, this.H + 20);
    if (th.stars) {
      ctx.fillStyle = '#fff';
      for (let i = 0; i < 70; i++) {
        const x = ((((hash1(i) * 1200 - this.camX * 0.05) % 1200) + 1200) % 1200) - 120;
        const y = hash1(i + 99) * 300;
        ctx.globalAlpha = 0.4 + 0.6 * Math.abs(Math.sin(this.time * 2 + i));
        ctx.fillRect(x, y, 2, 2);
      }
      ctx.globalAlpha = 1;
    }
    // Far hills
    ctx.fillStyle = th.hillFar;
    for (let i = -1; i < 6; i++) {
      const span = 420;
      const off = -((this.camX * 0.2) % span);
      const x = off + i * span;
      const hgt = 120 + hash1(i + Math.floor((this.camX * 0.2) / span)) * 80;
      ctx.beginPath();
      ctx.ellipse(x + span / 2, 13 * T, span * 0.6, hgt, 0, Math.PI, 0);
      ctx.fill();
    }
    // Clouds
    for (let i = -1; i < 5; i++) {
      const span = 320;
      const base = Math.floor((this.camX * 0.35) / span);
      const x = -((this.camX * 0.35) % span) + i * span + hash1(base + i) * 120;
      const y = 50 + hash1(base + i + 7) * 120;
      this.cloud(x, y, 0.8 + hash1(base + i + 3) * 0.5);
    }
    // Near hills
    ctx.fillStyle = th.hill;
    for (let i = -1; i < 5; i++) {
      const span = 360;
      const base = Math.floor((this.camX * 0.5) / span);
      const x = -((this.camX * 0.5) % span) + i * span;
      const hgt = 60 + hash1(base + i + 50) * 70;
      ctx.beginPath();
      ctx.ellipse(x + span * 0.4, 13 * T, span * 0.35, hgt, 0, Math.PI, 0);
      ctx.fill();
    }
  }

  private cloud(x: number, y: number, s: number): void {
    const ctx = this.ctx;
    ctx.fillStyle = this.theme.stars ? 'rgba(200,210,255,0.25)' : 'rgba(255,255,255,0.92)';
    ctx.beginPath();
    ctx.arc(x, y, 22 * s, 0, TAU);
    ctx.moveTo(x + 26 * s + 28 * s, y - 12 * s);
    ctx.arc(x + 26 * s, y - 12 * s, 28 * s, 0, TAU);
    ctx.moveTo(x + 56 * s + 22 * s, y);
    ctx.arc(x + 56 * s, y, 22 * s, 0, TAU);
    ctx.rect(x, y, 56 * s, 22 * s);
    ctx.fill('nonzero');
  }

  private drawTiles(): void {
    const ctx = this.ctx;
    const c0 = Math.max(0, Math.floor(this.camX / T) - 1);
    const c1 = Math.min(this.level.cols - 1, Math.ceil((this.camX + this.W) / T) + 1);
    const th = this.theme;
    for (let row = 0; row < ROWS; row++) {
      for (let col = c0; col <= c1; col++) {
        const tile = this.tileAt(col, row);
        if (tile === Tile.Empty) continue;
        const idx = row * this.level.cols + col;
        const bump = this.bumps.get(idx);
        const x = col * T;
        const y = row * T - (bump ? Math.sin((1 - bump / 0.15) * Math.PI) * 10 : 0);
        switch (tile) {
          case Tile.Ground: {
            ctx.fillStyle = th.ground;
            ctx.fillRect(x, y, T, T);
            ctx.fillStyle = shade(th.ground, -0.18);
            for (let i = 0; i < 3; i++) {
              const hx = hash1(idx * 3 + i);
              const hy = hash1(idx * 5 + i);
              ctx.fillRect(x + hx * (T - 6), y + 8 + hy * (T - 14), 5, 4);
            }
            if (this.tileAt(col, row - 1) === Tile.Empty) {
              ctx.fillStyle = th.grass;
              ctx.fillRect(x, y, T, 9);
              ctx.fillStyle = shade(th.grass, -0.25);
              ctx.fillRect(x, y + 9, T, 3);
              ctx.fillStyle = th.grass;
              for (let i = 0; i < 4; i++) ctx.fillRect(x + i * 9 + 2, y + 9, 5, 4);
            }
            break;
          }
          case Tile.Brick:
            ctx.fillStyle = '#b5532a';
            ctx.fillRect(x, y, T, T);
            ctx.fillStyle = '#6e2c12';
            ctx.fillRect(x, y, T, 2);
            ctx.fillRect(x, y + T / 2 - 1, T, 2);
            ctx.fillRect(x + T / 2 - 1, y, 2, T / 2);
            ctx.fillRect(x + T / 4 - 1, y + T / 2, 2, T / 2);
            ctx.fillRect(x + (3 * T) / 4 - 1, y + T / 2, 2, T / 2);
            ctx.fillStyle = 'rgba(255,255,255,0.15)';
            ctx.fillRect(x, y + 2, T, 2);
            break;
          case Tile.Question: {
            const shimmer = 0.15 * Math.sin(this.time * 5);
            fillRoundRect(ctx, x + 1, y + 1, T - 2, T - 2, 4, shade('#f8b800', shimmer));
            ctx.strokeStyle = '#8a4a00';
            ctx.lineWidth = 2;
            ctx.strokeRect(x + 2, y + 2, T - 4, T - 4);
            ctx.fillStyle = '#8a4a00';
            for (const [dx, dy] of [
              [5, 5],
              [T - 8, 5],
              [5, T - 8],
              [T - 8, T - 8],
            ] as const)
              ctx.fillRect(x + dx, y + dy, 3, 3);
            text(ctx, '?', x + T / 2 + 1, y + T / 2 + 2, {
              size: 24,
              align: 'center',
              color: '#fff',
              stroke: '#8a4a00',
              strokeWidth: 3,
            });
            break;
          }
          case Tile.Used:
            fillRoundRect(ctx, x + 1, y + 1, T - 2, T - 2, 4, '#8a5a3c');
            ctx.fillStyle = '#5a3420';
            for (const [dx, dy] of [
              [5, 5],
              [T - 8, 5],
              [5, T - 8],
              [T - 8, T - 8],
            ] as const)
              ctx.fillRect(x + dx, y + dy, 3, 3);
            break;
          case Tile.Hard:
            ctx.fillStyle = '#9a8f86';
            ctx.fillRect(x, y, T, T);
            ctx.fillStyle = '#c8bfb6';
            ctx.fillRect(x, y, T, 4);
            ctx.fillRect(x, y, 4, T);
            ctx.fillStyle = '#5e554e';
            ctx.fillRect(x, y + T - 4, T, 4);
            ctx.fillRect(x + T - 4, y, 4, T);
            break;
          case Tile.PipeTL:
          case Tile.PipeTR:
          case Tile.PipeL:
          case Tile.PipeR: {
            const left = tile === Tile.PipeTL || tile === Tile.PipeL;
            const top = tile === Tile.PipeTL || tile === Tile.PipeTR;
            const lip = top ? 4 : 0;
            const px0 = left ? x + 3 - lip : x;
            const pw = left ? T - 3 + lip : T - 3 + lip;
            const grad = ctx.createLinearGradient(left ? x : x - T, 0, left ? x + 2 * T : x + T, 0);
            grad.addColorStop(0, '#2f8f3a');
            grad.addColorStop(0.3, '#7ee08a');
            grad.addColorStop(0.55, '#3cb043');
            grad.addColorStop(1, '#1d6b27');
            ctx.fillStyle = grad;
            ctx.fillRect(px0, y, pw, top ? T - 2 : T);
            ctx.fillStyle = '#145020';
            if (top) ctx.fillRect(px0, y + T - 4, pw, 2);
            if (left) ctx.fillRect(px0, y, 2, T);
            else ctx.fillRect(px0 + pw - 2, y, 2, T);
            break;
          }
        }
      }
    }
  }

  private drawCoins(): void {
    for (const c of this.level.coins) {
      if (c.taken || c.x < this.camX - T || c.x > this.camX + this.W + T) continue;
      drawCoin(this.ctx, c.x, c.y, 11, Math.cos(this.time * 4 + c.x * 0.02));
    }
    for (const c of this.popCoins) drawCoin(this.ctx, c.x, c.y, 11, Math.cos(this.time * 20));
  }

  private drawFlagAndCastle(): void {
    const ctx = this.ctx;
    const fx = this.level.flagX;
    const groundY = 13 * T;
    const topY = 4 * T;
    // Checkpoint marker
    const cp = this.level.checkpoint;
    ctx.fillStyle = '#ddd';
    ctx.fillRect(cp.x, cp.y - 70, 4, 70);
    ctx.fillStyle = this.checkpointReached ? '#4dd9ff' : '#888';
    ctx.beginPath();
    ctx.moveTo(cp.x + 4, cp.y - 70);
    ctx.lineTo(cp.x + 30, cp.y - 60);
    ctx.lineTo(cp.x + 4, cp.y - 50);
    ctx.fill();
    // Pole
    ctx.fillStyle = '#d8f3dc';
    ctx.fillRect(fx - 3, topY, 6, groundY - topY);
    ctx.fillStyle = '#2d6a4f';
    ctx.beginPath();
    ctx.arc(fx, topY - 6, 9, 0, TAU);
    ctx.fill();
    // Flag
    const fy = topY + 10 + this.flagY;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(fx - 3, fy);
    ctx.lineTo(fx - 48, fy + 18);
    ctx.lineTo(fx - 3, fy + 36);
    ctx.fill();
    ctx.fillStyle = '#e63946';
    ctx.beginPath();
    ctx.arc(fx - 18, fy + 18, 7, 0, TAU);
    ctx.fill();
    // Castle
    const cx = this.level.castleX - T;
    const cw = 5 * T;
    const ch = 4 * T;
    const cy = groundY - ch;
    ctx.fillStyle = '#9c4f2f';
    ctx.fillRect(cx, cy + T, cw, ch - T);
    ctx.fillRect(cx + T, cy - T, cw - 2 * T, 2 * T);
    ctx.fillStyle = '#7a3a20';
    for (let i = 0; i < 5; i++) ctx.fillRect(cx + i * T + 4, cy + T - 12, T - 10, 12);
    for (let i = 0; i < 3; i++) ctx.fillRect(cx + T + i * T + 4, cy - T - 12, T - 10, 12);
    ctx.fillStyle = '#1b1b2f';
    ctx.beginPath();
    ctx.moveTo(cx + cw / 2 - 20, groundY);
    ctx.lineTo(cx + cw / 2 - 20, groundY - 44);
    ctx.arc(cx + cw / 2, groundY - 44, 20, Math.PI, 0);
    ctx.lineTo(cx + cw / 2 + 20, groundY);
    ctx.fill();
    ctx.fillRect(cx + T + 14, cy - 4, 10, 18);
    ctx.fillRect(cx + 3 * T - 6, cy - 4, 10, 18);
  }

  private drawPlayer(): void {
    const p = this.player;
    if (this.phase === 'tally' || (this.phase === 'walkoff' && p.x > this.level.castleX + 4)) return;
    if (p.invuln > 0 && Math.floor(this.time * 16) % 2 === 0) return;
    const big = p.power > 0 ? 'big' : 'small';
    let pose: HeroPose = 'stand';
    if (p.dead || !p.onGround) pose = 'jump';
    else if (Math.abs(p.vx) > 10)
      pose = Math.floor(p.anim) % 3 === 0 ? 'walkA' : Math.floor(p.anim) % 3 === 1 ? 'walkB' : 'stand';
    const def = HERO[big][pose];
    const sw = 12 * PX;
    const sh = def.length * PX;
    const pal = p.power === 2 ? this.heroPal.fire : this.heroPal.normal;
    drawSprite(
      this.ctx,
      def,
      pal,
      Math.round(p.x + p.w / 2 - sw / 2),
      Math.round(p.y + p.h - sh),
      PX,
      p.facing < 0,
    );
  }

  private drawEnemies(): void {
    const ctx = this.ctx;
    for (const e of this.enemies) {
      if (e.x + e.w < this.camX - T || e.x > this.camX + this.W + T) continue;
      const frame = Math.floor(this.time * 6) % 2;
      const px = 2.4;
      const flip = e.vx > 0;
      ctx.save();
      if (e.state === 'dead') {
        ctx.translate(e.x + e.w / 2, e.y + e.h / 2);
        ctx.scale(1, -1);
        ctx.translate(-(e.x + e.w / 2), -(e.y + e.h / 2));
      }
      if (e.kind === 'walker') {
        const def = WALKER[frame] ?? WALKER[0]!;
        if (e.state === 'squished') {
          ctx.translate(0, e.y + e.h);
          ctx.scale(1, 0.4);
          ctx.translate(0, -(e.y + e.h));
        }
        drawSprite(ctx, def, WALKER_PAL, e.x + e.w / 2 - 6 * px, e.y + e.h - 12 * px, px, flip);
      } else if (e.kind === 'shellback') {
        if (e.state === 'shell' || e.state === 'shellMove') {
          drawSprite(ctx, SHELL, SHELL_PAL, e.x + e.w / 2 - 6 * px, e.y + e.h - SHELL.length * px, px);
        } else {
          const def = SHELLBACK[frame] ?? SHELLBACK[0]!;
          drawSprite(ctx, def, SHELL_PAL, e.x + e.w / 2 - 6 * px, e.y + e.h - 12 * px, px, !flip);
        }
      } else {
        const def = SPIKY[frame] ?? SPIKY[0]!;
        drawSprite(ctx, def, SPIKY_PAL, e.x + e.w / 2 - 6 * px, e.y + e.h - def.length * px, px, flip);
      }
      ctx.restore();
    }
  }

  private drawItems(): void {
    for (const it of this.items) {
      const def = it.kind === 'flower' ? FLOWER : MUSHROOM;
      const pal = it.kind === 'flower' ? FLOWER_PAL : it.kind === 'oneup' ? ONEUP_PAL : MUSHROOM_PAL;
      drawSprite(this.ctx, def, pal, it.x + it.w / 2 - 6 * 2.4, it.y + it.h - 12 * 2.4, 2.4);
    }
  }

  private drawFireballs(): void {
    for (const f of this.fireballs) {
      this.ctx.save();
      this.ctx.translate(f.x, f.y);
      this.ctx.rotate(this.time * 20);
      drawSprite(this.ctx, FIREBALL, FIRE_PAL, -7, -7, 2.4);
      this.ctx.restore();
    }
  }

  private drawDebris(): void {
    const ctx = this.ctx;
    for (const d of this.debris) {
      ctx.save();
      ctx.translate(d.x, d.y);
      ctx.rotate(d.rot);
      ctx.fillStyle = '#b5532a';
      ctx.fillRect(-8, -8, 16, 16);
      ctx.fillStyle = '#6e2c12';
      ctx.fillRect(-8, -1, 16, 2);
      ctx.restore();
    }
  }

  private drawHud(): void {
    const ctx = this.ctx;
    hudPill(ctx, 12, 12, 210, 40);
    text(ctx, `${Math.floor(this.score).toString().padStart(7, '0')}`, 30, 33, { size: 22 });
    hudPill(ctx, 232, 12, 110, 40);
    drawCoin(ctx, 254, 32, 11);
    text(ctx, `× ${this.coins}`, 272, 33, { size: 20 });
    hudPill(ctx, 352, 12, 170, 40);
    text(ctx, `WORLD 1-${this.levelNum}`, 437, 33, { size: 18, align: 'center' });
    hudPill(ctx, this.W - 262, 12, 130, 40);
    const low = this.timeLeft < 30 && this.phase === 'play';
    text(ctx, `⏱ ${Math.ceil(this.timeLeft)}`, this.W - 197, 33, {
      size: 20,
      align: 'center',
      color: low ? '#ff6b6b' : '#fff',
    });
    hudPill(ctx, this.W - 122, 12, 110, 40);
    this.heart(this.W - 98, 32, 10);
    text(ctx, `× ${Math.max(0, this.lives)}`, this.W - 80, 33, { size: 20 });
    if (this.bannerT < 2.4 && this.phase === 'play') {
      banner(ctx, this.W, this.H, `WORLD 1-${this.levelNum}`, this.theme.name, this.bannerT / 2.4, '#ffd23f');
    }
    if (this.phase === 'tally' && this.timeLeft <= 0) {
      banner(
        ctx,
        this.W,
        this.H,
        'COURSE CLEAR!',
        `Next: World 1-${this.levelNum + 1}`,
        clamp(this.phaseT / 2.6, 0, 1),
        '#7CFC00',
      );
    }
    if (this.phase === 'dying' && this.lives <= 0 && this.phaseT > 1) {
      banner(ctx, this.W, this.H, 'GAME OVER', '', 0.5, '#ff6b6b');
    }
  }

  private heart(x: number, y: number, r: number): void {
    const ctx = this.ctx;
    ctx.fillStyle = '#ff4d6d';
    ctx.beginPath();
    ctx.moveTo(x, y + r);
    ctx.bezierCurveTo(x - r * 1.6, y - r * 0.2, x - r * 0.6, y - r * 1.4, x, y - r * 0.4);
    ctx.bezierCurveTo(x + r * 0.6, y - r * 1.4, x + r * 1.6, y - r * 0.2, x, y + r);
    ctx.fill();
  }
}

const WALKER_PAL: SpritePalette = { A: '#a0522d', W: '#ffffff', K: '#1b1b1b', T: '#f3d2a2', D: '#3b2314' };
const SHELL_PAL: SpritePalette = {
  H: '#f2c14e',
  W: '#ffffff',
  K: '#1b1b1b',
  G: '#2a9d4b',
  g: '#7ee08a',
  Y: '#fff1c1',
};
const SPIKY_PAL: SpritePalette = { R: '#d62828', r: '#ff7b7b', W: '#f1f1f1', K: '#1b1b1b', H: '#f4a261' };
const MUSHROOM_PAL: SpritePalette = { R: '#e63946', W: '#ffffff', S: '#f3e5c8', K: '#1b1b1b' };
const ONEUP_PAL: SpritePalette = { R: '#2a9d4b', W: '#ffffff', S: '#f3e5c8', K: '#1b1b1b' };
const FLOWER_PAL: SpritePalette = { O: '#e63946', Y: '#ffb703', W: '#fff8e1', G: '#2a9d4b' };
const FIRE_PAL: SpritePalette = { Y: '#ffd166', O: '#fb8500', R: '#e63946' };
