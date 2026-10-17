import { BaseGame } from '../base';
import { banner } from '../draw';
import type { GameServices } from '../types';
import {
  type Cell,
  cellX,
  cellY,
  COLS,
  emptyRow,
  FLY_SPEED,
  type Flight,
  flip,
  freeColour,
  groupAt,
  type Layout,
  makeLayout,
  type Point,
  type Row,
  shiftOf,
  stepFlight,
  traceShot,
  type Trace,
  trimRows,
  unanchored,
} from './board';
import {
  bubbleRadius,
  colourOf,
  drawAim,
  drawBackdrop,
  drawBubble,
  drawDangerLine,
  drawFalling,
  drawGrid,
  drawHud,
  drawNext,
  drawShooter,
  drawWalls,
  type Falling,
  type Palette,
} from './draw';

/** Shots between ceiling drops. */
export const SHOTS_PER_DROP = 6;
/** Bubbles of one colour that must touch to pop. */
const MIN_GROUP = 3;
const POP_POINTS = 10;
const DROP_POINTS = 20;
const MAX_COMBO = 5;
/** Bonus per level cleared, times the level. */
const CLEAR_BONUS = 100;
/** Lowest aim: 15 degrees above the horizon, so a shot never bounces along the walls. */
const MIN_AIM = (15 * Math.PI) / 180;
/** Keyboard aim speed, in radians per second. */
const AIM_RATE = 2.2;
const LEVEL_CLEAR_SEC = 1.8;
const BANNER_SEC = 2;
const DEATH_DELAY_SEC = 1.4;
/** How fast the grid slides down after a drop, in row heights per second. */
const SLIDE_RATE = 5;
const FALL_GRAVITY = 1400;
const MAX_FALLING = 80;
const DEFAULT_COLOURS = ['#38bdf8', '#f472b6', '#facc15', '#4ade80', '#a78bfa', '#fb923c'];
const STAT_KEYS = ['pops', 'drops', 'shots', 'levels', 'combo'] as const;

/** Rows at the start of a level: 7 on level 1, one more each level, up to 9. */
export function rowsFor(level: number): number {
  return Math.min(9, 6 + level);
}

/** Colours in play: 5 on level 1, 6 from level 2 on. */
export function coloursFor(level: number): number {
  return level <= 1 ? 5 : 6;
}

/** Score multiplier for a shot that removed `removed` bubbles (popped or dropped): x2 from 5, then +x1 per two more. */
export function comboFor(removed: number): number {
  return Math.min(MAX_COMBO, 1 + Math.floor(Math.max(0, removed - MIN_GROUP) / 2));
}

/** Keeps an aim angle between MIN_AIM and PI - MIN_AIM. */
export function clampAim(angle: number): number {
  return Math.min(Math.PI - MIN_AIM, Math.max(MIN_AIM, angle));
}

type Shot = Flight & { colour: number };

export class BubbleGame extends BaseGame {
  private readonly layout: Layout;
  private readonly pal: Palette;
  /** Grid rows from the ceiling (index 0) down. */
  private rows: Row[] = [];
  private level = 1;
  /** Shots fired since the ceiling last dropped. */
  private sinceDrop = 0;
  /** Aim in radians: 0 points right, PI / 2 straight up. */
  private aim = Math.PI / 2;
  /** Colour in the shooter, and the colour waiting beside it. */
  private loaded = 1;
  private upcoming = 1;
  private shot: Shot | null = null;
  /** Seconds left in the level-clear pause; the next level starts when it runs out. */
  private clearT = 0;
  private bannerT = 0;
  /** Downward offset of the grid after a drop, in px. It eases to 0, so the new row slides in. */
  private slide = 0;
  private shieldUsed = false;
  private falling: Falling[] = [];
  private traced: Trace | null = null;
  private tracedAim = NaN;
  private tracedVersion = -1;
  /** Bumped whenever the grid changes, so the aim preview knows to rebuild. */
  private version = 0;

  constructor(services: GameServices) {
    super(services);
    this.layout = makeLayout(this.W, this.H, this.insets.bottom);
    this.pal = this.palette();
    for (const key of STAT_KEYS) this.addStat(key, 0);
    this.startLevel(this.hasBoost('head-start') ? 2 : 1);
  }

