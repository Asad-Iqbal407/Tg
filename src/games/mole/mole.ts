import { clamp, lerp, TAU } from '../../core/math';
import { BaseGame } from '../base';
import { fillRoundRect, progressBar, roundRectPath, shade, text } from '../draw';
import { drawStatBar, statBarHeight } from '../statbar';
import type { GameServices } from '../types';

export type MoleKind = 'mole' | 'gold' | 'bomb';

export interface Mole {
  hole: number;
  kind: MoleKind;
  /** Seconds since it started to rise. */
  t: number;
  /** Seconds it stays out, rise and sink included. */
  up: number;
  hit: boolean;
}

const DESIGN_W = 600;
const HOLES = 9;
const COLS = 3;
const ROUND_SEC = 60;
const HEAD_START_SEC = 10;
const BOMB_PENALTY_SEC = 5;
/** Rise and sink time. */
const POP_SEC = 0.12;
/** A mole can be whacked once it is this far out of its hole. */
const HIT_FROM = 0.3;
const HIT_SINK_SEC = 0.25;
const GOLD_CHANCE = 0.08;
const BOMB_CHANCE = 0.16;
/** Bombs start popping up this many seconds into the round. */
const BOMBS_FROM = 12;
const MOLE_POINTS = 10;
const GOLD_POINTS = 50;
const COIN_WHACKS = 25;
/** The combo multiplier goes up by one every COMBO_STEP whacks in a row, up to MAX_MULT. */
const COMBO_STEP = 5;
const MAX_MULT = 4;

/** Spawn gap and time out for a round that is `progress` (0 to 1) through: both shrink as the round goes on. */
export function paceAt(progress: number): { gap: number; up: number } {
  const t = clamp(progress, 0, 1);
  return { gap: lerp(0.85, 0.36, t), up: lerp(1.35, 0.65, t) };
}

/** How far out of its hole a mole is, 0 to 1, from its rise and sink. */
export function heightOf(m: Mole): number {
  return clamp(Math.min(m.t / POP_SEC, (m.up - m.t) / POP_SEC, 1), 0, 1);
}

/** Whack-a-Mole: a timed round of bopping moles as they pop up. Golden ones pay extra; leave the bombs alone. */
export class MoleGame extends BaseGame {
  private readonly u: number;
  private moles: Mole[] = [];
  private timeLeft: number;
  private readonly roundSec: number;
  private elapsed = 0;
  private spawnT = 0.6;
  private combo = 0;
  private whacks = 0;
  private cursor = 4;
  private keyboard = false;
  private shield = false;
  /** Seconds of the red flash after a bomb. */
  private hurtT = 0;

  constructor(services: GameServices) {
    super(services);
    this.u = this.W / DESIGN_W;
    this.shield = this.hasBoost('shield');
    this.roundSec = ROUND_SEC + (this.hasBoost('head-start') ? HEAD_START_SEC : 0);
    this.timeLeft = this.roundSec;
    for (const key of ['whacks', 'golden', 'combo']) this.addStat(key, 0);
  }

  protected tick(dt: number): void {
    this.hurtT = Math.max(0, this.hurtT - dt);
    for (const m of this.moles) m.t += dt;
    if (this.isEnding) return;
    this.elapsed += dt;
    this.timeLeft -= dt;
    if (this.timeLeft <= 0) {
      this.timeLeft = 0;
      this.audio.play('win');
      this.endGame(1.6, false);
      return;
    }
    this.retire();
    this.spawnT -= dt;
    if (this.spawnT <= 0) this.spawn();
    const target = this.readTarget();
    if (target !== null) this.whack(target);
  }

