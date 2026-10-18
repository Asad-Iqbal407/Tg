import { clamp } from '../../core/math';
import { BaseGame } from '../base';
import { banner } from '../draw';
import type { GameServices } from '../types';
import { Board, COLS, HIDDEN_ROWS, ROWS } from './board';
import {
  buildLook,
  cellCentre,
  drawFlash,
  drawGhost,
  drawPanel,
  drawPiece,
  drawStack,
  drawWell,
  layoutTetris,
  type Look,
  type PanelSlots,
  panelSlots,
  type TetrisLayout,
  type Well,
} from './draw';
import {
  cellsOf,
  type Kind,
  KINDS,
  kickTests,
  type Piece,
  PieceQueue,
  pieceSize,
  turnedBackRot,
  turnedRot,
} from './pieces';
import { TouchDrop } from './touch';

/** The highest level. Gravity stops speeding up there. */
export const MAX_LEVEL = 15;
const LINES_PER_LEVEL = 10;
/** Where the Power Start boost begins. */
const HEAD_START_LEVEL = 3;
/** Points for clearing one to four lines at once, before the level multiplier. */
const LINE_POINTS = [0, 100, 300, 500, 800];
const TETRIS_LINES = 4;
const TETRIS_COINS = 3;
const SOFT_POINTS = 1;
const HARD_POINTS = 2;
/** Soft drop falls 20 rows a second. */
const SOFT_DROP_SEC = 0.05;
const LOCK_SEC = 0.5;
/** Moves and turns that restart the lock timer, per piece. */
const LOCK_RESETS = 15;
/** Held left or right: the first repeat comes after DAS_SEC, then one every ARR_SEC. */
const DAS_SEC = 0.17;
const ARR_SEC = 0.05;
const FLASH_SEC = 0.2;
const BANNER_SEC = 2;
const TOP_OUT_SEC = 1.6;
/** Settled rows the Guardian boost clears on the first top-out. */
const SHIELD_ROWS = 4;
/** Columns the score popups take in turn, so consecutive clears do not pile up at one point. */
const POPUP_COLUMNS = [2, 5, 8];
/** Popup text is this share of a well cell, between POPUP_MIN_PX and the largest size (POPUP_PX, or TETRIS_PX). */
const POPUP_CELL_SHARE = 0.75;
const POPUP_MIN_PX = 12;
const POPUP_PX = 20;
const TETRIS_PX = 24;
/** Rough width of a popup label in ems a character (the digits are the widest). It only keeps the text in the well. */
const POPUP_EM_PER_CHAR = 0.65;

/** The layout for one size, touch inset and preview flag, with the side panel's slots built from it. */
interface LayoutCache {
  readonly width: number;
  readonly height: number;
  readonly bottom: number;
  readonly preview: boolean;
  readonly layout: TetrisLayout;
  readonly slots: PanelSlots | null;
}

/** Level for a number of lines cleared, starting from `startLevel`: one more every ten lines. */
export function levelFor(lines: number, startLevel = 1): number {
  return Math.min(MAX_LEVEL, startLevel + Math.floor(lines / LINES_PER_LEVEL));
}

/** Seconds per row of gravity at a level: (0.8 - (L - 1) * 0.007) ^ (L - 1), but never under 0.02. */
export function secondsPerRow(level: number): number {
  return Math.max(0.02, Math.pow(0.8 - (level - 1) * 0.007, level - 1));
}

/**
 * Where the rows `rows` end up once the full rows `gone` are removed: a row moves down past each removed row
 * below it, and a removed row drops out of the list.
 */
function afterRemoval(rows: readonly number[], gone: readonly number[]): number[] {
  return rows.filter((r) => !gone.includes(r)).map((r) => r + gone.filter((g) => g > r).length);
}

/** A piece at its spawn position: state 0, centred in the top buffer rows. */
function newPiece(kind: Kind): Piece {
  return { kind, rot: 0, x: Math.floor((COLS - pieceSize(kind)) / 2), y: 0 };
}

/** Size of a score popup's text in a well of this cell size. Full size in the usual well, smaller in a small one. */
function popupSize(cell: number, tetris: boolean): number {
  return clamp(Math.round(cell * POPUP_CELL_SHARE), POPUP_MIN_PX, tetris ? TETRIS_PX : POPUP_PX);
}

