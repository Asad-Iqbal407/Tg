import { damp, TAU } from '../../core/math';
import { BaseGame } from '../base';
import { text } from '../draw';
import { drawStatBar, statBarHeight } from '../statbar';
import type { GameServices } from '../types';

/** A placed floor of the tower, or the block sliding above it. x and w in logical px. */
export interface Slab {
  x: number;
  w: number;
}

interface Chunk {
  x: number;
  /** World y of the chunk's top edge. */
  y: number;
  w: number;
  vy: number;
  spin: number;
  hue: number;
}

const DESIGN_W = 600;
const START_W = 260;
const BLOCK_H = 38;
/** A drop this close to the floor below snaps onto it exactly: a perfect drop. */
const PERFECT_TOL = 7;
/** Every perfect drop from the third in a row on widens the block by this much, up to START_W. */
const GROW = 14;
const GROW_FROM = 3;
/** Slide speed in design px/s: it starts at BASE_SPEED and gains SPEED_STEP per floor, up to MAX_SPEED. */
const BASE_SPEED = 230;
const SPEED_STEP = 7;
const MAX_SPEED = 540;
const FLOOR_SCORE = 10;
const PERFECT_BONUS = 5;
const COIN_FLOORS = 10;
const COIN_STREAK = 5;
const HEAD_START_FLOORS = 5;
const GRAVITY = 1800;
/** The top of the tower sits this far down the screen, so the open sky above shows the next block coming. */
const TOP_AT = 0.42;
const FALL_SEC = 1.4;

/**
 * Where a block dropped at `m` lands on `top`: the overlap that stays, the overhang that falls, and whether it was
 * a perfect drop (which snaps onto the floor below and loses nothing). A miss has no overlap.
 */
export function cut(
  m: Slab,
  top: Slab,
  tolerance: number,
): { kept: Slab | null; cutOff: Slab | null; perfect: boolean } {
  if (Math.abs(m.x - top.x) <= tolerance && Math.abs(m.w - top.w) <= tolerance) {
    return { kept: { x: top.x, w: top.w }, cutOff: null, perfect: true };
  }
  const left = Math.max(m.x, top.x);
  const right = Math.min(m.x + m.w, top.x + top.w);
  if (right <= left) return { kept: null, cutOff: { x: m.x, w: m.w }, perfect: false };
  const kept = { x: left, w: right - left };
  const cutOff = m.x < top.x ? { x: m.x, w: top.x - m.x } : { x: right, w: m.x + m.w - right };
  return { kept, cutOff: cutOff.w > 0 ? cutOff : null, perfect: false };
}

/** Stack Tower: drop the sliding block onto the tower; whatever hangs over the edge is sliced off. */
export class StackGame extends BaseGame {
  private readonly u: number;
  /** Floors from the ground up; floor 0 is the base. */
  private floors: Slab[] = [];
  private moving: Slab = { x: 0, w: 0 };
  private dir = 1;
  private chunks: Chunk[] = [];
  /** Perfect drops in a row. */
  private combo = 0;
  private placed = 0;
  /** World y of the screen's top edge (world y grows downward; floor 0 sits on y = 0). */
  private camY = 0;
  private shield = false;
  private flash = 0;

  constructor(services: GameServices) {
    super(services);
    this.u = this.W / DESIGN_W;
    this.shield = this.hasBoost('shield');
    for (const key of ['floors', 'perfects', 'combo']) this.addStat(key, 0);
    const w = START_W * this.u;
    this.floors.push({ x: (this.W - w) / 2, w });
    if (this.hasBoost('head-start')) {
      for (let i = 0; i < HEAD_START_FLOORS; i++) this.floors.push({ x: (this.W - w) / 2, w });
      this.score = HEAD_START_FLOORS * FLOOR_SCORE;
    }
    this.nextBlock();
    this.camY = this.cameraTarget();
  }

  protected tick(dt: number): void {
    this.flash = Math.max(0, this.flash - dt);
    this.camY += (this.cameraTarget() - this.camY) * damp(5, dt);
    for (const c of this.chunks) {
      c.vy += GRAVITY * this.u * dt;
      c.y += c.vy * dt;
    }
    this.chunks = this.chunks.filter((c) => c.y - this.camY < this.H + 200 * this.u);
    if (this.isEnding) return;
    this.slide(dt);
    const tapped =
      this.input.wasPressed('primary') || this.input.wasPressed('up') || this.input.pointer.pressed;
    if (tapped || this.autopilot()) this.drop();
  }

