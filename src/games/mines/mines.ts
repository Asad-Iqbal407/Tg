import { TAU } from '../../core/math';
import { BaseGame } from '../base';
import { banner, fillRoundRect, roundRectPath, shade, text } from '../draw';
import { drawStatBar, statBarHeight } from '../statbar';
import type { GameServices } from '../types';
import { Board } from './board';

const DESIGN_W = 600;
const COLS = 9;
const ROWS = 12;
/** Mines on board 1; each board adds MINES_STEP more, up to MAX_MINES. */
const START_MINES = 14;
const MINES_STEP = 3;
const MAX_MINES = 30;
const CELL_POINTS = 5;
const BOARD_BONUS = 300;
const BOARD_COINS = 2;
/** Holding a cell this long flags it instead of digging. */
const LONG_PRESS_SEC = 0.38;
/** A press that moves further than this (logical px) is not a tap. */
const SLOP = 20;
const CLEAR_SEC = 1.6;
const HEAD_START_FLAGS = 4;
const NUMBER_COLOURS = [
  '',
  '#2563eb',
  '#16a34a',
  '#dc2626',
  '#7c3aed',
  '#b45309',
  '#0891b2',
  '#111827',
  '#6b7280',
];

/** Mines on board `n` (1-based). */
export function minesFor(n: number): number {
  return Math.min(MAX_MINES, START_MINES + MINES_STEP * (n - 1));
}

interface Grid {
  x: number;
  y: number;
  cell: number;
}

/** Minesweeper: open every safe cell. Numbers count the mines around them; flag the mines you find. */
export class MinesGame extends BaseGame {
  private readonly u: number;
  private board: Board;
  private boardNum = 1;
  private flagMode = false;
  private shield = false;
  private clearT = 0;
  private bannerT = 1.4;
  private cursor = Math.floor((ROWS / 2) * COLS + COLS / 2);
  private keyboard = false;
  /** The press in progress: where it started, when, and whether a long press already used it. */
  private press: { x: number; y: number; t: number; used: boolean } | null = null;
  /** The mine that ended the run, drawn on red. */
  private boom = -1;

  constructor(services: GameServices) {
    super(services);
    this.u = this.W / DESIGN_W;
    this.shield = this.hasBoost('shield');
    for (const key of ['cells', 'boards', 'flags']) this.addStat(key, 0);
    this.board = new Board(COLS, ROWS, minesFor(1));
    if (services.preview) this.previewBoard();
  }

  protected tick(dt: number): void {
    this.bannerT = Math.max(0, this.bannerT - dt);
    if (this.isEnding) return;
    if (this.clearT > 0) {
      this.clearT -= dt;
      if (this.clearT <= 0) this.nextBoard();
      return;
    }
    this.readPointer();
    this.readKeys();
  }

