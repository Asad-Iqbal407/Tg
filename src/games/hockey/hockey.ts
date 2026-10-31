import { clamp, TAU } from '../../core/math';
import { BaseGame } from '../base';
import { banner, fillRoundRect, shade, text } from '../draw';
import { statBarHeight } from '../statbar';
import type { GameServices } from '../types';

const DESIGN_W = 600;
const MALLET_R = 40;
const PUCK_R = 26;
const GOAL_SHARE = 0.4;
const WIN_GOALS = 7;
const PUCK_MAX = 2300;
/** Share of the puck's speed lost per second to the air table. */
const DRAG = 0.35;
const WALL_BOUNCE = 0.9;
const HIT_BOUNCE = 0.92;
const PLAYER_MAX = 3000;
const KEY_SPEED = 950;
const GOAL_POINTS = 100;
const WIN_POINTS = 500;
const RESULT_SEC = 2;
const FACE_OFF_SEC = 0.8;
/** A puck pinned between both mallets this long is put back in play with a face-off. */
const PINCH_SEC = 0.5;

/** Fastest the computer's mallet moves on level n (logical px per second at the design width). */
export function cpuSpeedFor(level: number): number {
  return Math.min(1350, 520 + 130 * (level - 1));
}

/**
 * The puck's velocity after it meets a mallet moving at (mvx, mvy). `nx, ny` is the unit normal from the mallet to the
 * puck. The mallet is far heavier, so the puck bounces off it and takes on its push.
 */
export function strike(
  vx: number,
  vy: number,
  mvx: number,
  mvy: number,
  nx: number,
  ny: number,
  bounce: number,
): { vx: number; vy: number } {
  const rel = (vx - mvx) * nx + (vy - mvy) * ny;
  if (rel >= 0) return { vx, vy };
  return { vx: vx - (1 + bounce) * rel * nx, vy: vy - (1 + bounce) * rel * ny };
}

interface Body {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

/** Air Hockey against the computer: first to seven. Each match won brings a quicker opponent; a loss ends the run. */
export class HockeyGame extends BaseGame {
  private readonly u: number;
  private puck: Body = { x: 0, y: 0, vx: 0, vy: 0 };
  private me: Body = { x: 0, y: 0, vx: 0, vy: 0 };
  private cpu: Body = { x: 0, y: 0, vx: 0, vy: 0 };
  private myGoals = 0;
  private cpuGoals = 0;
  private level = 1;
  private faceT = FACE_OFF_SEC;
  private resultT = 0;
  private result: 'win' | 'loss' | null = null;
  private shield = false;
  private flash = 0;
  private pinchT = 0;

  constructor(services: GameServices) {
    super(services);
    this.u = this.W / DESIGN_W;
    this.shield = this.hasBoost('shield');
    for (const key of ['goals', 'wins']) this.addStat(key, 0);
    this.newMatch();
  }

  protected tick(dt: number): void {
    this.flash = Math.max(0, this.flash - dt);
    if (this.isEnding) return;
    if (this.result) {
      this.resultT -= dt;
      if (this.resultT <= 0) this.afterMatch();
      return;
    }
    this.moveMe(dt);
    this.moveCpu(dt);
    if (this.faceT > 0) {
      this.faceT -= dt;
      return;
    }
    const steps = Math.max(
      1,
      Math.ceil((Math.hypot(this.puck.vx, this.puck.vy) * dt) / (PUCK_R * this.u * 0.4)),
    );
    for (let i = 0; i < steps && !this.result && this.faceT <= 0; i++) this.stepPuck(dt / steps);
  }

