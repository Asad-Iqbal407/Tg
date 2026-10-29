import { TAU } from '../../core/math';
import { BaseGame } from '../base';
import { banner, progressBar, shade, text } from '../draw';
import { drawStatBar, statBarHeight } from '../statbar';
import type { GameServices } from '../types';
import { bladesOf, bounceOff, HOLES, type Hole, inRect, type Pt, wallsOf } from './course';

const DESIGN_W = 600;
const BALL_R = 0.024;
const CUP_R = 0.042;
/** Fastest putt, in course units per second. */
const MAX_SPEED = 2.4;
const FRICTION = 1.05;
const SAND_FRICTION = 4.2;
const WALL_BOUNCE = 0.72;
const BUMPER_BOUNCE = 1.15;
/** A ball faster than this rattles over the cup instead of dropping in. */
const SINK_SPEED = 1.1;
const STOP_SPEED = 0.025;
const MAX_STROKES = 8;
const ACE_POINTS = 500;
const HOLE_POINTS = 100;
const SINK_SEC = 1.6;
/** A drag this long (as a share of the course width) is a full-power putt. */
const FULL_DRAG = 0.42;
const KEY_TURN = 2.2;
const CHARGE_RATE = 1.1;

/** Points for a hole: 100 for every stroke under par + 3, and a bonus for a hole in one. */
export function holePoints(strokes: number, par: number): number {
  return Math.max(0, par + 3 - strokes) * HOLE_POINTS + (strokes === 1 ? ACE_POINTS : 0);
}

/** Mini Golf: nine holes of putting. Pull back to aim, let go to putt, and finish each hole in as few strokes as you can. */
export class GolfGame extends BaseGame {
  private readonly u: number;
  private holeIndex = 0;
  private hole: Hole = HOLES[0] as Hole;
  private walls: [Pt, Pt][] = [];
  private x = 0;
  private y = 0;
  private vx = 0;
  private vy = 0;
  private last: Pt = [0, 0];
  private strokes = 0;
  private total = 0;
  private windAngle = 0;
  /** Seconds left of the drop into the cup, then the next hole. */
  private sinkT = 0;
  private drag: { x: number; y: number } | null = null;
  private aim = -Math.PI / 2;
  private power = 0;
  private charging = false;
  private chargeDir = 1;
  private shield = false;
  private bannerT = 1.6;

  constructor(services: GameServices) {
    super(services);
    this.u = this.W / DESIGN_W;
    this.shield = this.hasBoost('shield');
    for (const key of ['holes', 'aces', 'under']) this.addStat(key, 0);
    this.startHole(0);
  }

  protected tick(dt: number): void {
    this.bannerT = Math.max(0, this.bannerT - dt);
    const w = this.hole.windmill;
    if (w) this.windAngle += w.speed * dt;
    if (this.isEnding) return;
    if (this.sinkT > 0) {
      this.sinkT -= dt;
      if (this.sinkT <= 0) this.nextHole();
      return;
    }
    if (this.moving()) this.roll(dt);
    else this.readAim(dt);
  }

