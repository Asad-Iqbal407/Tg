import { BaseGame } from '../base';
import { banner, fillRoundRect, roundRectPath, text } from '../draw';
import { drawStatBar, statBarHeight } from '../statbar';
import type { GameServices } from '../types';
import { boxOf, colOf, givensFor, type Grid, makePuzzle, rowOf, sees } from './puzzle';

const DESIGN_W = 600;
const MAX_MISTAKES = 3;
const CELL_POINTS = 10;
const PUZZLE_POINTS = 500;
/** Seconds under which a solved puzzle still earns a time bonus, a point a second. */
const TIME_BONUS_SEC = 900;
const PUZZLE_COINS = 2;
const HEAD_START_CELLS = 5;
const CLEAR_SEC = 1.8;

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Sudoku: fill the grid so every row, column and box holds 1 to 9 once. Three mistakes and the run is over. */
export class SudokuGame extends BaseGame {
  private readonly u: number;
  private puzzleNum = 1;
  private given: boolean[] = [];
  private cells: Grid = [];
  private solution: Grid = [];
  /** Pencil marks per cell, a bit per digit. */
  private notes: number[] = [];
  private selected = 40;
  private notesMode = false;
  private mistakes = 0;
  private allowedMistakes: number;
  /** The last wrong entry, shown in red for a moment. */
  private wrong = { cell: -1, digit: 0, t: 0 };
  private puzzleT = 0;
  private clearT = 0;
  private bannerT = 1.4;

  constructor(services: GameServices) {
    super(services);
    this.u = this.W / DESIGN_W;
    this.allowedMistakes = MAX_MISTAKES + (this.hasBoost('shield') ? 1 : 0);
    for (const key of ['puzzles', 'cells']) this.addStat(key, 0);
    this.newPuzzle();
  }

  protected tick(dt: number): void {
    this.bannerT = Math.max(0, this.bannerT - dt);
    this.wrong.t = Math.max(0, this.wrong.t - dt);
    if (this.isEnding) return;
    if (this.clearT > 0) {
      this.clearT -= dt;
      if (this.clearT <= 0) {
        this.puzzleNum++;
        this.newPuzzle();
      }
      return;
    }
    this.puzzleT += dt;
    this.readInput();
  }

