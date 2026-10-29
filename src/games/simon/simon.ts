import type { SfxName } from '../../core/audio';
import { TAU } from '../../core/math';
import { BaseGame } from '../base';
import { shade, text } from '../draw';
import { drawStatBar, statBarHeight } from '../statbar';
import type { GameServices } from '../types';

/** Pads clockwise from the top: top, right, bottom, left. */
const PADS = 4;
const DESIGN_W = 600;
const DEFAULT_COLOURS = ['#22c55e', '#ef4444', '#3b82f6', '#facc15'];
const SOUNDS: readonly SfxName[] = ['click', 'pop', 'coin', 'select'];
const KEYS = ['up', 'right', 'down', 'left'] as const;
const TAP_POINTS = 10;
const ROUND_POINTS = 20;
const COIN_ROUNDS = 5;
/** Seconds the player has for each tap before it counts as a miss. */
const TAP_TIMEOUT = 5;
const GAP_SEC = 0.12;
const PRESS_SEC = 0.18;
const HEAD_START_ROUND = 4;

/** How long each step of the sequence lights up on round n: it quickens, down to 0.22 s. */
export function flashFor(round: number): number {
  return Math.max(0.22, 0.55 - 0.025 * (round - 1));
}

/** The pad under a point, from its angle around the centre, or null outside the ring. */
export function padAt(dx: number, dy: number, inner: number, outer: number): number | null {
  const d = Math.hypot(dx, dy);
  if (d < inner || d > outer) return null;
  // Angle measured clockwise from straight up; each pad spans a quarter centred on its direction.
  const a = (Math.atan2(dx, -dy) + TAU + Math.PI / 4) % TAU;
  return Math.floor(a / (Math.PI / 2)) % PADS;
}

type Phase = 'show' | 'input' | 'pause';

/** Simon Says: watch the pads light up, then repeat the sequence. It grows by one every round. */
export class SimonGame extends BaseGame {
  private readonly u: number;
  private seq: number[] = [];
  private phase: Phase = 'pause';
  private phaseT = 0.9;
  /** Step being shown, or the next step the player must tap. */
  private step = 0;
  /** Pad lit now, and for how long it stays lit. */
  private lit = -1;
  private litT = 0;
  private waitT = 0;
  private shield = false;
  private failT = 0;

  constructor(services: GameServices) {
    super(services);
    this.u = this.W / DESIGN_W;
    this.shield = this.hasBoost('shield');
    for (const key of ['rounds', 'taps']) this.addStat(key, 0);
    const start = this.hasBoost('head-start') ? HEAD_START_ROUND : 1;
    for (let i = 0; i < start; i++) this.seq.push(this.rng.int(0, PADS - 1));
    for (let r = 1; r < start; r++) this.score += ROUND_POINTS * r + TAP_POINTS * r;
  }

  protected tick(dt: number): void {
    this.litT = Math.max(0, this.litT - dt);
    if (this.litT <= 0) this.lit = -1;
    this.failT = Math.max(0, this.failT - dt);
    if (this.isEnding) return;
    if (this.phase === 'pause') {
      this.phaseT -= dt;
      if (this.phaseT <= 0) this.beginShow();
    } else if (this.phase === 'show') {
      this.show(dt);
    } else {
      this.waitT -= dt;
      if (this.waitT <= 0) {
        this.fail(-1);
        return;
      }
      const pad = this.readPad();
      if (pad !== null) this.press(pad);
    }
  }

