import { TAU } from '../../core/math';
import { BaseGame } from '../base';
import { banner, text } from '../draw';
import { drawStatBar, statBarHeight } from '../statbar';
import type { GameServices } from '../types';
import { cellAt, COLS, type Dir, DIRS, find, open, OPPOSITE, ROWS, STEP } from './map';

const DESIGN_W = 600;
const LIVES = 3;
const PLAYER_SPEED = 5.4;
const GHOST_SPEED = 4.4;
const GHOST_STEP = 0.3;
const GHOST_MAX = 5.6;
const FRIGHT_SPEED = 0.55;
const FRIGHT_SEC = 6;
const SCATTER_SEC = 5;
const DOT_POINTS = 10;
const POWER_POINTS = 50;
const GHOST_POINTS = 200;
const LEVEL_POINTS = 500;
const HEAD_START_POWER = 4;
const DEATH_SEC = 1.4;
const CLEAR_SEC = 1.8;
const READY_SEC = 1.5;
const HOME_WAIT = 2;
/** Seconds after the start of a life before each ghost leaves the house. */
const RELEASE = [0, 1.5, 4, 7];
const GHOST_COLOURS = ['#ef4444', '#f472b6', '#22d3ee', '#fb923c'];
/** Each ghost's corner in scatter mode. */
const CORNERS: readonly [number, number][] = [
  [COLS - 2, 0],
  [1, 0],
  [COLS - 2, ROWS - 1],
  [1, ROWS - 1],
];

interface Actor {
  c: number;
  r: number;
  dir: Dir;
  /** Progress from the tile (c, r) to the next one along dir, 0 to 1. */
  p: number;
  moving: boolean;
}

interface Ghost extends Actor {
  id: number;
  /** True once out of the house; it never goes back in until eaten. */
  out: boolean;
  /** Seconds before it may leave the house. */
  wait: number;
}

/** The tile a ghost aims for: chase targets for each of the four, or its corner while scattering. */
export function ghostTarget(
  id: number,
  player: { c: number; r: number; dir: Dir },
  scatter: boolean,
  random: () => number,
): [number, number] {
  if (scatter) return CORNERS[id] ?? [1, 1];
  const [dx, dy] = STEP[player.dir];
  switch (id) {
    case 0:
      return [player.c, player.r];
    case 1:
      return [player.c + dx * 3, player.r + dy * 3];
    case 2:
      return [Math.floor(random() * COLS), Math.floor(random() * ROWS)];
    default: {
      const far = Math.hypot(player.c - 1, player.r - (ROWS - 1)) > 6;
      return far ? [player.c, player.r] : (CORNERS[3] ?? [1, 1]);
    }
  }
}

/** Maze Chase: eat every dot while the ghosts hunt you. A power pellet turns the tables for a few seconds. */
export class MazeGame extends BaseGame {
  private readonly u: number;
  private dots = new Set<number>();
  private power = new Set<number>();
  private player: Actor;
  private queued: Dir | null = null;
  private ghosts: Ghost[] = [];
  private lives = LIVES;
  private level = 1;
  private frightT = 0;
  /** Ghosts eaten in the current fright, for the doubling score. */
  private eaten = 0;
  private lifeT = 0;
  private deathT = 0;
  private clearT = 0;
  private readyT = READY_SEC;
  private mouth = 0;

  constructor(services: GameServices) {
    super(services);
    this.u = this.W / DESIGN_W;
    if (this.hasBoost('shield')) this.lives++;
    for (const key of ['dots', 'ghosts', 'levels']) this.addStat(key, 0);
    this.player = this.spawnPlayer();
    this.fillDots();
    this.resetActors();
    if (this.hasBoost('head-start')) this.frightT = HEAD_START_POWER;
    if (services.preview) this.readyT = 0;
  }

  protected tick(dt: number): void {
    if (this.isEnding) return;
    if (this.clearT > 0) {
      this.clearT -= dt;
      if (this.clearT <= 0) this.nextLevel();
      return;
    }
    if (this.deathT > 0) {
      this.deathT -= dt;
      if (this.deathT <= 0) this.afterDeath();
      return;
    }
    this.readTurn();
    if (this.readyT > 0) {
      this.readyT -= dt;
      return;
    }
    this.lifeT += dt;
    this.frightT = Math.max(0, this.frightT - dt);
    if (this.frightT === 0) this.eaten = 0;
    if (this.services.preview) this.autopilot();
    this.movePlayer(dt);
    this.eat();
    for (const g of this.ghosts) this.moveGhost(g, dt);
    this.collide();
  }

