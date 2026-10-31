import { TAU } from '../../core/math';
import { BaseGame } from '../base';
import { fillRoundRect, progressBar, roundRectPath, shade, text } from '../draw';
import { drawStatBar, statBarHeight } from '../statbar';
import type { GameServices } from '../types';
import {
  adjacent,
  collapse,
  findMatches,
  type Grid,
  hasMove,
  KINDS,
  newBoard,
  SIZE,
  swap,
  swapMatches,
} from './board';

const DESIGN_W = 600;
const ROUND_SEC = 60;
const EXTRA_SEC = 15;
const GEM_POINTS = 10;
/** Rows per second a gem falls. */
const FALL_RATE = 12;
const SWAP_SEC = 0.14;
const COIN_GEMS = 40;
const DEFAULT_COLOURS = ['#ef4444', '#3b82f6', '#22c55e', '#facc15', '#a855f7', '#f97316'];

/** Gem Swap: swap neighbouring gems to make lines of three or more. Cascades multiply the points. */
export class GemsGame extends BaseGame {
  private readonly u: number;
  private grid: Grid;
  /** Rows each gem still has to fall, for the drop animation. */
  private drop: number[] = Array<number>(SIZE * SIZE).fill(0);
  private selected = -1;
  /** A swap in progress: the two cells, whether it stands, and how far through it is. */
  private swapping: { a: number; b: number; ok: boolean; t: number } | null = null;
  private cascade = 0;
  private settling = false;
  private timeLeft: number;
  private roundSec: number;
  private shield = false;
  private cursor = 27;
  private keyboard = false;
  private popped = 0;
  private previewT = 0;

  constructor(services: GameServices) {
    super(services);
    this.u = this.W / DESIGN_W;
    this.shield = this.hasBoost('shield');
    this.roundSec = ROUND_SEC + (this.hasBoost('head-start') ? EXTRA_SEC : 0);
    this.timeLeft = this.roundSec;
    for (const key of ['gems', 'combo']) this.addStat(key, 0);
    this.grid = newBoard(this.rng);
  }

  protected tick(dt: number): void {
    this.drop = this.drop.map((d) => Math.max(0, d - FALL_RATE * dt));
    if (this.isEnding) return;
    this.timeLeft -= dt;
    if (this.timeLeft <= 0) {
      if (this.shield) {
        this.shield = false;
        this.timeLeft = 10;
        this.roundSec = Math.max(this.roundSec, 10);
        this.texts.add(this.W / 2, this.H * 0.5, 'SHIELD +10s', '#67e8f9', 26 * this.u, 1.2);
        this.audio.play('powerup');
      } else {
        this.timeLeft = 0;
        this.audio.play('win');
        this.endGame(1.4, false);
        return;
      }
    }
    if (this.swapping) {
      this.swapping.t += dt / SWAP_SEC;
      if (this.swapping.t >= 1) this.finishSwap();
      return;
    }
    if (this.settling) {
      if (this.drop.some((d) => d > 0)) return;
      this.resolve();
      return;
    }
    if (this.services.preview) {
      this.previewT += dt;
      if (this.previewT > 0.6) {
        this.previewT = 0;
        this.autoMove();
      }
      return;
    }
    this.readInput();
  }

