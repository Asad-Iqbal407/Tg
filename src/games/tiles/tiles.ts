import type { SfxName } from '../../core/audio';
import { BaseGame } from '../base';
import { fillRoundRect, text } from '../draw';
import { drawStatBar, statBarHeight } from '../statbar';
import type { GameServices } from '../types';

export const LANES = 4;
/** Rows of tiles visible at once. */
const VISIBLE = 4;
const START_SPEED = 2.4;
const SPEED_GAIN = 0.035;
const MAX_SPEED = 7.5;
const COIN_TILES = 50;
const KEYS = ['left', 'down', 'up', 'right'] as const;
const NOTES: readonly SfxName[] = ['click', 'pop', 'select', 'coin'];
const DESIGN_W = 600;

/** Scroll speed in rows per second after `hits` tiles (the head start builds speed half as fast). */
export function speedAfter(hits: number, gentle: boolean): number {
  return Math.min(MAX_SPEED, START_SPEED + SPEED_GAIN * hits * (gentle ? 0.5 : 1));
}

interface Row {
  lane: number;
  hit: boolean;
}

/** Piano Tiles: tap the black tiles in order as they scroll down. Tap white, or let one slip past, and the song ends. */
export class TilesGame extends BaseGame {
  private readonly u: number;
  /** Rows from the bottom up; row 0 is the first tile. */
  private rows: Row[] = [];
  /** How far the board has scrolled, in rows. */
  private scroll = 0;
  private next = 0;
  private started = false;
  private shield = false;
  private wrong: { lane: number; row: number; t: number } | null = null;
  private flash = new Map<number, number>();

  constructor(services: GameServices) {
    super(services);
    this.u = this.W / DESIGN_W;
    this.shield = this.hasBoost('shield');
    this.addStat('tiles', 0);
    this.ensureRows();
    if (services.preview) this.started = true;
  }

  protected tick(dt: number): void {
    for (const [k, t] of this.flash) {
      if (t - dt <= 0) this.flash.delete(k);
      else this.flash.set(k, t - dt);
    }
    if (this.wrong) this.wrong.t -= dt;
    if (this.isEnding) return;
    const lane = this.readLane();
    if (!this.started) {
      if (lane === (this.rows[0]?.lane ?? -1)) {
        this.started = true;
        this.hitNext();
      } else if (lane !== null) this.miss(lane, 0);
      return;
    }
    this.scroll += speedAfter(this.next, this.hasBoost('head-start')) * dt;
    if (this.services.preview && this.scroll > this.next - 0.6) this.hitNext();
    if (lane !== null) this.tap(lane);
    // The next tile has scrolled off the bottom without a tap.
    if (this.scroll > this.next + 1) this.slipped();
    this.ensureRows();
  }

  render(): void {
    const ctx = this.ctx;
    const b = this.board();
    ctx.fillStyle = this.skinColor('bg', '#e2e8f0');
    ctx.fillRect(0, 0, this.W, this.H);
    ctx.save();
    ctx.translate(this.shake.x, this.shake.y);
    ctx.fillStyle = this.skinColor('white', '#f8fafc');
    ctx.fillRect(b.x, b.y, b.w, b.h);
    // Tiles scroll in from above the board and out below it: only the board itself shows them.
    ctx.save();
    ctx.beginPath();
    ctx.rect(b.x, b.y, b.w, b.h);
    ctx.clip();
    const first = Math.max(0, Math.floor(this.scroll) - 1);
    for (let n = first; n < first + VISIBLE + 2; n++) {
      const row = this.rows[n];
      if (!row) continue;
      const y = this.rowTop(n, b);
      const x = b.x + row.lane * (b.w / LANES);
      const w = b.w / LANES;
      const h = b.h / VISIBLE;
      const fade = this.flash.get(n) ?? 0;
      const colour = row.hit ? this.skinColor('done', '#cbd5e1') : this.skinColor('tile', '#111827');
      fillRoundRect(ctx, x + 2, y + 2, w - 4, h - 4, 8 * this.u, colour);
      if (fade > 0) {
        ctx.fillStyle = `rgba(255,255,255,${fade * 2})`;
        ctx.fillRect(x, y, w, h);
      }
      if (n === 0 && !this.started) {
        text(ctx, 'START', x + w / 2, y + h / 2, { size: Math.round(26 * this.u), align: 'center' });
      }
    }
    if (this.wrong && this.wrong.t > 0) {
      ctx.fillStyle = `rgba(239,68,68,${Math.min(1, this.wrong.t * 2)})`;
      ctx.fillRect(
        b.x + this.wrong.lane * (b.w / LANES),
        this.rowTop(this.wrong.row, b),
        b.w / LANES,
        b.h / VISIBLE,
      );
    }
    ctx.strokeStyle = 'rgba(15,23,42,0.15)';
    ctx.lineWidth = 2;
    for (let k = 1; k < LANES; k++) {
      ctx.beginPath();
      ctx.moveTo(b.x + (k * b.w) / LANES, b.y);
      ctx.lineTo(b.x + (k * b.w) / LANES, b.y + b.h);
      ctx.stroke();
    }
    ctx.restore();
    this.particles.render(ctx);
    ctx.restore();
    if (this.services.preview) return;
    drawStatBar(ctx, this.W, this.insets.top, this.u, [
      ['TILES', String(this.next)],
      ['SPEED', speedAfter(this.next, this.hasBoost('head-start')).toFixed(1)],
      ['BEST', String(this.stats['tiles'] ?? 0)],
    ]);
  }