  render(): void {
    const ctx = this.ctx;
    ctx.fillStyle = this.skinColor('bg', '#14532d');
    ctx.fillRect(0, 0, this.W, this.H);
    const v = this.view();
    ctx.save();
    ctx.translate(this.shake.x, this.shake.y);
    this.drawHole(v);
    if (!this.moving() && this.sinkT <= 0 && !this.isEnding) this.drawAim(v);
    if (this.sinkT <= 0 || this.sinkT > SINK_SEC - 0.25) this.drawBall(v);
    this.particles.render(ctx);
    this.texts.render(ctx);
    ctx.restore();
    if (this.services.preview) return;
    drawStatBar(ctx, this.W, this.insets.top, this.u, [
      ['HOLE', `${this.holeIndex + 1} / ${HOLES.length}`],
      ['PAR', String(this.hole.par)],
      ['STROKES', String(this.strokes)],
    ]);
    const bottom = this.H - this.insets.bottom;
    text(
      ctx,
      `Total ${this.total} · Score ${Math.floor(this.score).toLocaleString('en-US')}`,
      this.W / 2,
      bottom - 20 * this.u,
      {
        size: Math.round(16 * this.u),
        align: 'center',
        color: 'rgba(255,255,255,0.8)',
        weight: 600,
      },
    );
    if (this.charging || this.drag) {
      progressBar(
        ctx,
        this.W * 0.25,
        bottom - 48 * this.u,
        this.W * 0.5,
        12 * this.u,
        this.power,
        this.power > 0.85 ? '#ef4444' : '#fde047',
      );
    }
    if (this.bannerT > 0) {
      banner(
        ctx,
        this.W,
        this.H,
        `HOLE ${this.holeIndex + 1}`,
        `${this.hole.name} · Par ${this.hole.par}`,
        1 - this.bannerT / 1.6,
      );
    }
  }

  /** Course units to screen: a uniform scale that fits the 1 x 1.4 course below the HUD. */
  private view(): { ox: number; oy: number; s: number } {
    const top = this.insets.top + statBarHeight(this.u) + 4 * this.u;
    const bottom = this.H - this.insets.bottom - 64 * this.u;
    const s = Math.min(this.W - 16 * this.u, (bottom - top) / 1.4);
    return { ox: (this.W - s) / 2, oy: top + (bottom - top - s * 1.4) / 2, s };
  }

  private startHole(i: number): void {
    this.holeIndex = i;
    this.hole = HOLES[i] as Hole;
    this.walls = wallsOf(this.hole);
    [this.x, this.y] = this.hole.tee;
    this.last = this.hole.tee;
    this.vx = 0;
    this.vy = 0;
    this.strokes = 0;
    this.aim = Math.atan2(this.hole.cup[1] - this.y, this.hole.cup[0] - this.x);
    this.bannerT = 1.6;
    this.windAngle = 0;
  }

  private moving(): boolean {
    return Math.hypot(this.vx, this.vy) > 0;
  }

  /**
   * Aiming: pull back anywhere on the screen and let go to putt, like a slingshot (the putt goes the opposite way to
   * the pull). On a keyboard, ← → turn the aim and holding Space charges the power. Card art putts straight at the cup.
   */
  private readAim(dt: number): void {
    const p = this.input.pointer;
    const v = this.view();
    if (this.services.preview) {
      if (this.time > 0.3) this.putt(Math.atan2(this.hole.cup[1] - this.y, this.hole.cup[0] - this.x), 0.55);
      return;
    }
    if (p.pressed) this.drag = { x: p.x, y: p.y };
    if (this.drag && p.down) {
      const dx = this.drag.x - p.x;
      const dy = this.drag.y - p.y;
      const len = Math.hypot(dx, dy);
      if (len > 4 * this.u) this.aim = Math.atan2(dy, dx);
      this.power = Math.min(1, len / (FULL_DRAG * v.s));
    }
    if (this.drag && !p.down) {
      this.drag = null;
      if (this.power > 0.05) this.putt(this.aim, this.power);
      this.power = 0;
      return;
    }
    this.aim += this.input.axisX() * KEY_TURN * dt;
    if (this.input.isDown('primary')) {
      this.charging = true;
      this.power += this.chargeDir * CHARGE_RATE * dt;
      if (this.power >= 1 || this.power <= 0) {
        this.chargeDir = -this.chargeDir;
        this.power = Math.max(0, Math.min(1, this.power));
      }
    } else if (this.charging) {
      this.charging = false;
      this.chargeDir = 1;
      if (this.power > 0.05) this.putt(this.aim, this.power);
      this.power = 0;
    }
  }

