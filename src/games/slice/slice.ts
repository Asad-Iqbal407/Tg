import { TAU } from '../../core/math';
import { BaseGame } from '../base';
import { shade, text } from '../draw';
import { drawStatBar, statBarHeight } from '../statbar';
import type { GameServices } from '../types';

export type FruitKind = 'apple' | 'orange' | 'melon' | 'lemon' | 'kiwi' | 'plum' | 'gold' | 'bomb';

export interface Fruit {
  kind: FruitKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  angle: number;
  spin: number;
}

interface Half extends Fruit {
  /** Which half: -1 the left, 1 the right. */
  side: number;
  life: number;
}

const DESIGN_W = 600;
const GRAVITY = 900;
const LIVES = 3;
const FRUIT_POINTS = 10;
const GOLD_POINTS = 50;
const COMBO_FROM = 3;
const COMBO_POINTS = 10;
const COIN_FRUITS = 25;
const GOLD_CHANCE = 0.04;
/** Bombs join the volleys this many seconds in, and get more common after. */
const BOMBS_FROM = 8;
const TRAIL_SEC = 0.16;
/** A swipe shorter than this per step is a resting finger, not a cut. */
const MIN_CUT = 3;
const COLOURS: Readonly<Record<FruitKind, readonly [string, string]>> = {
  apple: ['#ef4444', '#fef3c7'],
  orange: ['#fb923c', '#fed7aa'],
  melon: ['#16a34a', '#f43f5e'],
  lemon: ['#facc15', '#fef9c3'],
  kiwi: ['#854d0e', '#84cc16'],
  plum: ['#7c3aed', '#f0abfc'],
  gold: ['#fde047', '#fffbeb'],
  bomb: ['#111827', '#111827'],
};
const KINDS: readonly FruitKind[] = ['apple', 'orange', 'melon', 'lemon', 'kiwi', 'plum'];

/** Distance from point (px, py) to the segment from (ax, ay) to (bx, by). */
export function segmentDistance(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}

/** Fruit Slice: swipe through the fruit thrown up from below. Let one fall and it costs a life; never cut a bomb. */
export class SliceGame extends BaseGame {
  private readonly u: number;
  private fruits: Fruit[] = [];
  private halves: Half[] = [];
  private trail: { x: number; y: number; t: number }[] = [];
  private last: { x: number; y: number } | null = null;
  private lives: number;
  private elapsed = 0;
  private volleyT = 1;
  /** Fruit cut in the current stroke (one press of the finger). */
  private stroke = 0;
  private sliced = 0;
  private shield = false;
  private hurtT = 0;

  constructor(services: GameServices) {
    super(services);
    this.u = this.W / DESIGN_W;
    this.shield = this.hasBoost('shield');
    this.lives = LIVES + (this.hasBoost('head-start') ? 1 : 0);
    for (const key of ['fruits', 'combo', 'golden']) this.addStat(key, 0);
  }

  protected tick(dt: number): void {
    this.hurtT = Math.max(0, this.hurtT - dt);
    const g = GRAVITY * this.u;
    for (const f of [...this.fruits, ...this.halves]) {
      f.vy += g * dt;
      f.x += f.vx * dt;
      f.y += f.vy * dt;
      f.angle += f.spin * dt;
    }
    for (const h of this.halves) h.life -= dt;
    this.halves = this.halves.filter((h) => h.life > 0 && h.y - h.r < this.H);
    this.trail = this.trail.filter((p) => this.time - p.t < TRAIL_SEC);
    if (this.isEnding) return;
    this.elapsed += dt;
    this.blade();
    this.dropMissed();
    this.volleyT -= dt;
    if (this.volleyT <= 0) this.volley();
  }