export class TetrisGame extends BaseGame {
  private readonly board = new Board();
  private readonly queue: PieceQueue;
  private readonly look: Look;
  /** The level the run starts on: 1, 3 with Power Start, or the skin's start level if higher. */
  private readonly startLevel: number;
  private active: Piece;
  private hold: Kind | null = null;
  /** The hold slot has already been used for this piece. */
  private holdLocked = false;
  private level: number;
  private lines = 0;
  private tetrises = 0;
  /** Seconds since the active piece last fell a row. */
  private fallT = 0;
  /** Whether the last falling step was soft drop. Turning soft drop on or off rescales the time banked (see fall). */
  private wasSoft = false;
  /** Seconds the active piece has rested on something. */
  private lockT = 0;
  /** The part of a soft-drop row this piece has earned but not yet been paid for, in rows. */
  private softShare = 0;
  private lockResets = 0;
  /** The direction auto-repeat is running in (-1, 0 or 1), and the time that direction has been held. */
  private steerDir = 0;
  private steerHeld = 0;
  private steerNext = 0;
  private shieldUsed = false;
  private bannerT = 0;
  private flashT = 0;
  private flashRows: number[] = [];
  /** The level-up banner's text, set when the level rises so render() does not build it every frame. */
  private bannerText = '';
  /** Which of POPUP_COLUMNS the next score popup goes in. */
  private popupSlot = 0;
  private readonly touchDrop: TouchDrop;
  /** Coarse pointer at the start of the run: a touch screen gets the compact panel text. Drawing only. */
  private readonly touch: boolean;
  /** A finger on the well is dragging down far enough to soft drop this step. */
  private dragSoft = false;
  /** The layout and panel slots, rebuilt only when the size, the touch inset or the preview flag changes. */
  private cache: LayoutCache | null = null;
  /** The panel's contents, refreshed in place each frame. Stat lines are rebuilt only when a number changes. */
  private readonly hud: {
    hold: Kind | null;
    holdLocked: boolean;
    next: Kind[];
    stats: [string, string][];
  } = { hold: null, holdLocked: false, next: [KINDS[0], KINDS[0], KINDS[0]], stats: [] };
  /** The score, level and lines the stat lines were last built from. */
  private shown = { score: -1, level: -1, lines: -1 };

  constructor(services: GameServices) {
    super(services);
    this.touch = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
    this.touchDrop = new TouchDrop(this.H);
    this.queue = new PieceQueue(this.rng);
    const skinStart = this.skinParam('startLevel', 1);
    const base = Number.isFinite(skinStart) ? Math.round(skinStart) : 1;
    const headStart = this.hasBoost('head-start') ? HEAD_START_LEVEL : 1;
    this.startLevel = Math.min(MAX_LEVEL, Math.max(1, base, headStart));
    this.level = this.startLevel;
    this.active = newPiece(this.queue.next());
    this.look = buildLook((key, fallback) => this.skinColor(key, fallback));
    this.addStat('lines', 0);
    this.addStat('tetrises', 0);
    this.addStat('pieces', 0);
    this.maxStat('level', this.level);
  }

  protected tick(dt: number): void {
    if (this.isEnding) return;
    this.bannerT = Math.max(0, this.bannerT - dt);
    this.flashT = Math.max(0, this.flashT - dt);
    if (this.control(dt)) return;
    this.fall(dt);
  }

  render(): void {
    const ctx = this.ctx;
    const preview = this.services.preview === true;
    const { layout, slots } = this.current();
    const { well } = layout;
    ctx.fillStyle = this.look.backdrop;
    ctx.fillRect(0, 0, this.W, this.H);
    ctx.save();
    ctx.translate(this.shake.x, this.shake.y);
    drawWell(ctx, well, this.look);
    drawStack(ctx, this.board, well, this.look);
    if (this.flashT > 0) drawFlash(ctx, well, this.flashRows, this.flashT / FLASH_SEC);
    if (!this.isEnding) {
      drawGhost(ctx, this.active, this.board.dropDistance(this.active), well, this.look);
      drawPiece(ctx, this.active, well, this.look);
    } else {
      ctx.fillStyle = 'rgba(4, 6, 16, 0.55)';
      ctx.fillRect(well.x, well.y, COLS * well.cell, ROWS * well.cell);
    }
    this.particles.render(ctx);
    this.texts.render(ctx);
    ctx.restore();
    if (slots) {
      this.refreshHud();
      drawPanel(ctx, slots, this.look, this.hud);
    }
    if (this.bannerT > 0 && !preview) {
      banner(ctx, this.W, this.H, this.bannerText, 'Faster!', 1 - this.bannerT / BANNER_SEC, '#fde047');
    }
  }

