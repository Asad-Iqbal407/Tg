import type { Rng } from '../../core/rng';
import { BaseGame } from '../base';
import { banner, fillRoundRect, progressBar, roundRectPath, text } from '../draw';
import { drawStatBar, statBarHeight } from '../statbar';
import type { GameServices } from '../types';

export const SIZE = 5;

/** Presses a light: it and its four neighbours switch. */
export function press(on: boolean[], i: number): void {
  const r = Math.floor(i / SIZE);
  const c = i % SIZE;
  for (const [dr, dc] of [
    [0, 0],
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ] as const) {
    const rr = r + dr;
    const cc = c + dc;
    if (rr >= 0 && rr < SIZE && cc >= 0 && cc < SIZE) on[rr * SIZE + cc] = !on[rr * SIZE + cc];
  }
}

/**
 * A puzzle made by pressing `presses` different lights on a dark board, so it can always be solved in that many presses
 * (pressing the same lights again). Never one that comes out dark.
 */
export function makePuzzle(rng: Rng, presses: number): { on: boolean[]; solution: number[] } {
  for (;;) {
    const on = Array<boolean>(SIZE * SIZE).fill(false);
    const solution = rng.shuffle(Array.from({ length: SIZE * SIZE }, (_, i) => i)).slice(0, presses);
    for (const i of solution) press(on, i);
    if (on.some(Boolean)) return { on, solution };
  }
}

/** Presses that make puzzle n. */
export function pressesFor(n: number, easier: boolean): number {
  return Math.max(1, Math.min(15, 2 + n) - (easier ? 2 : 0));
}

const DESIGN_W = 600;
const LEVEL_POINTS = 100;
const PAR_POINTS = 200;
const TIME_POINTS = 5;
const CLEAR_SEC = 1.5;
const SHIELD_SECONDS = 20;

/** Lights Out: every press switches a light and its neighbours. Switch the whole board off before time runs out. */
export class LightsGame extends BaseGame {
  private readonly u: number;
  private level = 1;
  private on: boolean[] = [];
  private par = 1;
  private moves = 0;
  private timeLeft = 1;
  private levelTime = 1;
  private clearT = 0;
  private bannerT = 1.3;
  private cursor = 12;
  private keyboard = false;
  private shield = false;
  /** Seconds since each light last switched, for the glow animation. */
  private changed: number[] = Array<number>(SIZE * SIZE).fill(1);

  constructor(services: GameServices) {
    super(services);
    this.u = this.W / DESIGN_W;
    this.shield = this.hasBoost('shield');
    for (const key of ['puzzles', 'presses']) this.addStat(key, 0);
    this.startLevel(1);
  }

  protected tick(dt: number): void {
    this.changed = this.changed.map((t) => t + dt);
    this.bannerT = Math.max(0, this.bannerT - dt);
    if (this.isEnding) return;
    if (this.clearT > 0) {
      this.clearT -= dt;
      if (this.clearT <= 0) this.startLevel(this.level + 1);
      return;
    }
    this.timeLeft -= dt;
    if (this.timeLeft <= 0) {
      if (this.shield) {
        this.shield = false;
        this.timeLeft = SHIELD_SECONDS;
        this.levelTime = Math.max(this.levelTime, SHIELD_SECONDS);
        this.texts.add(this.W / 2, this.H * 0.5, `SHIELD +${SHIELD_SECONDS}s`, '#67e8f9', 26 * this.u, 1.2);
        this.audio.play('powerup');
      } else {
        this.timeLeft = 0;
        this.endGame(1.4);
        return;
      }
    }
    const i = this.readCell();
    if (i !== null) this.pressCell(i);
  }

  render(): void {
    const ctx = this.ctx;
    ctx.fillStyle = this.skinColor('bg', '#0b1020');
    ctx.fillRect(0, 0, this.W, this.H);
    const b = this.grid();
    ctx.save();
    ctx.translate(this.shake.x, this.shake.y);
    for (let i = 0; i < SIZE * SIZE; i++) this.drawLight(i, b);
    this.particles.render(ctx);
    this.texts.render(ctx);
    ctx.restore();
    if (this.services.preview) return;
    drawStatBar(ctx, this.W, this.insets.top, this.u, [
      ['SCORE', Math.floor(this.score).toLocaleString('en-US')],
      ['PUZZLE', String(this.level)],
      ['MOVES', `${this.moves} / par ${this.par}`],
    ]);
    const barY = this.H - this.insets.bottom - 34 * this.u;
    const t = Math.max(0, this.timeLeft) / this.levelTime;
    progressBar(
      ctx,
      24 * this.u,
      barY,
      this.W - 48 * this.u,
      12 * this.u,
      t,
      t < 0.2 ? '#ef4444' : this.skinColor('lit', '#facc15'),
    );
    text(
      ctx,
      `${this.on.filter(Boolean).length} lights on · ${Math.ceil(Math.max(0, this.timeLeft))}s`,
      this.W / 2,
      barY - 20 * this.u,
      {
        size: Math.round(17 * this.u),
        align: 'center',
        color: 'rgba(255,255,255,0.75)',
        weight: 600,
      },
    );
    if (this.clearT > 0) {
      banner(
        ctx,
        this.W,
        this.H,
        'LIGHTS OUT!',
        `Puzzle ${this.level + 1} next`,
        1 - this.clearT / CLEAR_SEC,
        '#fde047',
      );
    } else if (this.bannerT > 0) {
      banner(ctx, this.W, this.H, `PUZZLE ${this.level}`, `Solvable in ${this.par}`, 1 - this.bannerT / 1.3);
    }
  }

