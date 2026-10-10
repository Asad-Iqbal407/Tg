import { clamp, damp, rectsOverlap, TAU } from '../../core/math';
import { BaseGame } from '../base';
import { banner, drawCoin, fillRoundRect, hash1, hudPill, shade, text } from '../draw';
import { drawSprite, type SpritePalette } from '../sprite';
import type { GameServices } from '../types';
import {
  buildLevel,
  CHUNK_TOP_ROW,
  GROUND_ROW,
  ROWS,
  T,
  Tile,
  type EnemyKind,
  type LevelData,
  type Spawn,
  type TileId,
} from './level';
import { FIREBALL, FLOWER, HERO, MUSHROOM, SHELL, SHELLBACK, SPIKY, WALKER, type HeroPose } from './sprites';
import { themeFor, type Theme } from './themes';
import { ENEMY_SPEED, enemySpeedScale, HURRY_TIME, levelTimeLimit, PHYS, worldLabel } from './tuning';

const PX = 2.25;
const STOMP_POINTS = [100, 200, 400, 500, 800, 1000, 2000, 4000, 5000, 8000];
/** The hero lands on an enemy when its feet were at most this far below the enemy's top last step. */
const STOMP_TOLERANCE = 10;
/** Score per second left on the clock at the end of a course. */
const TIME_BONUS = 100;
const SHELL_KICK_POINTS = 400;
const RESPAWN_INVULN = 1.2;
const BANNER_TIME = 2;
const HUD_PAD = 12;
const HUD_H = 40;
/** Strip of floor (px) kept visible above touch controls covering the bottom of the canvas. */
const FLOOR_STRIP = 24;

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
  /** Just bounced off an enemy: overlaps from above keep counting as stomps for a moment. */
  stompGrace: number;
}

interface Enemy extends Box {
  kind: EnemyKind;
  state: 'walk' | 'shell' | 'shellMove' | 'squished' | 'dead';
  timer: number;
  active: boolean;
  dir: number;
  chain: number;
  /** Harmless (and can't be re-kicked) while > 0: right after a stomp or a kick. */
  kickGrace: number;
  /** Turns around at ledges. */
  patrol: boolean;
  /** Walking speed for this course. */
  speed: number;
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

/** Drop the entries `keep` rejects, in place (no per-frame array allocation). */
function prune<V>(list: V[], keep: (v: V) => boolean): void {
  let n = 0;
  for (const v of list) if (keep(v)) list[n++] = v;
  list.length = n;
}

const alive = (v: { life: number }): boolean => v.life > 0;
const itemInWorld = (it: Item): boolean => it.y < ROWS * T + 100;
const debrisInWorld = (d: Debris): boolean => d.y < ROWS * T + 50;
const enemyLingers = (e: Enemy): boolean =>
  !(e.state === 'dead' && e.y > ROWS * T + 80) && !(e.state === 'squished' && e.timer <= 0);

export class PlatformerGame extends BaseGame {
  private readonly seed: number;
  private readonly preview: boolean;
  private levelNum = 1;
  private level!: LevelData;
  private theme!: Theme;
  private phase: Phase = 'play';
  private phaseT = 0;
  private lives: number;
  private timeLeft = 0;
  private hurried = false;
  private hurryT = 99;
  /** Camera: world x/y of the top-left of the view. camY is presentation only. */
  private camX = 0;
  private camY = 0;
  private checkpointReached = false;
  private coinCounter = 0;
  private flagY = 0;
  private castleFlag = 0;
  private fireworks = 0;
  private fireworkAt = 0;
  private bannerT = 0;
  private showBanner = true;
  /** After a fresh course or a respawn, enemies stand still until the hero first moves or jumps. */
  private enemiesWaiting = true;
  private pitDeath = false;
  private readonly bumps = new Map<number, number>();
  private player!: Player;
  private enemies: Enemy[] = [];
  private items: Item[] = [];
  private fireballs: Fireball[] = [];
  private popCoins: PopCoin[] = [];
  private debris: Debris[] = [];
  private readonly heroPal: Record<'normal' | 'fire', SpritePalette>;
  // Render-only state: device pixels per logical px, and fills cached per theme.
  private rsX = 1;
  private rsY = 1;
  private sky: { theme: Theme; fill: CanvasGradient } | null = null;
  private pipeFill: CanvasGradient | null = null;
  private tones = { groundDark: '', grassDark: '' };