  /** Well and panel placement for the current size and touch inset, reused until one of them changes. */
  private current(): LayoutCache {
    const { W, H } = this;
    const bottom = this.insets.bottom;
    const preview = this.services.preview === true;
    let cache = this.cache;
    if (
      !cache ||
      cache.width !== W ||
      cache.height !== H ||
      cache.bottom !== bottom ||
      cache.preview !== preview
    ) {
      const layout = layoutTetris(W, H, bottom, !preview, this.touch || bottom > 0);
      cache = {
        width: W,
        height: H,
        bottom,
        preview,
        layout,
        slots: layout.panel ? panelSlots(layout.panel) : null,
      };
      this.cache = cache;
    }
    return cache;
  }

  private layout(): TetrisLayout {
    return this.current().layout;
  }

  /** Copies what the panel shows into the HUD. Stat lines are rebuilt only when a score, level or lines count moves. */
  private refreshHud(): void {
    const hud = this.hud;
    hud.hold = this.hold;
    hud.holdLocked = this.holdLocked;
    hud.next[0] = this.queue.peek(0);
    hud.next[1] = this.queue.peek(1);
    hud.next[2] = this.queue.peek(2);
    const shown = this.shown;
    if (shown.score === this.score && shown.level === this.level && shown.lines === this.lines) return;
    shown.score = this.score;
    shown.level = this.level;
    shown.lines = this.lines;
    hud.stats = [
      ['SCORE', this.score.toLocaleString('en-US')],
      ['LEVEL', `${this.level}`],
      ['LINES', `${this.lines}`],
    ];
  }

  /**
   * Applies the player's actions to the active piece. Returns true when the piece locked (or the run ended),
   * which ends this step.
   */
  private control(dt: number): boolean {
    const { input } = this;
    if (input.wasPressed('secondary')) {
      this.holdPiece();
      if (this.isEnding) return true;
    }
    if (input.wasPressed('up')) this.rotate(true);
    if (input.wasPressed('tertiary')) this.rotate(false);
    // A down swipe is not a drop: short drags are common while steering. Touch drops come from the finger instead.
    for (let s = input.consumeSwipe(); s !== null; s = input.consumeSwipe()) {
      if (s === 'left') this.shift(-1);
      else if (s === 'right') this.shift(1);
      else if (s === 'up') this.rotate(true);
    }
    const gesture = this.touchDrop.update(input.pointer, this.time);
    this.dragSoft = gesture === 'soft';
    if (gesture === 'hard') {
      this.hardDrop();
      return true;
    }
    this.steer(dt);
    if (input.wasPressed('primary')) {
      this.hardDrop();
      return true;
    }
    return false;
  }

  /** A tap moves one column. Holding repeats the move after DAS_SEC, then every ARR_SEC. */
  private steer(dt: number): void {
    const { input } = this;
    if (input.wasPressed('right') || input.wasPressed('left')) {
      const tap = input.wasPressed('right') ? 1 : -1;
      this.steerDir = tap;
      this.steerHeld = 0;
      this.steerNext = DAS_SEC;
      this.shift(tap);
      return;
    }
    const held = input.axisX();
    if (held === 0 || held !== this.steerDir) {
      this.steerDir = 0;
      return;
    }
    this.steerHeld += dt;
    while (this.steerHeld >= this.steerNext) {
      this.steerNext += ARR_SEC;
      this.shift(held);
    }
  }

  private shift(dx: number): void {
    const p = this.active;
    if (!this.board.fitsAt(p.kind, p.rot, p.x + dx, p.y)) return;
    p.x += dx;
    this.moved();
  }