  render(): void {
    const ctx = this.ctx;
    const g = ctx.createLinearGradient(0, 0, 0, this.H);
    g.addColorStop(0, this.skinColor('bg1', '#312e81'));
    g.addColorStop(1, this.skinColor('bg2', '#0f172a'));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.W, this.H);
    const b = this.board();
    ctx.save();
    ctx.translate(this.shake.x, this.shake.y);
    fillRoundRect(
      ctx,
      b.x - 6 * this.u,
      b.y - 6 * this.u,
      b.cell * SIZE + 12 * this.u,
      b.cell * SIZE + 12 * this.u,
      14 * this.u,
      'rgba(0,0,0,0.3)',
    );
    for (let i = 0; i < SIZE * SIZE; i++) {
      if ((i + Math.floor(i / SIZE)) % 2 === 0) {
        ctx.fillStyle = 'rgba(255,255,255,0.05)';
        ctx.fillRect(b.x + (i % SIZE) * b.cell, b.y + Math.floor(i / SIZE) * b.cell, b.cell, b.cell);
      }
    }
    ctx.save();
    ctx.beginPath();
    ctx.rect(b.x, b.y, b.cell * SIZE, b.cell * SIZE);
    ctx.clip();
    for (let i = 0; i < SIZE * SIZE; i++) this.drawCell(i, b);
    ctx.restore();
    const sel = this.selected >= 0 ? this.selected : this.keyboard ? this.cursor : -1;
    if (sel >= 0) {
      ctx.strokeStyle = this.selected >= 0 ? '#ffffff' : '#fde047';
      ctx.lineWidth = 3 * this.u;
      roundRectPath(
        ctx,
        b.x + (sel % SIZE) * b.cell + 2,
        b.y + Math.floor(sel / SIZE) * b.cell + 2,
        b.cell - 4,
        b.cell - 4,
        b.cell * 0.2,
      );
      ctx.stroke();
    }
    this.particles.render(ctx);
    this.texts.render(ctx);
    ctx.restore();
    if (this.services.preview) return;
    drawStatBar(ctx, this.W, this.insets.top, this.u, [
      ['SCORE', Math.floor(this.score).toLocaleString('en-US')],
      ['TIME', String(Math.ceil(this.timeLeft))],
      ['GEMS', String(this.popped)],
    ]);
    const barY = b.y + b.cell * SIZE + 24 * this.u;
    const t = this.timeLeft / this.roundSec;
    progressBar(ctx, b.x, barY, b.cell * SIZE, 12 * this.u, t, t < 0.2 ? '#ef4444' : '#a5b4fc');
    text(ctx, 'Swipe a gem, or tap two neighbours, to swap', this.W / 2, barY + 34 * this.u, {
      size: Math.round(15 * this.u),
      align: 'center',
      color: 'rgba(255,255,255,0.55)',
      weight: 600,
      stroke: null,
    });
  }

  private board(): { x: number; y: number; cell: number } {
    const top = this.insets.top + statBarHeight(this.u) + 20 * this.u;
    const bottom = this.H - this.insets.bottom - 90 * this.u;
    const size = Math.min(this.W - 24 * this.u, bottom - top);
    return { x: (this.W - size) / 2, y: top + (bottom - top - size) * 0.4, cell: size / SIZE };
  }

  private cellAt(px: number, py: number): number | null {
    const b = this.board();
    const c = Math.floor((px - b.x) / b.cell);
    const r = Math.floor((py - b.y) / b.cell);
    return c >= 0 && c < SIZE && r >= 0 && r < SIZE ? r * SIZE + c : null;
  }

  /** Tap a gem and swipe, or tap two neighbours; on a keyboard pick with Space and swap with an arrow. */
  private readInput(): void {
    const p = this.input.pointer;
    if (p.pressed) {
      this.keyboard = false;
      const i = this.cellAt(p.x, p.y);
      if (i === null) this.selected = -1;
      else if (this.selected >= 0 && adjacent(this.selected, i)) this.trySwap(this.selected, i);
      else this.selected = i;
    }
    const swipe = this.input.consumeSwipe();
    if (swipe && this.selected >= 0) {
      const to = this.neighbour(this.selected, swipe);
      if (to !== null) this.trySwap(this.selected, to);
      return;
    }
    for (const d of ['left', 'right', 'up', 'down'] as const) {
      if (!this.input.wasPressed(d)) continue;
      this.keyboard = true;
      const to = this.neighbour(this.selected >= 0 ? this.selected : this.cursor, d);
      if (to === null) continue;
      if (this.selected >= 0) this.trySwap(this.selected, to);
      else this.cursor = to;
    }
    if (this.input.wasPressed('primary')) {
      this.keyboard = true;
      this.selected = this.selected >= 0 ? -1 : this.cursor;
    }
  }

  private neighbour(i: number, d: 'left' | 'right' | 'up' | 'down'): number | null {
    const c = i % SIZE;
    const r = Math.floor(i / SIZE);
    if (d === 'left') return c > 0 ? i - 1 : null;
    if (d === 'right') return c < SIZE - 1 ? i + 1 : null;
    if (d === 'up') return r > 0 ? i - SIZE : null;
    return r < SIZE - 1 ? i + SIZE : null;
  }

  private trySwap(a: number, b: number): void {
    this.selected = -1;
    this.cursor = b;
    this.swapping = { a, b, ok: swapMatches(this.grid, a, b), t: 0 };
    this.audio.play('click', { volume: 0.4 });
  }

  /** A swap that makes a line stands and the board settles; one that does not slides back. */
  private finishSwap(): void {
    const s = this.swapping;
    this.swapping = null;
    if (!s) return;
    if (!s.ok) {
      this.audio.play('bump', { volume: 0.4 });
      return;
    }
    swap(this.grid, s.a, s.b);
    this.cascade = 0;
    this.resolve();
  }

  /** Clears every line, scores it (times the cascade), drops the gems, and repeats until nothing matches. */
  private resolve(): void {
    const matches = findMatches(this.grid);
    if (matches.size === 0) {
      this.settling = false;
      if (!hasMove(this.grid)) {
        this.grid = newBoard(this.rng);
        this.drop = Array<number>(SIZE * SIZE).fill(SIZE);
        this.texts.add(this.W / 2, this.H * 0.45, 'NO MOVES: SHUFFLE', '#c7d2fe', 24 * this.u, 1.2);
      }
      return;
    }
    this.cascade++;
    this.maxStat('combo', this.cascade);
    const points = matches.size * GEM_POINTS * this.cascade;
    this.score += points;
    this.popped += matches.size;
    this.addStat('gems', matches.size);
    if (Math.floor(this.popped / COIN_GEMS) > Math.floor((this.popped - matches.size) / COIN_GEMS))
      this.coins++;
    // Big lines buy time: a line of four adds a second, five or more adds two.
    if (matches.size >= 4) this.timeLeft += matches.size >= 5 ? 2 : 1;
    const b = this.board();
    let cx = 0;
    let cy = 0;
    for (const i of matches) {
      const x = b.x + ((i % SIZE) + 0.5) * b.cell;
      const y = b.y + (Math.floor(i / SIZE) + 0.5) * b.cell;
      cx += x;
      cy += y;
      this.particles.emit({
        x,
        y,
        count: 6,
        speed: 150 * this.u,
        life: 0.45,
        size: 3,
        colors: [this.colour(this.grid[i] ?? 0), '#ffffff'],
      });
      this.grid[i] = -1;
    }
    this.texts.add(
      cx / matches.size,
      cy / matches.size,
      this.cascade > 1 ? `+${points} x${this.cascade}` : `+${points}`,
      '#fde047',
      20 * this.u,
      0.8,
    );
    this.audio.play(this.cascade > 1 ? 'reward' : 'pop', { volume: 0.6 });
    this.drop = collapse(this.grid, this.rng);
    this.settling = true;
  }

  /** Card art plays the first swap it finds. */
  private autoMove(): void {
    for (let i = 0; i < SIZE * SIZE; i++) {
      for (const j of [i + 1, i + SIZE]) {
        if (j < SIZE * SIZE && adjacent(i, j) && swapMatches(this.grid, i, j)) {
          this.trySwap(i, j);
          return;
        }
      }
    }
  }

  private colour(k: number): string {
    return this.skinColor(`g${k + 1}`, DEFAULT_COLOURS[k % DEFAULT_COLOURS.length] ?? '#ffffff');
  }

  private drawCell(i: number, b: { x: number; y: number; cell: number }): void {
    const k = this.grid[i] ?? -1;
    if (k < 0) return;
    let cx = b.x + ((i % SIZE) + 0.5) * b.cell;
    let cy = b.y + (Math.floor(i / SIZE) + 0.5) * b.cell - (this.drop[i] ?? 0) * b.cell;
    const s = this.swapping;
    if (s && (i === s.a || i === s.b)) {
      // Swapping gems slide toward each other's place; a failed swap goes halfway and back.
      const other = i === s.a ? s.b : s.a;
      const f = s.ok ? s.t : Math.sin(s.t * Math.PI) * 0.5;
      cx += ((other % SIZE) - (i % SIZE)) * b.cell * f;
      cy += (Math.floor(other / SIZE) - Math.floor(i / SIZE)) * b.cell * f;
    }
    this.drawGem(k, cx, cy, b.cell * 0.38);
  }

  /** Each kind has its own cut, so colour is not the only clue. */
  private drawGem(k: number, x: number, y: number, r: number): void {
    const ctx = this.ctx;
    const colour = this.colour(k);
    const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.35, r * 0.1, x, y, r * 1.1);
    g.addColorStop(0, shade(colour, 0.5));
    g.addColorStop(1, shade(colour, -0.2));
    ctx.fillStyle = g;
    ctx.beginPath();
    const shape = k % KINDS;
    if (shape === 0) ctx.arc(x, y, r, 0, TAU);
    else if (shape === 1) {
      ctx.moveTo(x, y - r * 1.1);
      ctx.lineTo(x + r, y);
      ctx.lineTo(x, y + r * 1.1);
      ctx.lineTo(x - r, y);
    } else if (shape === 2) ctx.rect(x - r * 0.85, y - r * 0.85, r * 1.7, r * 1.7);
    else if (shape === 3) {
      ctx.moveTo(x, y - r * 1.05);
      ctx.lineTo(x + r, y + r * 0.8);
      ctx.lineTo(x - r, y + r * 0.8);
    } else if (shape === 4) {
      for (let q = 0; q < 6; q++)
        ctx.lineTo(x + Math.cos((q / 6) * TAU) * r, y + Math.sin((q / 6) * TAU) * r);
    } else {
      for (let q = 0; q < 10; q++) {
        const a = -Math.PI / 2 + (q / 10) * TAU;
        const rr = q % 2 === 0 ? r * 1.1 : r * 0.5;
        ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
      }
    }
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = shade(colour, -0.45);
    ctx.lineWidth = Math.max(1, r * 0.08);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.beginPath();
    ctx.arc(x - r * 0.3, y - r * 0.32, r * 0.16, 0, TAU);
    ctx.fill();
  }
}
