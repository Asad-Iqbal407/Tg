import type { Rng } from '../../core/rng';
import { BaseGame } from '../base';
import { banner, roundRectPath, text } from '../draw';
import { drawStatBar, statBarHeight } from '../statbar';
import type { GameServices } from '../types';

/** 0 empty, 1 the player (X), 2 the computer (O). */
export type Board = number[];

export const LINES: readonly [number, number, number][] = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
];

export function winnerOf(b: Board): { who: number; line: [number, number, number] } | null {
  for (const line of LINES) {
    const [a, c, d] = line;
    const v = b[a];
    if (v && v === b[c] && v === b[d]) return { who: v, line };
  }
  return null;
}

function minimax(b: Board, turn: number): number {
  const w = winnerOf(b);
  if (w) return w.who === 2 ? 10 : -10;
  if (b.every((v) => v !== 0)) return 0;
  let best = turn === 2 ? -Infinity : Infinity;
  for (let i = 0; i < 9; i++) {
    if (b[i]) continue;
    b[i] = turn;
    const v = minimax(b, turn === 2 ? 1 : 2) * 0.9;
    b[i] = 0;
    best = turn === 2 ? Math.max(best, v) : Math.min(best, v);
  }
  return best;
}

/** The computer's move: perfect play with chance `skill`, otherwise a random empty square. */
export function cpuMove(b: Board, skill: number, rng: Rng): number {
  const empty = b.map((v, i) => (v ? -1 : i)).filter((i) => i >= 0);
  if (empty.length === 0) return -1;
  if (!rng.chance(skill)) return rng.pick(empty);
  let best = -Infinity;
  let picks: number[] = [];
  for (const i of empty) {
    b[i] = 2;
    const v = minimax(b, 1);
    b[i] = 0;
    if (v > best) {
      best = v;
      picks = [i];
    } else if (v === best) picks.push(i);
  }
  return rng.pick(picks);
}

/** How often the computer plays the perfect move on level n. */
export function skillFor(level: number): number {
  return Math.min(0.97, 0.35 + 0.15 * (level - 1));
}

const DESIGN_W = 600;
const WIN_POINTS = 300;
const DRAW_POINTS = 60;
const RESULT_SEC = 1.8;
const CPU_SEC = 0.45;

/** Tic-Tac-Toe against the computer: three in a row wins. Each win faces a sharper opponent; a loss ends the run. */
export class TicTacToeGame extends BaseGame {
  private readonly u: number;
  private board: Board = Array<number>(9).fill(0);
  private level = 1;
  private turn: 1 | 2 = 1;
  private games = 0;
  private cpuT = 0;
  private resultT = 0;
  private result: 'win' | 'loss' | 'draw' | null = null;
  private line: [number, number, number] | null = null;
  private cursor = 4;
  private keyboard = false;
  private shield = false;
  /** Seconds since each square was marked, for the draw-in animation. */
  private marked: number[] = Array<number>(9).fill(0);

  constructor(services: GameServices) {
    super(services);
    this.u = this.W / DESIGN_W;
    this.shield = this.hasBoost('shield');
    for (const key of ['wins', 'draws']) this.addStat(key, 0);
  }

  protected tick(dt: number): void {
    this.marked = this.marked.map((t) => t + dt);
    if (this.isEnding) return;
    if (this.result) {
      this.resultT -= dt;
      if (this.resultT <= 0) this.nextGame();
      return;
    }
    if (this.turn === 2) {
      this.cpuT -= dt;
      if (this.cpuT <= 0) {
        const skill = this.games === 0 && this.hasBoost('head-start') ? 0 : skillFor(this.level);
        this.place(cpuMove(this.board, skill, this.rng), 2);
      }
      return;
    }
    const i = this.services.preview ? cpuMove(this.board, 0.5, this.rng) : this.readSquare();
    if (i !== null && i >= 0 && !this.board[i]) this.place(i, 1);
  }