  render(): void {
    const ctx = this.ctx;
    const r = this.rink();
    ctx.fillStyle = this.skinColor('bg', '#0f172a');
    ctx.fillRect(0, 0, this.W, this.H);
    ctx.save();
    ctx.translate(this.shake.x, this.shake.y);
    fillRoundRect(
      ctx,
      r.left - 10 * this.u,
      r.top - 10 * this.u,
      r.right - r.left + 20 * this.u,
      r.bottom - r.top + 20 * this.u,
      30 * this.u,
      this.skinColor('rail', '#1e40af'),
    );
    fillRoundRect(
      ctx,
      r.left,
      r.top,
      r.right - r.left,
      r.bottom - r.top,
      24 * this.u,
      this.skinColor('ice', '#e0f2fe'),
    );
    const mid = (r.top + r.bottom) / 2;
    const cx = (r.left + r.right) / 2;
    ctx.strokeStyle = this.skinColor('lines', '#ef4444');
    ctx.lineWidth = 4 * this.u;
    ctx.beginPath();
    ctx.moveTo(r.left, mid);
    ctx.lineTo(r.right, mid);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, mid, 70 * this.u, 0, TAU);
    ctx.stroke();
    const gw = (r.right - r.left) * GOAL_SHARE;
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(cx - gw / 2, r.top - 10 * this.u, gw, 12 * this.u);
    ctx.fillRect(cx - gw / 2, r.bottom - 2 * this.u, gw, 12 * this.u);
    for (const [y, dir] of [
      [r.top, 1],
      [r.bottom, -1],
    ] as const) {
      ctx.beginPath();
      ctx.arc(cx, y, gw * 0.45, dir > 0 ? 0 : Math.PI, dir > 0 ? Math.PI : TAU);
      ctx.stroke();
    }
    // Score painted on the ice under the play.
    ctx.globalAlpha = 0.18;
    text(ctx, String(this.cpuGoals), cx, mid - 110 * this.u, {
      size: Math.round(90 * this.u),
      align: 'center',
      color: '#0f172a',
      stroke: null,
    });
    text(ctx, String(this.myGoals), cx, mid + 110 * this.u, {
      size: Math.round(90 * this.u),
      align: 'center',
      color: '#0f172a',
      stroke: null,
    });
    ctx.globalAlpha = 1;
    this.drawPuck();
    this.drawMallet(this.cpu, this.skinColor('cpu', '#2563eb'));
    this.drawMallet(this.me, this.skinColor('player', '#ef4444'));
    this.particles.render(ctx);
    this.texts.render(ctx);
    ctx.restore();
    if (this.flash > 0) {
      ctx.fillStyle = `rgba(255,255,255,${this.flash})`;
      ctx.fillRect(0, 0, this.W, this.H);
    }
    if (this.services.preview) return;
    text(
      ctx,
      `LEVEL ${this.level}  ·  ${this.myGoals} – ${this.cpuGoals}  ·  SCORE ${Math.floor(this.score)}`,
      this.W / 2,
      this.insets.top + 26 * this.u,
      {
        size: Math.round(18 * this.u),
        align: 'center',
      },
    );
    if (this.result) {
      banner(
        ctx,
        this.W,
        this.H,
        this.result === 'win' ? 'YOU WIN!' : 'CPU WINS',
        this.result === 'win' ? `Level ${this.level + 1} next` : '',
        1 - this.resultT / RESULT_SEC,
        this.result === 'win' ? '#86efac' : '#fde047',
      );
    }
  }

  private rink(): { left: number; right: number; top: number; bottom: number } {
    const top = this.insets.top + Math.max(statBarHeight(this.u) * 0.75, 50 * this.u);
    return {
      left: 22 * this.u,
      right: this.W - 22 * this.u,
      top,
      bottom: this.H - this.insets.bottom - 22 * this.u,
    };
  }

  private newMatch(): void {
    this.myGoals = this.hasBoost('head-start') ? 1 : 0;
    this.cpuGoals = 0;
    this.result = null;
    const r = this.rink();
    const cx = (r.left + r.right) / 2;
    this.me = { x: cx, y: r.bottom - 90 * this.u, vx: 0, vy: 0 };
    this.cpu = { x: cx, y: r.top + 90 * this.u, vx: 0, vy: 0 };
    this.faceOff(true);
  }

  /** The puck waits still in the half of the side that let the goal in. */
  private faceOff(mine: boolean): void {
    const r = this.rink();
    const mid = (r.top + r.bottom) / 2;
    this.puck = { x: (r.left + r.right) / 2, y: mid + (mine ? 1 : -1) * 120 * this.u, vx: 0, vy: 0 };
    this.faceT = FACE_OFF_SEC;
  }

  /** The player's mallet follows a finger (or the mouse) anywhere in the lower half; the arrow keys move it too. */
  private moveMe(dt: number): void {
    const r = this.rink();
    const mid = (r.top + r.bottom) / 2;
    const p = this.input.pointer;
    const prevX = this.me.x;
    const prevY = this.me.y;
    let tx = this.me.x;
    let ty = this.me.y;
    if (p.down || (p.active && !p.touch && p.inside)) {
      tx = p.x;
      ty = p.y;
    } else if (this.services.preview) {
      tx = this.puck.x;
      ty = Math.max(this.puck.y + 30 * this.u, mid + 60 * this.u);
    } else {
      tx += this.input.axisX() * KEY_SPEED * this.u * dt;
      ty += this.input.axisY() * KEY_SPEED * this.u * dt;
    }
    const max = PLAYER_MAX * this.u * dt;
    const dx = tx - this.me.x;
    const dy = ty - this.me.y;
    const d = Math.hypot(dx, dy);
    const k = d > max ? max / d : 1;
    this.me.x += dx * k;
    this.me.y += dy * k;
    const m = MALLET_R * this.u;
    this.me.x = clamp(this.me.x, r.left + m, r.right - m);
    this.me.y = clamp(this.me.y, mid + m, r.bottom - m);
    this.me.vx = dt > 0 ? (this.me.x - prevX) / dt : 0;
    this.me.vy = dt > 0 ? (this.me.y - prevY) / dt : 0;
  }

