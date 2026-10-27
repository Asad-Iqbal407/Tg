import { TAU } from '../../core/math';
import { BaseGame } from '../base';
import { TapTracker } from '../drag';
import { drawCoin, fillRoundRect, shade, text } from '../draw';
import { drawStatBar, statBarHeight } from '../statbar';
import type { GameServices } from '../types';
import { COLS, covered, type Lane, makeLane, stepLane } from './lanes';

const DESIGN_W = 600;
const HOP_SEC = 0.12;
/** Standing still this long without a new best row brings the eagle. */
const IDLE_SEC = 8;
const HEAD_START_ROWS = 10;
const COIN_POINTS = 5;
/** How much of a car's length (each side) still hits; under 0.5 forgives a graze. */
const CAR_SLACK = 0.3;
/** How far past a log's end the hopper can still stand on it. */
const LOG_SLACK = 0.15;
const INVULN_SEC = 1.5;
/** The hopper's row sits this far down the screen. */
const PLAYER_AT = 0.72;

type Death = 'car' | 'water' | 'edge' | 'eagle';

/** Road Hopper: hop up the screen across roads and rivers. Cars squash, water drowns, and the eagle hates waiting. */
export class HopperGame extends BaseGame {
  private readonly u: number;
  private readonly lanes = new Map<number, Lane>();
  private topRow = -1;
  private runLeft = 0;
  /** Column as a float (a log carries the hopper between columns) and row. */
  private col = (COLS - 1) / 2;
  private row = 0;
  private best = 0;
  /** Hop animation: where the hop started and how far through it is (1 when standing). */
  private from = { col: 0, row: 0 };
  private hopT = 1;
  private facing: 'up' | 'down' | 'left' | 'right' = 'up';
  private camRow = 0;
  private idleT = 0;
  private hops = 0;
  private dead: Death | null = null;
  private shield = false;
  private invulnT = 0;
  private readonly tap = new TapTracker();

  constructor(services: GameServices) {
    super(services);
    this.u = this.W / DESIGN_W;
    this.shield = this.hasBoost('shield');
    for (const key of ['rows', 'hops']) this.addStat(key, 0);
    this.ensureLanes(30);
    if (this.hasBoost('head-start')) {
      // The head start lands the hopper on the nearest grass row at least ten rows up.
      let r = HEAD_START_ROWS;
      while (this.lane(r).kind !== 'grass') r++;
      this.row = r;
      this.best = r;
      this.score = r;
      const lane = this.lane(r);
      while (lane.trees.has(Math.round(this.col))) this.col = (this.col + 1) % COLS;
      this.ensureLanes(r + 30);
    }
    this.from = { col: this.col, row: this.row };
    this.camRow = this.row;
  }

  protected tick(dt: number): void {
    this.invulnT = Math.max(0, this.invulnT - dt);
    for (const [r, lane] of this.lanes) if (Math.abs(r - this.row) < 20) stepLane(lane, dt);
    this.camRow += (this.row - this.camRow) * Math.min(1, dt * 8);
    if (this.isEnding) return;
    this.hopT = Math.min(1, this.hopT + dt / HOP_SEC);
    this.ride(dt);
    this.readMove();
    this.idleT += dt;
    if (this.idleT >= IDLE_SEC && !this.services.preview) this.die('eagle');
    if (this.hopT >= 1) this.checkHazards();
    if (this.services.preview && this.hopT >= 1 && this.idleT > 0.35) this.autoHop();
  }

  render(): void {
    const ctx = this.ctx;
    const cell = this.cell();
    ctx.fillStyle = '#14532d';
    ctx.fillRect(0, 0, this.W, this.H);
    ctx.save();
    ctx.translate(this.shake.x, this.shake.y);
    const first = Math.floor(this.camRow - (this.H * (1 - PLAYER_AT)) / cell) - 1;
    const last = Math.ceil(this.camRow + (this.H * PLAYER_AT) / cell) + 1;
    for (let r = Math.max(0, first); r <= last; r++) this.drawLane(r, cell);
    this.drawHopper(cell);
    for (let r = Math.max(0, first); r <= last; r++) this.drawTrees(r, cell);
    this.particles.render(ctx);
    this.texts.render(ctx);
    if (this.dead === 'eagle') this.drawEagle(cell);
    ctx.restore();
    if (this.services.preview) return;
    drawStatBar(ctx, this.W, this.insets.top, this.u, [
      ['DISTANCE', String(this.best)],
      ['COINS', String(this.coins)],
      ['HOPS', String(this.hops)],
    ]);
    if (this.hops === 0 && !this.isEnding) {
      text(
        ctx,
        'TAP TO HOP · SWIPE TO TURN',
        this.W / 2,
        this.insets.top + statBarHeight(this.u) + 40 * this.u,
        {
          size: Math.round(22 * this.u),
          align: 'center',
        },
      );
    }
    const left = IDLE_SEC - this.idleT;
    if (left < 3 && !this.isEnding) {
      text(
        ctx,
        'HURRY! THE EAGLE IS COMING',
        this.W / 2,
        this.insets.top + statBarHeight(this.u) + 40 * this.u,
        {
          size: Math.round(20 * this.u),
          align: 'center',
          color: '#fca5a5',
        },
      );
    }
  }