  render(): void {
    const ctx = this.ctx;
    ctx.fillStyle = this.skinColor('bg', '#020617');
    ctx.fillRect(0, 0, this.W, this.H);
    const b = this.board();
    ctx.save();
    ctx.translate(this.shake.x, this.shake.y);
    this.drawWalls(b);
    this.drawDots(b);
    if (this.deathT <= 0 || this.deathT > DEATH_SEC * 0.5) this.drawPlayer(b);
    if (this.deathT <= 0) for (const g of this.ghosts) this.drawGhost(g, b);
    this.particles.render(ctx);
    this.texts.render(ctx);
    ctx.restore();
    if (this.services.preview) return;
    drawStatBar(ctx, this.W, this.insets.top, this.u, [
      ['SCORE', Math.floor(this.score).toLocaleString('en-US')],
      ['LEVEL', String(this.level)],
      ['LIVES', String(Math.max(0, this.lives))],
    ]);
    if (this.clearT > 0) {
      banner(
        ctx,
        this.W,
        this.H,
        'MAZE CLEAR',
        `Level ${this.level + 1} next`,
        1 - this.clearT / CLEAR_SEC,
        '#fde047',
      );
    } else if (this.readyT > 0) {
      text(ctx, 'READY!', this.W / 2, b.y + 11.5 * b.cell, {
        size: Math.round(b.cell * 0.9),
        align: 'center',
        color: '#fde047',
      });
    }
    text(ctx, 'Swipe or use the arrow keys to turn', this.W / 2, b.y + ROWS * b.cell + 26 * this.u, {
      size: Math.round(15 * this.u),
      align: 'center',
      color: 'rgba(255,255,255,0.45)',
      weight: 600,
      stroke: null,
    });
  }

  private board(): { x: number; y: number; cell: number } {
    const top = this.insets.top + statBarHeight(this.u) + 4 * this.u;
    const bottom = this.H - this.insets.bottom - 44 * this.u;
    const cell = Math.min((this.W - 12 * this.u) / COLS, (bottom - top) / ROWS);
    return { x: (this.W - cell * COLS) / 2, y: top + (bottom - top - cell * ROWS) / 2, cell };
  }