  /**
   * The computer attacks a puck in its half (from behind it, to drive it down) and otherwise guards its goal, shading
   * toward the puck. Its speed grows with the level.
   */
  private moveCpu(dt: number): void {
    const r = this.rink();
    const mid = (r.top + r.bottom) / 2;
    const m = MALLET_R * this.u;
    const pk = this.puck;
    const cx = (r.left + r.right) / 2;
    let tx: number;
    let ty: number;
    if (pk.y < mid && this.faceT <= 0) {
      tx = pk.x;
      ty = pk.y - (pk.vy < 0 ? 10 : 30) * this.u;
    } else {
      tx = cx + (pk.x - cx) * 0.5;
      ty = r.top + 80 * this.u;
    }
    const prevX = this.cpu.x;
    const prevY = this.cpu.y;
    const max = cpuSpeedFor(this.level) * this.u * dt;
    const dx = tx - this.cpu.x;
    const dy = ty - this.cpu.y;
    const d = Math.hypot(dx, dy);
    const k = d > max ? max / d : 1;
    this.cpu.x = clamp(this.cpu.x + dx * k, r.left + m, r.right - m);
    this.cpu.y = clamp(this.cpu.y + dy * k, r.top + m, mid - m);
    this.cpu.vx = dt > 0 ? (this.cpu.x - prevX) / dt : 0;
    this.cpu.vy = dt > 0 ? (this.cpu.y - prevY) / dt : 0;
  }

  private stepPuck(h: number): void {
    const r = this.rink();
    const pk = this.puck;
    const pr = PUCK_R * this.u;
    const drag = Math.max(0, 1 - DRAG * h);
    pk.vx *= drag;
    pk.vy *= drag;
    pk.x += pk.vx * h;
    pk.y += pk.vy * h;
    const cx = (r.left + r.right) / 2;
    const gw = (r.right - r.left) * GOAL_SHARE;
    const inMouth = Math.abs(pk.x - cx) < gw / 2 - pr * 0.3;
    if (pk.x < r.left + pr && pk.vx < 0) this.wall(pk, 'x', r.left + pr);
    if (pk.x > r.right - pr && pk.vx > 0) this.wall(pk, 'x', r.right - pr);
    if (pk.y < r.top + pr && pk.vy < 0) {
      if (inMouth) {
        if (pk.y < r.top - pr) this.goal(true);
      } else this.wall(pk, 'y', r.top + pr);
    }
    if (pk.y > r.bottom - pr && pk.vy > 0) {
      if (inMouth) {
        if (pk.y > r.bottom + pr) this.goal(false);
      } else this.wall(pk, 'y', r.bottom - pr);
    }
    for (const mallet of [this.me, this.cpu]) this.hit(mallet);
    this.unpinch(h, cx, r);
    const sp = Math.hypot(pk.vx, pk.vy);
    if (sp > PUCK_MAX * this.u) {
      pk.vx *= (PUCK_MAX * this.u) / sp;
      pk.vy *= (PUCK_MAX * this.u) / sp;
    }
  }

  /**
   * A puck squeezed between the two mallets (both touching it at once) would be shoved back and forth between them and
   * freeze. It pops out sideways toward the side with more room; if it is still pinned after PINCH_SEC (against a rail,
   * with nowhere to go), play restarts with a face-off in the middle.
   */
  private unpinch(h: number, cx: number, r: { left: number; right: number }): void {
    const pk = this.puck;
    const reach = (PUCK_R + MALLET_R) * this.u;
    const touching = (m: Body) => Math.hypot(pk.x - m.x, pk.y - m.y) < reach * 1.03;
    if (!touching(this.me) || !touching(this.cpu)) {
      this.pinchT = 0;
      return;
    }
    this.pinchT += h;
    if (this.pinchT > PINCH_SEC) {
      this.pinchT = 0;
      this.faceOff(this.rng.chance(0.5));
      return;
    }
    const side = pk.x === cx ? (this.rng.chance(0.5) ? 1 : -1) : pk.x > cx ? 1 : -1;
    pk.y = (this.me.y + this.cpu.y) / 2;
    pk.vx = side * 900 * this.u;
    pk.vy = 0;
    pk.x = Math.max(r.left + PUCK_R * this.u, Math.min(r.right - PUCK_R * this.u, pk.x));
  }

