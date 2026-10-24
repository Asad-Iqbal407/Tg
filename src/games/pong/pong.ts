import { clamp } from '../../core/math';
import { BaseGame } from '../base';
import type { GameServices } from '../types';
import {
  type Ball,
  BALL_R,
  DESIGN_H,
  frontLeft,
  frontRight,
  headHeight,
  paddleHalf,
  speedScale,
  type Table,
  tableFor,
} from './geometry';
import { Rival } from './rival';
import { drawBall, drawPaddles, drawScoreBand, drawTable, type Palette } from './render';

type Side = 'player' | 'computer';

const WIN_POINTS = 11;
const WIN_BY = 2;
const HEAD_START_POINTS = 2;
const POINT_SCORE = 100;
const LONG_RALLY_SHOTS = 10;
const LONG_RALLY_SCORE = 50;
/**
 * Ball and paddle speeds in design px/s, scaled to the table (speedScale). Speed builds within a rally: the ball
 * gains SPEEDUP on every paddle hit until it reaches MAX_SPEED, and every serve starts again at SERVE_SPEED. A long
 * rally gets hard to keep alive, while a new point always opens at a pace a player can read.
 */
const SERVE_SPEED = 420;
const SPEEDUP = 18;
const MAX_SPEED = 780;
/** The contact point sets the angle: the centre sends the ball straight, the edge at this much. */
const MAX_ANGLE = Math.PI / 3;
const SERVE_ANGLE = 0.3;
const SERVE_SEC = 0.9;
const PLAYER_SPEED = 560;
/** The paddle follows a press or drag at this speed, fast enough that it never lags the finger. */
const POINTER_SPEED = 1100;
const SUBSTEP = 1 / 240;
const TRAIL_LEN = 8;
const WIN_SEC = 2.6;
const LOSS_SEC = 2;

/** The match: a rally-based table tennis game against the computer. Left is the player, right the computer. */
export class PongGame extends BaseGame {
  /** Design px to logical px for sizes. Speeds scale with the table instead (see speedScale). */
  private readonly u: number;
  private readonly rival: Rival;
  private readonly ball: Ball = { x: 0, y: 0, vx: 0, vy: 0, speed: 0 };
  private playerY: number;
  private playerPts = 0;
  private rivalPts = 0;
  private shieldUsed = false;
  /** Serves so far. Even ones are the player's, odd ones the computer's, so they alternate. */
  private serves = 0;
  private server: Side = 'player';
  private serving = true;
  private serveT = 0;
  /** Shots in the current rally. The serve is the first shot, so a serve that is not returned is one shot. */
  private shots = 0;
  private readonly trail: { x: number; y: number }[] = [];

  constructor(services: GameServices) {
    super(services);
    this.u = this.H / DESIGN_H;
    const t = this.table();
    this.playerY = (t.top + t.bottom) / 2;
    this.rival = new Rival(this.rng, this.playerY);
    if (this.hasBoost('head-start')) this.playerPts = HEAD_START_POINTS;
    for (const key of ['points', 'rallies', 'longestRally', 'wins', 'aces']) this.addStat(key, 0);
    this.beginServe();
  }

  protected tick(dt: number): void {
    if (this.isEnding) return;
    const t = this.table();
    const half = paddleHalf(t);
    this.movePlayer(dt, t, half);
    this.rival.update(dt, this.ball, !this.serving && this.ball.vx > 0, t, half, this.u, speedScale(t));
    if (this.serving) {
      this.serveT -= dt;
      if (this.serveT <= 0) this.launch();
    } else {
      let left = dt;
      while (left > 0 && !this.serving && !this.isEnding) {
        const h = Math.min(left, SUBSTEP);
        this.stepBall(h);
        left -= h;
      }
    }
    this.trail.push({ x: this.ball.x, y: this.ball.y });
    if (this.trail.length > TRAIL_LEN) this.trail.shift();
  }