  private putt(angle: number, power: number): void {
    this.last = [this.x, this.y];
    this.vx = Math.cos(angle) * power * MAX_SPEED;
    this.vy = Math.sin(angle) * power * MAX_SPEED;
    this.strokes++;
    this.audio.play('hit', { volume: 0.5 + power * 0.5 });
    this.services.haptic(15);
  }

  /** Rolls the ball in small steps: friction, walls, bumpers, the windmill, water and the cup. */
  private roll(dt: number): void {
    const speed = Math.hypot(this.vx, this.vy);
    const steps = Math.max(1, Math.ceil((speed * dt) / (BALL_R * 0.5)));
    const h = dt / steps;
    for (let i = 0; i < steps && this.moving(); i++) {
      const sand = this.hole.sand.some((r) => inRect(r, this.x, this.y));
      const sp = Math.hypot(this.vx, this.vy);
      const slow = Math.max(0, sp - (sand ? SAND_FRICTION : FRICTION) * h);
      if (slow < STOP_SPEED) {
        this.vx = 0;
        this.vy = 0;
        this.stopped();
        return;
      }
      this.vx *= slow / sp;
      this.vy *= slow / sp;
      this.x += this.vx * h;
      this.y += this.vy * h;
      this.collide();
      if (this.hole.water.some((r) => inRect(r, this.x, this.y))) {
        this.splash();
        return;
      }
      if (this.cupCheck()) return;
    }
  }

  private collide(): void {
    const segs = [...this.walls, ...(this.hole.windmill ? bladesOf(this.hole.windmill, this.windAngle) : [])];
    for (const [a, b] of segs) {
      const hit = bounceOff(this.x, this.y, this.vx, this.vy, BALL_R, a, b, WALL_BOUNCE);
      if (!hit) continue;
      const loud = Math.abs(hit.vx - this.vx) + Math.abs(hit.vy - this.vy) > 0.3;
      Object.assign(this, { x: hit.x, y: hit.y, vx: hit.vx, vy: hit.vy });
      if (loud) this.audio.play('click', { volume: 0.4 });
    }
    for (const bm of this.hole.bumpers) {
      const dx = this.x - bm.x;
      const dy = this.y - bm.y;
      const d = Math.hypot(dx, dy);
      const reach = bm.r + BALL_R;
      if (d >= reach || d === 0) continue;
      const nx = dx / d;
      const ny = dy / d;
      this.x = bm.x + nx * reach;
      this.y = bm.y + ny * reach;
      const vn = this.vx * nx + this.vy * ny;
      if (vn < 0) {
        this.vx -= (1 + BUMPER_BOUNCE) * vn * nx;
        this.vy -= (1 + BUMPER_BOUNCE) * vn * ny;
        const sp = Math.hypot(this.vx, this.vy);
        if (sp > MAX_SPEED) {
          this.vx *= MAX_SPEED / sp;
          this.vy *= MAX_SPEED / sp;
        }
        this.audio.play('bump', { volume: 0.6 });
      }
    }
  }

  /** In the cup: slow enough drops in; too fast rattles over the hole and carries on, a little slower. */
  private cupCheck(): boolean {
    const [cx, cy] = this.hole.cup;
    const d = Math.hypot(this.x - cx, this.y - cy);
    if (d > CUP_R) return false;
    const sp = Math.hypot(this.vx, this.vy);
    if (sp > SINK_SPEED) {
      this.vx *= 0.8;
      this.vy *= 0.8;
      return false;
    }
    this.sink();
    return true;
  }

  private sink(): void {
    [this.x, this.y] = this.hole.cup;
    this.vx = 0;
    this.vy = 0;
    const counted = this.hasBoost('head-start') ? Math.max(1, this.strokes - 1) : this.strokes;
    this.finishHole(counted);
  }