  render(): void {
    const ctx = this.ctx;
    const g = ctx.createRadialGradient(this.W / 2, this.H * 0.4, 20, this.W / 2, this.H * 0.5, this.H * 0.8);
    g.addColorStop(0, this.skinColor('bg1', '#7c2d12'));
    g.addColorStop(1, this.skinColor('bg2', '#1c0a04'));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.W, this.H);
    this.drawPlanks();
    ctx.save();
    ctx.translate(this.shake.x, this.shake.y);
    for (const h of this.halves) this.drawFruit(h, h.side);
    for (const f of this.fruits) this.drawFruit(f, 0);
    this.particles.render(ctx);
    this.drawTrail();
    this.texts.render(ctx);
    ctx.restore();
    if (this.hurtT > 0) {
      ctx.fillStyle = `rgba(239,68,68,${this.hurtT * 0.5})`;
      ctx.fillRect(0, 0, this.W, this.H);
    }
    if (this.services.preview) return;
    drawStatBar(ctx, this.W, this.insets.top, this.u, [
      ['SCORE', Math.floor(this.score).toLocaleString('en-US')],
      ['FRUIT', String(this.sliced)],
      ['LIVES', '♥'.repeat(Math.max(0, this.lives)) || '—'],
    ]);
    if (this.elapsed < 2.5) {
      text(ctx, 'SWIPE TO SLICE!', this.W / 2, this.insets.top + statBarHeight(this.u) + 60 * this.u, {
        size: Math.round(30 * this.u),
        align: 'center',
      });
    }
  }

  /** Throws a volley: more fruit, closer together, and more bombs as the round goes on. */
  private volley(): void {
    const t = this.elapsed;
    this.volleyT = Math.max(0.85, 2 - t * 0.02) * this.rng.range(0.85, 1.15);
    const count = 1 + this.rng.int(0, Math.min(4, 1 + Math.floor(t / 15)));
    const bombChance = t < BOMBS_FROM ? 0 : Math.min(0.3, 0.12 + (t - BOMBS_FROM) * 0.003);
    for (let i = 0; i < count; i++) {
      const roll = this.rng.next();
      const kind: FruitKind =
        roll < bombChance ? 'bomb' : roll < bombChance + GOLD_CHANCE ? 'gold' : this.rng.pick(KINDS);
      this.throwFruit(kind);
    }
    this.audio.play('whoosh', { volume: 0.4 });
  }

  private throwFruit(kind: FruitKind): void {
    const u = this.u;
    const r = (kind === 'melon' ? 46 : kind === 'bomb' ? 34 : kind === 'gold' ? 30 : 36) * u;
    const x = this.rng.range(this.W * 0.15, this.W * 0.85);
    // High enough to clear the HUD's lower edge sometimes, never out of the top of the screen.
    const top = this.insets.top + statBarHeight(u) + r;
    const peak = this.rng.range(top, this.H * 0.45);
    const rise = this.H + r - peak;
    const vy = -Math.sqrt(2 * GRAVITY * u * rise);
    const flight = (2 * -vy) / (GRAVITY * u);
    const vx = (this.rng.range(this.W * 0.3, this.W * 0.7) - x) / flight;
    this.fruits.push({ kind, x, y: this.H + r, vx, vy, r, angle: 0, spin: this.rng.range(-3, 3) });
  }

  /** The finger's path this step is the blade: every fruit it crosses is cut. */
  private blade(): void {
    const p = this.input.pointer;
    if (!p.down) {
      this.finishStroke();
      this.last = null;
      return;
    }
    const at = { x: p.x, y: p.y };
    const from = this.last;
    this.last = at;
    if (p.pressed || !from) {
      this.finishStroke();
      return;
    }
    if (Math.hypot(at.x - from.x, at.y - from.y) < MIN_CUT * this.u) return;
    this.trail.push({ x: at.x, y: at.y, t: this.time });
    if (this.trail.length === 1) this.trail.unshift({ x: from.x, y: from.y, t: this.time });
    const keep: Fruit[] = [];
    for (const f of this.fruits) {
      if (segmentDistance(f.x, f.y, from.x, from.y, at.x, at.y) <= f.r)
        this.cut(f, at.x - from.x, at.y - from.y);
      else keep.push(f);
    }
    this.fruits = keep;
  }

  private cut(f: Fruit, dx: number, dy: number): void {
    if (this.isEnding) return;
    if (f.kind === 'bomb') {
      this.bomb(f);
      return;
    }
    const gold = f.kind === 'gold';
    this.stroke++;
    this.sliced++;
    this.addStat('fruits');
    this.score += gold ? GOLD_POINTS : FRUIT_POINTS;
    if (gold) {
      this.coins++;
      this.addStat('golden');
      this.texts.add(f.x, f.y - f.r, '+50 GOLD', '#fde047', 22 * this.u, 1);
    }
    if (this.sliced % COIN_FRUITS === 0) this.coins++;
    // The halves fly apart across the cut.
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    const push = 120 * this.u;
    for (const side of [-1, 1]) {
      this.halves.push({
        ...f,
        side,
        life: 2,
        vx: f.vx + nx * push * side,
        vy: f.vy + ny * push * side,
        spin: f.spin + side * 2,
      });
    }
    const [, inner] = COLOURS[f.kind];
    this.particles.emit({
      x: f.x,
      y: f.y,
      count: 16,
      speed: 220 * this.u,
      life: 0.5,
      size: 4,
      gravity: 600 * this.u,
      colors: [inner, COLOURS[f.kind][0]],
    });
    this.audio.play(gold ? 'coin' : 'pop');
    this.services.haptic(10);
  }

  /** Ends a stroke: three or more fruit in one swipe pay a combo bonus. */
  private finishStroke(): void {
    if (this.stroke >= COMBO_FROM) {
      const bonus = COMBO_POINTS * this.stroke;
      this.score += bonus;
      this.maxStat('combo', this.stroke);
      const at = this.trail[this.trail.length - 1] ?? { x: this.W / 2, y: this.H / 2 };
      this.texts.add(
        at.x,
        at.y - 30 * this.u,
        `${this.stroke} FRUIT COMBO +${bonus}`,
        '#fde047',
        22 * this.u,
        1.2,
      );
      this.audio.play('reward');
    }
    this.stroke = 0;
  }

  /** Fruit that falls back out of sight uncut costs a life. Bombs that fall are harmless. */
  private dropMissed(): void {
    const keep: Fruit[] = [];
    for (const f of this.fruits) {
      if (f.vy > 0 && f.y - f.r > this.H) {
        if (f.kind !== 'bomb') this.loseLife(f.x);
      } else keep.push(f);
    }
    this.fruits = keep;
  }

  private loseLife(x: number): void {
    if (this.isEnding) return;
    this.lives--;
    this.hurtT = 0.35;
    this.texts.add(x, this.H - this.insets.bottom - 40 * this.u, '✕', '#ef4444', 40 * this.u, 0.9);
    this.audio.play('bump');
    if (this.lives <= 0) this.endGame(1.4);
  }

  /** A bomb was cut. The shield defuses the first one; otherwise it ends the run. */
  private bomb(f: Fruit): void {
    this.particles.emit({
      x: f.x,
      y: f.y,
      count: 40,
      speed: 320 * this.u,
      life: 0.8,
      size: 5,
      colors: ['#f97316', '#fde047', '#ffffff', '#111827'],
    });
    this.shake.add(0.8);
    if (this.shield) {
      this.shield = false;
      this.texts.add(f.x, f.y - f.r, 'DEFUSED', '#67e8f9', 24 * this.u, 1.1);
      this.audio.play('powerup');
      return;
    }
    this.hurtT = 0.8;
    this.audio.play('explode');
    this.services.haptic(150);
    this.endGame(1.6);
  }

  private drawPlanks(): void {
    const ctx = this.ctx;
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.lineWidth = 3 * this.u;
    const step = 96 * this.u;
    for (let x = step; x < this.W; x += step) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, this.H);
      ctx.stroke();
    }
  }

  private drawTrail(): void {
    const ctx = this.ctx;
    const pts = this.trail;
    if (pts.length < 2) return;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      if (!a || !b) continue;
      const k = i / pts.length;
      ctx.strokeStyle = this.skinColor('blade', '#e0f2fe');
      ctx.globalAlpha = 0.3 + 0.7 * k;
      ctx.lineWidth = (2 + 9 * k) * this.u;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawFruit(f: Fruit, side: number): void {
    const ctx = this.ctx;
    const [skin, inner] = COLOURS[f.kind];
    ctx.save();
    ctx.translate(f.x, f.y);
    ctx.rotate(f.angle);
    if (f.kind === 'bomb') {
      ctx.fillStyle = skin;
      ctx.beginPath();
      ctx.arc(0, 0, f.r, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = 3 * this.u;
      ctx.stroke();
      ctx.strokeStyle = '#a16207';
      ctx.lineWidth = 4 * this.u;
      ctx.beginPath();
      ctx.moveTo(0, -f.r);
      ctx.quadraticCurveTo(f.r * 0.4, -f.r * 1.5, f.r * 0.7, -f.r * 1.3);
      ctx.stroke();
      ctx.fillStyle = '#fde047';
      ctx.beginPath();
      ctx.arc(f.r * 0.7, -f.r * 1.3, f.r * (0.15 + 0.08 * Math.sin(this.time * 30)), 0, TAU);
      ctx.fill();
      ctx.fillStyle = '#ef4444';
      ctx.font = `900 ${Math.round(f.r)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('✕', 0, f.r * 0.05);
      ctx.restore();
      return;
    }
    if (side !== 0) {
      // A half: the rind on one side, the flesh showing along the cut.
      ctx.beginPath();
      ctx.arc(0, 0, f.r, side < 0 ? Math.PI / 2 : -Math.PI / 2, side < 0 ? (Math.PI * 3) / 2 : Math.PI / 2);
      ctx.closePath();
      ctx.fillStyle = skin;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(
        0,
        0,
        f.r * 0.82,
        side < 0 ? Math.PI / 2 : -Math.PI / 2,
        side < 0 ? (Math.PI * 3) / 2 : Math.PI / 2,
      );
      ctx.closePath();
      ctx.fillStyle = inner;
      ctx.fill();
      ctx.restore();
      return;
    }
    const g = ctx.createRadialGradient(-f.r * 0.35, -f.r * 0.35, f.r * 0.1, 0, 0, f.r);
    g.addColorStop(0, shade(skin, 0.45));
    g.addColorStop(1, skin);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, f.r, 0, TAU);
    ctx.fill();
    if (f.kind === 'melon') {
      ctx.strokeStyle = '#14532d';
      ctx.lineWidth = 4 * this.u;
      for (const a of [-0.5, 0, 0.5]) {
        ctx.beginPath();
        ctx.ellipse(0, 0, f.r * Math.abs(Math.cos(a + 0.6)) * 0.9, f.r * 0.98, 0, 0, TAU);
        ctx.stroke();
      }
    }
    if (f.kind === 'gold') {
      ctx.fillStyle = '#fffbeb';
      ctx.font = `900 ${Math.round(f.r * 1.1)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('★', 0, f.r * 0.05);
    }
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.beginPath();
    ctx.ellipse(-f.r * 0.35, -f.r * 0.4, f.r * 0.3, f.r * 0.18, -0.6, 0, TAU);
    ctx.fill();
    if (f.kind !== 'gold' && f.kind !== 'melon') {
      ctx.fillStyle = '#3f6212';
      ctx.beginPath();
      ctx.ellipse(f.r * 0.15, -f.r * 0.95, f.r * 0.28, f.r * 0.12, -0.5, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }
}
