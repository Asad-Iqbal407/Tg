import { clamp, TAU } from '../../core/math';
import { BaseGame } from '../base';
import { drawCoin, fillRoundRect, shade, text } from '../draw';
import { drawStatBar, statBarHeight } from '../statbar';
import type { GameServices } from '../types';
import { type Gate, GATE_SPACING, GATE_W, nextGate } from './course';

type Phase = 'ready' | 'flying' | 'falling';

const DESIGN_W = 600;
const BIRD_R = 22;
const GRAVITY = 2000;
const FLAP_V = -620;
const MAX_FALL = 900;
const START_SPEED = 230;
const SPEED_STEP = 2.5;
const MAX_SPEED = 340;
const GROUND_H = 64;
const GATE_SCORE = 10;
const COIN_SCORE = 5;
const COIN_R = 12;
const HEAD_START_GATES = 5;
const INVULN_SEC = 1.4;
const FALL_SEC = 1.3;
/** The bird is drawn a little smaller than its hit circle is generous: the circle is shrunk by this share. */
const HIT_SHRINK = 0.82;

/** Sky Hopper: tap to flap through the gaps between the pipes. */
export class FlappyGame extends BaseGame {
  private readonly u: number;
  private phase: Phase = 'ready';
  private readonly birdX: number;
  private birdY: number;
  private vy = 0;
  private gates: Gate[] = [];
  private gateIndex = 0;
  private passed = 0;
  /** Distance scrolled, in logical px: drives the ground stripes and the parallax hills. */
  private distance = 0;
  private shield = false;
  private invulnT = 0;
  /** Seconds since the last flap, for the wing animation. */
  private flapT = 1;

  constructor(services: GameServices) {
    super(services);
    this.u = this.W / DESIGN_W;
    this.birdX = this.W * 0.3;
    this.birdY = this.skyTop() + (this.groundY() - this.skyTop()) * 0.45;
    this.shield = this.hasBoost('shield');
    for (const key of ['gates', 'flaps']) this.addStat(key, 0);
    if (this.hasBoost('head-start')) {
      this.passed = HEAD_START_GATES;
      this.gateIndex = HEAD_START_GATES;
      this.score = HEAD_START_GATES * GATE_SCORE;
    }
    this.fillGates(this.W + 80 * this.u, this.birdY);
    if (services.preview) this.phase = 'flying';
  }

  protected tick(dt: number): void {
    this.invulnT = Math.max(0, this.invulnT - dt);
    this.flapT += dt;
    if (this.phase === 'ready') {
      if (this.wantsFlap()) {
        this.phase = 'flying';
        this.flap();
      }
      return;
    }
    if (this.phase === 'falling') {
      this.vy = Math.min(MAX_FALL * this.u, this.vy + GRAVITY * this.u * dt);
      this.birdY = Math.min(this.groundY() - BIRD_R * this.u, this.birdY + this.vy * dt);
      return;
    }
    if (this.wantsFlap() || this.autopilot()) this.flap();
    this.vy = Math.min(MAX_FALL * this.u, this.vy + GRAVITY * this.u * dt);
    this.birdY += this.vy * dt;
    if (this.birdY - BIRD_R * this.u < 0) {
      this.birdY = BIRD_R * this.u;
      this.vy = 0;
    }
    const speed = this.speed();
    this.distance += speed * dt;
    for (const g of this.gates) g.x -= speed * dt;
    const last = this.gates[this.gates.length - 1];
    if (last) this.fillGates(last.x + GATE_SPACING * this.u, last.gapY);
    this.gates = this.gates.filter((g) => g.x + GATE_W * this.u > -20 * this.u);
    this.checkGates();
  }

