import { TAU } from '../../core/math';
import { BaseGame } from '../base';
import { banner, fillRoundRect, shade, text } from '../draw';
import { drawStatBar, statBarHeight } from '../statbar';
import type { GameServices } from '../types';
import { COLS, cpuMove, emptyGrid, full, type Grid, landingRow, ROWS, winLine } from './board';

const DESIGN_W = 600;
const GRAVITY = 3200;
const CPU_THINK_SEC = 0.45;
const RESULT_SEC = 2.2;
const WIN_POINTS = 500;
const QUICK_POINTS = 10;
const DRAW_POINTS = 150;
const WIN_COINS = 2;

/** How far ahead the computer looks on level n, and how often it plays a random column instead. */
export function cpuSkill(level: number): { depth: number; blunder: number } {
  const depth = Math.min(6, 1 + level);
  const blunder = [0.35, 0.15, 0.05][level - 1] ?? 0;
  return { depth, blunder };
}

type Phase = 'player' | 'falling' | 'cpu' | 'result';

interface Falling {
  col: number;
  row: number;
  who: number;
  /** Disc centre in rows from the bottom, falling to `row`. */
  y: number;
  vy: number;
}

/** Connect Four against the computer: line up four in a row. Each win brings a sharper opponent; a loss ends the run. */
export class FourGame extends BaseGame {
  private readonly u: number;
  private grid: Grid = emptyGrid();
  private level = 1;
  private phase: Phase = 'player';
  private falling: Falling | null = null;
  private thinkT = 0;
  private resultT = 0;
  private result: 'win' | 'loss' | 'draw' | null = null;
  private line: [number, number][] | null = null;
  private cursor = 3;
  /** Discs the player has dropped this game. */
  private moves = 0;
  private shield = false;
  /** The head start makes the computer play at random for the first game. */
  private easyFirst: boolean;

  constructor(services: GameServices) {
    super(services);
    this.u = this.W / DESIGN_W;
    this.shield = this.hasBoost('shield');
    this.easyFirst = this.hasBoost('head-start');
    for (const key of ['wins', 'draws']) this.addStat(key, 0);
    if (services.preview) this.previewGrid();
  }

  protected tick(dt: number): void {
    if (this.isEnding) return;
    switch (this.phase) {
      case 'player':
        this.readInput();
        break;
      case 'falling':
        this.fall(dt);
        break;
      case 'cpu':
        this.thinkT -= dt;
        if (this.thinkT <= 0) this.cpuTurn();
        break;
      case 'result':
        this.resultT -= dt;
        if (this.resultT <= 0) this.nextGame();
        break;
    }
  }