  render(): void {
    const ctx = this.ctx;
    const t = this.table();
    const pal = this.palette();
    const g = ctx.createLinearGradient(0, 0, 0, this.H);
    g.addColorStop(0, pal.table1);
    g.addColorStop(1, pal.table2);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.W, this.H);
    ctx.save();
    ctx.translate(this.shake.x, this.shake.y);
    drawTable(ctx, t, this.u, pal);
    drawPaddles(ctx, t, this.u, pal, this.playerY, this.rival.y);
    drawBall(ctx, this.ball, this.trail, BALL_R * this.u, pal, this.time, this.serving);
    this.particles.render(ctx);
    this.texts.render(ctx);
    ctx.restore();
    if (!this.services.preview) {
      drawScoreBand(ctx, this.W, this.insets.top, headHeight(this.H), this.u, pal, {
        player: this.playerPts,
        rival: this.rivalPts,
        shots: this.shots,
        serving: this.serving,
        server: this.server,
      });
    }
  }

  /** The playfield for this frame: it follows the live insets, so the bottom edge stops above touch controls. */
  private table(): Table {
    return tableFor(this.W, this.H, this.insets);
  }

  private palette(): Palette {
    return {
      table1: this.skinColor('table1', '#0f3d2e'),
      table2: this.skinColor('table2', '#0b2456'),
      line: this.skinColor('line', 'rgba(255,255,255,0.4)'),
      rail: this.skinColor('rail', '#e2e8f0'),
      player: this.skinColor('player', '#fb923c'),
      rival: this.skinColor('rival', '#60a5fa'),
      ball: this.skinColor('ball', '#fef9c3'),
    };
  }

  /**
   * The player's paddle: the arrow keys or W/S move it at PLAYER_SPEED. A press or drag on the stage moves it toward
   * the pointer's height. Preview cards track the ball so the frame shows a rally.
   */
  private movePlayer(dt: number, t: Table, half: number): void {
    const lo = t.top + half;
    const hi = t.bottom - half;
    const k = speedScale(t);
    const axis = this.input.axisY();
    const pointer = this.input.pointer;
    if (axis !== 0) {
      this.playerY += axis * PLAYER_SPEED * k * dt;
    } else if (pointer.down) {
      const max = POINTER_SPEED * k * dt;
      this.playerY += clamp(clamp(pointer.y, lo, hi) - this.playerY, -max, max);
    } else if (this.services.preview) {
      const max = PLAYER_SPEED * k * dt;
      this.playerY += clamp(clamp(this.ball.y, lo, hi) - this.playerY, -max, max);
    }
    this.playerY = clamp(this.playerY, lo, hi);
  }

  /** One physics sub-step: walls, paddle contacts, then a point if the ball has left the table. */
  private stepBall(h: number): void {
    const t = this.table();
    const b = this.ball;
    const r = BALL_R * this.u;
    const prevX = b.x;
    b.x += b.vx * h;
    b.y += b.vy * h;
    const lo = t.top + r;
    const hi = t.bottom - r;
    if (b.y < lo && b.vy < 0) {
      b.y = 2 * lo - b.y;
      b.vy = -b.vy;
      this.wallHit(b.y);
    } else if (b.y > hi && b.vy > 0) {
      b.y = 2 * hi - b.y;
      b.vy = -b.vy;
      this.wallHit(b.y);
    }
    const half = paddleHalf(t);
    const pl = frontLeft(t, this.u);
    const pr = frontRight(t, this.u);
    if (b.vx < 0 && prevX - r > pl && b.x - r <= pl && Math.abs(b.y - this.playerY) <= half + r) {
      this.contact('player', pl + r);
    } else if (b.vx > 0 && prevX + r < pr && b.x + r >= pr && Math.abs(b.y - this.rival.y) <= half + r) {
      this.contact('computer', pr - r);
    } else if (b.x + r < t.left) {
      this.scorePoint('computer');
    } else if (b.x - r > t.right) {
      this.scorePoint('player');
    }
  }

  private wallHit(y: number): void {
    this.audio.play('click', { volume: 0.35 });
    this.particles.emit({
      x: this.ball.x,
      y,
      count: 4,
      speed: 90 * this.u,
      life: 0.3,
      size: 2.5,
      drag: 3,
      colors: [this.palette().rail],
    });
  }

  /**
   * A paddle hit. The angle depends on where the ball met the paddle: the centre returns it straight, and the
   * edge sends it off at up to MAX_ANGLE. Each hit adds speed, up to the cap.
   */
  private contact(side: Side, x: number): void {
    const t = this.table();
    const half = paddleHalf(t);
    const b = this.ball;
    const py = side === 'player' ? this.playerY : this.rival.y;
    const rel = clamp((b.y - py) / half, -1, 1);
    const angle = rel * MAX_ANGLE;
    const k = speedScale(t);
    b.speed = Math.min(MAX_SPEED * k, b.speed + SPEEDUP * k);
    const dir = side === 'player' ? 1 : -1;
    b.vx = dir * Math.cos(angle) * b.speed;
    b.vy = Math.sin(angle) * b.speed;
    b.x = x;
    this.shots++;
    if (side === 'player') this.rival.aim(half);
    this.shake.add(0.1);
    this.audio.play('hit');
    const pal = this.palette();
    this.particles.emit({
      x: b.x,
      y: b.y,
      count: 14,
      speed: 180 * this.u,
      life: 0.45,
      size: 3,
      drag: 2.5,
      colors: [side === 'player' ? pal.player : pal.rival, '#ffffff'],
    });
  }

  /**
   * A point for `winner`. A point the player wins counts 100 points; a long rally adds 50 whoever wins it. The first
   * point the player loses is not counted when the shield boost is in play. Ends the match on 11 by two.
   */
  private scorePoint(winner: Side): void {
    const t = this.table();
    const ace = winner === 'player' && this.server === 'player' && this.shots === 1;
    this.addStat('rallies');
    this.maxStat('longestRally', this.shots);
    // Popups stay clear of the side edges, so a point scored at the edge still shows its text in full.
    const at = { x: clamp(this.ball.x, t.left + 56 * this.u, t.right - 56 * this.u), y: this.ball.y };
    const pal = this.palette();
    if (this.shots > LONG_RALLY_SHOTS) {
      this.score += LONG_RALLY_SCORE;
      this.texts.add(
        (t.left + t.right) / 2,
        t.top + 40 * this.u,
        'LONG RALLY +50',
        pal.ball,
        20 * this.u,
        1.2,
      );
    }
    if (winner === 'player') {
      this.playerPts++;
      this.score += POINT_SCORE;
      this.addStat('points');
      if (ace) {
        this.addStat('aces');
        this.texts.add(at.x, at.y, 'ACE!', pal.player, 26 * this.u, 1.1);
        this.audio.play('reward');
      } else {
        this.audio.play('coin');
      }
    } else if (!this.shieldUsed && this.hasBoost('shield')) {
      this.shieldUsed = true;
      this.texts.add(at.x, at.y, 'SHIELD', '#67e8f9', 22 * this.u, 1.1);
      this.audio.play('powerup');
    } else {
      this.rivalPts++;
      this.audio.play('bump');
    }
    this.particles.emit({
      x: at.x,
      y: at.y,
      count: 26,
      speed: 240 * this.u,
      life: 0.7,
      size: 3.5,
      drag: 2.2,
      colors: [winner === 'player' ? pal.player : pal.rival, '#ffffff'],
    });
    this.shake.add(0.3);
    if (this.playerPts >= 10 && this.playerPts === this.rivalPts) {
      this.texts.add((t.left + t.right) / 2, (t.top + t.bottom) / 2, 'DEUCE', pal.ball, 30 * this.u, 1.2);
    }
    const match = this.matchWinner();
    if (match) {
      this.finish(match);
      return;
    }
    this.serves++;
    this.beginServe();
  }

  /** The side that has won the match: 11 points with a lead of at least two. */
  private matchWinner(): Side | null {
    if (Math.max(this.playerPts, this.rivalPts) < WIN_POINTS) return null;
    if (Math.abs(this.playerPts - this.rivalPts) < WIN_BY) return null;
    return this.playerPts > this.rivalPts ? 'player' : 'computer';
  }

  private finish(winner: Side): void {
    if (winner === 'player') {
      this.addStat('wins');
      this.audio.play('win');
      this.endGame(WIN_SEC, false);
    } else {
      this.endGame(LOSS_SEC);
    }
  }

  /** Puts the ball at the centre for the next serve. The serve alternates between the two sides. */
  private beginServe(): void {
    const t = this.table();
    this.server = this.serves % 2 === 0 ? 'player' : 'computer';
    this.serving = true;
    this.serveT = this.services.preview ? 0 : SERVE_SEC;
    const b = this.ball;
    b.x = (t.left + t.right) / 2;
    b.y = (t.top + t.bottom) / 2;
    b.vx = 0;
    b.vy = 0;
    b.speed = SERVE_SPEED * speedScale(t);
    this.shots = 0;
  }

  /** Sends the served ball across the table with a small random angle from the gameplay RNG. */
  private launch(): void {
    this.serving = false;
    const dir = this.server === 'player' ? 1 : -1;
    const angle = this.rng.range(-SERVE_ANGLE, SERVE_ANGLE);
    const b = this.ball;
    b.vx = dir * Math.cos(angle) * b.speed;
    b.vy = Math.sin(angle) * b.speed;
    this.shots = 1;
    if (dir > 0) this.rival.aim(paddleHalf(this.table()));
    this.audio.play('whoosh');
  }
}