  render(): void {
    const ctx = this.ctx;
    const g = ctx.createRadialGradient(this.W / 2, this.H / 2, 20, this.W / 2, this.H / 2, this.H * 0.7);
    g.addColorStop(0, this.skinColor('bg1', '#1f2937'));
    g.addColorStop(1, this.skinColor('bg2', '#030712'));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.W, this.H);
    if (this.failT > 0) {
      ctx.fillStyle = `rgba(239,68,68,${this.failT * 0.4})`;
      ctx.fillRect(0, 0, this.W, this.H);
    }
    ctx.save();
    ctx.translate(this.shake.x, this.shake.y);
    this.drawBoard();
    this.particles.render(ctx);
    this.texts.render(ctx);
    ctx.restore();
    if (this.services.preview) return;
    drawStatBar(ctx, this.W, this.insets.top, this.u, [
      ['SCORE', Math.floor(this.score).toLocaleString('en-US')],
      ['ROUND', String(this.seq.length)],
      ['BEST', String(this.stats['rounds'] ?? 0)],
    ]);
    const msg = this.phase === 'input' ? 'YOUR TURN' : this.phase === 'show' ? 'WATCH…' : '';
    const { cy, outer } = this.board();
    if (msg) {
      text(ctx, msg, this.W / 2, cy + outer + 50 * this.u, {
        size: Math.round(28 * this.u),
        align: 'center',
        color: this.phase === 'input' ? '#86efac' : '#e5e7eb',
      });
    }
    if (this.phase === 'input') {
      text(ctx, `${this.step} / ${this.seq.length}`, this.W / 2, cy + outer + 86 * this.u, {
        size: Math.round(18 * this.u),
        align: 'center',
        color: 'rgba(255,255,255,0.6)',
        weight: 600,
      });
    }
  }

  private board(): { cx: number; cy: number; inner: number; outer: number } {
    const top = this.insets.top + statBarHeight(this.u);
    const bottom = this.H - this.insets.bottom - 110 * this.u;
    const outer = Math.min(this.W * 0.45, (bottom - top) * 0.45);
    return { cx: this.W / 2, cy: top + (bottom - top) / 2, inner: outer * 0.36, outer };
  }

  private beginShow(): void {
    this.phase = 'show';
    this.step = 0;
    this.phaseT = 0.35;
  }

  /** Lights each step of the sequence in turn, then hands over to the player. */
  private show(dt: number): void {
    this.phaseT -= dt;
    if (this.phaseT > 0) return;
    if (this.step >= this.seq.length) {
      this.phase = 'input';
      this.step = 0;
      this.waitT = TAP_TIMEOUT;
      return;
    }
    const flash = flashFor(this.seq.length);
    this.light(this.seq[this.step] as number, flash);
    this.step++;
    this.phaseT = flash + GAP_SEC;
  }

  private light(pad: number, sec: number): void {
    this.lit = pad;
    this.litT = sec;
    this.audio.play(SOUNDS[pad] ?? 'click', { volume: 0.7 });
  }

  /** A tap on a pad, or an arrow key for the pad in that direction. Card art taps the right pad itself. */
  private readPad(): number | null {
    const p = this.input.pointer;
    if (p.pressed) {
      const b = this.board();
      return padAt(p.x - b.cx, p.y - b.cy, b.inner, b.outer);
    }
    for (let i = 0; i < PADS; i++) if (this.input.wasPressed(KEYS[i] as (typeof KEYS)[number])) return i;
    if (this.services.preview && this.litT <= 0 && this.waitT < TAP_TIMEOUT - 0.4)
      return this.seq[this.step] ?? null;
    return null;
  }

  private press(pad: number): void {
    this.light(pad, PRESS_SEC);
    if (pad !== this.seq[this.step]) {
      this.fail(pad);
      return;
    }
    this.step++;
    this.score += TAP_POINTS;
    this.addStat('taps');
    this.waitT = TAP_TIMEOUT;
    if (this.step < this.seq.length) return;
    // Round complete: the sequence grows by one.
    const round = this.seq.length;
    this.score += ROUND_POINTS * round;
    this.maxStat('rounds', round);
    if (round % COIN_ROUNDS === 0) this.coins++;
    const { cx, cy } = this.board();
    this.texts.add(cx, cy, `+${ROUND_POINTS * round}`, '#fde047', 26 * this.u, 0.9);
    this.particles.emit({
      x: cx,
      y: cy,
      count: 18,
      speed: 200 * this.u,
      life: 0.5,
      size: 3,
      colors: [...this.colours(), '#ffffff'],
    });
    this.seq.push(this.rng.int(0, PADS - 1));
    this.phase = 'pause';
    this.phaseT = 0.8;
  }

  /** A wrong pad (or too slow). The shield replays the same sequence once; otherwise the run ends. */
  private fail(pad: number): void {
    this.failT = 0.6;
    this.shake.add(0.4);
    this.services.haptic(100);
    if (this.shield) {
      this.shield = false;
      const { cx, cy } = this.board();
      this.texts.add(cx, cy, 'SHIELD: WATCH AGAIN', '#67e8f9', 22 * this.u, 1.4);
      this.audio.play('powerup');
      this.phase = 'pause';
      this.phaseT = 1;
      return;
    }
    this.audio.play('error');
    // Show the pad that was wanted.
    const want = this.seq[this.step];
    if (want !== undefined && want !== pad) {
      this.lit = want;
      this.litT = 1.2;
    }
    this.endGame(1.6);
  }

  private colours(): string[] {
    return DEFAULT_COLOURS.map((c, i) => this.skinColor(`p${i + 1}`, c));
  }

  private drawBoard(): void {
    const ctx = this.ctx;
    const { cx, cy, inner, outer } = this.board();
    const colours = this.colours();
    ctx.fillStyle = this.skinColor('case', '#111827');
    ctx.beginPath();
    ctx.arc(cx, cy, outer + 14 * this.u, 0, TAU);
    ctx.fill();
    const gap = 0.06;
    for (let i = 0; i < PADS; i++) {
      // Pad i is centred on its direction: up, right, down, left (canvas angles start at the right).
      const mid = -Math.PI / 2 + i * (Math.PI / 2);
      const a0 = mid - Math.PI / 4 + gap;
      const a1 = mid + Math.PI / 4 - gap;
      const on = this.lit === i;
      const base = colours[i] ?? '#ffffff';
      ctx.save();
      if (on) {
        ctx.shadowColor = base;
        ctx.shadowBlur = 40 * this.u;
      }
      ctx.fillStyle = on ? shade(base, 0.45) : shade(base, -0.3);
      ctx.beginPath();
      ctx.arc(cx, cy, outer, a0, a1);
      ctx.arc(cx, cy, inner, a1, a0, true);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    ctx.fillStyle = this.skinColor('case', '#111827');
    ctx.beginPath();
    ctx.arc(cx, cy, inner * 0.92, 0, TAU);
    ctx.fill();
    text(ctx, String(this.seq.length), cx, cy, { size: Math.round(inner * 0.8), align: 'center' });
  }
}