  render(): void {
    const ctx = this.ctx;
    const ground = this.groundY();
    const sky = ctx.createLinearGradient(0, 0, 0, ground);
    sky.addColorStop(0, this.skinColor('sky1', '#38bdf8'));
    sky.addColorStop(1, this.skinColor('sky2', '#bae6fd'));
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, this.W, this.H);
    ctx.save();
    ctx.translate(this.shake.x, this.shake.y);
    this.drawBackdrop(ground);
    for (const g of this.gates) this.drawGate(g, ground);
    this.drawGround(ground);
    this.drawBird();
    this.particles.render(ctx);
    this.texts.render(ctx);
    ctx.restore();
    if (this.services.preview) return;
    drawStatBar(ctx, this.W, this.insets.top, this.u, [
      ['SCORE', Math.floor(this.score).toLocaleString('en-US')],
      ['GATES', String(this.passed)],
      ['COINS', String(this.coins)],
    ]);
    if (this.phase === 'ready') {
      text(ctx, 'TAP TO FLY', this.W / 2, this.birdY - 80 * this.u, {
        size: Math.round(30 * this.u),
        align: 'center',
      });
      text(ctx, 'Tap to flap up through the gaps', this.W / 2, this.birdY + 80 * this.u, {
        size: Math.round(18 * this.u),
        align: 'center',
        color: 'rgba(255,255,255,0.9)',
      });
    }
  }

  private skyTop(): number {
    return this.insets.top + statBarHeight(this.u);
  }

  private groundY(): number {
    return this.H - this.insets.bottom - GROUND_H * this.u;
  }

  private speed(): number {
    return Math.min(MAX_SPEED, START_SPEED + SPEED_STEP * this.passed) * this.u;
  }

  private wantsFlap(): boolean {
    return this.input.wasPressed('primary') || this.input.wasPressed('up') || this.input.pointer.pressed;
  }

  /** Preview cards flap when the bird sinks below the next gap, so the frame shows flight. */
  private autopilot(): boolean {
    if (!this.services.preview || this.vy < 0) return false;
    const next = this.gates.find((g) => g.x + GATE_W * this.u > this.birdX - BIRD_R * this.u);
    const target = next ? next.gapY + next.gapH * 0.15 : this.groundY() * 0.5;
    return this.birdY > target;
  }

  private flap(): void {
    this.vy = FLAP_V * this.u;
    this.flapT = 0;
    this.addStat('flaps');
    this.audio.play('jump', { volume: 0.5 });
  }

  private fillGates(fromX: number, prevY: number): void {
    let x = fromX;
    let y = prevY;
    while (x < this.W + GATE_SPACING * this.u) {
      const g = nextGate(
        this.rng,
        this.gateIndex++,
        x,
        y,
        this.skyTop() + 10 * this.u,
        this.groundY() - 20 * this.u,
        this.u,
      );
      this.gates.push(g);
      x += GATE_SPACING * this.u;
      y = g.gapY;
    }
  }

  private checkGates(): void {
    const r = BIRD_R * this.u * HIT_SHRINK;
    const w = GATE_W * this.u;
    for (const g of this.gates) {
      if (g.coin) {
        const cx = g.x + w / 2;
        const dx = cx - this.birdX;
        const dy = g.gapY - this.birdY;
        const reach = r + COIN_R * this.u;
        if (dx * dx + dy * dy < reach * reach) {
          g.coin = false;
          this.coins++;
          this.score += COIN_SCORE;
          this.audio.play('coin');
          this.particles.emit({
            x: cx,
            y: g.gapY,
            count: 10,
            speed: 120 * this.u,
            life: 0.4,
            size: 3,
            colors: ['#fde047', '#ffffff'],
          });
        }
      }
      if (!g.passed && g.x + w < this.birdX - r) {
        g.passed = true;
        this.passed++;
        this.score += GATE_SCORE;
        this.addStat('gates');
        this.audio.play('select', { volume: 0.5 });
        if (this.passed % 10 === 0) {
          this.texts.add(
            this.W / 2,
            this.skyTop() + 50 * this.u,
            `${this.passed} GATES!`,
            '#fde047',
            26 * this.u,
            1.2,
          );
          this.audio.play('reward');
        }
      }
      const inX = this.birdX + r > g.x && this.birdX - r < g.x + w;
      const inGap = this.birdY - r > g.gapY - g.gapH / 2 && this.birdY + r < g.gapY + g.gapH / 2;
      if (inX && !inGap && this.invulnT <= 0) {
        this.crash(false);
        return;
      }
    }
    if (this.birdY + r >= this.groundY()) this.crash(true);
  }

  /** A hit on a pipe or the ground. The shield saves the first one; otherwise the bird drops and the run ends. */
  private crash(ground: boolean): void {
    if (this.invulnT > 0) {
      if (ground) this.vy = FLAP_V * this.u;
      return;
    }
    this.shake.add(0.4);
    this.particles.emit({
      x: this.birdX,
      y: this.birdY,
      count: 18,
      speed: 200 * this.u,
      life: 0.6,
      size: 3.5,
      gravity: 500 * this.u,
      colors: [this.skinColor('bird', '#facc15'), '#ffffff'],
    });
    if (this.shield) {
      this.shield = false;
      this.invulnT = INVULN_SEC;
      if (ground) this.vy = FLAP_V * this.u;
      this.texts.add(this.birdX, this.birdY - 40 * this.u, 'SHIELD', '#67e8f9', 24 * this.u, 1);
      this.audio.play('powerup');
      return;
    }
    this.audio.play('hit');
    this.phase = 'falling';
    this.vy = ground ? 0 : Math.max(0, this.vy);
    this.endGame(FALL_SEC);
  }

  private drawBackdrop(ground: number): void {
    const ctx = this.ctx;
    const u = this.u;
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    for (let i = 0; i < 4; i++) {
      const span = this.W + 240 * u;
      const x = ((((i * 260 * u - this.distance * 0.2) % span) + span) % span) - 120 * u;
      const y = this.skyTop() + (40 + ((i * 97) % 160)) * u;
      for (const [dx, dy, r] of [
        [0, 0, 26],
        [28, -10, 30],
        [58, 0, 24],
      ] as const) {
        ctx.beginPath();
        ctx.arc(x + dx * u, y + dy * u, r * u, 0, TAU);
        ctx.fill();
      }
    }
    ctx.fillStyle = this.skinColor('hills', '#86efac');
    ctx.beginPath();
    ctx.moveTo(0, ground);
    const step = 20 * u;
    for (let x = 0; x <= this.W + step; x += step) {
      const wx = (x + this.distance * 0.35) / u;
      const h = 60 + 28 * Math.sin(wx * 0.011) + 18 * Math.sin(wx * 0.027 + 1.3);
      ctx.lineTo(x, ground - h * u);
    }
    ctx.lineTo(this.W, ground);
    ctx.closePath();
    ctx.fill();
  }

  private drawGate(g: Gate, ground: number): void {
    const ctx = this.ctx;
    const u = this.u;
    const w = GATE_W * u;
    const top = g.gapY - g.gapH / 2;
    const bottom = g.gapY + g.gapH / 2;
    const colour = this.skinColor('pipe', '#22c55e');
    const body = ctx.createLinearGradient(g.x, 0, g.x + w, 0);
    body.addColorStop(0, shade(colour, 0.25));
    body.addColorStop(0.6, colour);
    body.addColorStop(1, shade(colour, -0.35));
    ctx.fillStyle = body;
    ctx.fillRect(g.x + 6 * u, 0, w - 12 * u, top);
    ctx.fillRect(g.x + 6 * u, bottom, w - 12 * u, ground - bottom);
    const lip = 26 * u;
    fillRoundRect(ctx, g.x, top - lip, w, lip, 6 * u, body);
    fillRoundRect(ctx, g.x, bottom, w, lip, 6 * u, body);
    ctx.strokeStyle = shade(colour, -0.5);
    ctx.lineWidth = 2 * u;
    ctx.strokeRect(g.x, top - lip, w, lip);
    ctx.strokeRect(g.x, bottom, w, lip);
    if (g.coin) drawCoin(ctx, g.x + w / 2, g.gapY, COIN_R * u, Math.cos(this.time * 4 + g.x * 0.01));
  }

  private drawGround(ground: number): void {
    const ctx = this.ctx;
    const u = this.u;
    const colour = this.skinColor('ground', '#d97706');
    ctx.fillStyle = colour;
    ctx.fillRect(0, ground, this.W, this.H - ground);
    ctx.fillStyle = this.skinColor('grass', '#65a30d');
    ctx.fillRect(0, ground, this.W, 12 * u);
    ctx.fillStyle = shade(colour, -0.15);
    const stripe = 36 * u;
    const off = this.distance % (stripe * 2);
    for (let x = -off; x < this.W; x += stripe * 2) {
      ctx.beginPath();
      ctx.moveTo(x, ground + 12 * u);
      ctx.lineTo(x + stripe, ground + 12 * u);
      ctx.lineTo(x + stripe - 14 * u, ground + 30 * u);
      ctx.lineTo(x - 14 * u, ground + 30 * u);
      ctx.closePath();
      ctx.fill();
    }
  }

  private drawBird(): void {
    const ctx = this.ctx;
    const u = this.u;
    const r = BIRD_R * u;
    // Nose up after a flap, nose down when diving.
    const tilt = clamp(this.vy / (MAX_FALL * u), -0.5, 1) * 0.9;
    ctx.save();
    ctx.translate(this.birdX, this.birdY);
    ctx.rotate(tilt);
    if (this.invulnT > 0 && Math.floor(this.invulnT * 10) % 2 === 0) ctx.globalAlpha = 0.45;
    const body = this.skinColor('bird', '#facc15');
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.ellipse(0, 0, r * 1.15, r, 0, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = shade(body, -0.45);
    ctx.lineWidth = 2 * u;
    ctx.stroke();
    // The wing beats down right after a flap, then rests.
    const beat = this.flapT < 0.18 ? Math.sin((this.flapT / 0.18) * Math.PI) : 0;
    ctx.fillStyle = shade(body, 0.35);
    ctx.beginPath();
    ctx.ellipse(-r * 0.3, r * (0.05 + beat * 0.45), r * 0.6, r * 0.34, -0.3 + beat * 0.6, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(r * 0.45, -r * 0.3, r * 0.34, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#0f172a';
    ctx.beginPath();
    ctx.arc(r * 0.55, -r * 0.3, r * 0.15, 0, TAU);
    ctx.fill();
    ctx.fillStyle = this.skinColor('beak', '#f97316');
    ctx.beginPath();
    ctx.moveTo(r * 0.9, -r * 0.05);
    ctx.lineTo(r * 1.55, r * 0.15);
    ctx.lineTo(r * 0.9, r * 0.4);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}