  render(): void {
    const ctx = this.ctx;
    const g = ctx.createLinearGradient(0, 0, 0, this.H);
    g.addColorStop(0, this.skinColor('bg1', '#334155'));
    g.addColorStop(1, this.skinColor('bg2', '#0f172a'));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.W, this.H);
    const grid = this.grid();
    ctx.save();
    ctx.translate(this.shake.x, this.shake.y);
    fillRoundRect(
      ctx,
      grid.x - 6 * this.u,
      grid.y - 6 * this.u,
      grid.cell * COLS + 12 * this.u,
      grid.cell * ROWS + 12 * this.u,
      10 * this.u,
      'rgba(0,0,0,0.35)',
    );
    this.board.cells.forEach((_, i) => this.drawCell(i, grid));
    if (this.keyboard) {
      const x = grid.x + (this.cursor % COLS) * grid.cell;
      const y = grid.y + Math.floor(this.cursor / COLS) * grid.cell;
      ctx.strokeStyle = '#fde047';
      ctx.lineWidth = 3 * this.u;
      ctx.strokeRect(x + 1, y + 1, grid.cell - 2, grid.cell - 2);
    }
    this.particles.render(ctx);
    this.texts.render(ctx);
    ctx.restore();
    if (this.services.preview) return;
    const left = this.board.mines - this.board.flagsPlaced();
    drawStatBar(ctx, this.W, this.insets.top, this.u, [
      ['SCORE', Math.floor(this.score).toLocaleString('en-US')],
      ['BOARD', String(this.boardNum)],
      ['MINES', String(left)],
    ]);
    this.drawModeButton();
    if (this.clearT > 0) {
      banner(
        ctx,
        this.W,
        this.H,
        'BOARD CLEAR',
        `Board ${this.boardNum + 1} next`,
        1 - this.clearT / CLEAR_SEC,
        '#86efac',
      );
    } else if (this.bannerT > 0 && !this.board.laid) {
      banner(
        ctx,
        this.W,
        this.H,
        `BOARD ${this.boardNum}`,
        `${this.board.mines} mines`,
        1 - this.bannerT / 1.4,
      );
    }
  }

  private grid(): Grid {
    const top = this.insets.top + statBarHeight(this.u) + 8 * this.u;
    const bottom = this.modeButton().y - 30 * this.u;
    const cell = Math.min((this.W - 28 * this.u) / COLS, (bottom - top) / ROWS);
    return { x: (this.W - cell * COLS) / 2, y: top + (bottom - top - cell * ROWS) / 2, cell };
  }

  private modeButton(): { x: number; y: number; w: number; h: number } {
    const h = 58 * this.u;
    const w = 260 * this.u;
    return { x: (this.W - w) / 2, y: this.H - this.insets.bottom - h - 14 * this.u, w, h };
  }

  private cellAt(px: number, py: number): number | null {
    const g = this.grid();
    const c = Math.floor((px - g.x) / g.cell);
    const r = Math.floor((py - g.y) / g.cell);
    if (c < 0 || c >= COLS || r < 0 || r >= ROWS) return null;
    return this.board.index(c, r);
  }

  /**
   * A tap digs (or flags in flag mode). Holding a cell flags it, whatever the mode. A tap on the mode button switches
   * between digging and flagging. A press that slides off is ignored.
   */
  private readPointer(): void {
    const p = this.input.pointer;
    if (p.pressed) {
      this.keyboard = false;
      this.press = { x: p.x, y: p.y, t: this.time, used: false };
    }
    const press = this.press;
    if (!press) return;
    const moved = Math.hypot(p.x - press.x, p.y - press.y) > SLOP * this.u;
    if (p.down && !press.used && !moved && this.time - press.t >= LONG_PRESS_SEC) {
      press.used = true;
      const i = this.cellAt(press.x, press.y);
      if (i !== null) this.flag(i);
    }
    if (!p.released && p.down) return;
    this.press = null;
    if (press.used || moved) return;
    const b = this.modeButton();
    if (press.x >= b.x && press.x <= b.x + b.w && press.y >= b.y && press.y <= b.y + b.h) {
      this.flagMode = !this.flagMode;
      this.audio.play('select');
      return;
    }
    const i = this.cellAt(press.x, press.y);
    if (i === null) return;
    if (this.flagMode && !this.board.cells[i]?.open) this.flag(i);
    else this.dig(i);
  }

  /** Arrow keys move a cursor; Space digs and X / Shift flags. */
  private readKeys(): void {
    const before = this.cursor;
    const c = this.cursor % COLS;
    const r = Math.floor(this.cursor / COLS);
    if (this.input.wasPressed('left')) this.cursor = r * COLS + Math.max(0, c - 1);
    if (this.input.wasPressed('right')) this.cursor = r * COLS + Math.min(COLS - 1, c + 1);
    if (this.input.wasPressed('up')) this.cursor = Math.max(0, r - 1) * COLS + c;
    if (this.input.wasPressed('down')) this.cursor = Math.min(ROWS - 1, r + 1) * COLS + c;
    if (this.cursor !== before) this.keyboard = true;
    if (this.input.wasPressed('primary')) {
      this.keyboard = true;
      this.dig(this.cursor);
    } else if (this.input.wasPressed('secondary')) {
      this.keyboard = true;
      this.flag(this.cursor);
    }
  }

  private flag(i: number): void {
    if (!this.board.laid) return;
    if (this.board.toggleFlag(i)) {
      this.audio.play('click', { volume: 0.5 });
      this.services.haptic(20);
    }
  }

  private dig(i: number): void {
    const b = this.board;
    if (!b.laid) {
      b.lay(this.rng, i);
      if (this.hasBoost('head-start')) this.flagSome(HEAD_START_FLAGS);
    }
    const cell = b.cells[i];
    if (!cell) return;
    const opened = cell.open ? b.chord(i) : b.open(i);
    if (opened === null) {
      this.mineHit();
      return;
    }
    if (opened.length === 0) return;
    this.score += opened.length * CELL_POINTS;
    this.addStat('cells', opened.length);
    this.audio.play(opened.length > 5 ? 'whoosh' : 'pop', { volume: 0.6 });
    if (b.cleared()) this.clearBoard();
  }

  /** Flags `n` mines for the head start. */
  private flagSome(n: number): void {
    const mines = this.board.cells.map((c, i) => (c.mine ? i : -1)).filter((i) => i >= 0);
    for (const i of this.rng.shuffle(mines).slice(0, n)) {
      const cell = this.board.cells[i];
      if (cell) cell.flag = true;
    }
  }

  /** A mine went off. The shield defuses the first one (it is flagged instead); otherwise the run ends. */
  private mineHit(): void {
    const i = this.board.cells.findIndex((c) => c.mine && c.open);
    const cell = this.board.cells[i];
    const g = this.grid();
    const x = g.x + ((i % COLS) + 0.5) * g.cell;
    const y = g.y + (Math.floor(i / COLS) + 0.5) * g.cell;
    if (this.shield && cell) {
      this.shield = false;
      cell.open = false;
      cell.flag = true;
      this.texts.add(x, y - g.cell, 'DEFUSED', '#67e8f9', 22 * this.u, 1.2);
      this.audio.play('powerup');
      return;
    }
    this.boom = i;
    for (const c of this.board.cells) if (c.mine && !c.flag) c.open = true;
    this.countFlags();
    this.particles.emit({
      x,
      y,
      count: 40,
      speed: 280 * this.u,
      life: 0.8,
      size: 4,
      colors: ['#f97316', '#fde047', '#111827'],
    });
    this.shake.add(0.7);
    this.audio.play('explode');
    this.services.haptic(150);
    this.endGame(2);
  }

  private clearBoard(): void {
    this.countFlags();
    this.score += BOARD_BONUS * this.boardNum;
    this.coins += BOARD_COINS;
    this.addStat('boards');
    // Every mine is shown flagged once the board is clear.
    for (const c of this.board.cells) if (c.mine) c.flag = true;
    this.clearT = CLEAR_SEC;
    this.audio.play('levelup');
  }

  /** Correct flags count toward the flags stat when a board ends. */
  private countFlags(): void {
    this.addStat('flags', this.board.cells.filter((c) => c.mine && c.flag).length);
  }

  private nextBoard(): void {
    this.boardNum++;
    this.board = new Board(COLS, ROWS, minesFor(this.boardNum));
    this.flagMode = false;
    this.bannerT = 1.4;
  }

  /** Card art: a board part way through, with a few flags. */
  private previewBoard(): void {
    const b = this.board;
    b.lay(this.rng, b.index(4, 6));
    b.open(b.index(4, 6));
    let flags = 0;
    b.cells.forEach((c, i) => {
      if (c.mine && flags < 3 && b.around(i).some((k) => b.cells[k]?.open)) {
        c.flag = true;
        flags++;
      }
    });
  }

  private drawCell(i: number, g: Grid): void {
    const ctx = this.ctx;
    const cell = this.board.cells[i];
    if (!cell) return;
    const x = g.x + (i % COLS) * g.cell;
    const y = g.y + Math.floor(i / COLS) * g.cell;
    const s = g.cell;
    const pad = s * 0.05;
    if (cell.open) {
      const base =
        (i + Math.floor(i / COLS)) % 2 === 0
          ? this.skinColor('open1', '#e2e8f0')
          : this.skinColor('open2', '#cbd5e1');
      ctx.fillStyle = i === this.boom ? '#ef4444' : base;
      ctx.fillRect(x, y, s, s);
      if (cell.mine) this.drawMine(x + s / 2, y + s / 2, s * 0.28);
      else if (cell.near > 0) {
        text(ctx, String(cell.near), x + s / 2, y + s / 2 + s * 0.03, {
          size: Math.round(s * 0.58),
          align: 'center',
          color: NUMBER_COLOURS[cell.near] ?? '#111827',
          stroke: null,
          weight: 900,
        });
      }
      return;
    }
    const tile =
      (i + Math.floor(i / COLS)) % 2 === 0
        ? this.skinColor('tile1', '#4ade80')
        : this.skinColor('tile2', '#22c55e');
    fillRoundRect(ctx, x + pad, y + pad, s - pad * 2, s - pad * 2, s * 0.14, tile);
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.fillRect(x + pad * 2, y + pad * 2, s - pad * 4, s * 0.1);
    ctx.fillStyle = shade(tile, -0.25);
    ctx.fillRect(x + pad * 2, y + s - pad * 2 - s * 0.08, s - pad * 4, s * 0.08);
    if (cell.flag) this.drawFlag(x + s / 2, y + s / 2, s * 0.32);
  }

  private drawFlag(cx: number, cy: number, r: number): void {
    const ctx = this.ctx;
    ctx.fillStyle = '#1f2937';
    ctx.fillRect(cx - r * 0.35, cy - r, r * 0.16, r * 1.9);
    ctx.fillRect(cx - r * 0.7, cy + r * 0.8, r * 1.1, r * 0.2);
    ctx.fillStyle = this.skinColor('flag', '#ef4444');
    ctx.beginPath();
    ctx.moveTo(cx - r * 0.2, cy - r);
    ctx.lineTo(cx + r * 0.85, cy - r * 0.55);
    ctx.lineTo(cx - r * 0.2, cy - r * 0.1);
    ctx.closePath();
    ctx.fill();
  }

  private drawMine(cx: number, cy: number, r: number): void {
    const ctx = this.ctx;
    ctx.strokeStyle = '#111827';
    ctx.lineWidth = r * 0.22;
    ctx.beginPath();
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI;
      ctx.moveTo(cx + Math.cos(a) * r * 1.3, cy + Math.sin(a) * r * 1.3);
      ctx.lineTo(cx - Math.cos(a) * r * 1.3, cy - Math.sin(a) * r * 1.3);
    }
    ctx.stroke();
    ctx.fillStyle = '#111827';
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, TAU);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.beginPath();
    ctx.arc(cx - r * 0.35, cy - r * 0.35, r * 0.25, 0, TAU);
    ctx.fill();
  }

  private drawModeButton(): void {
    const ctx = this.ctx;
    const b = this.modeButton();
    const flag = this.flagMode;
    fillRoundRect(ctx, b.x, b.y, b.w, b.h, b.h / 2, flag ? '#b91c1c' : 'rgba(15,23,42,0.75)');
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 2 * this.u;
    roundRectPath(ctx, b.x, b.y, b.w, b.h, b.h / 2);
    ctx.stroke();
    if (flag) this.drawFlag(b.x + b.h * 0.6, b.y + b.h / 2, b.h * 0.26);
    else this.drawMine(b.x + b.h * 0.6, b.y + b.h / 2, b.h * 0.2);
    text(ctx, flag ? 'FLAG MODE' : 'DIG MODE', b.x + b.w / 2 + b.h * 0.25, b.y + b.h / 2, {
      size: Math.round(20 * this.u),
      align: 'center',
    });
    text(ctx, 'Tap to switch · hold a cell to flag', this.W / 2, b.y - 14 * this.u, {
      size: Math.round(13 * this.u),
      align: 'center',
      color: 'rgba(255,255,255,0.6)',
      weight: 600,
      stroke: null,
    });
  }
}