  render(): void {
    const ctx = this.ctx;
    const g = ctx.createLinearGradient(0, 0, 0, this.H);
    g.addColorStop(0, this.skinColor('sky', '#7dd3fc'));
    g.addColorStop(0.22, this.skinColor('grass1', '#4ade80'));
    g.addColorStop(1, this.skinColor('grass2', '#15803d'));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.W, this.H);
    ctx.save();
    ctx.translate(this.shake.x, this.shake.y);
    for (let i = 0; i < HOLES; i++) this.drawHole(i);
    this.particles.render(ctx);
    this.texts.render(ctx);
    ctx.restore();
    if (this.hurtT > 0) {
      ctx.fillStyle = `rgba(239,68,68,${this.hurtT * 0.6})`;
      ctx.fillRect(0, 0, this.W, this.H);
    }
    if (this.services.preview) return;
    const mult = this.multiplier();
    drawStatBar(ctx, this.W, this.insets.top, this.u, [
      ['SCORE', Math.floor(this.score).toLocaleString('en-US')],
      ['TIME', `${Math.ceil(this.timeLeft)}`],
      ['COMBO', mult > 1 ? `x${mult}` : String(this.combo)],
    ]);
    const y = this.insets.top + statBarHeight(this.u);
    const t = this.timeLeft / this.roundSec;
    progressBar(
      ctx,
      24 * this.u,
      y,
      this.W - 48 * this.u,
      10 * this.u,
      t,
      t < 0.2 ? '#ef4444' : '#fde047',
      'rgba(0,0,0,0.25)',
    );
    if (this.elapsed < 2) {
      text(ctx, 'WHACK THE MOLES!', this.W / 2, y + 40 * this.u, {
        size: Math.round(28 * this.u),
        align: 'center',
      });
    }
  }

  private multiplier(): number {
    return Math.min(MAX_MULT, 1 + Math.floor(this.combo / COMBO_STEP));
  }

  /** The hole's centre (the middle of its opening) and the size of a cell. */
  private holeAt(i: number): { x: number; y: number; cell: number } {
    const top = this.insets.top + statBarHeight(this.u) + 70 * this.u;
    const bottom = this.H - this.insets.bottom - 40 * this.u;
    const cell = Math.min((this.W - 40 * this.u) / COLS, (bottom - top) / 3);
    const left = (this.W - cell * COLS) / 2;
    const gridTop = top + (bottom - top - cell * 3) / 2;
    const col = i % COLS;
    const row = Math.floor(i / COLS);
    return { x: left + (col + 0.5) * cell, y: gridTop + (row + 0.78) * cell, cell };
  }

  /** The hole a point is over: the opening and the space a mole fills above it. */
  private holeUnder(px: number, py: number): number | null {
    for (let i = 0; i < HOLES; i++) {
      const h = this.holeAt(i);
      if (Math.abs(px - h.x) <= h.cell * 0.45 && py <= h.y + h.cell * 0.18 && py >= h.y - h.cell * 0.75)
        return i;
    }
    return null;
  }

  /** A tap over a hole, or the arrow keys moving a cursor and Space whacking the hole under it. */
  private readTarget(): number | null {
    const p = this.input.pointer;
    if (p.pressed) {
      this.keyboard = false;
      const hole = this.holeUnder(p.x, p.y);
      if (hole === null) return null;
      return hole;
    }
    const before = this.cursor;
    const col = this.cursor % COLS;
    const row = Math.floor(this.cursor / COLS);
    if (this.input.wasPressed('left')) this.cursor = row * COLS + ((col + COLS - 1) % COLS);
    if (this.input.wasPressed('right')) this.cursor = row * COLS + ((col + 1) % COLS);
    if (this.input.wasPressed('up')) this.cursor = ((row + 2) % 3) * COLS + col;
    if (this.input.wasPressed('down')) this.cursor = ((row + 1) % 3) * COLS + col;
    if (this.cursor !== before) this.keyboard = true;
    if (!this.input.wasPressed('primary')) return null;
    this.keyboard = true;
    return this.cursor;
  }

  /** Moles whose time is up go back down. A mole that got away unwhacked breaks the combo. */
  private retire(): void {
    const keep: Mole[] = [];
    for (const m of this.moles) {
      if (m.t < m.up) keep.push(m);
      else if (!m.hit && m.kind !== 'bomb') this.combo = 0;
    }
    this.moles = keep;
  }

  private spawn(): void {
    const pace = paceAt(this.elapsed / ROUND_SEC);
    this.spawnT = pace.gap * this.rng.range(0.75, 1.25);
    const busy = new Set(this.moles.map((m) => m.hole));
    const free = Array.from({ length: HOLES }, (_, i) => i).filter((i) => !busy.has(i));
    if (free.length === 0) return;
    const hole = this.rng.pick(free);
    const roll = this.rng.next();
    const bombs = this.elapsed >= BOMBS_FROM;
    const kind: MoleKind =
      roll < GOLD_CHANCE ? 'gold' : bombs && roll < GOLD_CHANCE + BOMB_CHANCE ? 'bomb' : 'mole';
    this.moles.push({ hole, kind, t: 0, up: pace.up * (kind === 'gold' ? 0.8 : 1), hit: false });
  }

  private whack(hole: number): void {
    const m = this.moles.find((x) => x.hole === hole && !x.hit && heightOf(x) >= HIT_FROM);
    const h = this.holeAt(hole);
    if (!m) {
      // A whack on an empty hole breaks the combo.
      this.combo = 0;
      this.audio.play('bump', { volume: 0.4 });
      this.particles.emit({
        x: h.x,
        y: h.y,
        count: 6,
        speed: 90 * this.u,
        life: 0.35,
        size: 3,
        colors: ['#a16207', '#713f12'],
      });
      return;
    }
    m.hit = true;
    m.up = m.t + HIT_SINK_SEC;
    if (m.kind === 'bomb') {
      this.bomb(h.x, h.y - h.cell * 0.3);
      return;
    }
    this.combo++;
    this.whacks++;
    this.addStat('whacks');
    this.maxStat('combo', this.combo);
    const mult = this.multiplier();
    const gold = m.kind === 'gold';
    const points = (gold ? GOLD_POINTS : MOLE_POINTS) * mult;
    this.score += points;
    if (gold) {
      this.coins++;
      this.addStat('golden');
    }
    if (this.whacks % COIN_WHACKS === 0) this.coins++;
    this.audio.play(gold ? 'coin' : 'stomp');
    this.services.haptic(14);
    this.shake.add(0.08);
    const y = h.y - h.cell * 0.35;
    this.texts.add(
      h.x,
      y - h.cell * 0.2,
      gold ? `+${points} GOLD!` : `+${points}`,
      gold ? '#fde047' : '#ffffff',
      22 * this.u,
      0.8,
    );
    this.particles.emit({
      x: h.x,
      y,
      count: gold ? 22 : 12,
      speed: 200 * this.u,
      life: 0.5,
      size: 3.5,
      colors: gold ? ['#fde047', '#ffffff', '#facc15'] : ['#ffffff', '#fde68a', '#fbbf24'],
    });
  }

  /** A bomb was whacked: it costs time and the combo. The shield takes the first one. */
  private bomb(x: number, y: number): void {
    this.combo = 0;
    this.shake.add(0.5);
    this.particles.emit({
      x,
      y,
      count: 30,
      speed: 260 * this.u,
      life: 0.6,
      size: 4,
      colors: ['#f97316', '#fde047', '#1f2937'],
    });
    if (this.shield) {
      this.shield = false;
      this.texts.add(x, y - 30 * this.u, 'SHIELD', '#67e8f9', 24 * this.u, 1);
      this.audio.play('powerup');
      return;
    }
    this.timeLeft = Math.max(0, this.timeLeft - BOMB_PENALTY_SEC);
    this.hurtT = 0.5;
    this.texts.add(x, y - 30 * this.u, `-${BOMB_PENALTY_SEC}s`, '#f87171', 26 * this.u, 1);
    this.audio.play('explode');
    this.services.haptic(80);
  }

  private drawHole(i: number): void {
    const ctx = this.ctx;
    const h = this.holeAt(i);
    const rx = h.cell * 0.36;
    const ry = h.cell * 0.12;
    // The dirt mound and the dark opening.
    ctx.fillStyle = this.skinColor('dirt', '#92400e');
    ctx.beginPath();
    ctx.ellipse(h.x, h.y + ry * 0.4, rx * 1.18, ry * 1.6, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#1c1917';
    ctx.beginPath();
    ctx.ellipse(h.x, h.y, rx, ry, 0, 0, TAU);
    ctx.fill();
    const m = this.moles.find((x) => x.hole === i);
    if (m) {
      // The mole rises out of the opening: everything below the hole's middle line is clipped away.
      ctx.save();
      ctx.beginPath();
      ctx.rect(h.x - h.cell / 2, h.y - h.cell, h.cell, h.cell);
      ctx.ellipse(h.x, h.y, rx, ry, 0, 0, Math.PI);
      ctx.clip();
      const rise = heightOf(m) * h.cell * 0.62;
      this.drawMole(m, h.x, h.y + h.cell * 0.18 - rise, h.cell * 0.27);
      ctx.restore();
    }
    // The front lip of the mound covers the bottom of the mole.
    ctx.fillStyle = shade(this.skinColor('dirt', '#92400e'), 0.12);
    ctx.beginPath();
    ctx.ellipse(h.x, h.y + ry * 0.55, rx * 1.05, ry * 0.7, 0, 0, Math.PI);
    ctx.fill();
    if (this.keyboard && this.cursor === i) {
      ctx.strokeStyle = '#fde047';
      ctx.lineWidth = 4 * this.u;
      roundRectPath(ctx, h.x - h.cell * 0.46, h.y - h.cell * 0.76, h.cell * 0.92, h.cell * 0.98, 14 * this.u);
      ctx.stroke();
    }
  }

  private drawMole(m: Mole, x: number, y: number, r: number): void {
    const ctx = this.ctx;
    if (m.kind === 'bomb') {
      ctx.fillStyle = '#111827';
      ctx.beginPath();
      ctx.arc(x, y + r * 0.2, r * 0.95, 0, TAU);
      ctx.fill();
      ctx.fillStyle = '#374151';
      fillRoundRect(ctx, x - r * 0.25, y - r * 0.95, r * 0.5, r * 0.3, r * 0.08, '#374151');
      ctx.strokeStyle = '#a16207';
      ctx.lineWidth = r * 0.1;
      ctx.beginPath();
      ctx.moveTo(x, y - r * 0.95);
      ctx.quadraticCurveTo(x + r * 0.3, y - r * 1.4, x + r * 0.55, y - r * 1.25);
      ctx.stroke();
      const spark = 0.6 + 0.4 * Math.sin(m.t * 30);
      ctx.fillStyle = '#fde047';
      ctx.beginPath();
      ctx.arc(x + r * 0.55, y - r * 1.25, r * 0.16 * (1 + spark * 0.5), 0, TAU);
      ctx.fill();
      // A white skull-ish face warns it off.
      ctx.fillStyle = '#f9fafb';
      ctx.beginPath();
      ctx.arc(x - r * 0.3, y + r * 0.05, r * 0.16, 0, TAU);
      ctx.arc(x + r * 0.3, y + r * 0.05, r * 0.16, 0, TAU);
      ctx.fill();
      ctx.fillRect(x - r * 0.3, y + r * 0.45, r * 0.6, r * 0.1);
      return;
    }
    const gold = m.kind === 'gold';
    const fur = gold ? '#facc15' : this.skinColor('fur', '#8b5a2b');
    // Body and head in one rounded shape.
    fillRoundRect(ctx, x - r, y - r, r * 2, r * 2.6, r, fur);
    ctx.fillStyle = shade(fur, 0.35);
    ctx.beginPath();
    ctx.ellipse(x, y + r * 0.55, r * 0.62, r * 0.55, 0, 0, TAU);
    ctx.fill();
    if (m.hit) {
      // Dizzy X eyes after a whack.
      ctx.strokeStyle = '#111827';
      ctx.lineWidth = r * 0.12;
      for (const ex of [-0.38, 0.38]) {
        ctx.beginPath();
        ctx.moveTo(x + (ex - 0.13) * r, y - r * 0.32);
        ctx.lineTo(x + (ex + 0.13) * r, y - r * 0.06);
        ctx.moveTo(x + (ex + 0.13) * r, y - r * 0.32);
        ctx.lineTo(x + (ex - 0.13) * r, y - r * 0.06);
        ctx.stroke();
      }
    } else {
      ctx.fillStyle = '#111827';
      ctx.beginPath();
      ctx.arc(x - r * 0.38, y - r * 0.2, r * 0.13, 0, TAU);
      ctx.arc(x + r * 0.38, y - r * 0.2, r * 0.13, 0, TAU);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(x - r * 0.34, y - r * 0.25, r * 0.05, 0, TAU);
      ctx.arc(x + r * 0.42, y - r * 0.25, r * 0.05, 0, TAU);
      ctx.fill();
    }
    ctx.fillStyle = '#f472b6';
    ctx.beginPath();
    ctx.ellipse(x, y + r * 0.12, r * 0.2, r * 0.14, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x - r * 0.14, y + r * 0.3, r * 0.12, r * 0.18);
    ctx.fillRect(x + r * 0.02, y + r * 0.3, r * 0.12, r * 0.18);
    if (gold) {
      // A crown and a sparkle mark the golden mole.
      ctx.fillStyle = '#fef08a';
      ctx.beginPath();
      ctx.moveTo(x - r * 0.45, y - r * 0.85);
      ctx.lineTo(x - r * 0.45, y - r * 1.25);
      ctx.lineTo(x - r * 0.2, y - r * 1.02);
      ctx.lineTo(x, y - r * 1.35);
      ctx.lineTo(x + r * 0.2, y - r * 1.02);
      ctx.lineTo(x + r * 0.45, y - r * 1.25);
      ctx.lineTo(x + r * 0.45, y - r * 0.85);
      ctx.closePath();
      ctx.fill();
    }
  }
}
