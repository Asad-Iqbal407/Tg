import { approach } from '../../core/math';
import type { Rng } from '../../core/rng';
import { BaseGame } from '../base';
import { banner, fillRoundRect, progressBar, roundRectPath, text } from '../draw';
import { drawStatBar, statBarHeight } from '../statbar';
import type { GameServices } from '../types';
import { drawSymbol, SYMBOLS } from './symbols';

export interface Card {
  symbol: number;
  matched: boolean;
  /** True while the card is turned face up (picked or matched). */
  up: boolean;
  /** Flip animation: 0 shows the back, 1 the face. */
  turn: number;
}

const DESIGN_W = 600;
const COLS = 4;
/** Card height over width. */
const CARD_ASPECT = 1.25;
const FLIP_RATE = 7;
/** A wrong pair stays face up this long before turning back (a new pick turns it back at once). */
const MISMATCH_SEC = 0.75;
const MATCH_POINTS = 50;
const MAX_STREAK_MULT = 5;
const LEVEL_BONUS = 200;
const TIME_POINTS = 10;
const STREAK_COIN = 4;
const CLEAR_SEC = 1.4;
const PEEK_SEC = 2;
const SHIELD_SECONDS = 15;

/** Rows of four cards on a level: 3, 4, 5, then 6 from level 4 on. */
export function rowsFor(level: number): number {
  return Math.min(6, 2 + level);
}

/** Seconds on the clock for a level with `pairs` pairs. */
export function timeFor(pairs: number): number {
  return 24 + 4 * pairs;
}

/** A shuffled deck of `pairs` pairs, each pair a different symbol. */
export function deal(rng: Rng, pairs: number): Card[] {
  const symbols = rng.shuffle(Array.from({ length: SYMBOLS.length }, (_, i) => i)).slice(0, pairs);
  const cards = [...symbols, ...symbols].map((symbol) => ({ symbol, matched: false, up: false, turn: 0 }));
  return rng.shuffle(cards);
}

/** Memory Match: turn cards two at a time and find every pair before the clock runs out. */
export class MemoryGame extends BaseGame {
  private readonly u: number;
  private level = 1;
  private cards: Card[] = [];
  /** Indices of the face-up cards still being compared (at most two). */
  private picks: number[] = [];
  /** Seconds left before a wrong pair turns back, or 0. */
  private wrongT = 0;
  private timeLeft = 0;
  private levelTime = 1;
  private streak = 0;
  private cursor = 0;
  /** True once the arrow keys have moved the cursor (and until the next tap), so the cursor shows only then. */
  private keyboard = false;
  private clearT = 0;
  private peekT = 0;
  private bannerT = 0;
  private shield = false;

  constructor(services: GameServices) {
    super(services);
    this.u = this.W / DESIGN_W;
    this.shield = this.hasBoost('shield');
    for (const key of ['pairs', 'levels', 'streak']) this.addStat(key, 0);
    this.startLevel(1);
  }

  protected tick(dt: number): void {
    for (const c of this.cards) c.turn = approach(c.turn, c.up || this.peekT > 0 ? 1 : 0, FLIP_RATE * dt);
    this.bannerT = Math.max(0, this.bannerT - dt);
    if (this.isEnding) return;
    if (this.clearT > 0) {
      this.clearT -= dt;
      if (this.clearT <= 0) this.startLevel(this.level + 1);
      return;
    }
    if (this.peekT > 0) {
      this.peekT -= dt;
      return;
    }
    this.timeLeft -= dt;
    if (this.timeLeft <= 0) {
      this.outOfTime();
      return;
    }
    if (this.wrongT > 0) {
      this.wrongT -= dt;
      if (this.wrongT <= 0) this.turnBackWrong();
    }
    const pick = this.readPick();
    if (pick !== null) this.flip(pick);
  }