  private cell(): number {
    return this.W / COLS;
  }

  /** Screen y of the centre of world row r. */
  private rowY(r: number, cell: number): number {
    return this.H * PLAYER_AT - (r - this.camRow) * cell;
  }

  private lane(r: number): Lane {
    this.ensureLanes(r + 1);
    return this.lanes.get(r) as Lane;
  }

  private ensureLanes(upTo: number): void {
    while (this.topRow < upTo) {
      this.topRow++;
      const made = makeLane(this.rng, this.topRow, this.lanes.get(this.topRow - 1) ?? null, this.runLeft);
      this.lanes.set(this.topRow, made.lane);
      this.runLeft = made.runLeft;
    }
    for (const r of this.lanes.keys()) if (r < this.row - 30) this.lanes.delete(r);
  }

  /** A tap hops forward; a swipe or the arrow keys hop that way. One hop at a time. */
  private readMove(): void {
    const p = this.input.pointer;
    const tapped = this.tap.update(p.down, p.pressed, p.released, p.x, p.y, this.time, 22 * this.u, 0.4);
    const swipe = this.input.consumeSwipe();
    let dir: 'up' | 'down' | 'left' | 'right' | null = swipe;
    if (!dir) {
      if (this.input.wasPressed('up') || this.input.wasPressed('primary') || tapped) dir = 'up';
      else if (this.input.wasPressed('down')) dir = 'down';
      else if (this.input.wasPressed('left')) dir = 'left';
      else if (this.input.wasPressed('right')) dir = 'right';
    }
    if (dir && this.hopT >= 1) this.hop(dir);
  }

  private hop(dir: 'up' | 'down' | 'left' | 'right'): void {
    const dc = dir === 'left' ? -1 : dir === 'right' ? 1 : 0;
    const dr = dir === 'up' ? 1 : dir === 'down' ? -1 : 0;
    const row = Math.max(0, this.row + dr);
    const target = this.lane(row);
    // Leaving a log lands on a whole column; side hops on a log move one column from where it is.
    let col = dr !== 0 && target.kind !== 'river' ? Math.round(this.col) : this.col + dc;
    if (dr === 0 && this.lane(this.row).kind !== 'river') col = Math.round(this.col) + dc;
    this.facing = dir;
    if (col < -0.4 || col > COLS - 0.6) return;
    if (target.kind === 'grass' && target.trees.has(Math.round(col))) return;
    this.from = { col: this.col, row: this.row };
    this.col = col;
    this.row = row;
    this.hopT = 0;
    this.hops++;
    this.addStat('hops');
    this.audio.play('jump', { volume: 0.35 });
    if (row > this.best) {
      this.score += row - this.best;
      this.best = row;
      this.maxStat('rows', row);
      this.idleT = 0;
    }
    this.ensureLanes(row + 25);
  }

  /** A log carries the hopper along. */
  private ride(dt: number): void {
    const lane = this.lane(this.row);
    if (lane.kind !== 'river' || this.hopT < 1) return;
    if (covered(lane, this.col + 0.5, LOG_SLACK)) {
      this.col += lane.speed * dt;
      this.from.col = this.col;
    }
  }

  private checkHazards(): void {
    const lane = this.lane(this.row);
    const centre = this.col + 0.5;
    if (lane.kind === 'grass' && lane.coin === Math.round(this.col)) {
      lane.coin = -1;
      this.coins++;
      this.score += COIN_POINTS;
      this.audio.play('coin');
    }
    if (this.invulnT > 0) return;
    if (this.col < -0.5 || this.col > COLS - 0.5) this.die('edge');
    else if (lane.kind === 'road' && covered(lane, centre, -CAR_SLACK)) this.die('car');
    else if (lane.kind === 'river' && !covered(lane, centre, LOG_SLACK)) this.die('water');
  }