  private startLevel(level: number): void {
    this.level = level;
    this.par = pressesFor(level, this.hasBoost('head-start'));
    const { on, solution } = makePuzzle(this.rng, this.par);
    this.on = on;
    if (this.services.preview) for (const i of solution.slice(0, 1)) press(this.on, i);
    this.moves = 0;
    this.levelTime = 30 + 8 * this.par;
    this.timeLeft = this.levelTime;
    this.bannerT = 1.3;
  }

  private grid(): { x: number; y: number; cell: number } {
    const top = this.insets.top + statBarHeight(this.u) + 20 * this.u;
    const bottom = this.H - this.insets.bottom - 80 * this.u;
    const size = Math.min(this.W - 40 * this.u, bottom - top);
    return { x: (this.W - size) / 2, y: top + (bottom - top - size) / 2, cell: size / SIZE };
  }

  private readCell(): number | null {
    const p = this.input.pointer;
    if (p.pressed) {
      this.keyboard = false;
      const b = this.grid();
      const c = Math.floor((p.x - b.x) / b.cell);
      const r = Math.floor((p.y - b.y) / b.cell);
      return c >= 0 && c < SIZE && r >= 0 && r < SIZE ? r * SIZE + c : null;
    }
    const before = this.cursor;
    const c = this.cursor % SIZE;
    const r = Math.floor(this.cursor / SIZE);
    if (this.input.wasPressed('left')) this.cursor = r * SIZE + ((c + SIZE - 1) % SIZE);
    if (this.input.wasPressed('right')) this.cursor = r * SIZE + ((c + 1) % SIZE);
    if (this.input.wasPressed('up')) this.cursor = ((r + SIZE - 1) % SIZE) * SIZE + c;
    if (this.input.wasPressed('down')) this.cursor = ((r + 1) % SIZE) * SIZE + c;
    if (this.cursor !== before) this.keyboard = true;
    if (!this.input.wasPressed('primary')) return null;
    this.keyboard = true;
    return this.cursor;
  }

  private pressCell(i: number): void {
    press(this.on, i);
    const r = Math.floor(i / SIZE);
    const c = i % SIZE;
    for (let k = 0; k < SIZE * SIZE; k++) {
      if (Math.abs(Math.floor(k / SIZE) - r) + Math.abs((k % SIZE) - c) <= 1) this.changed[k] = 0;
    }
    this.moves++;
    this.addStat('presses');
    this.audio.play('click', { volume: 0.5 });
    if (this.on.every((v) => !v)) this.clear();
  }

  private clear(): void {
    const atPar = this.moves <= this.par;
    const bonus =
      LEVEL_POINTS * this.level + (atPar ? PAR_POINTS : 0) + Math.ceil(this.timeLeft) * TIME_POINTS;
    this.score += bonus;
    this.coins += atPar ? 2 : 1;
    this.addStat('puzzles');
    this.clearT = CLEAR_SEC;
    this.audio.play('levelup');
    this.texts.add(
      this.W / 2,
      this.H * 0.6,
      atPar ? `PAR! +${bonus}` : `+${bonus}`,
      '#fde047',
      28 * this.u,
      1.3,
    );
  }

  private drawLight(i: number, b: { x: number; y: number; cell: number }): void {
    const ctx = this.ctx;
    const x = b.x + (i % SIZE) * b.cell;
    const y = b.y + Math.floor(i / SIZE) * b.cell;
    const pad = b.cell * 0.08;
    const lit = this.on[i];
    const pop = Math.max(0, 1 - (this.changed[i] ?? 1) / 0.18);
    const s = b.cell - pad * 2 - pop * b.cell * 0.06;
    const ox = x + (b.cell - s) / 2;
    const oy = y + (b.cell - s) / 2;
    if (lit) {
      ctx.save();
      ctx.shadowColor = this.skinColor('lit', '#facc15');
      ctx.shadowBlur = 24 * this.u;
      fillRoundRect(ctx, ox, oy, s, s, s * 0.18, this.skinColor('lit', '#facc15'));
      ctx.restore();
      fillRoundRect(ctx, ox + s * 0.12, oy + s * 0.1, s * 0.76, s * 0.22, s * 0.1, 'rgba(255,255,255,0.35)');
    } else {
      fillRoundRect(ctx, ox, oy, s, s, s * 0.18, this.skinColor('off', '#1e293b'));
    }
    if (this.keyboard && this.cursor === i) {
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 4 * this.u;
      roundRectPath(ctx, ox - 4 * this.u, oy - 4 * this.u, s + 8 * this.u, s + 8 * this.u, s * 0.2);
      ctx.stroke();
    }
  }
}