  protected tick(dt: number): void {
    this.animate(dt);
    if (this.clearT > 0) {
      this.clearT -= dt;
      if (this.clearT <= 0) this.startLevel(this.level + 1);
      return;
    }
    if (this.isEnding) return;
    this.steerAim(dt);
    if (!this.shot && (this.input.wasPressed('primary') || this.input.pointer.released)) this.fire();
    if (this.shot) this.fly(dt);
  }

  render(): void {
    const ctx = this.ctx;
    const L = this.layout;
    const pal = this.pal;
    const r = bubbleRadius(L);
    drawBackdrop(ctx, this.W, this.H, pal);
    ctx.save();
    ctx.translate(this.shake.x, this.shake.y);
    drawWalls(ctx, L, pal, this.H);
    drawDangerLine(ctx, L, pal);
    drawGrid(ctx, L, this.H, this.rows, pal, r, this.slide);
    const loaded = colourOf(pal, this.loaded);
    if (!this.shot && !this.isEnding && this.clearT <= 0) {
      const trace = this.aimTrace();
      const spot: Point | null = trace.at
        ? { x: cellX(L, trace.at.col, shiftOf(this.rows, trace.at.row)), y: cellY(L, trace.at.row) }
        : null;
      drawAim(ctx, L, trace.points, spot, loaded, pal, r);
    }
    drawFalling(ctx, this.falling, pal, r);
    if (this.shot) drawBubble(ctx, this.shot.x, this.shot.y, r, colourOf(pal, this.shot.colour));
    drawShooter(ctx, L, pal, this.aim, loaded, r);
    drawNext(ctx, L, pal, colourOf(pal, this.upcoming), r);
    this.particles.render(ctx);
    this.texts.render(ctx);
    ctx.restore();
    if (this.services.preview) return;
    drawHud(ctx, this.W, L, pal, {
      score: this.score,
      level: this.level,
      sinceDrop: this.sinceDrop,
      perDrop: SHOTS_PER_DROP,
    });
    if (this.clearT > 0) {
      banner(
        ctx,
        this.W,
        this.H,
        'LEVEL CLEAR',
        `Level ${this.level + 1} next`,
        1 - this.clearT / LEVEL_CLEAR_SEC,
        '#fde047',
      );
    } else if (this.bannerT > 0) {
      banner(
        ctx,
        this.W,
        this.H,
        `LEVEL ${this.level}`,
        'Pop the matches, drop the rest',
        1 - this.bannerT / BANNER_SEC,
        pal.text,
      );
    }
  }

  private palette(): Palette {
    return {
      top: this.skinColor('top', '#1e3a8a'),
      bottom: this.skinColor('bottom', '#0b1530'),
      panel: this.skinColor('panel', '#172e6b'),
      rail: this.skinColor('rail', '#67e8f9'),
      gun: this.skinColor('gun', '#e0f2fe'),
      danger: this.skinColor('danger', '#f87171'),
      text: this.skinColor('text', '#e0f2fe'),
      bubbles: DEFAULT_COLOURS.map((fallback, i) => this.skinColor(`c${i + 1}`, fallback)),
    };
  }

  private startLevel(level: number): void {
    this.level = level;
    this.rows = [];
    for (let i = 0; i < rowsFor(level); i++) this.growRow(false);
    this.sinceDrop = 0;
    this.shot = null;
    this.slide = 0;
    this.loaded = this.pickShot();
    this.upcoming = this.pickShot();
    this.bannerT = BANNER_SEC;
    this.version++;
  }

  /** Adds a full row of random colours above the grid (a ceiling drop) or below it (the first rows). */
  private growRow(atTop: boolean): void {
    const colours = coloursFor(this.level);
    const edge = atTop ? this.rows[0] : this.rows[this.rows.length - 1];
    const row = emptyRow(edge ? flip(edge.shift) : 0);
    if (atTop) this.rows.unshift(row);
    else this.rows.push(row);
    const index = atTop ? 0 : this.rows.length - 1;
    for (let c = 0; c < COLS; c++) row.cells[c] = freeColour(this.rng, this.rows, index, c, colours);
  }