  /** Squashed, drowned, swept away or snatched. The shield saves the first one; otherwise the run ends. */
  private die(how: Death): void {
    const cell = this.cell();
    const x = (this.col + 0.5) * cell;
    const y = this.rowY(this.row, cell);
    if (this.shield && how !== 'eagle') {
      this.shield = false;
      this.invulnT = INVULN_SEC;
      // Back to the nearest grass row behind, on a free column.
      let r = this.row;
      while (r > 0 && this.lane(r).kind !== 'grass') r--;
      const lane = this.lane(r);
      let c = Math.min(COLS - 1, Math.max(0, Math.round(this.col)));
      while (lane.trees.has(c)) c = (c + 1) % COLS;
      this.row = r;
      this.col = c;
      this.from = { col: c, row: r };
      this.hopT = 1;
      this.texts.add(x, y - cell, 'SHIELD', '#67e8f9', 24 * this.u, 1.1);
      this.audio.play('powerup');
      return;
    }
    this.dead = how;
    const colours = how === 'water' ? ['#bfdbfe', '#ffffff', '#3b82f6'] : ['#ffffff', '#fde047', '#ef4444'];
    this.particles.emit({ x, y, count: 24, speed: 200 * this.u, life: 0.6, size: 4, colors: colours });
    this.shake.add(how === 'car' ? 0.6 : 0.3);
    this.audio.play(how === 'water' ? 'pop' : 'hit');
    this.services.haptic(120);
    this.endGame(1.5);
  }

  /** Card art hops forward whenever the row ahead is safe right now. */
  private autoHop(): void {
    const ahead = this.lane(this.row + 1);
    const c = Math.round(this.col);
    const safe =
      (ahead.kind === 'grass' && !ahead.trees.has(c)) ||
      (ahead.kind === 'road' && !covered(ahead, c + 0.5, 1.2)) ||
      (ahead.kind === 'river' && covered(ahead, this.col + 0.5, -0.2));
    if (safe) this.hop('up');
  }

  private drawLane(r: number, cell: number): void {
    const ctx = this.ctx;
    const lane = this.lane(r);
    const y = this.rowY(r, cell) - cell / 2;
    if (lane.kind === 'grass') {
      ctx.fillStyle = r % 2 === 0 ? this.skinColor('grass1', '#4ade80') : this.skinColor('grass2', '#22c55e');
      ctx.fillRect(0, y, this.W, cell + 1);
      if (lane.coin >= 0)
        drawCoin(ctx, (lane.coin + 0.5) * cell, y + cell / 2, cell * 0.2, Math.cos(this.time * 4));
      return;
    }
    if (lane.kind === 'road') {
      ctx.fillStyle = this.skinColor('road', '#334155');
      ctx.fillRect(0, y, this.W, cell + 1);
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      for (let x = 0; x < this.W; x += cell)
        ctx.fillRect(x + cell * 0.2, y + cell - 3 * this.u, cell * 0.5, 3 * this.u);
      for (const m of lane.movers) this.drawCar(m.x * cell, y, m.len * cell, cell, m.hue, lane.speed > 0);
      return;
    }
    ctx.fillStyle = this.skinColor('water', '#3b82f6');
    ctx.fillRect(0, y, this.W, cell + 1);
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.lineWidth = 2 * this.u;
    for (let k = 0; k < 4; k++) {
      const wx =
        ((k * cell * 2.3 + this.time * 20 * this.u * Math.sign(lane.speed)) % (this.W + cell)) - cell / 2;
      ctx.beginPath();
      ctx.arc(wx, y + cell * 0.5, cell * 0.18, Math.PI * 1.1, Math.PI * 1.9);
      ctx.stroke();
    }
    for (const m of lane.movers) {
      fillRoundRect(
        ctx,
        m.x * cell + 2,
        y + cell * 0.14,
        m.len * cell - 4,
        cell * 0.72,
        cell * 0.2,
        this.skinColor('log', '#92400e'),
      );
      ctx.fillStyle = 'rgba(0,0,0,0.18)';
      for (let k = 1; k < m.len; k++) ctx.fillRect((m.x + k) * cell - 1, y + cell * 0.2, 2, cell * 0.6);
    }
  }