  private finishHole(strokes: number): void {
    const par = this.hole.par;
    const points = holePoints(strokes, par);
    this.score += points;
    this.total += strokes;
    this.addStat('holes');
    if (strokes === 1) {
      this.addStat('aces');
      this.coins += 3;
    }
    if (strokes < par) {
      this.addStat('under');
      this.coins++;
    }
    const label =
      strokes === 1
        ? 'HOLE IN ONE!'
        : strokes <= par - 2
          ? 'EAGLE!'
          : strokes === par - 1
            ? 'BIRDIE!'
            : strokes === par
              ? 'PAR'
              : strokes === par + 1
                ? 'BOGEY'
                : `+${strokes - par}`;
    const v = this.view();
    this.texts.add(
      v.ox + v.s / 2,
      v.oy + v.s * 0.7,
      `${label} +${points}`,
      strokes <= par ? '#fde047' : '#ffffff',
      26 * this.u,
      1.5,
    );
    this.particles.emit({
      x: v.ox + this.hole.cup[0] * v.s,
      y: v.oy + this.hole.cup[1] * v.s,
      count: strokes <= par ? 30 : 10,
      speed: 200 * this.u,
      life: 0.7,
      size: 3,
      colors: ['#fde047', '#ffffff', '#4ade80'],
    });
    this.audio.play(strokes < par ? 'win' : 'coin');
    this.sinkT = SINK_SEC;
  }

  /** The ball has stopped. Too many strokes on a hole and it is picked up at the limit. */
  private stopped(): void {
    if (this.strokes >= MAX_STROKES) this.finishHole(MAX_STROKES);
  }

  /** Into the water: the ball goes back to where it was putted from, a stroke added (the shield waives one). */
  private splash(): void {
    const v = this.view();
    this.particles.emit({
      x: v.ox + this.x * v.s,
      y: v.oy + this.y * v.s,
      count: 18,
      speed: 140 * this.u,
      life: 0.5,
      size: 3,
      colors: ['#bfdbfe', '#ffffff'],
    });
    this.audio.play('pop');
    [this.x, this.y] = this.last;
    this.vx = 0;
    this.vy = 0;
    if (this.shield) {
      this.shield = false;
      this.texts.add(
        v.ox + this.x * v.s,
        v.oy + this.y * v.s - 30 * this.u,
        'FREE DROP',
        '#67e8f9',
        20 * this.u,
        1.1,
      );
    } else {
      this.strokes++;
      this.texts.add(
        v.ox + this.x * v.s,
        v.oy + this.y * v.s - 30 * this.u,
        'SPLASH +1',
        '#93c5fd',
        20 * this.u,
        1.1,
      );
    }
    this.stopped();
  }

  private nextHole(): void {
    if (this.holeIndex + 1 >= HOLES.length) {
      this.audio.play('win');
      this.endGame(0.6, false);
      return;
    }
    this.startHole(this.holeIndex + 1);
  }