  render(): void {
    const ctx = this.ctx;
    const g = ctx.createLinearGradient(0, 0, 0, this.H);
    // The sky darkens as the tower climbs.
    const height = Math.min(1, this.floors.length / 80);
    g.addColorStop(0, this.skinColor('sky1', '#1e1b4b'));
    g.addColorStop(1, this.skinColor('sky2', '#7c3aed'));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.W, this.H);
    ctx.fillStyle = `rgba(2,6,23,${height * 0.5})`;
    ctx.fillRect(0, 0, this.W, this.H);
    this.drawStars();
    ctx.save();
    ctx.translate(this.shake.x, this.shake.y - this.camY);
    this.drawGround();
    this.floors.forEach((f, i) => this.drawSlab(f, this.floorY(i), this.hue(i)));
    if (!this.isEnding)
      this.drawSlab(this.moving, this.floorY(this.floors.length), this.hue(this.floors.length));
    for (const c of this.chunks) {
      ctx.save();
      ctx.translate(c.x + c.w / 2, c.y + (BLOCK_H * this.u) / 2);
      ctx.rotate(c.spin * (c.vy / (GRAVITY * this.u)));
      this.drawSlab({ x: -c.w / 2, w: c.w }, -(BLOCK_H * this.u) / 2, c.hue);
      ctx.restore();
    }
    this.particles.render(ctx);
    this.texts.render(ctx);
    ctx.restore();
    if (this.flash > 0) {
      ctx.fillStyle = `rgba(255,255,255,${this.flash * 0.5})`;
      ctx.fillRect(0, 0, this.W, this.H);
    }
    if (this.services.preview) return;
    drawStatBar(ctx, this.W, this.insets.top, this.u, [
      ['FLOORS', String(this.floors.length - 1)],
      ['SCORE', Math.floor(this.score).toLocaleString('en-US')],
      ['PERFECT', this.combo > 0 ? `x${this.combo}` : '—'],
    ]);
    if (this.placed === 0) {
      text(ctx, 'TAP TO DROP', this.W / 2, this.floorY(this.floors.length) - this.camY - 70 * this.u, {
        size: Math.round(28 * this.u),
        align: 'center',
      });
    }
  }

  /** World y of the top edge of floor i. */
  private floorY(i: number): number {
    return -(i + 1) * BLOCK_H * this.u;
  }

  private cameraTarget(): number {
    const top = this.floorY(this.floors.length);
    const room = this.H - this.insets.bottom - statBarHeight(this.u) - this.insets.top;
    return top - (this.insets.top + statBarHeight(this.u) + room * TOP_AT);
  }

  private hue(i: number): number {
    return (this.skinParam('hue', 260) + i * this.skinParam('hueStep', 9)) % 360;
  }

  private speed(): number {
    return Math.min(MAX_SPEED, BASE_SPEED + SPEED_STEP * this.placed) * this.u;
  }

  private nextBlock(): void {
    const top = this.floors[this.floors.length - 1] ?? { x: 0, w: START_W * this.u };
    // Blocks come in from alternate sides.
    this.dir = this.floors.length % 2 === 0 ? 1 : -1;
    const x = this.dir > 0 ? -top.w * 0.3 : this.W - top.w * 0.7;
    this.moving = { x, w: top.w };
  }

  /** The block slides back and forth, turning when a third of it is past either edge. */
  private slide(dt: number): void {
    const m = this.moving;
    m.x += this.dir * this.speed() * dt;
    const lo = -m.w * 0.3;
    const hi = this.W - m.w * 0.7;
    if (m.x < lo) {
      m.x = lo;
      this.dir = 1;
    } else if (m.x > hi) {
      m.x = hi;
      this.dir = -1;
    }
  }

  /** Card art drops the block whenever it lines up, so the frame shows a growing tower. */
  private autopilot(): boolean {
    if (!this.services.preview) return false;
    const top = this.floors[this.floors.length - 1];
    return !!top && Math.abs(this.moving.x - top.x) < 6 * this.u;
  }

  private drop(): void {
    const top = this.floors[this.floors.length - 1];
    if (!top) return;
    const level = this.floors.length;
    const res = cut(this.moving, top, PERFECT_TOL * this.u);
    if (res.cutOff) this.fall(res.cutOff, level);
    if (!res.kept) {
      this.miss();
      return;
    }
    let kept = res.kept;
    if (res.perfect) {
      this.combo++;
      this.addStat('perfects');
      this.maxStat('combo', this.combo);
      if (this.combo >= GROW_FROM) {
        const w = Math.min(START_W * this.u, kept.w + GROW * this.u);
        kept = { x: kept.x - (w - kept.w) / 2, w };
      }
      this.score += PERFECT_BONUS * this.combo;
      if (this.combo % COIN_STREAK === 0) this.coins++;
      this.flash = 0.25;
      this.audio.play('reward', { volume: 0.6 });
      this.services.haptic(15);
      this.texts.add(
        kept.x + kept.w / 2,
        this.floorY(level) - 14 * this.u,
        this.combo > 1 ? `PERFECT x${this.combo}` : 'PERFECT',
        '#fde047',
        22 * this.u,
        0.9,
      );
      this.particles.emit({
        x: kept.x + kept.w / 2,
        y: this.floorY(level) + (BLOCK_H * this.u) / 2,
        count: 18,
        speed: 220 * this.u,
        life: 0.5,
        size: 3,
        colors: ['#ffffff', `hsl(${this.hue(level)},90%,70%)`],
      });
    } else {
      this.combo = 0;
      this.audio.play('land');
    }
    this.floors.push(kept);
    this.placed++;
    this.score += FLOOR_SCORE;
    this.addStat('floors');
    if ((this.floors.length - 1) % COIN_FLOORS === 0) this.coins++;
    this.nextBlock();
  }

  /** The block missed the tower entirely. The shield gives the block back once; otherwise the run ends. */
  private miss(): void {
    this.combo = 0;
    this.shake.add(0.4);
    if (this.shield) {
      this.shield = false;
      this.texts.add(this.W / 2, this.floorY(this.floors.length), 'SHIELD', '#67e8f9', 26 * this.u, 1.1);
      this.audio.play('powerup');
      this.nextBlock();
      return;
    }
    this.audio.play('bump');
    this.endGame(FALL_SEC);
  }

  private fall(s: Slab, level: number): void {
    this.chunks.push({
      x: s.x,
      y: this.floorY(level),
      w: s.w,
      vy: 0,
      spin: s.x < this.W / 2 ? -0.6 : 0.6,
      hue: this.hue(level),
    });
  }

  private drawSlab(s: Slab, y: number, hue: number): void {
    const ctx = this.ctx;
    const h = BLOCK_H * this.u;
    const side = h * 0.28;
    ctx.fillStyle = `hsl(${hue},70%,58%)`;
    ctx.fillRect(s.x, y, s.w, h - side);
    ctx.fillStyle = `hsl(${hue},65%,42%)`;
    ctx.fillRect(s.x, y + h - side, s.w, side);
    ctx.fillStyle = `hsla(${hue},90%,85%,0.7)`;
    ctx.fillRect(s.x, y, s.w, 3 * this.u);
    ctx.strokeStyle = `hsla(${hue},60%,25%,0.6)`;
    ctx.lineWidth = Math.max(1, this.u);
    ctx.strokeRect(s.x + 0.5, y + 0.5, s.w - 1, h - 1);
  }

  private drawGround(): void {
    const ctx = this.ctx;
    ctx.fillStyle = this.skinColor('ground', '#0f172a');
    ctx.fillRect(-20, 0, this.W + 40, 2000 * this.u);
    ctx.fillStyle = this.skinColor('groundTop', '#334155');
    ctx.fillRect(-20, 0, this.W + 40, 8 * this.u);
  }

  /** Fixed stars that drift down slowly as the camera rises, for a sense of height. */
  private drawStars(): void {
    const ctx = this.ctx;
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    const span = this.H + 40;
    for (let i = 0; i < 40; i++) {
      const x = ((i * 137.5) % 1) * this.W + ((i * 97) % this.W);
      const base = (i * 71) % span;
      const y = (((base - this.camY * 0.15) % span) + span) % span;
      ctx.beginPath();
      ctx.arc(x % this.W, y - 20, (1 + (i % 3) * 0.6) * this.u, 0, TAU);
      ctx.fill();
    }
  }
}