  private fillDots(): void {
    this.dots.clear();
    this.power.clear();
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const k = cellAt(c, r);
        if (k === '.') this.dots.add(r * COLS + c);
        else if (k === 'o') this.power.add(r * COLS + c);
      }
    }
  }

  private spawnPlayer(): Actor {
    const [c, r] = find('P');
    return { c, r, dir: 'left', p: 0, moving: false };
  }

  /** Player at its start, the red ghost just outside the house, the others inside, waiting their turn. */
  private resetActors(): void {
    this.player = this.spawnPlayer();
    this.queued = null;
    const [hc, hr] = find('G');
    const starts: [number, number][] = [
      [7, 5],
      [hc + 1, hr],
      [hc, hr],
      [hc + 2, hr],
    ];
    this.ghosts = starts.map(([c, r], id) => ({
      id,
      c,
      r,
      dir: 'left' as Dir,
      p: 0,
      moving: true,
      out: id === 0,
      wait: RELEASE[id] ?? 0,
    }));
    this.lifeT = 0;
    this.readyT = this.services.preview ? 0 : READY_SEC;
  }

  private readTurn(): void {
    const swipe = this.input.consumeSwipe();
    if (swipe) this.queued = swipe;
    for (const d of DIRS) if (this.input.wasPressed(d)) this.queued = d;
  }

  /** Card art steers toward the nearest dot so the frame shows a chase. */
  private autopilot(): void {
    if (this.player.p > 0.05) return;
    let best: Dir | null = null;
    let bestD = Infinity;
    for (const d of DIRS) {
      const [dx, dy] = STEP[d];
      if (!open(this.player.c + dx, this.player.r + dy)) continue;
      const nc = this.player.c + dx;
      const nr = this.player.r + dy;
      for (const k of this.dots) {
        const dd = Math.abs((k % COLS) - nc) + Math.abs(Math.floor(k / COLS) - nr);
        if (dd < bestD) {
          bestD = dd;
          best = d;
        }
      }
    }
    if (best) this.queued = best;
  }

  private movePlayer(dt: number): void {
    const p = this.player;
    // Reversing is allowed at any time, as in the arcade game.
    if (this.queued && this.queued === OPPOSITE[p.dir] && p.moving && p.p > 0) {
      const [dx, dy] = STEP[p.dir];
      p.c = this.wrap(p.c + dx);
      p.r += dy;
      p.p = 1 - p.p;
      p.dir = this.queued;
    }
    this.advance(p, PLAYER_SPEED * dt, (a) => {
      if (this.queued && this.canGo(a, this.queued, false)) a.dir = this.queued;
      a.moving = this.canGo(a, a.dir, false);
    });
    if (p.moving) this.mouth += dt * 12;
  }

  /**
   * Moves an actor `dist` tiles along its direction. Each time it reaches a tile centre `decide` picks the next
   * direction (and whether it keeps moving).
   */
  private advance(a: Actor, dist: number, decide: (a: Actor) => void): void {
    if (a.p === 0) decide(a);
    let left = dist;
    while (left > 0 && a.moving) {
      const step = Math.min(left, 1 - a.p);
      a.p += step;
      left -= step;
      if (a.p >= 1 - 1e-9) {
        const [dx, dy] = STEP[a.dir];
        a.c = this.wrap(a.c + dx);
        a.r += dy;
        a.p = 0;
        decide(a);
      }
    }
  }

  private canGo(a: Actor, d: Dir, ghost: boolean): boolean {
    const [dx, dy] = STEP[d];
    return open(a.c + dx, a.r + dy, ghost);
  }

  private wrap(c: number): number {
    return ((c % COLS) + COLS) % COLS;
  }

  private eat(): void {
    const p = this.player;
    if (p.p > 0.5) return;
    const k = p.r * COLS + p.c;
    if (this.dots.delete(k)) {
      this.score += DOT_POINTS;
      this.addStat('dots');
      if (this.dots.size % 2 === 0) this.audio.play('click', { volume: 0.25 });
    } else if (this.power.delete(k)) {
      this.score += POWER_POINTS;
      this.frightT = this.powerTime(FRIGHT_SEC);
      this.eaten = 0;
      for (const g of this.ghosts) if (g.out) g.dir = OPPOSITE[g.dir];
      this.audio.play('powerup');
    }
    if (this.dots.size === 0 && this.power.size === 0) this.clearLevel();
  }

  private moveGhost(g: Ghost, dt: number): void {
    if (g.wait > 0) {
      g.wait -= dt;
      return;
    }
    const fright = this.frightT > 0 && g.out;
    const speed =
      Math.min(GHOST_MAX, GHOST_SPEED + GHOST_STEP * (this.level - 1)) * (fright ? FRIGHT_SPEED : 1);
    this.advance(g, speed * dt, (a) => this.steerGhost(a as Ghost));
  }

  /**
   * At each tile a ghost picks the open way (never straight back, unless there is no other) that brings it closest
   * to its target. Frightened ghosts pick at random. A ghost still in the house heads for the door first.
   */
  private steerGhost(g: Ghost): void {
    if (!g.out && g.r <= 5) g.out = true;
    const inHouse = !g.out;
    const options = DIRS.filter((d) => d !== OPPOSITE[g.dir] && this.canGo(g, d, inHouse));
    const choices = options.length > 0 ? options : DIRS.filter((d) => this.canGo(g, d, inHouse));
    if (choices.length === 0) {
      g.moving = false;
      return;
    }
    g.moving = true;
    if (this.frightT > 0 && g.out) {
      g.dir = this.rng.pick(choices);
      return;
    }
    const target: [number, number] = inHouse
      ? [7, 5]
      : ghostTarget(g.id, this.player, this.lifeT < SCATTER_SEC, () => this.rng.next());
    let best = choices[0] as Dir;
    let bestD = Infinity;
    for (const d of choices) {
      const [dx, dy] = STEP[d];
      const dd = Math.hypot(g.c + dx - target[0], g.r + dy - target[1]);
      if (dd < bestD) {
        bestD = dd;
        best = d;
      }
    }
    g.dir = best;
  }

  /** Screen-independent position of an actor in tiles (with wrapping handled by the caller). */
  private pos(a: Actor): [number, number] {
    const [dx, dy] = STEP[a.dir];
    return [a.c + dx * a.p, a.r + dy * a.p];
  }

  private collide(): void {
    const [px, py] = this.pos(this.player);
    for (const g of this.ghosts) {
      if (g.wait > 0) continue;
      const [gx, gy] = this.pos(g);
      if (Math.hypot(gx - px, gy - py) > 0.6) continue;
      if (this.frightT > 0 && g.out) this.eatGhost(g);
      else {
        this.die();
        return;
      }
    }
  }

  private eatGhost(g: Ghost): void {
    this.eaten++;
    const points = GHOST_POINTS * 2 ** (this.eaten - 1);
    this.score += points;
    this.addStat('ghosts');
    if (this.eaten === 4) this.coins++;
    const b = this.board();
    const [gx, gy] = this.pos(g);
    this.texts.add(
      b.x + (gx + 0.5) * b.cell,
      b.y + (gy + 0.5) * b.cell,
      `+${points}`,
      '#67e8f9',
      20 * this.u,
      0.9,
    );
    this.audio.play('reward');
    // Back to the house to wait before coming out again.
    const [hc, hr] = find('G');
    Object.assign(g, { c: hc + 1, r: hr, p: 0, dir: 'up', out: false, wait: HOME_WAIT, moving: true });
  }

  private die(): void {
    this.lives--;
    this.deathT = DEATH_SEC;
    this.shake.add(0.4);
    this.audio.play('hit');
    this.services.haptic(120);
    const b = this.board();
    const [px, py] = this.pos(this.player);
    this.particles.emit({
      x: b.x + (px + 0.5) * b.cell,
      y: b.y + (py + 0.5) * b.cell,
      count: 24,
      speed: 160 * this.u,
      life: 0.8,
      size: 3,
      colors: [this.skinColor('hero', '#facc15'), '#ffffff'],
    });
  }

  private afterDeath(): void {
    if (this.lives <= 0) {
      this.endGame(0.4);
      return;
    }
    this.frightT = 0;
    this.resetActors();
  }

  private clearLevel(): void {
    this.score += LEVEL_POINTS * this.level;
    this.coins += 2;
    this.addStat('levels');
    this.clearT = CLEAR_SEC;
    this.audio.play('levelup');
  }

  private nextLevel(): void {
    this.level++;
    this.fillDots();
    this.frightT = this.hasBoost('head-start') ? HEAD_START_POWER : 0;
    this.resetActors();
  }

  private drawWalls(b: { x: number; y: number; cell: number }): void {
    const ctx = this.ctx;
    const wall = this.skinColor('wall', '#2563eb');
    const s = b.cell;
    ctx.fillStyle = this.skinColor('wallFill', '#0b1a4a');
    ctx.strokeStyle = wall;
    ctx.lineWidth = Math.max(1.5, s * 0.1);
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const k = cellAt(c, r);
        const x = b.x + c * s;
        const y = b.y + r * s;
        if (k === '-') {
          ctx.fillStyle = '#f9a8d4';
          ctx.fillRect(x + s * 0.1, y + s * 0.42, s * 0.8, s * 0.16);
          ctx.fillStyle = this.skinColor('wallFill', '#0b1a4a');
          continue;
        }
        if (k !== '#') continue;
        ctx.fillRect(x, y, s + 0.5, s + 0.5);
        // Outline only the sides that face open floor, so walls read as rounded blocks.
        const edge = (dc: number, dr: number) =>
          cellAt(c + dc, r + dr) !== '#' && r + dr >= 0 && r + dr < ROWS;
        ctx.beginPath();
        if (edge(0, -1)) {
          ctx.moveTo(x, y + 1);
          ctx.lineTo(x + s, y + 1);
        }
        if (edge(0, 1)) {
          ctx.moveTo(x, y + s - 1);
          ctx.lineTo(x + s, y + s - 1);
        }
        if (edge(-1, 0) && c > 0) {
          ctx.moveTo(x + 1, y);
          ctx.lineTo(x + 1, y + s);
        }
        if (edge(1, 0) && c < COLS - 1) {
          ctx.moveTo(x + s - 1, y);
          ctx.lineTo(x + s - 1, y + s);
        }
        ctx.stroke();
      }
    }
  }

  private drawDots(b: { x: number; y: number; cell: number }): void {
    const ctx = this.ctx;
    ctx.fillStyle = this.skinColor('dot', '#fde68a');
    for (const k of this.dots) {
      ctx.beginPath();
      ctx.arc(
        b.x + ((k % COLS) + 0.5) * b.cell,
        b.y + (Math.floor(k / COLS) + 0.5) * b.cell,
        b.cell * 0.1,
        0,
        TAU,
      );
      ctx.fill();
    }
    const pulse = 0.75 + 0.25 * Math.sin(this.time * 8);
    for (const k of this.power) {
      ctx.beginPath();
      ctx.arc(
        b.x + ((k % COLS) + 0.5) * b.cell,
        b.y + (Math.floor(k / COLS) + 0.5) * b.cell,
        b.cell * 0.28 * pulse,
        0,
        TAU,
      );
      ctx.fill();
    }
  }

  private drawPlayer(b: { x: number; y: number; cell: number }): void {
    const ctx = this.ctx;
    const [px, py] = this.pos(this.player);
    const x = b.x + (this.wrapDraw(px) + 0.5) * b.cell;
    const y = b.y + (py + 0.5) * b.cell;
    const r = b.cell * 0.45;
    const gape =
      this.deathT > 0
        ? Math.min(Math.PI * 0.95, (1 - this.deathT / DEATH_SEC) * Math.PI * 2)
        : (0.15 + 0.25 * Math.abs(Math.sin(this.mouth))) * Math.PI;
    const facing = { right: 0, down: Math.PI / 2, left: Math.PI, up: -Math.PI / 2 }[this.player.dir];
    ctx.fillStyle = this.skinColor('hero', '#facc15');
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.arc(x, y, r, facing + gape / 2, facing - gape / 2 + TAU);
    ctx.closePath();
    ctx.fill();
  }

  private wrapDraw(x: number): number {
    // While crossing the tunnel the position runs past the edge; draw it there rather than jumping.
    return x > COLS - 0.5 ? x - COLS : x;
  }

  private drawGhost(g: Ghost, b: { x: number; y: number; cell: number }): void {
    const ctx = this.ctx;
    const [gx, gy] = this.pos(g);
    const x = b.x + (this.wrapDraw(gx) + 0.5) * b.cell;
    const y = b.y + (gy + 0.5) * b.cell;
    const r = b.cell * 0.44;
    const fright = this.frightT > 0 && g.out;
    const flashing = fright && this.frightT < 2 && Math.floor(this.frightT * 6) % 2 === 0;
    ctx.fillStyle = fright ? (flashing ? '#f8fafc' : '#1d4ed8') : (GHOST_COLOURS[g.id] ?? '#ef4444');
    ctx.beginPath();
    ctx.arc(x, y - r * 0.1, r, Math.PI, 0);
    ctx.lineTo(x + r, y + r * 0.85);
    // A wavy hem that ripples as it moves.
    const wave = Math.sin(this.time * 14 + g.id) > 0 ? 1 : 0;
    for (let k = 0; k < 4; k++) {
      const x0 = x + r - (k + 0.5) * (r / 2);
      ctx.lineTo(x0, y + r * (k % 2 === wave ? 0.6 : 0.85));
    }
    ctx.lineTo(x - r, y + r * 0.85);
    ctx.closePath();
    ctx.fill();
    if (fright) {
      ctx.fillStyle = flashing ? '#ef4444' : '#fde68a';
      ctx.fillRect(x - r * 0.4, y - r * 0.3, r * 0.2, r * 0.2);
      ctx.fillRect(x + r * 0.2, y - r * 0.3, r * 0.2, r * 0.2);
      return;
    }
    const [dx, dy] = STEP[g.dir];
    for (const ex of [-0.35, 0.35]) {
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(x + ex * r, y - r * 0.2, r * 0.26, 0, TAU);
      ctx.fill();
      ctx.fillStyle = '#1e3a8a';
      ctx.beginPath();
      ctx.arc(x + ex * r + dx * r * 0.12, y - r * 0.2 + dy * r * 0.12, r * 0.13, 0, TAU);
      ctx.fill();
    }
  }
}