  render(): void {
    const ctx = this.ctx;
    const g = ctx.createLinearGradient(0, 0, 0, this.H);
    g.addColorStop(0, this.skinColor('bg1', '#1e3a8a'));
    g.addColorStop(1, this.skinColor('bg2', '#0b1530'));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.W, this.H);
    const b = this.layout();
    ctx.save();
    ctx.translate(this.shake.x, this.shake.y);
    // Discs behind the board's face, so they show through its holes.
    for (let c = 0; c < COLS; c++) {
      for (let r = 0; r < ROWS; r++) {
        const who = this.grid[c]?.[r] ?? 0;
        if (who) this.drawDisc(b.x + (c + 0.5) * b.cell, this.rowY(b, r), b.cell * 0.4, who);
      }
    }
    const f = this.falling;
    if (f) this.drawDisc(b.x + (f.col + 0.5) * b.cell, this.rowY(b, f.y), b.cell * 0.4, f.who);
    this.drawBoard(b);
    if (this.line) {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 6 * this.u;
      ctx.lineCap = 'round';
      ctx.beginPath();
      const [a, z] = [this.line[0], this.line[3]];
      if (a && z) {
        ctx.moveTo(b.x + (a[0] + 0.5) * b.cell, this.rowY(b, a[1]));
        ctx.lineTo(b.x + (z[0] + 0.5) * b.cell, this.rowY(b, z[1]));
      }
      ctx.stroke();
    }
    if (this.phase === 'player' && !this.services.preview) {
      this.drawDisc(b.x + (this.cursor + 0.5) * b.cell, b.y - b.cell * 0.55, b.cell * 0.36, 1);
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
    const status =
      this.phase === 'cpu' || this.falling?.who === 2
        ? 'CPU is thinking…'
        : this.phase === 'player'
          ? 'Your turn: tap a column'
          : '';
    if (status) {
      text(ctx, status, this.W / 2, b.y + b.cell * ROWS + 40 * this.u, {
        size: Math.round(22 * this.u),
        align: 'center',
        color:
          this.phase === 'player' ? this.skinColor('player', '#ef4444') : this.skinColor('cpu', '#facc15'),
      });
    }
    if (this.phase === 'result' && this.result) {
      const title = this.result === 'win' ? 'YOU WIN!' : this.result === 'loss' ? 'CPU WINS' : 'DRAW';
      const sub =
        this.result === 'win'
          ? `Level ${this.level + 1} next`
          : this.result === 'draw'
            ? 'Play the level again'
            : '';
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

  private layout(): { x: number; y: number; cell: number } {
    const top = this.insets.top + statBarHeight(this.u) + 90 * this.u;
    const bottom = this.H - this.insets.bottom - 80 * this.u;
    const cell = Math.min((this.W - 30 * this.u) / COLS, (bottom - top) / ROWS);
    return { x: (this.W - cell * COLS) / 2, y: top + (bottom - top - cell * ROWS) / 2, cell };
  }

  /** Screen y of a disc's centre in row r (rows count up from the bottom; r may be fractional while falling). */
  private rowY(b: { y: number; cell: number }, r: number): number {
    return b.y + (ROWS - 1 - r + 0.5) * b.cell;
  }

  private readInput(): void {
    const p = this.input.pointer;
    const b = this.layout();
    if (p.active && p.inside) this.cursor = Math.max(0, Math.min(COLS - 1, Math.floor((p.x - b.x) / b.cell)));
    if (this.input.wasPressed('left')) this.cursor = Math.max(0, this.cursor - 1);
    if (this.input.wasPressed('right')) this.cursor = Math.min(COLS - 1, this.cursor + 1);
    const tapped = p.pressed && p.x >= b.x && p.x <= b.x + b.cell * COLS;
    if (tapped || this.input.wasPressed('primary') || this.input.wasPressed('down'))
      this.drop(this.cursor, 1);
  }

  private drop(col: number, who: number): void {
    const row = landingRow(this.grid, col);
    if (row < 0) {
      if (who === 1) this.audio.play('bump', { volume: 0.4 });
      return;
    }
    if (who === 1) this.moves++;
    this.falling = { col, row, who, y: ROWS + 0.4, vy: 0 };
    this.phase = 'falling';
  }

  private fall(dt: number): void {
    const f = this.falling;
    if (!f) return;
    const cell = this.layout().cell;
    f.vy += (GRAVITY * dt) / cell;
    f.y -= f.vy * dt;
    if (f.y > f.row) return;
    (this.grid[f.col] as number[])[f.row] = f.who;
    this.falling = null;
    this.audio.play('land', { volume: 0.6 });
    this.services.haptic(10);
    const line = winLine(this.grid);
    if (line) {
      this.line = line;
      this.finish(f.who === 1 ? 'win' : 'loss');
    } else if (full(this.grid)) {
      this.finish('draw');
    } else if (f.who === 1) {
      this.phase = 'cpu';
      this.thinkT = CPU_THINK_SEC;
    } else {
      this.phase = 'player';
    }
  }

  private cpuTurn(): void {
    const skill = cpuSkill(this.level);
    const blunder = this.easyFirst ? 1 : skill.blunder;
    this.drop(cpuMove(this.grid, skill.depth, this.rng, blunder), 2);
  }

  private finish(result: 'win' | 'loss' | 'draw'): void {
    this.result = result;
    this.phase = 'result';
    this.resultT = RESULT_SEC;
    this.easyFirst = false;
    const b = this.layout();
    if (result === 'win') {
      const points = WIN_POINTS * this.level + Math.max(0, 21 - this.moves) * QUICK_POINTS;
      this.score += points;
      this.coins += WIN_COINS;
      this.addStat('wins');
      this.audio.play('win');
      this.texts.add(this.W / 2, b.y - 20 * this.u, `+${points}`, '#fde047', 28 * this.u, 1.4);
      this.particles.emit({
        x: this.W / 2,
        y: b.y + b.cell * 3,
        count: 40,
        speed: 300 * this.u,
        life: 1,
        size: 4,
        colors: ['#ef4444', '#fde047', '#ffffff'],
      });
    } else if (result === 'draw') {
      this.score += DRAW_POINTS;
      this.addStat('draws');
      this.audio.play('select');
    } else {
      this.audio.play('bump');
      this.shake.add(0.4);
    }
  }

  /** After a result: a win moves up a level, a draw replays it, a loss ends the run (the shield forgives one). */
  private nextGame(): void {
    if (this.result === 'loss') {
      if (!this.shield) {
        this.endGame(0.3, false);
        return;
      }
      this.shield = false;
      this.texts.add(this.W / 2, this.H * 0.4, 'SHIELD: TRY AGAIN', '#67e8f9', 26 * this.u, 1.4);
      this.audio.play('powerup');
    }
    if (this.result === 'win') this.level++;
    this.grid = emptyGrid();
    this.line = null;
    this.result = null;
    this.moves = 0;
    this.phase = 'player';
  }

  /** Card art: a game in progress. */
  private previewGrid(): void {
    const moves: [number, number][] = [
      [3, 1],
      [3, 2],
      [2, 1],
      [4, 2],
      [4, 1],
      [2, 2],
      [3, 1],
      [5, 2],
      [1, 1],
    ];
    for (const [c, who] of moves) {
      const r = landingRow(this.grid, c);
      if (r >= 0) (this.grid[c] as number[])[r] = who;
    }
  }

  private drawDisc(x: number, y: number, r: number, who: number): void {
    const ctx = this.ctx;
    const colour = who === 1 ? this.skinColor('player', '#ef4444') : this.skinColor('cpu', '#facc15');
    const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.35, r * 0.1, x, y, r);
    g.addColorStop(0, shade(colour, 0.35));
    g.addColorStop(1, shade(colour, -0.2));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = shade(colour, -0.35);
    ctx.lineWidth = r * 0.12;
    ctx.beginPath();
    ctx.arc(x, y, r * 0.7, 0, TAU);
    ctx.stroke();
  }

  /** The board's face: a panel with a hole over every cell (drawn with an even-odd fill). */
  private drawBoard(b: { x: number; y: number; cell: number }): void {
    const ctx = this.ctx;
    const pad = b.cell * 0.12;
    ctx.fillStyle = this.skinColor('board', '#2563eb');
    ctx.beginPath();
    ctx.rect(b.x - pad, b.y - pad, b.cell * COLS + pad * 2, b.cell * ROWS + pad * 2);
    for (let c = 0; c < COLS; c++) {
      for (let r = 0; r < ROWS; r++) {
        const x = b.x + (c + 0.5) * b.cell;
        const y = b.y + (r + 0.5) * b.cell;
        ctx.moveTo(x + b.cell * 0.42, y);
        ctx.arc(x, y, b.cell * 0.42, 0, TAU);
      }
    }
    ctx.fill('evenodd');
    fillRoundRect(
      ctx,
      b.x - pad * 2,
      b.y + b.cell * ROWS + pad,
      b.cell * COLS + pad * 4,
      pad * 1.6,
      pad * 0.8,
      shade(this.skinColor('board', '#2563eb'), -0.3),
    );
  }
}