  /** A turn with SRS wall kicks, clockwise or anticlockwise: the first kick offset that fits is taken. */
  private rotate(clockwise: boolean): void {
    const p = this.active;
    const to = clockwise ? turnedRot(p.rot) : turnedBackRot(p.rot);
    for (const [dx, dy] of kickTests(p.kind, p.rot, to)) {
      if (!this.board.fitsAt(p.kind, to, p.x + dx, p.y - dy)) continue;
      p.rot = to;
      p.x += dx;
      p.y -= dy;
      this.moved();
      this.audio.play('click', { volume: 0.5 });
      return;
    }
  }

  /** A successful move or turn restarts the lock timer while the piece rests on something. */
  private moved(): void {
    if (this.grounded() && this.lockResets < LOCK_RESETS) {
      this.lockT = 0;
      this.lockResets++;
    }
  }

  private grounded(): boolean {
    const p = this.active;
    return !this.board.fitsAt(p.kind, p.rot, p.x, p.y + 1);
  }

  /** Gravity and soft drop while the piece is free to fall; the lock delay once it rests on something. */
  private fall(dt: number): void {
    if (this.grounded()) {
      this.fallT = 0;
      this.lockT += dt;
      if (this.lockT >= LOCK_SEC) this.lock();
      return;
    }
    this.lockT = 0;
    const gravity = secondsPerRow(this.level);
    const soft = this.input.isDown('down') || this.dragSoft;
    const interval = soft ? Math.min(gravity, SOFT_DROP_SEC) : gravity;
    if (soft !== this.wasSoft) {
      // The piece keeps its place in its row: the time banked so far becomes the same fraction of the new row. Left as
      // seconds, the time banked under gravity would be spent at once as a burst of rows when Down is pressed.
      const before = this.wasSoft ? Math.min(gravity, SOFT_DROP_SEC) : gravity;
      this.fallT = (this.fallT / before) * interval;
      this.wasSoft = soft;
    }
    // Soft drop is paid for the time it moves the piece faster than gravity would: 1 / interval - 1 / gravity rows a
    // second, which is nothing once gravity is the quicker. Paid by time rather than by row, a tap of Down earns only
    // its own time, whichever part of a row it starts in.
    const extra = 1 / interval - 1 / gravity;
    const phase = this.fallT;
    this.fallT += dt;
    let rows = 0;
    while (this.fallT >= interval && !this.grounded()) {
      this.fallT -= interval;
      this.active.y++;
      rows++;
    }
    // The time spent falling this step: all of it, or only up to the row that landed the piece.
    const falling = this.grounded() ? Math.max(0, rows * interval - phase) : dt;
    this.softShare += falling * extra;
    // Whole rows are paid out; the fraction carries on to the next row this piece falls.
    const whole = Math.floor(this.softShare + 1e-9);
    if (whole > 0) {
      this.score += whole * SOFT_POINTS;
      this.softShare -= whole;
    }
  }

  /** Drops the piece to its landing row at once, then locks it. */
  private hardDrop(): void {
    const p = this.active;
    const rows = this.board.dropDistance(p);
    p.y += rows;
    this.score += HARD_POINTS * rows;
    this.shake.add(0.15);
    this.burst(p, 2);
    this.lock();
  }

  /** Writes the active piece into the well, clears full rows, then spawns the next piece or ends the run. */
  private lock(): void {
    const p = this.active;
    const buffered = this.board.inBuffer(p);
    // The settled rows the Guardian would take, found before the piece is written in: its own cells never count.
    const stack = buffered ? this.board.highestRows(SHIELD_ROWS) : [];
    this.board.place(p);
    this.addStat('pieces');
    this.audio.play('land', { volume: 0.6 });
    const rows = this.board.fullRows();
    if (rows.length > 0) this.clearRows(rows);
    if (buffered && !this.survive(afterRemoval(stack, rows))) return;
    this.holdLocked = false;
    this.enter(this.queue.next());
  }

  /** Puts `kind` at the spawn position. A spawn the stack blocks is a top-out. */
  private enter(kind: Kind): void {
    this.active = newPiece(kind);
    this.fallT = 0;
    this.softShare = 0;
    this.lockT = 0;
    this.lockResets = 0;
    if (this.board.fits(this.active)) return;
    if (this.survive(this.board.highestRows(SHIELD_ROWS)) && this.board.fits(this.active)) return;
    this.endGame(TOP_OUT_SEC);
  }