  /** The next colour to load: one that is still on the grid, so the board is always clearable. */
  private pickShot(): number {
    const present = new Set<number>();
    for (const row of this.rows) for (const v of row.cells) if (v) present.add(v);
    const list =
      present.size > 0
        ? [...present].sort((a, b) => a - b)
        : Array.from({ length: coloursFor(this.level) }, (_, i) => i + 1);
    return this.rng.pick(list);
  }

  private aimTrace(): Trace {
    if (!this.traced || this.tracedAim !== this.aim || this.tracedVersion !== this.version) {
      this.traced = traceShot(this.layout, this.rows, this.aim);
      this.tracedAim = this.aim;
      this.tracedVersion = this.version;
    }
    return this.traced;
  }

  private animate(dt: number): void {
    this.bannerT = Math.max(0, this.bannerT - dt);
    this.slide = Math.max(0, this.slide - dt * this.layout.rowH * SLIDE_RATE);
    for (const f of this.falling) {
      f.vy += FALL_GRAVITY * dt;
      f.x += f.vx * dt;
      f.y += f.vy * dt;
      f.life -= dt;
    }
    this.falling = this.falling.filter((f) => f.life > 0);
  }

  /** The pointer aims while it is held (and for the release); otherwise the arrow keys nudge the aim. */
  private steerAim(dt: number): void {
    const ptr = this.input.pointer;
    if (ptr.down || ptr.released) this.aim = this.angleTo(ptr.x, ptr.y);
    else this.aim = clampAim(this.aim - this.input.axisX() * AIM_RATE * dt);
  }

  private angleTo(x: number, y: number): number {
    return clampAim(Math.atan2(this.layout.shooterY - y, x - this.layout.shooterX));
  }

  private fire(): void {
    const L = this.layout;
    this.shot = {
      x: L.shooterX,
      y: L.shooterY,
      vx: Math.cos(this.aim) * FLY_SPEED,
      vy: -Math.sin(this.aim) * FLY_SPEED,
      colour: this.loaded,
    };
    this.loaded = this.upcoming;
    this.upcoming = this.pickShot();
    this.addStat('shots');
    this.audio.play('whoosh');
  }

  private fly(dt: number): void {
    const shot = this.shot;
    if (!shot) return;
    const hit = stepFlight(this.layout, this.rows, shot, dt);
    if (!hit) return;
    this.shot = null;
    this.land(hit.at, shot.colour);
  }

  /** A shot has settled: place it, pop and drop, then check the ceiling and the shooter line. */
  private land(at: Cell | null, colour: number): void {
    this.version++;
    if (!at) {
      this.endGame(DEATH_DELAY_SEC);
      return;
    }
    this.place(at, colour);
    const origin: Point = {
      x: cellX(this.layout, at.col, shiftOf(this.rows, at.row)),
      y: cellY(this.layout, at.row),
    };
    const group = groupAt(this.rows, at.row, at.col);
    const pops = group.length >= MIN_GROUP ? group.length : 0;
    if (pops > 0) {
      this.popCells(group);
      this.services.haptic(12);
    } else {
      this.audio.play('bump');
    }
    const drops = pops > 0 ? this.dropFloating() : 0;
    this.award(pops, drops, origin);
    if (this.rows.length === 0) {
      this.clearLevel();
      return;
    }
    this.sinceDrop++;
    if (this.sinceDrop >= SHOTS_PER_DROP) {
      this.sinceDrop = 0;
      this.ceilingDrop();
    }
    if (this.rows.length > this.layout.lineRow) this.reachLine();
  }

  private place(at: Cell, colour: number): void {
    while (this.rows.length <= at.row) {
      const last = this.rows[this.rows.length - 1];
      this.rows.push(emptyRow(last ? flip(last.shift) : 0));
    }
    const row = this.rows[at.row];
    if (row) row.cells[at.col] = colour;
  }

  private popCells(group: Cell[]): void {
    const L = this.layout;
    for (const c of group) {
      const row = this.rows[c.row];
      if (!row) continue;
      const k = row.cells[c.col] ?? 0;
      row.cells[c.col] = 0;
      this.particles.emit({
        x: cellX(L, c.col, row.shift),
        y: cellY(L, c.row),
        count: 8,
        speed: 170,
        life: 0.5,
        size: 3.5,
        drag: 2.2,
        colors: [colourOf(this.pal, k), '#ffffff'],
      });
    }
  }