  private board(): { x: number; y: number; w: number; h: number } {
    const top = this.insets.top + statBarHeight(this.u);
    const bottom = this.H - this.insets.bottom;
    return { x: 0, y: top, w: this.W, h: bottom - top };
  }

  /** Screen y of the top of row n: row `scroll` sits at the bottom of the board. */
  private rowTop(n: number, b: { y: number; h: number }): number {
    const h = b.h / VISIBLE;
    return b.y + b.h - (n - this.scroll + 1) * h;
  }

  private ensureRows(): void {
    while (this.rows.length < Math.ceil(this.scroll) + VISIBLE + 3) {
      const prev = this.rows[this.rows.length - 1]?.lane ?? -1;
      // No tile repeats its lane straight away, so every step is a new reach.
      let lane = this.rng.int(0, LANES - 1);
      if (lane === prev) lane = (lane + 1 + this.rng.int(0, LANES - 2)) % LANES;
      this.rows.push({ lane, hit: false });
    }
  }

  /** The lane of a tap (or an arrow key: ← ↓ ↑ → for lanes one to four), or null. */
  private readLane(): number | null {
    const p = this.input.pointer;
    if (p.pressed) {
      const b = this.board();
      if (p.y < b.y || p.y > b.y + b.h) return null;
      return Math.max(0, Math.min(LANES - 1, Math.floor(((p.x - b.x) / b.w) * LANES)));
    }
    for (let i = 0; i < LANES; i++) if (this.input.wasPressed(KEYS[i] as (typeof KEYS)[number])) return i;
    return null;
  }

  /** A tap in the next tile's lane plays it; a tap anywhere else on its row is a wrong note. */
  private tap(lane: number): void {
    const row = this.rows[this.next];
    if (!row) return;
    if (lane === row.lane) this.hitNext();
    else this.miss(lane, this.next);
  }

  private hitNext(): void {
    const row = this.rows[this.next];
    if (!row) return;
    row.hit = true;
    this.flash.set(this.next, 0.25);
    this.audio.play(NOTES[row.lane] ?? 'click', { volume: 0.6 });
    this.next++;
    this.score = this.next;
    this.maxStat('tiles', this.next);
    if (this.next % COIN_TILES === 0) this.coins++;
    const b = this.board();
    this.particles.emit({
      x: b.x + (row.lane + 0.5) * (b.w / LANES),
      y: this.rowTop(this.next - 1, b) + b.h / VISIBLE / 2,
      count: 6,
      speed: 120 * this.u,
      life: 0.3,
      size: 3,
      colors: [this.skinColor('spark', '#38bdf8'), '#ffffff'],
    });
  }

  /** A wrong lane. The shield forgives one; otherwise the song is over. */
  private miss(lane: number, row: number): void {
    this.wrong = { lane, row, t: 1 };
    this.audio.play('error');
    this.services.haptic(100);
    this.shake.add(0.3);
    if (this.shield) {
      this.shield = false;
      this.audio.play('powerup');
      return;
    }
    this.endGame(1.4, false);
  }

  /** The next tile went past untapped. The shield lets one go; otherwise the song is over. */
  private slipped(): void {
    const row = this.rows[this.next];
    if (this.shield && row) {
      this.shield = false;
      row.hit = true;
      this.next++;
      this.audio.play('powerup');
      return;
    }
    this.wrong = { lane: row?.lane ?? 0, row: this.next, t: 1 };
    this.scroll = this.next + 0.4;
    this.audio.play('error');
    this.endGame(1.4, false);
  }
}