  render(): void {
    const ctx = this.ctx;
    const g = ctx.createLinearGradient(0, 0, 0, this.H);
    g.addColorStop(0, this.skinColor('bg1', '#0f766e'));
    g.addColorStop(1, this.skinColor('bg2', '#042f2e'));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.W, this.H);
    const b = this.grid();
    ctx.save();
    ctx.translate(this.shake.x, this.shake.y);
    ctx.strokeStyle = this.skinColor('grid', 'rgba(255,255,255,0.85)');
    ctx.lineWidth = 8 * this.u;
    ctx.lineCap = 'round';
    for (let k = 1; k < 3; k++) {
      ctx.beginPath();
      ctx.moveTo(b.x + k * b.cell, b.y + 10 * this.u);
      ctx.lineTo(b.x + k * b.cell, b.y + 3 * b.cell - 10 * this.u);
      ctx.moveTo(b.x + 10 * this.u, b.y + k * b.cell);
      ctx.lineTo(b.x + 3 * b.cell - 10 * this.u, b.y + k * b.cell);
      ctx.stroke();
    }
    this.board.forEach((v, i) => {
      if (v) this.drawMark(v, i, b);
    });
    if (this.line) {
      const [a, , c] = this.line;
      ctx.strokeStyle = this.result === 'win' ? '#fde047' : '#f87171';
      ctx.lineWidth = 12 * this.u;
      ctx.beginPath();
      ctx.moveTo(b.x + ((a % 3) + 0.5) * b.cell, b.y + (Math.floor(a / 3) + 0.5) * b.cell);
      ctx.lineTo(b.x + ((c % 3) + 0.5) * b.cell, b.y + (Math.floor(c / 3) + 0.5) * b.cell);
      ctx.stroke();
    }
    if (this.keyboard && this.turn === 1 && !this.result) {
      ctx.strokeStyle = '#fde047';
      ctx.lineWidth = 4 * this.u;
      roundRectPath(
        ctx,
        b.x + (this.cursor % 3) * b.cell + 8 * this.u,
        b.y + Math.floor(this.cursor / 3) * b.cell + 8 * this.u,
        b.cell - 16 * this.u,
        b.cell - 16 * this.u,
        12 * this.u,
      );
      ctx.stroke();
    }
    this.particles.render(ctx);
    this.texts.render(ctx);
    ctx.restore();
    if (this.services.preview) return;
    drawStatBar(ctx, this.W, this.insets.top, this.u, [
      ['SCORE', Math.floor(this.score).toLocaleString('en-US')],
      ['LEVEL', String(this.level)],
      ['WINS', String(this.stats['wins'] ?? 0)],
    ]);
    const msg = this.result ? '' : this.turn === 1 ? 'Your move (X)' : 'Computer thinking…';
    text(ctx, msg, this.W / 2, b.y + 3 * b.cell + 50 * this.u, {
      size: Math.round(24 * this.u),
      align: 'center',
    });
    if (this.result) {
      const title = this.result === 'win' ? 'YOU WIN!' : this.result === 'loss' ? 'COMPUTER WINS' : 'DRAW';
      const sub =
        this.result === 'win' ? `Level ${this.level + 1} next` : this.result === 'draw' ? 'Play again' : '';
      banner(
        ctx,
        this.W,
        this.H,
        title,
        sub,
        1 - this.resultT / RESULT_SEC,
        this.result === 'win' ? '#86efac' : '#fde047',
      );
    }
  }

  private grid(): { x: number; y: number; cell: number } {
    const top = this.insets.top + statBarHeight(this.u) + 40 * this.u;
    const bottom = this.H - this.insets.bottom - 120 * this.u;
    const size = Math.min(this.W - 60 * this.u, bottom - top);
    return { x: (this.W - size) / 2, y: top + (bottom - top - size) / 2, cell: size / 3 };
  }

  private readSquare(): number | null {
    const p = this.input.pointer;
    if (p.pressed) {
      this.keyboard = false;
      const b = this.grid();
      const c = Math.floor((p.x - b.x) / b.cell);
      const r = Math.floor((p.y - b.y) / b.cell);
      return c >= 0 && c < 3 && r >= 0 && r < 3 ? r * 3 + c : null;
    }
    const before = this.cursor;
    const c = this.cursor % 3;
    const r = Math.floor(this.cursor / 3);
    if (this.input.wasPressed('left')) this.cursor = r * 3 + ((c + 2) % 3);
    if (this.input.wasPressed('right')) this.cursor = r * 3 + ((c + 1) % 3);
    if (this.input.wasPressed('up')) this.cursor = ((r + 2) % 3) * 3 + c;
    if (this.input.wasPressed('down')) this.cursor = ((r + 1) % 3) * 3 + c;
    if (this.cursor !== before) this.keyboard = true;
    if (!this.input.wasPressed('primary')) return null;
    this.keyboard = true;
    return this.cursor;
  }

  private place(i: number, who: 1 | 2): void {
    if (i < 0) return;
    this.board[i] = who;
    this.marked[i] = 0;
    this.audio.play(who === 1 ? 'click' : 'pop', { volume: 0.6 });
    const w = winnerOf(this.board);
    if (w) {
      this.line = w.line;
      this.finish(w.who === 1 ? 'win' : 'loss');
    } else if (this.board.every((v) => v !== 0)) this.finish('draw');
    else {
      this.turn = who === 1 ? 2 : 1;
      this.cpuT = CPU_SEC;
    }
  }

  private finish(result: 'win' | 'loss' | 'draw'): void {
    this.result = result;
    this.resultT = RESULT_SEC;
    if (result === 'win') {
      this.score += WIN_POINTS * this.level;
      this.coins++;
      this.addStat('wins');
      this.audio.play('win');
      const b = this.grid();
      this.particles.emit({
        x: this.W / 2,
        y: b.y + b.cell * 1.5,
        count: 30,
        speed: 260 * this.u,
        life: 0.9,
        size: 4,
        colors: ['#fde047', '#ffffff', '#5eead4'],
      });
    } else if (result === 'draw') {
      this.score += DRAW_POINTS;
      this.addStat('draws');
      this.audio.play('select');
    } else {
      this.audio.play('bump');
      this.shake.add(0.3);
    }
  }

  /** A win moves up a level, a draw replays it, a loss ends the run (the shield forgives one). Starts alternate. */
  private nextGame(): void {
    if (this.result === 'loss') {
      if (!this.shield) {
        this.endGame(0.3, false);
        return;
      }
      this.shield = false;
      this.texts.add(this.W / 2, this.H * 0.45, 'SHIELD: TRY AGAIN', '#67e8f9', 26 * this.u, 1.3);
      this.audio.play('powerup');
    }
    if (this.result === 'win') this.level++;
    this.games++;
    this.board = Array<number>(9).fill(0);
    this.line = null;
    this.result = null;
    this.turn = this.games % 2 === 0 ? 1 : 2;
    this.cpuT = CPU_SEC;
  }

  private drawMark(v: number, i: number, b: { x: number; y: number; cell: number }): void {
    const ctx = this.ctx;
    const t = Math.min(1, (this.marked[i] ?? 1) / 0.2);
    const cx = b.x + ((i % 3) + 0.5) * b.cell;
    const cy = b.y + (Math.floor(i / 3) + 0.5) * b.cell;
    const r = b.cell * 0.3;
    ctx.lineWidth = 14 * this.u;
    ctx.lineCap = 'round';
    if (v === 1) {
      ctx.strokeStyle = this.skinColor('x', '#fb7185');
      ctx.beginPath();
      ctx.moveTo(cx - r, cy - r);
      ctx.lineTo(cx - r + 2 * r * Math.min(1, t * 2), cy - r + 2 * r * Math.min(1, t * 2));
      if (t > 0.5) {
        const k = (t - 0.5) * 2;
        ctx.moveTo(cx + r, cy - r);
        ctx.lineTo(cx + r - 2 * r * k, cy - r + 2 * r * k);
      }
      ctx.stroke();
    } else {
      ctx.strokeStyle = this.skinColor('o', '#fde047');
      ctx.beginPath();
      ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * t);
      ctx.stroke();
    }
  }
}