  /** Removes the bubbles no longer tied to the ceiling. They fall away on screen and count as drops. */
  private dropFloating(): number {
    const lost = unanchored(this.rows);
    const L = this.layout;
    for (const c of lost) {
      const row = this.rows[c.row];
      if (!row) continue;
      const k = row.cells[c.col] ?? 0;
      row.cells[c.col] = 0;
      this.releaseFalling(cellX(L, c.col, row.shift), cellY(L, c.row), k);
    }
    trimRows(this.rows);
    return lost.length;
  }

  private releaseFalling(x: number, y: number, colour: number): void {
    const vx = (this.fxRng.next() - 0.5) * 120;
    this.falling.push({ x, y, vx, vy: 0, colour, life: 0.9 });
    if (this.falling.length > MAX_FALLING) this.falling.shift();
  }

  /** Points for a shot that popped `pops` bubbles and dropped `drops`, with the combo multiplier. */
  private award(pops: number, drops: number, at: Point): void {
    const removed = pops + drops;
    if (removed === 0) return;
    const combo = comboFor(removed);
    const points = (POP_POINTS * pops + DROP_POINTS * drops) * combo;
    this.score += points;
    this.addStat('pops', pops);
    this.addStat('drops', drops);
    this.maxStat('combo', combo);
    this.syncCoins();
    const size = Math.round(Math.max(14, this.layout.d * 0.34));
    this.texts.add(at.x, at.y - this.layout.d * 0.4, `+${points}`, '#ffffff', size);
    if (combo > 1) {
      this.texts.add(at.x, at.y + this.layout.d * 0.4, `COMBO x${combo}`, '#fde047', size + 4, 1.2);
      this.audio.play('reward');
    } else {
      this.audio.play('pop');
    }
  }

  /** Two coins per level cleared and one per six drops. */
  private syncCoins(): void {
    this.coins = 2 * (this.stats['levels'] ?? 0) + Math.floor((this.stats['drops'] ?? 0) / 6);
  }

  private clearLevel(): void {
    this.addStat('levels');
    this.score += CLEAR_BONUS * this.level;
    this.syncCoins();
    this.clearT = LEVEL_CLEAR_SEC;
    this.shot = null;
    this.audio.play('levelup');
    this.services.haptic(40);
    const L = this.layout;
    this.particles.emit({
      x: L.shooterX,
      y: L.shooterY - L.d,
      count: 36,
      speed: 260,
      life: 1,
      size: 4.5,
      colors: [...this.pal.bubbles, '#ffffff'],
    });
  }

  /** The ceiling sinks one row: a fresh full row comes in above, and everything moves down. */
  private ceilingDrop(): void {
    this.growRow(true);
    this.slide = this.layout.rowH;
    this.version++;
    this.audio.play('warning');
    this.shake.add(0.25);
  }

  /** A bubble has settled on the shooter line. The boost clears that row once; otherwise the run ends. */
  private reachLine(): void {
    const L = this.layout;
    if (!this.shieldUsed && this.hasBoost('shield')) {
      this.shieldUsed = true;
      const gone = this.rows.splice(L.lineRow);
      gone.forEach((row, k) => {
        row.cells.forEach((colour, c) => {
          if (!colour) return;
          this.particles.emit({
            x: cellX(L, c, row.shift),
            y: cellY(L, L.lineRow + k),
            count: 8,
            speed: 200,
            life: 0.6,
            size: 3.5,
            colors: [colourOf(this.pal, colour), '#67e8f9'],
          });
        });
      });
      trimRows(this.rows);
      const dropped = this.dropFloating();
      this.version++;
      const at: Point = { x: L.shooterX, y: cellY(L, L.lineRow) };
      this.award(0, dropped, at);
      this.texts.add(at.x, at.y - L.d * 0.9, 'SAVED!', '#67e8f9', Math.round(L.d * 0.4), 1.4);
      this.audio.play('powerup');
      this.shake.add(0.4);
      return;
    }
    this.endGame(DEATH_DELAY_SEC);
    this.shake.add(0.8);
    this.particles.emit({
      x: L.shooterX,
      y: cellY(L, L.lineRow),
      count: 30,
      speed: 220,
      life: 0.8,
      size: 4,
      drag: 2,
      colors: [this.pal.danger, '#ffffff'],
    });
  }
}
