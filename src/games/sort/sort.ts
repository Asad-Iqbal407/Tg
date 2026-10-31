import { TAU } from '../../core/math';
import { BaseGame } from '../base';
import { banner, fillRoundRect, progressBar, roundRectPath, shade, text } from '../draw';
import { drawStatBar, statBarHeight } from '../statbar';
import type { GameServices } from '../types';
import { CAPACITY, canPour, dealTubes, pour, solved, type Tubes } from './tubes';

const DESIGN_W = 600;
const PER_ROW = 5;
const LEVEL_BONUS = 200;
const TIME_POINTS = 5;
const CLEAR_SEC = 1.6;
const SHIELD_SECONDS = 20;
const DEFAULT_BALLS = ['#ef4444', '#3b82f6', '#22c55e', '#facc15', '#a855f7', '#f97316', '#ec4899'];

/** Colours on level n: 3 on the first, one more per level, up to 7. */
export function coloursFor(level: number): number {
  return Math.min(7, 2 + level);
}

/** Seconds on the clock for a level with this many colours. */
export function sortTime(colours: number): number {
  return 40 + 15 * colours;
}

interface TubeBox {
  x: number;
  y: number;
  w: number;
  h: number;
  ball: number;
}

/** Color Sort: pour the balls between tubes until every tube holds a single colour. */
export class SortGame extends BaseGame {
  private readonly u: number;
  private level = 1;
  private tubes: Tubes = [];
  private selected = -1;
  private cursor = 0;
  private keyboard = false;
  private history: [number, number][] = [];
  private timeLeft = 1;
  private levelTime = 1;
  private clearT = 0;
  private bannerT = 1.4;
  private shield = false;
  /** Seconds left of the shake on a tube that refused a ball, and which tube. */
  private refuse = { tube: -1, t: 0 };

  constructor(services: GameServices) {
    super(services);
    this.u = this.W / DESIGN_W;
    this.shield = this.hasBoost('shield');
    for (const key of ['levels', 'moves']) this.addStat(key, 0);
    this.startLevel(1);
  }

  protected tick(dt: number): void {
    this.bannerT = Math.max(0, this.bannerT - dt);
    this.refuse.t = Math.max(0, this.refuse.t - dt);
    if (this.isEnding) return;
    if (this.clearT > 0) {
      this.clearT -= dt;
      if (this.clearT <= 0) this.startLevel(this.level + 1);
      return;
    }
    this.timeLeft -= dt;
    if (this.timeLeft <= 0) {
      this.outOfTime();
      return;
    }
    this.readInput();
    if (this.services.preview && this.history.length < 4 && this.time > 0.2 * (this.history.length + 1))
      this.previewMove();
  }