  private drawCar(x: number, y: number, w: number, cell: number, hue: number, right: boolean): void {
    const ctx = this.ctx;
    const body = `hsl(${hue},75%,55%)`;
    fillRoundRect(ctx, x + 3, y + cell * 0.14, w - 6, cell * 0.72, cell * 0.18, body);
    // Windscreen on the front, facing the way it drives.
    ctx.fillStyle = 'rgba(191,219,254,0.85)';
    const wx = right ? x + w - cell * 0.42 : x + cell * 0.18;
    ctx.fillRect(wx, y + cell * 0.24, cell * 0.24, cell * 0.52);
    ctx.fillStyle = '#111827';
    for (const fx of [0.22, 0.78]) {
      ctx.fillRect(x + w * fx - cell * 0.1, y + cell * 0.08, cell * 0.2, cell * 0.08);
      ctx.fillRect(x + w * fx - cell * 0.1, y + cell * 0.84, cell * 0.2, cell * 0.08);
    }
  }

  private drawTrees(r: number, cell: number): void {
    const lane = this.lane(r);
    if (lane.kind !== 'grass') return;
    const ctx = this.ctx;
    const y = this.rowY(r, cell);
    for (const c of lane.trees) {
      const x = (c + 0.5) * cell;
      ctx.fillStyle = '#78350f';
      ctx.fillRect(x - cell * 0.08, y, cell * 0.16, cell * 0.36);
      ctx.fillStyle = this.skinColor('tree', '#15803d');
      ctx.beginPath();
      ctx.arc(x, y - cell * 0.08, cell * 0.36, 0, TAU);
      ctx.fill();
      ctx.fillStyle = shade(this.skinColor('tree', '#15803d'), 0.25);
      ctx.beginPath();
      ctx.arc(x - cell * 0.1, y - cell * 0.18, cell * 0.14, 0, TAU);
      ctx.fill();
    }
  }

  private drawHopper(cell: number): void {
    if (this.dead === 'water' || this.dead === 'eagle') return;
    if (this.invulnT > 0 && Math.floor(this.invulnT * 10) % 2 === 0) return;
    const ctx = this.ctx;
    const t = this.hopT;
    const col = this.from.col + (this.col - this.from.col) * t;
    const row = this.from.row + (this.row - this.from.row) * t;
    const lift = Math.sin(t * Math.PI) * cell * 0.25;
    const x = (col + 0.5) * cell;
    const y = this.rowY(row, cell) - lift;
    const s = cell * 0.36;
    const squashed = this.dead === 'car';
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath();
    ctx.ellipse(x, this.rowY(row, cell) + s * 0.8, s * 0.8, s * 0.25, 0, 0, TAU);
    ctx.fill();
    const body = this.skinColor('body', '#ffffff');
    if (squashed) {
      fillRoundRect(ctx, x - s * 1.2, y + s * 0.4, s * 2.4, s * 0.5, s * 0.2, body);
      return;
    }
    fillRoundRect(ctx, x - s, y - s, s * 2, s * 1.9, s * 0.5, body);
    // Comb, beak and an eye, turned the way it last hopped.
    ctx.fillStyle = '#ef4444';
    ctx.fillRect(x - s * 0.25, y - s * 1.3, s * 0.5, s * 0.35);
    const side = this.facing === 'left' ? -1 : 1;
    ctx.fillStyle = '#f97316';
    ctx.fillRect(x + side * s * 0.55 - s * 0.2, y - s * 0.25, s * 0.4, s * 0.3);
    ctx.fillStyle = '#111827';
    ctx.beginPath();
    ctx.arc(x + side * s * 0.25, y - s * 0.45, s * 0.14, 0, TAU);
    ctx.fill();
    ctx.fillStyle = shade(body, -0.12);
    ctx.fillRect(x - s * 0.95, y + s * 0.1, s * 0.3, s * 0.5);
    ctx.fillRect(x + s * 0.65, y + s * 0.1, s * 0.3, s * 0.5);
  }

  private drawEagle(cell: number): void {
    const ctx = this.ctx;
    const x = (this.col + 0.5) * cell;
    const y = this.rowY(this.row, cell);
    ctx.fillStyle = '#44403c';
    ctx.beginPath();
    ctx.moveTo(x - cell * 1.6, y - cell * 0.6);
    ctx.lineTo(x, y - cell * 0.1);
    ctx.lineTo(x + cell * 1.6, y - cell * 0.6);
    ctx.lineTo(x, y + cell * 0.4);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#fafaf9';
    ctx.beginPath();
    ctx.arc(x, y - cell * 0.15, cell * 0.22, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#f59e0b';
    ctx.fillRect(x - cell * 0.06, y - cell * 0.05, cell * 0.12, cell * 0.16);
  }
}