  /**
   * A top-out ends the run, except the first one with the Guardian boost: that clears the given settled rows (the
   * highest that held blocks before the top-out piece locked) and carries on. Returns whether the run continues.
   */
  private survive(rows: readonly number[]): boolean {
    if (this.shieldUsed || !this.hasBoost('shield')) {
      this.endGame(TOP_OUT_SEC);
      return false;
    }
    this.shieldUsed = true;
    const well = this.layout().well;
    this.board.removeRows(rows);
    this.flashRows = [...rows];
    this.flashT = FLASH_SEC;
    this.shake.add(0.35);
    this.audio.play('bump');
    const at = cellCentre(well, Math.floor(COLS / 2), HIDDEN_ROWS);
    this.texts.add(at.x, at.y, 'GUARDIAN!', '#67e8f9', 20, 1.2);
    return true;
  }

  /** Scores the rows a piece completed, celebrates them, removes them, and checks the level. */
  private clearRows(rows: number[]): void {
    const n = rows.length;
    const points = (LINE_POINTS[n] ?? 0) * this.level;
    this.score += points;
    this.lines += n;
    this.addStat('lines', n);
    if (n === TETRIS_LINES) {
      this.tetrises++;
      this.addStat('tetrises');
    }
    this.coins = this.lines + TETRIS_COINS * this.tetrises;

    const well = this.layout().well;
    for (const r of rows) this.burstRow(well, r);
    this.board.removeRows(rows);
    this.flashRows = rows;
    this.flashT = FLASH_SEC;
    this.shake.add(0.1 * n);
    this.services.haptic(n === TETRIS_LINES ? 25 : 10);
    this.audio.play(n === TETRIS_LINES ? 'reward' : 'pop');
    const column = POPUP_COLUMNS[this.popupSlot] ?? Math.floor(COLS / 2);
    this.popupSlot = (this.popupSlot + 1) % POPUP_COLUMNS.length;
    const tetris = n === TETRIS_LINES;
    const label = tetris ? 'TETRIS!' : `+${points}`;
    const size = popupSize(well.cell, tetris);
    // The text is centred on its column, so it moves in where it would run past either side of the well.
    const half = (label.length * POPUP_EM_PER_CHAR * size) / 2;
    const at = cellCentre(well, column, rows[0] ?? 0);
    const x = clamp(at.x, well.x + half, well.x + COLS * well.cell - half);
    this.texts.add(x, at.y, label, tetris ? '#fde047' : '#ffffff', size);

    const level = levelFor(this.lines, this.startLevel);
    if (level > this.level) {
      this.level = level;
      this.maxStat('level', level);
      this.bannerText = `LEVEL ${level}`;
      this.bannerT = BANNER_SEC;
      this.audio.play('levelup');
    }
  }

  /** Swaps the active piece with the hold slot, or stores it if the slot is empty. Once per piece. */
  private holdPiece(): void {
    if (this.holdLocked) return;
    this.holdLocked = true;
    this.audio.play('select');
    const held = this.hold;
    this.hold = this.active.kind;
    this.enter(held ?? this.queue.next());
  }

  /** A few particles from each cell of a piece, in its colour. */
  private burst(p: Piece, count: number): void {
    const well = this.layout().well;
    const colour = this.look.blocks[p.kind].fill;
    for (const o of cellsOf(p.kind, p.rot)) {
      const at = cellCentre(well, p.x + o.x, p.y + o.y);
      this.particles.emit({
        x: at.x,
        y: at.y,
        count,
        speed: 120,
        life: 0.35,
        size: 3,
        drag: 3,
        colors: [colour],
      });
    }
  }

  /** Particles over a row about to be removed, in the colours of its blocks. */
  private burstRow(well: Well, r: number): void {
    for (let x = 0; x < COLS; x++) {
      const code = this.board.cells[r * COLS + x] ?? 0;
      const kind = KINDS[code - 1];
      if (!kind) continue;
      const at = cellCentre(well, x, r);
      this.particles.emit({
        x: at.x,
        y: at.y,
        count: 3,
        speed: 200,
        life: 0.6,
        size: 3,
        drag: 2,
        colors: [this.look.blocks[kind].fill, '#ffffff'],
      });
    }
  }
}