  private drawHole(v: { ox: number; oy: number; s: number }): void {
    const ctx = this.ctx;
    const P = (p: Pt): [number, number] => [v.ox + p[0] * v.s, v.oy + p[1] * v.s];
    const h = this.hole;
    const path = (poly: readonly Pt[]) => {
      ctx.beginPath();
      poly.forEach((p, i) => {
        const [x, y] = P(p);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.closePath();
    };
    // Felt, with mowing stripes.
    path(h.outline);
    ctx.fillStyle = this.skinColor('felt', '#22c55e');
    ctx.fill();
    ctx.save();
    path(h.outline);
    ctx.clip();
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    for (let k = 0; k < 14; k += 2) ctx.fillRect(v.ox, v.oy + k * 0.1 * v.s, v.s, 0.1 * v.s);
    for (const r of h.sand) {
      const [x0, y0] = P([r.x0, r.y0]);
      const [x1, y1] = P([r.x1, r.y1]);
      ctx.fillStyle = this.skinColor('sand', '#fde68a');
      ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    }
    for (const r of h.water) {
      const [x0, y0] = P([r.x0, r.y0]);
      const [x1, y1] = P([r.x1, r.y1]);
      ctx.fillStyle = this.skinColor('water', '#3b82f6');
      ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 2 * this.u;
      for (let k = 0; k < 3; k++) {
        const wy = y0 + ((k + 0.5) / 3) * (y1 - y0);
        const off = Math.sin(this.time * 2 + k) * 6 * this.u;
        ctx.beginPath();
        ctx.moveTo(x0 + 6 * this.u + off, wy);
        ctx.lineTo(x1 - 6 * this.u + off, wy);
        ctx.stroke();
      }
    }
    ctx.restore();
    const wall = this.skinColor('wall', '#78350f');
    for (const b of h.blocks) {
      path(b);
      ctx.fillStyle = wall;
      ctx.fill();
    }
    path(h.outline);
    ctx.strokeStyle = wall;
    ctx.lineWidth = 8 * this.u;
    ctx.lineJoin = 'round';
    ctx.stroke();
    for (const bm of h.bumpers) {
      const [x, y] = P([bm.x, bm.y]);
      ctx.fillStyle = '#ef4444';
      ctx.beginPath();
      ctx.arc(x, y, bm.r * v.s, 0, TAU);
      ctx.fill();
      ctx.fillStyle = '#fecaca';
      ctx.beginPath();
      ctx.arc(x, y, bm.r * v.s * 0.5, 0, TAU);
      ctx.fill();
    }
    const [cx, cy] = P(h.cup);
    ctx.fillStyle = '#052e16';
    ctx.beginPath();
    ctx.arc(cx, cy, CUP_R * v.s, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#e5e7eb';
    ctx.fillRect(cx - 1.5 * this.u, cy - 60 * this.u, 3 * this.u, 60 * this.u);
    ctx.fillStyle = this.skinColor('flag', '#ef4444');
    ctx.beginPath();
    ctx.moveTo(cx + 1.5 * this.u, cy - 60 * this.u);
    ctx.lineTo(cx + 34 * this.u, cy - 50 * this.u);
    ctx.lineTo(cx + 1.5 * this.u, cy - 40 * this.u);
    ctx.fill();
    if (h.windmill) {
      const [wx, wy] = P([h.windmill.x, h.windmill.y]);
      ctx.strokeStyle = '#f8fafc';
      ctx.lineWidth = 10 * this.u;
      ctx.lineCap = 'round';
      for (const [a, b] of bladesOf(h.windmill, this.windAngle)) {
        ctx.beginPath();
        ctx.moveTo(...P(a));
        ctx.lineTo(...P(b));
        ctx.stroke();
      }
      ctx.fillStyle = '#b91c1c';
      ctx.beginPath();
      ctx.arc(wx, wy, 10 * this.u, 0, TAU);
      ctx.fill();
    }
  }

  private drawBall(v: { ox: number; oy: number; s: number }): void {
    const ctx = this.ctx;
    const x = v.ox + this.x * v.s;
    const y = v.oy + this.y * v.s;
    const r = BALL_R * v.s;
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath();
    ctx.ellipse(x + r * 0.3, y + r * 0.5, r, r * 0.6, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = this.skinColor('ball', '#ffffff');
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = shade(this.skinColor('ball', '#ffffff'), -0.3);
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  /** The aim: a dotted line from the ball, longer with more power. */
  private drawAim(v: { ox: number; oy: number; s: number }): void {
    const ctx = this.ctx;
    const x = v.ox + this.x * v.s;
    const y = v.oy + this.y * v.s;
    const len = (0.08 + 0.32 * this.power) * v.s;
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    for (let k = 1; k <= 7; k++) {
      const t = (k / 7) * len;
      ctx.beginPath();
      ctx.arc(x + Math.cos(this.aim) * t, y + Math.sin(this.aim) * t, 3 * this.u * (1 - k / 10), 0, TAU);
      ctx.fill();
    }
  }
}