  render(): void {
    const ctx = this.ctx;
    const g = ctx.createLinearGradient(0, 0, 0, this.H);
    g.addColorStop(0, this.skinColor('bg1', '#1e293b'));
    g.addColorStop(1, this.skinColor('bg2', '#020617'));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.W, this.H);
    ctx.save();
    ctx.translate(this.shake.x, this.shake.y);
    this.drawGrid();
    this.drawPad();
    this.particles.render(ctx);
    this.texts.render(ctx);
    ctx.restore();
    if (this.services.preview) return;
    drawStatBar(ctx, this.W, this.insets.top, this.u, [
      ['SCORE', Math.floor(this.score).toLocaleString('en-US')],
      ['PUZZLE', String(this.puzzleNum)],
      ['MISTAKES', `${this.mistakes}/${this.allowedMistakes}`],
    ]);
    if (this.clearT > 0) {
      banner(
        ctx,
        this.W,
        this.H,
        'SOLVED!',
        `Puzzle ${this.puzzleNum + 1} next`,
        1 - this.clearT / CLEAR_SEC,
        '#86efac',
      );
    } else if (this.bannerT > 0) {
      banner(
        ctx,
        this.W,
        this.H,
        `PUZZLE ${this.puzzleNum}`,
        `${this.given.filter(Boolean).length} numbers given`,
        1 - this.bannerT / 1.4,
      );
    }
  }

  private newPuzzle(): void {
    const { puzzle, solution } = makePuzzle(this.rng, givensFor(this.puzzleNum));
    this.solution = solution;
    this.cells = [...puzzle];
    if (this.hasBoost('head-start')) {
      const empty = this.rng.shuffle(this.cells.map((v, i) => (v ? -1 : i)).filter((i) => i >= 0));
      for (const i of empty.slice(0, HEAD_START_CELLS)) this.cells[i] = this.solution[i] as number;
    }
    if (this.services.preview) {
      const empty = this.cells.map((v, i) => (v ? -1 : i)).filter((i) => i >= 0);
      for (const i of empty.slice(0, 10)) this.cells[i] = this.solution[i] as number;
    }
    this.given = this.cells.map((v) => v !== 0);
    this.notes = Array<number>(81).fill(0);
    this.selected = this.cells.findIndex((v) => v === 0);
    this.notesMode = false;
    this.puzzleT = 0;
    this.bannerT = 1.4;
  }

  private gridRect(): Rect {
    const top = this.insets.top + statBarHeight(this.u) + 6 * this.u;
    const padTop = this.padTop();
    const size = Math.min(this.W - 24 * this.u, padTop - top - 14 * this.u);
    return { x: (this.W - size) / 2, y: top + (padTop - top - size) / 2, w: size, h: size };
  }

  /** The number pad: nine digit keys in a row, then NOTES and ERASE beneath. */
  private padTop(): number {
    return this.H - this.insets.bottom - this.keySize() * 2 - 30 * this.u;
  }

  private keySize(): number {
    return Math.min(60 * this.u, (this.W - 24 * this.u - 8 * 6 * this.u) / 9);
  }

  private digitKey(d: number): Rect {
    const k = this.keySize();
    const gap = 6 * this.u;
    const total = 9 * k + 8 * gap;
    return { x: (this.W - total) / 2 + (d - 1) * (k + gap), y: this.padTop(), w: k, h: k * 1.1 };
  }

  private toolKey(which: 'notes' | 'erase'): Rect {
    const k = this.keySize();
    const w = 150 * this.u;
    const y = this.padTop() + k * 1.1 + 12 * this.u;
    return { x: which === 'notes' ? this.W / 2 - w - 8 * this.u : this.W / 2 + 8 * this.u, y, w, h: k * 0.8 };
  }

  private readInput(): void {
    const p = this.input.pointer;
    // The arrow keys move the selection; the primary key toggles notes.
    const r = rowOf(this.selected);
    const c = colOf(this.selected);
    if (this.input.wasPressed('left')) this.selected = r * 9 + ((c + 8) % 9);
    if (this.input.wasPressed('right')) this.selected = r * 9 + ((c + 1) % 9);
    if (this.input.wasPressed('up')) this.selected = ((r + 8) % 9) * 9 + c;
    if (this.input.wasPressed('down')) this.selected = ((r + 1) % 9) * 9 + c;
    if (this.input.wasPressed('secondary')) this.notesMode = !this.notesMode;
    if (!p.pressed) return;
    const inside = (b: Rect) => p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h;
    const g = this.gridRect();
    if (inside(g)) {
      const cell = g.w / 9;
      const col = Math.min(8, Math.floor((p.x - g.x) / cell));
      const row = Math.min(8, Math.floor((p.y - g.y) / cell));
      this.selected = row * 9 + col;
      this.audio.play('click', { volume: 0.3 });
      return;
    }
    for (let d = 1; d <= 9; d++) {
      if (inside(this.digitKey(d))) {
        this.enter(d);
        return;
      }
    }
    if (inside(this.toolKey('notes'))) {
      this.notesMode = !this.notesMode;
      this.audio.play('select');
    } else if (inside(this.toolKey('erase'))) this.erase();
  }

  private enter(d: number): void {
    const i = this.selected;
    if (i < 0 || this.given[i] || this.cells[i] !== 0) return;
    if (this.notesMode) {
      this.notes[i] = (this.notes[i] ?? 0) ^ (1 << d);
      this.audio.play('click', { volume: 0.4 });
      return;
    }
    if (this.solution[i] !== d) {
      this.mistake(i, d);
      return;
    }
    this.cells[i] = d;
    this.notes[i] = 0;
    // A placed number clears that pencil mark from every cell it sees.
    for (let j = 0; j < 81; j++) if (sees(i, j)) this.notes[j] = (this.notes[j] ?? 0) & ~(1 << d);
    this.score += CELL_POINTS;
    this.addStat('cells');
    this.audio.play('pop', { volume: 0.6 });
    this.celebrateUnits(i);
    if (this.cells.every((v) => v !== 0)) this.solved();
  }

  /** A row, column or box just completed by cell i gets a sparkle. */
  private celebrateUnits(i: number): void {
    const g = this.gridRect();
    const cell = g.w / 9;
    const done = (pred: (j: number) => boolean) =>
      Array.from({ length: 81 }, (_, j) => j)
        .filter(pred)
        .every((j) => this.cells[j] !== 0);
    const units = [
      done((j) => rowOf(j) === rowOf(i)),
      done((j) => colOf(j) === colOf(i)),
      done((j) => boxOf(j) === boxOf(i)),
    ].filter(Boolean).length;
    if (units === 0) return;
    this.particles.emit({
      x: g.x + (colOf(i) + 0.5) * cell,
      y: g.y + (rowOf(i) + 0.5) * cell,
      count: 12 * units,
      speed: 200 * this.u,
      life: 0.6,
      size: 3,
      colors: ['#fde047', '#86efac', '#ffffff'],
    });
    this.audio.play('reward', { volume: 0.5 });
  }

  private erase(): void {
    const i = this.selected;
    if (i >= 0 && !this.given[i]) this.notes[i] = 0;
  }

  private mistake(i: number, d: number): void {
    this.mistakes++;
    this.wrong = { cell: i, digit: d, t: 0.9 };
    this.shake.add(0.25);
    this.audio.play('bump');
    this.services.haptic(60);
    if (this.mistakes >= this.allowedMistakes) this.endGame(1.6);
  }

  private solved(): void {
    const bonus = PUZZLE_POINTS * this.puzzleNum + Math.max(0, Math.floor(TIME_BONUS_SEC - this.puzzleT));
    this.score += bonus;
    this.coins += PUZZLE_COINS;
    this.addStat('puzzles');
    this.clearT = CLEAR_SEC;
    this.audio.play('levelup');
    this.texts.add(this.W / 2, this.H * 0.45, `+${bonus}`, '#fde047', 30 * this.u, 1.4);
  }

  private drawGrid(): void {
    const ctx = this.ctx;
    const g = this.gridRect();
    const cell = g.w / 9;
    const sel = this.selected;
    const selDigit = this.cells[sel] ?? 0;
    fillRoundRect(
      ctx,
      g.x - 4 * this.u,
      g.y - 4 * this.u,
      g.w + 8 * this.u,
      g.h + 8 * this.u,
      10 * this.u,
      this.skinColor('paper', '#f8fafc'),
    );
    for (let i = 0; i < 81; i++) {
      const x = g.x + colOf(i) * cell;
      const y = g.y + rowOf(i) * cell;
      const v = this.cells[i] ?? 0;
      let shade: string | null = null;
      if (i === sel) shade = this.skinColor('select', '#93c5fd');
      else if (selDigit && v === selDigit) shade = this.skinColor('same', '#bfdbfe');
      else if (sel >= 0 && sees(i, sel)) shade = this.skinColor('peer', '#e2e8f0');
      if (shade) {
        ctx.fillStyle = shade;
        ctx.fillRect(x, y, cell, cell);
      }
      if (v) {
        text(ctx, String(v), x + cell / 2, y + cell / 2 + cell * 0.03, {
          size: Math.round(cell * 0.62),
          align: 'center',
          color: this.given[i] ? this.skinColor('given', '#0f172a') : this.skinColor('ink', '#2563eb'),
          stroke: null,
          weight: this.given[i] ? 800 : 700,
        });
      } else if (this.wrong.t > 0 && this.wrong.cell === i) {
        text(ctx, String(this.wrong.digit), x + cell / 2, y + cell / 2, {
          size: Math.round(cell * 0.62),
          align: 'center',
          color: '#dc2626',
          stroke: null,
        });
      } else if (this.notes[i]) {
        for (let d = 1; d <= 9; d++) {
          if (!((this.notes[i] ?? 0) & (1 << d))) continue;
          text(
            ctx,
            String(d),
            x + (((d - 1) % 3) + 0.5) * (cell / 3),
            y + (Math.floor((d - 1) / 3) + 0.5) * (cell / 3),
            {
              size: Math.round(cell * 0.24),
              align: 'center',
              color: '#64748b',
              stroke: null,
              weight: 600,
            },
          );
        }
      }
    }
    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = Math.max(1, this.u);
    for (let k = 1; k < 9; k++) {
      if (k % 3 === 0) continue;
      ctx.beginPath();
      ctx.moveTo(g.x + k * cell, g.y);
      ctx.lineTo(g.x + k * cell, g.y + g.h);
      ctx.moveTo(g.x, g.y + k * cell);
      ctx.lineTo(g.x + g.w, g.y + k * cell);
      ctx.stroke();
    }
    ctx.strokeStyle = this.skinColor('lines', '#0f172a');
    ctx.lineWidth = 3 * this.u;
    for (let k = 0; k <= 9; k += 3) {
      ctx.beginPath();
      ctx.moveTo(g.x + k * cell, g.y);
      ctx.lineTo(g.x + k * cell, g.y + g.h);
      ctx.moveTo(g.x, g.y + k * cell);
      ctx.lineTo(g.x + g.w, g.y + k * cell);
      ctx.stroke();
    }
  }

  private drawPad(): void {
    const ctx = this.ctx;
    for (let d = 1; d <= 9; d++) {
      const b = this.digitKey(d);
      // A digit already placed nine times is greyed out.
      const used = this.cells.filter((v) => v === d).length >= 9;
      fillRoundRect(
        ctx,
        b.x,
        b.y,
        b.w,
        b.h,
        10 * this.u,
        used ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.92)',
      );
      text(ctx, String(d), b.x + b.w / 2, b.y + b.h / 2, {
        size: Math.round(b.w * 0.55),
        align: 'center',
        color: used ? 'rgba(255,255,255,0.3)' : this.notesMode ? '#64748b' : '#1e3a8a',
        stroke: null,
      });
    }
    for (const which of ['notes', 'erase'] as const) {
      const b = this.toolKey(which);
      const on = which === 'notes' && this.notesMode;
      fillRoundRect(ctx, b.x, b.y, b.w, b.h, b.h / 2, on ? '#f59e0b' : 'rgba(15,23,42,0.75)');
      ctx.strokeStyle = 'rgba(255,255,255,0.3)';
      ctx.lineWidth = 2 * this.u;
      roundRectPath(ctx, b.x, b.y, b.w, b.h, b.h / 2);
      ctx.stroke();
      text(
        ctx,
        which === 'notes' ? (on ? '✎ NOTES ON' : '✎ NOTES') : '⌫ ERASE',
        b.x + b.w / 2,
        b.y + b.h / 2,
        {
          size: Math.round(18 * this.u),
          align: 'center',
        },
      );
    }
  }
}
