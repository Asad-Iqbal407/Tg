import { TAU } from './math';
import type { Rng } from './rng';

interface Particle {
  alive: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
  gravity: number;
  drag: number;
  shape: 'circle' | 'square' | 'spark';
  rot: number;
  vr: number;
}

export interface EmitOptions {
  x: number;
  y: number;
  count?: number;
  speed?: number;
  speedVar?: number;
  /** Direction in radians; omit for radial bursts. */
  angle?: number;
  spread?: number;
  life?: number;
  size?: number;
  colors?: readonly string[];
  gravity?: number;
  drag?: number;
  shape?: Particle['shape'];
}

/** Pooled particle system: no allocation after construction. */
export class Particles {
  private readonly pool: Particle[];
  private cursor = 0;
  /** Scales emitted counts (reduced-motion / low-end devices). */
  density = 1;

  constructor(
    private readonly rng: Rng,
    capacity = 700,
  ) {
    this.pool = Array.from({ length: capacity }, () => ({
      alive: false,
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      life: 0,
      maxLife: 1,
      size: 1,
      color: '#fff',
      gravity: 0,
      drag: 0,
      shape: 'circle' as const,
      rot: 0,
      vr: 0,
    }));
  }

  emit(o: EmitOptions): void {
    const count = Math.max(1, Math.round((o.count ?? 10) * this.density));
    const colors = o.colors ?? ['#fff'];
    for (let i = 0; i < count; i++) {
      const p = this.pool[this.cursor] as Particle;
      this.cursor = (this.cursor + 1) % this.pool.length;
      const angle =
        o.angle === undefined ? this.rng.next() * TAU : o.angle + (this.rng.next() - 0.5) * (o.spread ?? 0.6);
      const speed = (o.speed ?? 120) * (1 - (o.speedVar ?? 0.6) * this.rng.next());
      p.alive = true;
      p.x = o.x;
      p.y = o.y;
      p.vx = Math.cos(angle) * speed;
      p.vy = Math.sin(angle) * speed;
      p.maxLife = p.life = (o.life ?? 0.6) * (0.6 + 0.4 * this.rng.next());
      p.size = (o.size ?? 3) * (0.6 + 0.6 * this.rng.next());
      p.color = colors[Math.floor(this.rng.next() * colors.length)] ?? '#fff';
      p.gravity = o.gravity ?? 0;
      p.drag = o.drag ?? 1.5;
      p.shape = o.shape ?? 'circle';
      p.rot = this.rng.next() * TAU;
      p.vr = (this.rng.next() - 0.5) * 10;
    }
  }

  update(dt: number): void {
    for (const p of this.pool) {
      if (!p.alive) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.alive = false;
        continue;
      }
      const d = Math.exp(-p.drag * dt);
      p.vx *= d;
      p.vy = p.vy * d + p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
    }
  }

  render(ctx: CanvasRenderingContext2D, offsetX = 0, offsetY = 0): void {
    for (const p of this.pool) {
      if (!p.alive) continue;
      const t = p.life / p.maxLife;
      ctx.globalAlpha = Math.min(1, t * 1.5);
      ctx.fillStyle = p.color;
      const x = p.x - offsetX;
      const y = p.y - offsetY;
      if (p.shape === 'circle') {
        ctx.beginPath();
        ctx.arc(x, y, p.size * (0.4 + 0.6 * t), 0, TAU);
        ctx.fill();
      } else if (p.shape === 'square') {
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(p.rot);
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
        ctx.restore();
      } else {
        ctx.strokeStyle = p.color;
        ctx.lineWidth = p.size * 0.5;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x - p.vx * 0.04, y - p.vy * 0.04);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }

  clear(): void {
    for (const p of this.pool) p.alive = false;
  }
}

/** Trauma-based screen shake (Squirrel Eiserloh's GDC model). */
export class Shake {
  private trauma = 0;
  private t = 0;
  enabled = true;
  x = 0;
  y = 0;

  constructor(private readonly maxOffset = 14) {}

  add(amount: number): void {
    this.trauma = Math.min(1, this.trauma + amount);
  }

  update(dt: number): void {
    this.t += dt;
    this.trauma = Math.max(0, this.trauma - dt * 1.6);
    if (!this.enabled || this.trauma <= 0) {
      this.x = this.y = 0;
      return;
    }
    const s = this.trauma * this.trauma * this.maxOffset;
    this.x = s * Math.sin(this.t * 61.3) * Math.cos(this.t * 17.1);
    this.y = s * Math.cos(this.t * 53.7) * Math.sin(this.t * 23.9);
  }
}

interface FloatText {
  x: number;
  y: number;
  text: string;
  color: string;
  life: number;
  maxLife: number;
  size: number;
}

/** Rising, fading score popups. */
export class FloatingTexts {
  private items: FloatText[] = [];

  add(x: number, y: number, text: string, color = '#fff', size = 20, life = 0.9): void {
    if (this.items.length > 40) this.items.shift();
    this.items.push({ x, y, text, color, life, maxLife: life, size });
  }

  update(dt: number): void {
    for (const f of this.items) {
      f.life -= dt;
      f.y -= 50 * dt;
    }
    this.items = this.items.filter((f) => f.life > 0);
  }

  render(ctx: CanvasRenderingContext2D, offsetX = 0, offsetY = 0): void {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const f of this.items) {
      const t = f.life / f.maxLife;
      ctx.globalAlpha = Math.min(1, t * 2);
      const scale = 1 + (1 - t) * 0.15;
      ctx.font = `800 ${Math.round(f.size * scale)}px ${FONT}`;
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.strokeText(f.text, f.x - offsetX, f.y - offsetY);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, f.x - offsetX, f.y - offsetY);
    }
    ctx.restore();
  }

  clear(): void {
    this.items = [];
  }
}

export const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