  render(): void {
    const ctx = this.ctx;
    const g = ctx.createLinearGradient(0, 0, 0, this.H);
    g.addColorStop(0, this.skinColor('bg1', '#0f766e'));
    g.addColorStop(1, this.skinColor('bg2', '#042f2e'));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.W, this.H);
    const grid = this.grid();
    ctx.save();
    ctx.translate(this.shake.x, this.shake.y);
    this.cards.forEach((c, i) => this.drawCard(c, i, grid));
    this.particles.render(ctx);
    this.texts.render(ctx);
    ctx.restore();
    if (this.services.preview) return;
    drawStatBar(ctx, this.W, this.insets.top, this.u, [
      ['SCORE', Math.floor(this.score).toLocaleString('en-US')],
      ['LEVEL', String(this.level)],
      ['STREAK', this.streak > 1 ? `x${Math.min(MAX_STREAK_MULT, this.streak)}` : '—'],
    ]);
    const barY = this.H - this.insets.bottom - 34 * this.u;
    const t = Math.max(0, this.timeLeft) / this.levelTime;
    progressBar(
      ctx,
      24 * this.u,
      barY,
      this.W - 48 * this.u,
      14 * this.u,
      t,
      t < 0.25 ? '#ef4444' : this.skinColor('accent', '#5eead4'),
    );
    text(ctx, `${Math.ceil(Math.max(0, this.timeLeft))}s`, this.W / 2, barY - 16 * this.u, {
      size: Math.round(18 * this.u),
      align: 'center',
    });
    if (this.clearT > 0) {
      banner(
        ctx,
        this.W,
        this.H,
        'ALL PAIRS!',
        `Level ${this.level + 1} next`,
        1 - this.clearT / CLEAR_SEC,
        '#fde047',
      );
    } else if (this.bannerT > 0) {
      banner(
        ctx,
        this.W,
        this.H,
        `LEVEL ${this.level}`,
        this.peekT > 0 ? 'Remember them!' : 'Find the pairs',
        1 - this.bannerT / 1.6,
      );
    }
  }

  private startLevel(level: number): void {
    this.level = level;
    const pairs = (rowsFor(level) * COLS) / 2;
    this.cards = deal(this.rng, pairs);
    this.picks = [];
    this.wrongT = 0;
    this.levelTime = timeFor(pairs);
    this.timeLeft = this.levelTime;
    this.cursor = 0;
    this.bannerT = 1.6;
    this.peekT = this.hasBoost('head-start') ? PEEK_SEC : 0;
    if (this.services.preview) {
      // Card art shows a game in progress: a few pairs found and one card turned.
      const seen = new Set<number>();
      for (const c of this.cards) {
        if (seen.size < 3 && !seen.has(c.symbol)) seen.add(c.symbol);
        if (seen.has(c.symbol)) {
          c.matched = true;
          c.up = true;
          c.turn = 1;
        }
      }
    }
  }

  private grid(): { x: number; y: number; w: number; h: number; gap: number } {
    const rows = rowsFor(this.level);
    const top = this.insets.top + statBarHeight(this.u) + 8 * this.u;
    const bottom = this.H - this.insets.bottom - 70 * this.u;
    const gap = 12 * this.u;
    const byW = (this.W - 32 * this.u - gap * (COLS - 1)) / COLS;
    const byH = (bottom - top - gap * (rows - 1)) / rows / CARD_ASPECT;
    const w = Math.max(10, Math.min(byW, byH));
    const h = w * CARD_ASPECT;
    const totalW = w * COLS + gap * (COLS - 1);
    const totalH = h * rows + gap * (rows - 1);
    return { x: (this.W - totalW) / 2, y: top + (bottom - top - totalH) / 2, w, h, gap };
  }

  private cardAt(px: number, py: number): number | null {
    const g = this.grid();
    const col = Math.floor((px - g.x) / (g.w + g.gap));
    const row = Math.floor((py - g.y) / (g.h + g.gap));
    if (col < 0 || col >= COLS || row < 0 || row >= rowsFor(this.level)) return null;
    // Taps in the gaps between cards count for nothing.
    if (px - g.x - col * (g.w + g.gap) > g.w || py - g.y - row * (g.h + g.gap) > g.h) return null;
    const i = row * COLS + col;
    return i < this.cards.length ? i : null;
  }

  /** A tap on a card, or the arrow keys moving a cursor and Space turning the card under it. */
  private readPick(): number | null {
    const p = this.input.pointer;
    if (p.pressed) {
      this.keyboard = false;
      return this.cardAt(p.x, p.y);
    }
    const rows = rowsFor(this.level);
    const n = rows * COLS;
    const before = this.cursor;
    if (this.input.wasPressed('left')) this.cursor = (this.cursor + n - 1) % n;
    if (this.input.wasPressed('right')) this.cursor = (this.cursor + 1) % n;
    if (this.input.wasPressed('up')) this.cursor = (this.cursor + n - COLS) % n;
    if (this.input.wasPressed('down')) this.cursor = (this.cursor + COLS) % n;
    if (this.cursor !== before) this.keyboard = true;
    if (!this.input.wasPressed('primary')) return null;
    this.keyboard = true;
    return this.cursor;
  }

  private flip(i: number): void {
    const card = this.cards[i];
    if (!card || card.up || card.matched) return;
    // A third pick turns a wrong pair back straight away, so a quick player never waits.
    if (this.wrongT > 0) this.turnBackWrong();
    card.up = true;
    this.picks.push(i);
    this.audio.play('click', { volume: 0.5 });
    if (this.picks.length < 2) return;
    const [a, b] = this.picks.map((k) => this.cards[k]);
    if (a && b && a.symbol === b.symbol) this.match(a, b);
    else this.wrong();
  }

  private match(a: Card, b: Card): void {
    a.matched = true;
    b.matched = true;
    this.streak++;
    const mult = Math.min(MAX_STREAK_MULT, this.streak);
    const points = MATCH_POINTS * mult;
    this.score += points;
    this.addStat('pairs');
    this.maxStat('streak', this.streak);
    if (this.streak === STREAK_COIN) this.coins++;
    const g = this.grid();
    const at = this.picks[1] ?? 0;
    const x = g.x + (at % COLS) * (g.w + g.gap) + g.w / 2;
    const y = g.y + Math.floor(at / COLS) * (g.h + g.gap) + g.h / 2;
    this.texts.add(
      x,
      y - g.h * 0.3,
      mult > 1 ? `+${points} x${mult}` : `+${points}`,
      '#fde047',
      20 * this.u,
      0.9,
    );
    this.particles.emit({
      x,
      y,
      count: 14,
      speed: 180 * this.u,
      life: 0.5,
      size: 3,
      colors: [SYMBOLS[a.symbol]?.colour ?? '#fff', '#ffffff'],
    });
    this.audio.play(mult > 1 ? 'reward' : 'coin');
    this.services.haptic(12);
    this.picks = [];
    if (this.cards.every((c) => c.matched)) this.clearLevel();
  }

  private wrong(): void {
    this.streak = 0;
    this.wrongT = MISMATCH_SEC;
    this.audio.play('bump', { volume: 0.5 });
  }

  private turnBackWrong(): void {
    for (const k of this.picks) {
      const c = this.cards[k];
      if (c && !c.matched) c.up = false;
    }
    this.picks = [];
    this.wrongT = 0;
  }

  private clearLevel(): void {
    const bonus = LEVEL_BONUS * this.level + Math.ceil(this.timeLeft) * TIME_POINTS;
    this.score += bonus;
    this.coins++;
    this.addStat('levels');
    this.clearT = CLEAR_SEC;
    this.audio.play('levelup');
    this.texts.add(this.W / 2, this.H * 0.6, `+${bonus}`, '#fde047', 28 * this.u, 1.3);
  }

  /** The clock ran out. The shield adds time once; otherwise the run ends. */
  private outOfTime(): void {
    if (this.shield) {
      this.shield = false;
      this.timeLeft = SHIELD_SECONDS;
      this.levelTime = Math.max(this.levelTime, SHIELD_SECONDS);
      this.texts.add(this.W / 2, this.H * 0.5, `SHIELD +${SHIELD_SECONDS}s`, '#67e8f9', 26 * this.u, 1.3);
      this.audio.play('powerup');
      return;
    }
    this.timeLeft = 0;
    for (const c of this.cards) c.up = true;
    this.endGame(1.8);
  }

  private drawCard(c: Card, i: number, g: { x: number; y: number; w: number; h: number; gap: number }): void {
    const ctx = this.ctx;
    const x = g.x + (i % COLS) * (g.w + g.gap);
    const y = g.y + Math.floor(i / COLS) * (g.h + g.gap);
    // The flip squeezes the card to nothing at the half-way point, then opens it on the other side.
    const sx = Math.abs(Math.cos(c.turn * Math.PI));
    const face = c.turn > 0.5;
    const cx = x + g.w / 2;
    const w = g.w * Math.max(0.02, sx);
    const r = 12 * this.u;
    if (face) {
      fillRoundRect(
        ctx,
        cx - w / 2,
        y,
        w,
        g.h,
        r,
        c.matched ? this.skinColor('matched', '#ecfeff') : '#ffffff',
      );
      if (sx > 0.15) {
        ctx.save();
        ctx.translate(cx, y + g.h / 2);
        ctx.scale(sx, 1);
        if (c.matched) ctx.globalAlpha = 0.85;
        drawSymbol(ctx, c.symbol, 0, 0, g.w * 0.28);
        ctx.restore();
      }
    } else {
      const back = this.skinColor('back', '#f97316');
      fillRoundRect(ctx, cx - w / 2, y, w, g.h, r, back);
      ctx.strokeStyle = 'rgba(255,255,255,0.55)';
      ctx.lineWidth = 3 * this.u;
      const m = 8 * this.u * sx;
      roundRectPath(ctx, cx - w / 2 + m, y + 8 * this.u, Math.max(0, w - 2 * m), g.h - 16 * this.u, r * 0.6);
      ctx.stroke();
      if (sx > 0.3) {
        text(ctx, '?', cx, y + g.h / 2, {
          size: Math.round(g.w * 0.4 * sx),
          align: 'center',
          color: 'rgba(255,255,255,0.85)',
        });
      }
    }
    if (this.keyboard && this.cursor === i) {
      ctx.strokeStyle = '#fde047';
      ctx.lineWidth = 4 * this.u;
      roundRectPath(ctx, x - 4 * this.u, y - 4 * this.u, g.w + 8 * this.u, g.h + 8 * this.u, r);
      ctx.stroke();
    }
  }
}