  constructor(s: GameServices) {
    super(s);
    this.preview = s.preview === true;
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

  /** Build the current course. `fresh` starts it from the beginning; otherwise this is a respawn. */
  private loadLevel(fresh: boolean): void {
    this.level = buildLevel(this.levelNum, this.seed);
    this.theme = themeFor(this.levelNum);
    this.tones = { groundDark: shade(this.theme.ground, -0.18), grassDark: shade(this.theme.grass, -0.25) };
    this.bumps.clear();
    this.items = [];
    this.fireballs = [];
    this.popCoins = [];
    this.debris = [];
    const speed = enemySpeedScale(this.levelNum);
    this.enemies = this.level.spawns.map((sp) => this.makeEnemy(sp, speed));
    const atCheckpoint = !fresh && this.checkpointReached;
    const cp = this.level.checkpoint;
    const prevPower = this.player?.power ?? 0;
    const w = 22;
    const h = 32;
    this.player = {
      x: atCheckpoint ? cp.x - w / 2 : this.level.start.x,
      y: (atCheckpoint ? cp.y : this.level.start.y) - h,
      w,
      h,
      vx: 0,
      vy: 0,
      onGround: false,
      power: fresh ? prevPower : 0,
      facing: 1,
      invuln: fresh ? 0 : RESPAWN_INVULN,
      coyote: 0,
      jumpBuf: 0,
      jumping: false,
      anim: 0,
      dead: false,
      combo: 0,
      fireCooldown: 0,
      stompGrace: 0,
    };
    this.syncPlayerSize();
    this.timeLeft = levelTimeLimit(this.level.cols * T, this.levelNum);
    this.hurried = false;
    this.hurryT = 99;
    this.phase = 'play';
    this.phaseT = 0;
    this.flagY = 0;
    this.castleFlag = 0;
    this.fireworks = 0;
    this.fireworkAt = 0;
    this.bannerT = 0;
    this.showBanner = fresh;
    this.enemiesWaiting = true;
    this.pitDeath = false;
    this.camX = this.cameraTargetX();
    this.camY = this.cameraTargetY();
  }

  private makeEnemy(sp: Spawn, speedScale: number): Enemy {
    const h = sp.kind === 'walker' ? 26 : sp.kind === 'shellback' ? 28 : 24;
    return {
      kind: sp.kind,
      x: sp.x - 13,
      y: sp.y - h,
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
      patrol: sp.patrol,
      speed: ENEMY_SPEED[sp.kind] * speedScale,
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

  /** Centre x of the castle door the hero walks into. */
  private get doorX(): number {
    return this.level.castleX + 1.5 * T;
  }

  // ------------------------------------------------------------------ camera

  private cameraTargetX(): number {
    // Narrow views keep the hero a little further left, so ~1.5 s of run-speed lookahead stays visible.
    const anchor = clamp(0.4 - (1000 - this.W) * 0.0003, 0.33, 0.4);
    const maxX = Math.max(0, this.level.cols * T - this.W);
    return clamp(this.player.x + this.player.w / 2 - this.W * anchor, 0, maxX);
  }

  /**
   * Vertical framing (presentation only). The level is exactly as tall as the default view; when touch
   * controls cover the bottom of the canvas, the view shifts down into the unused sky rows so the
   * hero's row and a strip of floor stay above them. It also follows the hero above the HUD.
   */
  private cameraTargetY(): number {
    const worldTop = ROWS * T - this.H;
    const hudBottom = this.insets.top + HUD_PAD + HUD_H;
    const need = GROUND_ROW * T + FLOOR_STRIP - (this.H - this.insets.bottom);
    const maxShift = Math.max(worldTop, (CHUNK_TOP_ROW + 1) * T - hudBottom - 8);
    let y = clamp(need, worldTop, maxShift);
    const p = this.player;
    if ((this.phase === 'play' || this.phase === 'flag') && !p.dead) y = Math.min(y, p.y - hudBottom - 4);
    return y;
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

  /**
   * Move along y; returns the column of a ceiling hit (for block bumps), -1 for floor, null otherwise.
   * With `nudge` > 0, a rising box that only clips a ceiling corner by that many px or less slides
   * past it instead of bonking (corner correction, used for the hero).
   */
  private moveY(b: Box, dy: number, nudge = 0): number | null {
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
        if (nudge > 0 && this.slipCorner(b, row, c0, c1, nudge)) return null;
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

  /** Corner correction: shift `b` sideways off a ceiling tile it overlaps by at most `max` px. */
  private slipCorner(b: Box, row: number, c0: number, c1: number, max: number): boolean {
    if (c0 === c1) return false;
    const leftHit = this.solid(c0, row);
    const rightHit = this.solid(c1, row);
    if (leftHit === rightHit) return false;
    const x = leftHit ? (c0 + 1) * T : c1 * T - b.w;
    if (Math.abs(x - b.x) > max) return false;
    // The spot it slides into must be free for the hero's full height.
    const col = leftHit ? c1 : c0;
    const r1 = Math.floor((b.y + b.h - 0.01) / T);
    for (let r = row; r <= r1; r++) if (this.solid(col, r)) return false;
    b.x = x;
    return true;
  }

  // ------------------------------------------------------------------ update

  protected tick(dt: number): void {
    this.phaseT += dt;
    this.bannerT += dt;
    this.hurryT += dt;
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
    this.camX += (this.cameraTargetX() - this.camX) * damp(10, dt);
    this.camY += (this.cameraTargetY() - this.camY) * damp(6, dt);
  }

  private updatePlay(dt: number): void {
    const p = this.player;
    this.timeLeft -= dt;
    if (!this.hurried && this.timeLeft <= HURRY_TIME) {
      this.hurried = true;
      this.hurryT = 0;
      this.audio.play('warning');
    }
    if (this.timeLeft <= 0) {
      this.timeLeft = 0;
      this.die();
      return;
    }
    p.invuln = Math.max(0, p.invuln - dt);
    p.fireCooldown = Math.max(0, p.fireCooldown - dt);
    p.stompGrace = Math.max(0, p.stompGrace - dt);

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
    const jumpPressed = this.input.wasPressed('primary') || this.input.wasPressed('up');
    p.coyote = p.onGround ? PHYS.coyote : Math.max(0, p.coyote - dt);
    p.jumpBuf = jumpPressed ? PHYS.buffer : Math.max(0, p.jumpBuf - dt);
    if (ax !== 0 || jumpPressed) this.enemiesWaiting = false;
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
    // Variable height: letting go caps the rise, so a tap is a short hop.
    if (p.jumping && !holding && p.vy < -PHYS.jumpCutV) p.vy = -PHYS.jumpCutV;
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
    const descending = p.vy > 0;
    this.moveX(p, p.vx * dt);
    if (p.x < 0) {
      p.x = 0;
      p.vx = 0;
    }
    const wasAir = !p.onGround;
    const hit = this.moveY(p, p.vy * dt, PHYS.cornerNudge);
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

    const cp = this.level.checkpoint;
    if (!this.checkpointReached && p.x + p.w / 2 >= cp.x) {
      this.checkpointReached = true;
      this.audio.play('select');
      this.texts.add(cp.x, cp.y - 3 * T, 'CHECKPOINT', '#7cf', 22);
    }

    this.collectCoins();
    this.updateItems(dt);
    this.updateEnemies(dt, prevBottom, descending);
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
    this.particles.emit({ x, y, count: 6, speed: 120, life: 0.35, size: 3, colors: ['#ffe066', '#fff'] });
    if (this.coinCounter >= 100) {
      this.coinCounter -= 100;
      this.gainLife(x, y);
    }
  }

  private gainLife(x: number, y: number): void {
    this.lives++;
    this.audio.play('levelup');
    this.texts.add(x, y - 20, '1UP', '#5f5', 26);
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
        // Debris is cosmetic: it draws from the effects RNG, never the gameplay one.
        for (let i = 0; i < 4; i++) {
          this.debris.push({
            x: col * T + (i % 2) * 18 + 9,
            y: row * T + Math.floor(i / 2) * 18 + 9,
            vx: (i % 2 === 0 ? -1 : 1) * this.fxRng.range(80, 160),
            vy: -this.fxRng.range(380, 560) + Math.floor(i / 2) * 120,
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
    prune(this.popCoins, alive);
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
          this.gainLife(p.x + p.w / 2, p.y);
        } else {
          this.score += 1000;
          this.addStat('powerups');
          this.audio.play('powerup');
          this.texts.add(p.x + p.w / 2, p.y - 10, '1000', '#fff', 20);
          if (it.kind === 'mushroom') p.power = Math.max(p.power, 1) as 1 | 2;
          else p.power = 2;
          this.syncPlayerSize();
        }
      }
    }
    prune(this.items, itemInWorld);
  }

  /** True when a walking enemy's next step would take it off a ledge. */
  private ledgeAhead(e: Enemy): boolean {
    if (e.vx === 0) return false;
    const footX = e.vx > 0 ? e.x + e.w + 1 : e.x - 1;
    return !this.solid(Math.floor(footX / T), Math.floor((e.y + e.h + 1) / T));
  }

  /**
   * `prevBottom` is the hero's feet before this step's move and `descending` whether that move was
   * downward; both are captured before any stomp bounces the hero, and the hero is only lifted onto
   * the stomped enemies after the loop, so landing on two enemies at once squashes both.
   */
  private updateEnemies(dt: number, prevBottom: number, descending: boolean): void {
    const p = this.player;
    const viewL = this.camX - 3 * T;
    const viewR = this.camX + this.W + 3 * T;
    let landTop = Infinity;
    for (const e of this.enemies) {
      if (!e.active) {
        if (this.enemiesWaiting || e.x >= viewR || e.x + e.w <= viewL) continue;
        e.active = true;
        e.vx = e.dir * e.speed;
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
      if (e.state === 'walk' && e.patrol && e.onGround && this.ledgeAhead(e)) e.vx = -e.vx;
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

      if (p.dead || this.phase !== 'play' || !rectsOverlap(p, e)) continue;
      const fromAbove = prevBottom <= e.y + STOMP_TOLERANCE;
      if ((descending || p.stompGrace > 0) && fromAbove && e.kind !== 'spiky') {
        landTop = Math.min(landTop, e.y);
        this.stomp(e);
      } else if (e.kickGrace > 0) {
        // Just stomped or kicked: harmless, and not kicked again by the same contact.
      } else if (e.state === 'shell') {
        this.kickShell(e, p.x + p.w / 2 < e.x + e.w / 2 ? 1 : -1);
      } else {
        this.hurt();
      }
    }
    // Sit the hero on top of what it stomped, so the bounce starts clear of the enemies.
    if (landTop < Infinity) p.y = Math.min(p.y, landTop - p.h);
    prune(this.enemies, enemyLingers);
  }

  private stomp(e: Enemy): void {
    const p = this.player;
    p.vy = this.input.isDown('primary') || this.input.isDown('up') ? -720 : -460;
    p.jumping = true;
    p.stompGrace = PHYS.stompGrace;
    this.addStat('stomps');
    this.services.haptic(20);
    if (e.kind === 'shellback' && e.state === 'shell') {
      // Landing on a resting shell kicks it away from the side the hero came down on.
      const side = p.x + p.w / 2 - (e.x + e.w / 2);
      this.kickShell(e, side === 0 ? p.facing : side < 0 ? 1 : -1);
      return;
    }
    const pts = STOMP_POINTS[Math.min(p.combo, STOMP_POINTS.length - 1)] ?? 100;
    p.combo++;
    if (p.combo > STOMP_POINTS.length) this.gainLife(e.x + e.w / 2, e.y);
    else {
      this.score += pts;
      this.texts.add(e.x + e.w / 2, e.y - 6, `${pts}`, '#fff', 18);
    }
    this.audio.play('stomp', { pitch: 1 + Math.min(p.combo, 6) * 0.06 });
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
      // A walking shellback retreats into its shell; a sliding shell stops.
      e.state = 'shell';
      e.vx = 0;
      e.kickGrace = 0.2;
    }
  }

  private kickShell(e: Enemy, dir: number): void {
    e.state = 'shellMove';
    e.vx = dir * ENEMY_SPEED.shell * enemySpeedScale(this.levelNum, true);
    e.kickGrace = 0.25;
    e.chain = 0;
    this.score += SHELL_KICK_POINTS;
    this.texts.add(e.x + e.w / 2, e.y - 6, `${SHELL_KICK_POINTS}`, '#fff', 18);
    this.audio.play('stomp', { pitch: 0.8 });
  }

  private killEnemy(e: Enemy, points: number, dir: number): void {
    if (e.state === 'dead') return;
    e.state = 'dead';
    e.vy = -380;
    e.vx = dir * 80;
    this.score += points;
    this.addStat('enemies');
    this.audio.play('stomp', { pitch: 1.3 });
    this.texts.add(e.x + e.w / 2, e.y - 6, `${points}`, '#fff', 18);
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
    // Falling out of the level is its own death: no hop back up over the pit.
    this.pitDeath = p.y + p.h > ROWS * T;
    p.dead = true;
    p.vy = this.pitDeath ? 0 : -720;
    p.vx = 0;
    p.power = 0;
    this.syncPlayerSize();
    this.phase = 'dying';
    this.phaseT = 0;
    this.lives--;
    this.addStat('deaths');
    this.audio.play('hit');
    this.shake.add(this.pitDeath ? 0.2 : 0.5);
    this.services.haptic(150);
  }

  private updateDying(dt: number): void {
    const p = this.player;
    if (!this.pitDeath && this.phaseT > 0.4) {
      p.vy += PHYS.gFall * 0.6 * dt;
      p.y += p.vy * dt;
    }
    this.updateDebris(dt);
    if (this.phaseT > (this.pitDeath ? 1.6 : 2.4)) {
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
    const groundY = GROUND_ROW * T;
    const poleTop = CHUNK_TOP_ROW * T;
    const t = clamp((groundY - (p.y + p.h)) / (groundY - poleTop), 0, 1);
    const pts = t > 0.85 ? 5000 : t > 0.6 ? 2000 : t > 0.35 ? 800 : t > 0.15 ? 400 : 100;
    this.score += pts;
    this.fireworks = pts >= 5000 ? 3 : pts >= 2000 ? 2 : 1;
    this.fireworkAt = 0.25;
    this.texts.add(this.level.flagX + 30, p.y, `${pts}`, '#ffd23f', 24);
    this.audio.play('win');
  }

  private updateFlag(dt: number): void {
    const p = this.player;
    const groundY = GROUND_ROW * T;
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
    if (p.x + p.w / 2 >= this.doorX) {
      this.phase = 'tally';
      this.phaseT = 0;
    }
  }

  private updateTally(dt: number): void {
    this.castleFlag = Math.min(1, this.castleFlag + dt * 1.5);
    if (this.timeLeft > 0) {
      const step = Math.min(this.timeLeft, 90 * dt);
      this.timeLeft -= step;
      this.score += step * TIME_BONUS;
      if (Math.floor(this.phaseT * 20) % 2 === 0) this.audio.play('click', { volume: 0.3 });
      // Restart the phase clock once counted down: the clear banner and fireworks follow.
      if (this.timeLeft <= 0) this.phaseT = 0;
      return;
    }
    if (this.fireworks > 0 && this.phaseT >= this.fireworkAt) {
      this.launchFirework(this.fireworks--);
      this.fireworkAt += 0.45;
    }
    if (this.phaseT > 2.6) {
      this.addStat('levels');
      this.levelNum++;
      this.maxStat('world', this.levelNum - 1);
      this.checkpointReached = false;
      this.loadLevel(true);
    }
  }

  /** A cosmetic burst over the castle; `i` (3, 2, 1) spreads them out. */
  private launchFirework(i: number): void {
    const x = this.doorX + (i - 2) * 2.2 * T;
    const y = (2 + (i % 2)) * T + 10;
    const colors = [
      ['#ffd23f', '#fff'],
      ['#ff6b6b', '#ffd6e0'],
      ['#7cf', '#fff'],
    ][i % 3] as string[];
    this.particles.emit({ x, y, count: 28, speed: 260, life: 0.9, size: 3, colors, gravity: 220, drag: 1.2 });
    this.audio.play('pop', { pitch: 0.6 + i * 0.15, volume: 0.8 });
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
          x: f.x,
          y: f.y,
          count: 8,
          speed: 140,
          life: 0.3,
          size: 3,
          colors: ['#ffb703', '#fb5607'],
        });
    }
    prune(this.fireballs, alive);
  }

  private updateDebris(dt: number): void {
    for (const d of this.debris) {
      d.vy += 2000 * dt;
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      d.rot += dt * 12;
    }
    prune(this.debris, debrisInWorld);
  }

  // ------------------------------------------------------------------ render

  render(): void {
    const ctx = this.ctx;
    const m = typeof ctx.getTransform === 'function' ? ctx.getTransform() : undefined;
    this.rsX = m && m.a > 0 ? m.a : 1;
    this.rsY = m && m.d > 0 ? m.d : 1;
    ctx.save();
    ctx.translate(this.snapX(this.shake.x), this.snapY(this.shake.y));
    this.drawBackground();
    ctx.save();
    // Whole device pixels, so tile edges land on pixel boundaries at any scale.
    ctx.translate(-this.snapX(this.camX), -this.snapY(this.camY));
    this.drawFlagAndCastle();
    this.drawItems();
    this.drawTiles();
    this.drawCoins();
    this.drawEnemies();
    this.drawFireballs();
    this.drawDebris();
    this.drawPlayer();
    this.particles.render(ctx);
    this.texts.render(ctx);
    ctx.restore();
    ctx.restore();
    if (!this.preview) this.drawHud();
  }

  private snapX(v: number): number {
    return Math.round(v * this.rsX) / this.rsX;
  }

  private snapY(v: number): number {
    return Math.round(v * this.rsY) / this.rsY;
  }

  /** fillRect with every edge on a device pixel, so neighbouring tiles share edges exactly (no seams). */
  private rect(x: number, y: number, w: number, h: number): void {
    const x0 = this.snapX(x);
    const y0 = this.snapY(y);
    this.ctx.fillRect(x0, y0, this.snapX(x + w) - x0, this.snapY(y + h) - y0);
  }

  private skyFill(): CanvasGradient {
    const th = this.theme;
    if (this.sky?.theme !== th) {
      const g = this.ctx.createLinearGradient(0, 0, 0, this.H);
      g.addColorStop(0, th.sky[0]);
      g.addColorStop(1, th.sky[1]);
      this.sky = { theme: th, fill: g };
    }
    return this.sky.fill;
  }

  private drawBackground(): void {
    const ctx = this.ctx;
    const th = this.theme;
    ctx.fillStyle = this.skyFill();
    ctx.fillRect(-20, -20, this.W + 40, this.H + 40);
    // Hills stand on the horizon, so they move vertically with the world.
    const horizon = GROUND_ROW * T - this.camY;
    if (th.stars) this.drawStars();
    this.drawHills(th.hillFar, 420, 0.2, horizon, 120, 80, 0.6, 0.5, 0);
    if (th.cave) this.drawStalactites();
    else this.drawClouds();
    this.drawHills(th.hill, 360, 0.5, horizon, 60, 70, 0.35, 0.4, 50);
  }

  private drawStars(): void {
    const ctx = this.ctx;
    const period = this.W + 240;
    const count = Math.round(period / 17);
    ctx.fillStyle = '#fff';
    for (let i = 0; i < count; i++) {
      const x = ((((hash1(i) * period - this.camX * 0.05) % period) + period) % period) - 120;
      const y = hash1(i + 99) * 300 - this.camY * 0.3;
      ctx.globalAlpha = 0.4 + 0.6 * Math.abs(Math.sin(this.time * 2 + i));
      ctx.fillRect(x, y, 2, 2);
    }
    ctx.globalAlpha = 1;
  }

  /** A parallax row of half-ellipse hills covering the whole view width. */
  private drawHills(
    color: string,
    span: number,
    parallax: number,
    baseline: number,
    minH: number,
    varH: number,
    rx: number,
    cx: number,
    salt: number,
  ): void {
    const ctx = this.ctx;
    const scroll = this.camX * parallax;
    const base = Math.floor(scroll / span);
    const off = base * span - scroll;
    const n = Math.ceil(this.W / span) + 2;
    ctx.fillStyle = color;
    ctx.beginPath();
    for (let i = -1; i < n; i++) {
      const x = off + i * span + span * cx;
      ctx.moveTo(x - span * rx, baseline);
      ctx.ellipse(x, baseline, span * rx, minH + hash1(base + i + salt) * varH, 0, Math.PI, 0);
    }
    ctx.fill();
  }

  private drawClouds(): void {
    const span = 320;
    const scroll = this.camX * 0.35;
    const base = Math.floor(scroll / span);
    const off = base * span - scroll;
    const n = Math.ceil(this.W / span) + 2;
    this.ctx.fillStyle = this.theme.stars ? 'rgba(200,210,255,0.25)' : 'rgba(255,255,255,0.92)';
    for (let i = -1; i < n; i++) {
      const x = off + i * span + hash1(base + i) * 120;
      const y = 50 + hash1(base + i + 7) * 120 - this.camY * 0.3;
      this.cloud(x, y, 0.8 + hash1(base + i + 3) * 0.5);
    }
  }

  private cloud(x: number, y: number, s: number): void {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.arc(x, y, 22 * s, 0, TAU);
    ctx.moveTo(x + 26 * s + 28 * s, y - 12 * s);
    ctx.arc(x + 26 * s, y - 12 * s, 28 * s, 0, TAU);
    ctx.moveTo(x + 56 * s + 22 * s, y);
    ctx.arc(x + 56 * s, y, 22 * s, 0, TAU);
    ctx.rect(x, y, 56 * s, 22 * s);
    ctx.fill('nonzero');
  }

  /** Underground: a rocky ceiling with stalactites and glinting crystals, in place of clouds. */
  private drawStalactites(): void {
    const ctx = this.ctx;
    const span = 150;
    const scroll = this.camX * 0.35;
    const base = Math.floor(scroll / span);
    const off = base * span - scroll;
    const n = Math.ceil(this.W / span) + 2;
    const top = 14 - this.camY * 0.3;
    ctx.fillStyle = this.theme.hillFar;
    ctx.fillRect(-20, -20, this.W + 40, top + 20);
    ctx.beginPath();
    for (let i = -1; i < n; i++) {
      const x = off + i * span + hash1(base + i + 11) * 60;
      const half = 14 + hash1(base + i + 13) * 16;
      const len = 30 + hash1(base + i + 17) * 110;
      ctx.moveTo(x - half, top - 1);
      ctx.lineTo(x + half, top - 1);
      ctx.lineTo(x + half * 0.2, top + len);
      ctx.closePath();
    }
    ctx.fill();
    ctx.fillStyle = this.theme.grass;
    for (let i = -1; i < n; i++) {
      const x = off + i * span + hash1(base + i + 11) * 60;
      const len = 30 + hash1(base + i + 17) * 110;
      ctx.globalAlpha = 0.35 + 0.5 * Math.abs(Math.sin(this.time * 1.7 + i * 1.3));
      ctx.fillRect(x - 1, top + len - 14, 3, 5);
    }
    ctx.globalAlpha = 1;
  }

  private drawTiles(): void {
    const ctx = this.ctx;
    const c0 = Math.max(0, Math.floor(this.camX / T) - 1);
    const c1 = Math.min(this.level.cols - 1, Math.ceil((this.camX + this.W) / T) + 1);
    const r0 = clamp(Math.floor(this.camY / T) - 1, 0, ROWS - 1);
    const r1 = clamp(Math.ceil((this.camY + this.H) / T), 0, ROWS - 1);
    // When the view reaches below the level (touch framing), the bottom ground row extends down.
    const floorEnd = Math.max(ROWS * T, this.camY + this.H + 20);
    const th = this.theme;
    for (let row = r0; row <= r1; row++) {
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
            this.rect(x, y, T, (row === ROWS - 1 ? floorEnd : y + T) - y);
            ctx.fillStyle = this.tones.groundDark;
            for (let i = 0; i < 3; i++) {
              const hx = hash1(idx * 3 + i);
              const hy = hash1(idx * 5 + i);
              ctx.fillRect(x + hx * (T - 6), y + 8 + hy * (T - 14), 5, 4);
            }
            if (this.tileAt(col, row - 1) === Tile.Empty) {
              ctx.fillStyle = th.grass;
              this.rect(x, y, T, 9);
              ctx.fillStyle = this.tones.grassDark;
              this.rect(x, y + 9, T, 3);
              ctx.fillStyle = th.grass;
              for (let i = 0; i < 4; i++) ctx.fillRect(x + i * 9 + 2, y + 9, 5, 4);
            }
            break;
          }
          case Tile.Brick:
            ctx.fillStyle = '#b5532a';
            this.rect(x, y, T, T);
            ctx.fillStyle = '#6e2c12';
            this.rect(x, y, T, 2);
            this.rect(x, y + T / 2 - 1, T, 2);
            this.rect(x + T / 2 - 1, y, 2, T / 2);
            this.rect(x + T / 4 - 1, y + T / 2, 2, T / 2);
            this.rect(x + (3 * T) / 4 - 1, y + T / 2, 2, T / 2);
            ctx.fillStyle = 'rgba(255,255,255,0.15)';
            this.rect(x, y + 2, T, 2);
            break;
          case Tile.Question: {
            const shimmer = 0.15 * Math.sin(this.time * 5);
            fillRoundRect(ctx, x + 1, y + 1, T - 2, T - 2, 4, shade('#f8b800', shimmer));
            ctx.strokeStyle = '#8a4a00';
            ctx.lineWidth = 2;
            ctx.strokeRect(x + 2, y + 2, T - 4, T - 4);
            this.rivets(x, y, '#8a4a00');
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
            this.rivets(x, y, '#5a3420');
            break;
          case Tile.Hard:
            ctx.fillStyle = '#9a8f86';
            this.rect(x, y, T, T);
            ctx.fillStyle = '#c8bfb6';
            this.rect(x, y, T, 4);
            this.rect(x, y, 4, T);
            ctx.fillStyle = '#5e554e';
            this.rect(x, y + T - 4, T, 4);
            this.rect(x + T - 4, y, 4, T);
            break;
          case Tile.PipeTL:
          case Tile.PipeTR:
          case Tile.PipeL:
          case Tile.PipeR:
            this.drawPipeTile(tile, x, y);
            break;
        }
      }
    }
  }

  private rivets(x: number, y: number, color: string): void {
    const ctx = this.ctx;
    ctx.fillStyle = color;
    ctx.fillRect(x + 5, y + 5, 3, 3);
    ctx.fillRect(x + T - 8, y + 5, 3, 3);
    ctx.fillRect(x + 5, y + T - 8, 3, 3);
    ctx.fillRect(x + T - 8, y + T - 8, 3, 3);
  }

  private drawPipeTile(tile: TileId, x: number, y: number): void {
    const ctx = this.ctx;
    const left = tile === Tile.PipeTL || tile === Tile.PipeL;
    const top = tile === Tile.PipeTL || tile === Tile.PipeTR;
    const lip = top ? 4 : 0;
    const px0 = left ? x + 3 - lip : x;
    const pw = T - 3 + lip;
    const h = top ? T - 2 : T;
    // One gradient spans the whole pipe (two tiles); it is built once in pipe-local coordinates.
    const pipeX = left ? x : x - T;
    if (!this.pipeFill) {
      const g = ctx.createLinearGradient(0, 0, 2 * T, 0);
      g.addColorStop(0, '#2f8f3a');
      g.addColorStop(0.3, '#7ee08a');
      g.addColorStop(0.55, '#3cb043');
      g.addColorStop(1, '#1d6b27');
      this.pipeFill = g;
    }
    const xa = this.snapX(px0);
    const xb = this.snapX(px0 + pw);
    const ya = this.snapY(y);
    ctx.save();
    ctx.translate(pipeX, 0);
    ctx.fillStyle = this.pipeFill;
    ctx.fillRect(xa - pipeX, ya, xb - xa, this.snapY(y + h) - ya);
    ctx.restore();
    ctx.fillStyle = '#145020';
    if (top) this.rect(px0, y + T - 4, pw, 2);
    if (left) this.rect(px0, y, 2, T);
    else this.rect(px0 + pw - 2, y, 2, T);
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
    const groundY = GROUND_ROW * T;
    const topY = CHUNK_TOP_ROW * T;
    // Checkpoint marker, standing on the ground.
    const cp = this.level.checkpoint;
    const poleH = 2 * T + 10;
    ctx.fillStyle = '#7d7d8a';
    this.rect(cp.x - 7, cp.y - 6, 14, 6);
    ctx.fillStyle = '#ddd';
    this.rect(cp.x - 2, cp.y - poleH, 4, poleH - 6);
    ctx.fillStyle = this.checkpointReached ? '#4dd9ff' : '#888';
    ctx.beginPath();
    ctx.moveTo(cp.x + 2, cp.y - poleH);
    ctx.lineTo(cp.x + 30, cp.y - poleH + 10);
    ctx.lineTo(cp.x + 2, cp.y - poleH + 20);
    ctx.fill();
    // Goal pole
    ctx.fillStyle = '#d8f3dc';
    this.rect(fx - 3, topY, 6, groundY - topY);
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
    // Its flag rises out of the tower once the hero is inside.
    if (this.castleFlag > 0) {
      const poleX = cx + cw / 2;
      const rise = 46 * this.castleFlag;
      ctx.fillStyle = '#d8f3dc';
      this.rect(poleX - 2, cy - T - 12 - rise, 4, rise);
      ctx.fillStyle = '#ffd23f';
      ctx.beginPath();
      ctx.moveTo(poleX + 2, cy - T - 12 - rise);
      ctx.lineTo(poleX + 26, cy - T - 4 - rise);
      ctx.lineTo(poleX + 2, cy - T + 4 - rise);
      ctx.fill();
    }
    ctx.fillStyle = '#9c4f2f';
    this.rect(cx, cy + T, cw, ch - T);
    this.rect(cx + T, cy - T, cw - 2 * T, 2 * T);
    ctx.fillStyle = '#7a3a20';
    for (let i = 0; i < 5; i++) this.rect(cx + i * T + 4, cy + T - 12, T - 10, 12);
    for (let i = 0; i < 3; i++) this.rect(cx + T + i * T + 4, cy - T - 12, T - 10, 12);
    ctx.fillStyle = '#1b1b2f';
    ctx.beginPath();
    ctx.moveTo(cx + cw / 2 - 20, groundY);
    ctx.lineTo(cx + cw / 2 - 20, groundY - 44);
    ctx.arc(cx + cw / 2, groundY - 44, 20, Math.PI, 0);
    ctx.lineTo(cx + cw / 2 + 20, groundY);
    ctx.fill();
    this.rect(cx + T + 14, cy - 4, 10, 18);
    this.rect(cx + 3 * T - 6, cy - 4, 10, 18);
  }

  private drawPlayer(): void {
    const p = this.player;
    if (this.phase === 'tally' || this.pitDeath) return;
    const ctx = this.ctx;
    // Walking into the castle: fade out over the last steps before the door.
    let alpha = this.phase === 'walkoff' ? clamp((this.doorX - (p.x + p.w / 2)) / 24, 0, 1) : 1;
    if (p.invuln > 0 && !p.dead) {
      if (this.services.reducedMotion) alpha *= 0.55;
      else if (Math.floor(this.time * 16) % 2 === 0) return;
    }
    if (alpha <= 0) return;
    const size = p.power > 0 ? 'big' : 'small';
    let pose: HeroPose = 'stand';
    if (p.dead) pose = 'dead';
    else if (!p.onGround) pose = 'jump';
    else if (Math.abs(p.vx) > 10)
      pose = Math.floor(p.anim) % 3 === 0 ? 'walkA' : Math.floor(p.anim) % 3 === 1 ? 'walkB' : 'stand';
    const def = HERO[size][pose];
    const sw = (def[0]?.length ?? 12) * PX;
    const sh = def.length * PX;
    const pal = p.power === 2 ? this.heroPal.fire : this.heroPal.normal;
    ctx.globalAlpha = alpha;
    drawSprite(
      ctx,
      def,
      pal,
      Math.round(p.x + p.w / 2 - sw / 2),
      Math.round(p.y + p.h - sh),
      PX,
      pose !== 'dead' && p.facing < 0,
    );
    ctx.globalAlpha = 1;
  }

  private drawEnemies(): void {
    const ctx = this.ctx;
    const px = 2.4;
    const step = Math.floor(this.time * 6) % 2;
    for (const e of this.enemies) {
      if (e.x + e.w < this.camX - T || e.x > this.camX + this.W + T) continue;
      // Waiting enemies stand still; every sprite faces right and is mirrored when heading left.
      const frame = e.active ? step : 0;
      const flip = e.vx < 0 || (e.vx === 0 && e.dir < 0);
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
          const spin = e.state === 'shellMove' && Math.floor(this.time * 14) % 2 === 1;
          drawSprite(ctx, SHELL, SHELL_PAL, e.x + e.w / 2 - 6 * px, e.y + e.h - SHELL.length * px, px, spin);
        } else {
          const def = SHELLBACK[frame] ?? SHELLBACK[0]!;
          drawSprite(ctx, def, SHELL_PAL, e.x + e.w / 2 - 6 * px, e.y + e.h - 12 * px, px, flip);
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

  /** HUD anchored to the canvas edges inside the insets: score, coins, world on the left; clock, lives on the right. */
  private drawHud(): void {
    const ctx = this.ctx;
    const ins = this.insets;
    const top = ins.top + HUD_PAD;
    const left = ins.left + HUD_PAD;
    const right = this.W - ins.right - HUD_PAD;
    const cy = top + HUD_H / 2 + 1;
    hudPill(ctx, left, top, 196, HUD_H);
    text(ctx, `${Math.floor(this.score).toString().padStart(7, '0')}`, left + 18, cy, { size: 22 });
    hudPill(ctx, left + 206, top, 104, HUD_H);
    drawCoin(ctx, left + 228, cy - 1, 11);
    text(ctx, `× ${this.coins}`, left + 246, cy, { size: 20 });
    const livesX = right - 104;
    const clockX = livesX - 10 - 120;
    hudPill(ctx, clockX, top, 120, HUD_H);
    const low = this.timeLeft < HURRY_TIME && this.phase === 'play';
    text(ctx, `⏱ ${Math.ceil(this.timeLeft)}`, clockX + 60, cy, {
      size: 20,
      align: 'center',
      color: low ? '#ff6b6b' : '#fff',
    });
    hudPill(ctx, livesX, top, 104, HUD_H);
    this.heart(livesX + 24, cy - 1, 10);
    text(ctx, `× ${Math.max(0, this.lives)}`, livesX + 42, cy, { size: 20 });
    // The world pill follows the coins when there is room, else it drops below the score.
    const worldW = 150;
    let wx = left + 320;
    let wy = top;
    if (wx + worldW > clockX - 10) {
      wx = left;
      wy = top + HUD_H + 8;
    }
    hudPill(ctx, wx, wy, worldW, HUD_H);
    text(ctx, `WORLD ${worldLabel(this.levelNum)}`, wx + worldW / 2, wy + HUD_H / 2 + 1, {
      size: 18,
      align: 'center',
    });

    // Banners sit in the open sky under the HUD, clear of the rows the hero plays in.
    const sky = wy + HUD_H;
    const mid = ins.top + (this.H - ins.top - ins.bottom) * 0.38;
    if (this.phase === 'play' && this.showBanner && this.bannerT < BANNER_TIME) {
      const t = this.bannerT / BANNER_TIME;
      this.drawBanner(`WORLD ${worldLabel(this.levelNum)}`, this.theme.name, t, '#ffd23f', sky + 72);
    }
    if (this.phase === 'play' && this.hurryT < 2)
      this.drawBanner('HURRY UP!', '', this.hurryT / 2, '#ff6b6b', sky + 56);
    if (this.phase === 'tally' && this.timeLeft <= 0) {
      const next = `Next: World ${worldLabel(this.levelNum + 1)}`;
      this.drawBanner('COURSE CLEAR!', next, clamp(this.phaseT / 2.6, 0, 1), '#7CFC00', mid);
    }
    if (this.phase === 'dying' && this.lives <= 0 && this.phaseT > 1) {
      this.drawBanner('GAME OVER', '', 0.5, '#ff6b6b', mid);
    }
  }

  /** The shared banner, centred at height `y` across the area between the side insets. */
  private drawBanner(title: string, subtitle: string, t: number, color: string, y: number): void {
    const ctx = this.ctx;
    const w = this.W - this.insets.left - this.insets.right;
    ctx.save();
    ctx.translate(this.insets.left, y - this.H * 0.38);
    banner(ctx, w, this.H, title, subtitle, t, color);
    ctx.restore();
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