  private wall(pk: Body, axis: 'x' | 'y', at: number): void {
    pk[axis] = at;
    if (axis === 'x') pk.vx = -pk.vx * WALL_BOUNCE;
    else pk.vy = -pk.vy * WALL_BOUNCE;
    if (Math.abs(axis === 'x' ? pk.vx : pk.vy) > 200 * this.u) this.audio.play('click', { volume: 0.4 });
  }

  private hit(m: Body): void {
    const pk = this.puck;
    const dx = pk.x - m.x;
    const dy = pk.y - m.y;
    const d = Math.hypot(dx, dy);
    const reach = (PUCK_R + MALLET_R) * this.u;
    if (d >= reach || d === 0) return;
    const nx = dx / d;
    const ny = dy / d;
    pk.x = m.x + nx * reach;
    pk.y = m.y + ny * reach;
    const v = strike(pk.vx, pk.vy, m.vx, m.vy, nx, ny, HIT_BOUNCE);
    const hard = Math.hypot(v.vx - pk.vx, v.vy - pk.vy) > 300 * this.u;
    pk.vx = v.vx;
    pk.vy = v.vy;
    if (hard) {
      this.audio.play('hit', { volume: 0.6 });
      this.services.haptic(10);
    }
  }

  /** A goal. `forMe` is true when the puck went into the computer's goal at the top. */
  private goal(forMe: boolean): void {
    this.flash = 0.3;
    this.shake.add(0.4);
    const r = this.rink();
    if (forMe) {
      this.myGoals++;
      this.score += GOAL_POINTS;
      this.addStat('goals');
      this.audio.play('coin');
      this.particles.emit({
        x: this.puck.x,
        y: r.top,
        count: 30,
        speed: 260 * this.u,
        life: 0.8,
        size: 4,
        colors: ['#ef4444', '#fde047', '#ffffff'],
      });
    } else {
      this.cpuGoals++;
      this.audio.play('bump');
    }
    if (this.myGoals >= WIN_GOALS || this.cpuGoals >= WIN_GOALS) {
      this.result = this.myGoals >= WIN_GOALS ? 'win' : 'loss';
      this.resultT = RESULT_SEC;
      if (this.result === 'win') {
        this.score += WIN_POINTS * this.level;
        this.coins += 2;
        this.addStat('wins');
        this.audio.play('win');
      }
      return;
    }
    this.faceOff(!forMe);
  }

  /** A won match moves up a level; a lost one ends the run (the shield gives one rematch). */
  private afterMatch(): void {
    if (this.result === 'loss') {
      if (!this.shield) {
        this.endGame(0.3, false);
        return;
      }
      this.shield = false;
      this.texts.add(this.W / 2, this.H * 0.45, 'SHIELD: REMATCH', '#67e8f9', 26 * this.u, 1.3);
      this.audio.play('powerup');
    } else this.level++;
    this.newMatch();
  }

  private drawPuck(): void {
    const ctx = this.ctx;
    const pr = PUCK_R * this.u;
    ctx.fillStyle = 'rgba(15,23,42,0.25)';
    ctx.beginPath();
    ctx.arc(this.puck.x + 3 * this.u, this.puck.y + 4 * this.u, pr, 0, TAU);
    ctx.fill();
    ctx.fillStyle = this.skinColor('puck', '#111827');
    ctx.beginPath();
    ctx.arc(this.puck.x, this.puck.y, pr, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.3)';
    ctx.lineWidth = 3 * this.u;
    ctx.beginPath();
    ctx.arc(this.puck.x, this.puck.y, pr * 0.65, 0, TAU);
    ctx.stroke();
  }

  private drawMallet(m: Body, colour: string): void {
    const ctx = this.ctx;
    const r = MALLET_R * this.u;
    ctx.fillStyle = 'rgba(15,23,42,0.25)';
    ctx.beginPath();
    ctx.arc(m.x + 4 * this.u, m.y + 5 * this.u, r, 0, TAU);
    ctx.fill();
    ctx.fillStyle = shade(colour, -0.25);
    ctx.beginPath();
    ctx.arc(m.x, m.y, r, 0, TAU);
    ctx.fill();
    ctx.fillStyle = colour;
    ctx.beginPath();
    ctx.arc(m.x, m.y, r * 0.78, 0, TAU);
    ctx.fill();
    ctx.fillStyle = shade(colour, 0.35);
    ctx.beginPath();
    ctx.arc(m.x, m.y, r * 0.38, 0, TAU);
    ctx.fill();
  }
}