  render(): void {
    const ctx = this.ctx;
    const g = ctx.createLinearGradient(0, 0, 0, this.H);
    g.addColorStop(0, this.skinColor('bg1', '#312e81'));
    g.addColorStop(1, this.skinColor('bg2', '#0f172a'));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.W, this.H);
    ctx.save();
    ctx.translate(this.shake.x, this.shake.y);
    this.boxes().forEach((b, i) => this.drawTube(i, b));
    this.particles.render(ctx);
    this.texts.render(ctx);
    ctx.restore();
    if (this.services.preview) return;
    drawStatBar(ctx, this.W, this.insets.top, this.u, [
      ['SCORE', Math.floor(this.score).toLocaleString('en-US')],
      ['LEVEL', String(this.level)],
      ['MOVES', String(this.history.length)],
    ]);
    this.drawUndo();
    const barY = this.H - this.insets.bottom - 30 * this.u;
    const t = Math.max(0, this.timeLeft) / this.levelTime;
    progressBar(
      ctx,
      24 * this.u,
      barY,
      this.W - 48 * this.u,
      12 * this.u,
      t,
      t < 0.2 ? '#ef4444' : '#a5b4fc',
    );
    text(ctx, `${Math.ceil(Math.max(0, this.timeLeft))}s`, this.W - 40 * this.u, barY - 18 * this.u, {
      size: Math.round(18 * this.u),
      align: 'right',
    });
    if (this.clearT > 0) {
      banner(
        ctx,
        this.W,
        this.H,
        'SORTED!',
        `Level ${this.level + 1} next`,
        1 - this.clearT / CLEAR_SEC,
        '#86efac',
      );
    } else if (this.bannerT > 0) {
      banner(ctx, this.W, this.H, `LEVEL ${this.level}`, 'One colour per tube', 1 - this.bannerT / 1.4);
    }
  }

  private startLevel(level: number): void {
    this.level = level;
    const colours = coloursFor(level);
    this.tubes = dealTubes(this.rng, colours, 2 + (this.hasBoost('head-start') ? 1 : 0));
    this.selected = -1;
    this.cursor = 0;
    this.history = [];
    this.levelTime = sortTime(colours);
    this.timeLeft = this.levelTime;
    this.bannerT = 1.4;
  }

  /** Where each tube sits: rows of up to PER_ROW, centred, sized to fit between the HUD and the undo button. */
  private boxes(): TubeBox[] {
    const n = this.tubes.length;
    const rows = Math.ceil(n / PER_ROW);
    const perRow = Math.ceil(n / rows);
    const top = this.insets.top + statBarHeight(this.u) + 30 * this.u;
    const bottom = this.H - this.insets.bottom - 120 * this.u;
    const gapX = 18 * this.u;
    const ball = Math.min(
      (this.W - 40 * this.u - gapX * (perRow - 1)) / perRow / 1.2,
      (bottom - top) / rows / (CAPACITY + 1.6),
      86 * this.u,
    );
    const w = ball * 1.2;
    const h = ball * (CAPACITY + 0.5);
    const rowH = (bottom - top) / rows;
    const out: TubeBox[] = [];
    for (let i = 0; i < n; i++) {
      const r = Math.floor(i / perRow);
      const inRow = Math.min(perRow, n - r * perRow);
      const k = i - r * perRow;
      const totalW = inRow * w + (inRow - 1) * gapX;
      out.push({
        x: (this.W - totalW) / 2 + k * (w + gapX),
        y: top + r * rowH + (rowH - h) / 2 + ball * 0.6,
        w,
        h,
        ball,
      });
    }
    return out;
  }

  private undoBox(): { x: number; y: number; w: number; h: number } {
    const w = 150 * this.u;
    const h = 50 * this.u;
    return { x: (this.W - w) / 2, y: this.H - this.insets.bottom - 104 * this.u, w, h };
  }

  private readInput(): void {
    const p = this.input.pointer;
    if (p.pressed) {
      this.keyboard = false;
      const u = this.undoBox();
      if (p.x >= u.x && p.x <= u.x + u.w && p.y >= u.y && p.y <= u.y + u.h) {
        this.undo();
        return;
      }
      const i = this.boxes().findIndex(
        (b) =>
          p.x >= b.x - 8 * this.u &&
          p.x <= b.x + b.w + 8 * this.u &&
          p.y >= b.y - b.ball * 1.4 &&
          p.y <= b.y + b.h + 8 * this.u,
      );
      if (i >= 0) this.choose(i);
      else this.selected = -1;
      return;
    }
    const n = this.tubes.length;
    if (this.input.wasPressed('left')) {
      this.cursor = (this.cursor + n - 1) % n;
      this.keyboard = true;
    }
    if (this.input.wasPressed('right')) {
      this.cursor = (this.cursor + 1) % n;
      this.keyboard = true;
    }
    if (this.input.wasPressed('primary') || this.input.wasPressed('up')) {
      this.keyboard = true;
      this.choose(this.cursor);
    }
    if (this.input.wasPressed('secondary')) this.undo();
  }

  /** The first tap lifts the top ball of a tube; the second pours it into another tube. */
  private choose(i: number): void {
    if (this.selected < 0) {
      if ((this.tubes[i]?.length ?? 0) === 0) return;
      this.selected = i;
      this.audio.play('click', { volume: 0.5 });
      return;
    }
    if (this.selected === i) {
      this.selected = -1;
      return;
    }
    const from = this.selected;
    this.selected = -1;
    if (!pour(this.tubes, from, i)) {
      this.refuse = { tube: i, t: 0.3 };
      this.audio.play('bump', { volume: 0.5 });
      return;
    }
    this.history.push([from, i]);
    this.addStat('moves');
    this.audio.play('pop', { volume: 0.6 });
    const tube = this.tubes[i] as number[];
    if (tube.length === CAPACITY && tube.every((c) => c === tube[0])) this.tubeDone(i);
    if (solved(this.tubes)) this.clearLevel();
  }

  private undo(): void {
    const last = this.history.pop();
    if (!last) return;
    const [from, to] = last;
    const ball = this.tubes[to]?.pop();
    if (ball !== undefined) this.tubes[from]?.push(ball);
    this.selected = -1;
    this.audio.play('whoosh', { volume: 0.4 });
  }

  private tubeDone(i: number): void {
    const b = this.boxes()[i];
    if (!b) return;
    const colour = this.ballColour(this.tubes[i]?.[0] ?? 1);
    this.particles.emit({
      x: b.x + b.w / 2,
      y: b.y,
      count: 16,
      speed: 180 * this.u,
      life: 0.5,
      size: 3,
      colors: [colour, '#ffffff'],
    });
    this.audio.play('reward', { volume: 0.5 });
  }

  private clearLevel(): void {
    const bonus = LEVEL_BONUS * this.level + Math.ceil(this.timeLeft) * TIME_POINTS;
    this.score += bonus;
    this.coins++;
    this.addStat('levels');
    this.clearT = CLEAR_SEC;
    this.audio.play('levelup');
    this.texts.add(this.W / 2, this.H * 0.55, `+${bonus}`, '#fde047', 30 * this.u, 1.3);
  }

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
    this.endGame(1.6);
  }

  /** Card art makes a few legal moves so the frame shows a puzzle under way. */
  private previewMove(): void {
    for (let a = 0; a < this.tubes.length; a++) {
      for (let b = 0; b < this.tubes.length; b++) {
        if (canPour(this.tubes, a, b) && (this.tubes[b]?.length ?? 0) > 0) {
          pour(this.tubes, a, b);
          this.history.push([a, b]);
          return;
        }
      }
    }
    this.history.push([0, 0]);
  }

  private ballColour(c: number): string {
    return this.skinColor(`c${c}`, DEFAULT_BALLS[(c - 1) % DEFAULT_BALLS.length] ?? '#ffffff');
  }

  private drawTube(i: number, b: TubeBox): void {
    const ctx = this.ctx;
    const shakeX =
      this.refuse.tube === i && this.refuse.t > 0 ? Math.sin(this.refuse.t * 60) * 4 * this.u : 0;
    const x = b.x + shakeX;
    const glass = this.skinColor('glass', 'rgba(255,255,255,0.12)');
    fillRoundRect(ctx, x, b.y, b.w, b.h, b.w / 2, glass);
    ctx.strokeStyle = this.keyboard && this.cursor === i ? '#fde047' : 'rgba(255,255,255,0.55)';
    ctx.lineWidth = (this.keyboard && this.cursor === i ? 4 : 2.5) * this.u;
    roundRectPath(ctx, x, b.y, b.w, b.h, b.w / 2);
    ctx.stroke();
    const tube = this.tubes[i] ?? [];
    const r = b.ball * 0.44;
    tube.forEach((c, k) => {
      const lifted = i === this.selected && k === tube.length - 1;
      const cy = lifted ? b.y - b.ball * 0.75 : b.y + b.h - b.ball * 0.55 - k * b.ball;
      this.drawBall(x + b.w / 2, cy, r, this.ballColour(c));
    });
  }

  private drawBall(x: number, y: number, r: number, colour: string): void {
    const ctx = this.ctx;
    const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r);
    g.addColorStop(0, shade(colour, 0.45));
    g.addColorStop(1, shade(colour, -0.15));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.beginPath();
    ctx.arc(x - r * 0.35, y - r * 0.38, r * 0.16, 0, TAU);
    ctx.fill();
  }

  private drawUndo(): void {
    const ctx = this.ctx;
    const b = this.undoBox();
    const can = this.history.length > 0;
    fillRoundRect(ctx, b.x, b.y, b.w, b.h, b.h / 2, can ? 'rgba(15,23,42,0.75)' : 'rgba(15,23,42,0.35)');
    ctx.strokeStyle = 'rgba(255,255,255,0.3)';
    ctx.lineWidth = 2 * this.u;
    roundRectPath(ctx, b.x, b.y, b.w, b.h, b.h / 2);
    ctx.stroke();
    text(ctx, '↶ UNDO', b.x + b.w / 2, b.y + b.h / 2, {
      size: Math.round(20 * this.u),
      align: 'center',
      color: can ? '#ffffff' : 'rgba(255,255,255,0.4)',
    });
  }
}
