import { clamp, TAU } from '../../core/math';
import { fillRoundRect, hash1, text } from '../draw';
import { DUCK_INFO, type DuckKind, POWER_INFO, type PowerKind } from './tuning';

/** Per-round palette: the four skies cycle and the trees and grass change with them. */
export interface Scene {
  sky: readonly [string, string];
  hills: string;
  field: string;
  trunk: string;
  canopy: readonly [string, string];
  blades: readonly [string, string];
  ground: string;
  night: boolean;
}

export const SCENES: readonly Scene[] = [
  {
    sky: ['#7ec8ff', '#d6f0ff'],
    hills: '#4f8f5a',
    field: '#3f7f3f',
    trunk: '#5b3a1e',
    canopy: ['#2f7d3a', '#3f9a48'],
    blades: ['#4caf50', '#3d8f40'],
    ground: '#8a5a2b',
    night: false,
  },
  {
    sky: ['#5aa9f0', '#bfe3ff'],
    hills: '#478a58',
    field: '#3a7a3d',
    trunk: '#5b3a1e',
    canopy: ['#2b7536', '#3d9446'],
    blades: ['#52b452', '#3f9142'],
    ground: '#86572a',
    night: false,
  },
  // Sunset: autumn colours.
  {
    sky: ['#ff8e72', '#ffd59e'],
    hills: '#8a6a3c',
    field: '#6f7a2e',
    trunk: '#4e2f18',
    canopy: ['#d5621f', '#eba23a'],
    blades: ['#a3b43f', '#869c35'],
    ground: '#7d4f25',
    night: false,
  },
  // Night: fireflies.
  {
    sky: ['#1b2a5a', '#4b3f7a'],
    hills: '#1d2b3a',
    field: '#1d3a26',
    trunk: '#2b1d14',
    canopy: ['#173826', '#1f4a31'],
    blades: ['#1f5a2c', '#2a6b36'],
    ground: '#3a2a1e',
    night: true,
  },
];

export function sceneFor(round: number): Scene {
  return SCENES[(round - 1) % SCENES.length] ?? (SCENES[0] as Scene);
}

/** Canopy circles of the big tree, relative to the trunk centre at grass level: dx, dy, r. */
const CANOPY: readonly (readonly [number, number, number])[] = [
  [0, -250, 70],
  [-47, -200, 50],
  [53, -205, 55],
  [3, -170, 55],
];

export interface Cloud {
  x: number;
  y: number;
  s: number;
}

/**
 * Background and foreground layers for a logical size. Gradients are created once per size and
 * scene; the big tree stands behind the flight band so it never hides a duck or a crate.
 */
export class Scenery {
  private readonly skyGrads = new Map<number, CanvasGradient>();
  private sunGrad: CanvasGradient | null = null;

  constructor(
    private readonly ctx: CanvasRenderingContext2D,
    private readonly W: number,
    private readonly H: number,
    readonly grassTop: number,
  ) {}

  private skyGradient(index: number, scene: Scene): CanvasGradient {
    let g = this.skyGrads.get(index);
    if (!g) {
      g = this.ctx.createLinearGradient(0, 0, 0, this.grassTop);
      g.addColorStop(0, scene.sky[0]);
      g.addColorStop(1, scene.sky[1]);
      this.skyGrads.set(index, g);
    }
    return g;
  }

  /** Sky, sun or moon, clouds, the distant tree line, the field and the background trees. */
  drawBack(round: number, time: number, clouds: readonly Cloud[]): void {
    const { ctx, W, H, grassTop } = this;
    const index = (round - 1) % SCENES.length;
    const scene = sceneFor(round);
    ctx.fillStyle = this.skyGradient(index, scene);
    ctx.fillRect(-20, -20, W + 40, grassTop + 20);
    const sunX = W - 140;
    if (scene.night) {
      ctx.fillStyle = '#fff';
      for (let i = 0; i < 60; i++) {
        const tw = 0.5 + 0.5 * Math.sin(time * 2 + i * 1.7);
        ctx.globalAlpha = 0.45 + 0.55 * tw;
        ctx.fillRect(hash1(i) * W, hash1(i + 7) * (grassTop - 120), 2, 2);
      }
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#f5f3ce';
      ctx.beginPath();
      ctx.arc(sunX - 20, 90, 34, 0, TAU);
      ctx.fill();
      // The crescent's bite is filled with the sky itself.
      ctx.fillStyle = this.skyGradient(index, scene);
      ctx.beginPath();
      ctx.arc(sunX - 6, 80, 30, 0, TAU);
      ctx.fill();
    } else {
      if (!this.sunGrad) {
        const g = ctx.createRadialGradient(sunX, 90, 10, sunX, 90, 90);
        g.addColorStop(0, 'rgba(255,250,210,0.95)');
        g.addColorStop(1, 'rgba(255,250,210,0)');
        this.sunGrad = g;
      }
      ctx.fillStyle = this.sunGrad;
      ctx.fillRect(sunX - 120, 0, 240, 200);
    }
    ctx.fillStyle = scene.night ? 'rgba(180,180,220,0.18)' : 'rgba(255,255,255,0.85)';
    for (const c of clouds) {
      ctx.beginPath();
      ctx.ellipse(c.x, c.y, 60 * c.s, 20 * c.s, 0, 0, TAU);
      ctx.ellipse(c.x + 40 * c.s, c.y - 12 * c.s, 40 * c.s, 22 * c.s, 0, 0, TAU);
      ctx.fill();
    }
    // Distant tree line, then the field behind the tall grass (no pale sky strip between them).
    ctx.fillStyle = scene.hills;
    ctx.beginPath();
    ctx.moveTo(-24, grassTop);
    for (let x = -24; x <= W + 24; x += 24) ctx.lineTo(x, grassTop - 40 - hash1(x * 0.37) * 40);
    ctx.lineTo(W + 24, grassTop);
    ctx.fill();
    ctx.fillStyle = scene.field;
    ctx.fillRect(-20, grassTop - 4, W + 40, H - grassTop + 24);
    // Background trees: ducks and crates always pass in front of them.
    this.drawTree(scene, 77, 1);
    if (W >= 1000) this.drawTree(scene, W - 96, 0.62);
  }

  private drawTree(scene: Scene, x: number, s: number): void {
    const { ctx, grassTop } = this;
    ctx.fillStyle = scene.trunk;
    ctx.fillRect(x - 17 * s, grassTop - 230 * s, 34 * s, 230 * s + 10);
    ctx.fillStyle = scene.canopy[0];
    ctx.beginPath();
    for (const [dx, dy, r] of CANOPY) {
      ctx.moveTo(x + dx * s + r * s, grassTop + dy * s);
      ctx.arc(x + dx * s, grassTop + dy * s, r * s, 0, TAU);
    }
    ctx.fill();
    ctx.fillStyle = scene.canopy[1];
    ctx.beginPath();
    ctx.arc(x - 18 * s, grassTop - 268 * s, 34 * s, 0, TAU);
    ctx.moveTo(x + 66 * s, grassTop - 214 * s);
    ctx.arc(x + 44 * s, grassTop - 214 * s, 22 * s, 0, TAU);
    ctx.fill();
  }

  /** Tall grass and dirt in front of everything that lands or emerges, plus night fireflies. */
  drawFront(round: number, time: number): void {
    const { ctx, W, H, grassTop } = this;
    const scene = sceneFor(round);
    ctx.fillStyle = scene.ground;
    ctx.fillRect(-20, grassTop + 70, W + 40, H - grassTop);
    for (let layer = 0; layer < 2; layer++) {
      ctx.fillStyle = scene.blades[layer] as string;
      ctx.beginPath();
      ctx.moveTo(-10, grassTop + 90);
      for (let x = -10; x <= W + 10; x += 14) {
        const sway = Math.sin(time * 1.5 + x * 0.05 + layer) * 4;
        ctx.lineTo(x + 7 + sway, grassTop - 10 + layer * 20 + hash1(x + layer * 13) * 20);
        ctx.lineTo(x + 14, grassTop + 40 + layer * 10);
      }
      ctx.lineTo(W + 24, grassTop + 90);
      ctx.fill();
    }
    if (scene.night) {
      for (let i = 0; i < 16; i++) {
        const x = hash1(i * 3.1) * W + Math.sin(time * 0.6 + i) * 26;
        const y = grassTop - 10 - hash1(i * 5.7) * 70 + Math.cos(time * 0.8 + i * 1.7) * 12;
        const a = clamp(0.5 + 0.6 * Math.sin(time * 2.4 + i * 2.3), 0, 1);
        if (a <= 0.05) continue;
        ctx.globalAlpha = a * 0.35;
        ctx.fillStyle = '#e8ff7a';
        ctx.beginPath();
        ctx.arc(x, y, 6, 0, TAU);
        ctx.fill();
        ctx.globalAlpha = a;
        ctx.fillStyle = '#f6ffc4';
        ctx.fillRect(x - 1.5, y - 1.5, 3, 3);
      }
      ctx.globalAlpha = 1;
    }
  }
}

export interface DuckPose {
  /** 1 = facing right, -1 = facing left. */
  facing: number;
  /** Body rotation in radians (applied before the facing flip). */
  rot: number;
  /** Wing angle in radians. */
  wing: number;
  dead: boolean;
  scale: number;
}

/** A duck centred at (x, y). */
export function drawDuckSprite(
  ctx: CanvasRenderingContext2D,
  kind: DuckKind,
  x: number,
  y: number,
  pose: DuckPose,
): void {
  const info = DUCK_INFO[kind];
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(pose.rot);
  ctx.scale(pose.facing * pose.scale, pose.scale);
  if (kind === 'gold') {
    ctx.shadowColor = '#ffd23f';
    ctx.shadowBlur = 18;
  }
  // Tail and body
  ctx.fillStyle = info.body;
  ctx.beginPath();
  ctx.moveTo(-26, -2);
  ctx.lineTo(-38, -8);
  ctx.lineTo(-36, 6);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(-4, 2, 26, 15, 0, 0, TAU);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = info.belly;
  ctx.beginPath();
  ctx.ellipse(-2, 9, 20, 7, 0, 0, TAU);
  ctx.fill();
  // Head, collar and beak
  ctx.fillStyle = info.head;
  ctx.beginPath();
  ctx.arc(22, -10, 11, 0, TAU);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.fillRect(14, -2, 14, 3);
  ctx.fillStyle = '#f4a020';
  ctx.beginPath();
  ctx.moveTo(31, -12);
  ctx.lineTo(44, -8);
  ctx.lineTo(31, -5);
  ctx.fill();
  // Eye
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(25, -13, 3.5, 0, TAU);
  ctx.fill();
  if (pose.dead) {
    ctx.strokeStyle = '#111';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(23, -15);
    ctx.lineTo(27, -11);
    ctx.moveTo(27, -15);
    ctx.lineTo(23, -11);
    ctx.stroke();
  } else {
    ctx.fillStyle = '#111';
    ctx.beginPath();
    ctx.arc(26, -13, 1.8, 0, TAU);
    ctx.fill();
  }
  // Wing
  ctx.save();
  ctx.translate(-6, -4);
  ctx.rotate(-pose.wing * 0.9);
  ctx.fillStyle = info.wing;
  ctx.beginPath();
  ctx.ellipse(-4, -12, 9, 20, -0.4, 0, TAU);
  ctx.fill();
  ctx.restore();
  ctx.restore();
}

export interface CrateLike {
  kind: PowerKind;
  x: number;
  y: number;
}

/** Offset of the balloon centre above the crate centre, and its radii. */
export const BALLOON_DY = 66;
export const BALLOON_RX = 20;
export const BALLOON_RY = 24;
export const CRATE_HALF = 18;

export function drawCrate(ctx: CanvasRenderingContext2D, c: CrateLike): void {
  const info = POWER_INFO[c.kind];
  const by = c.y - BALLOON_DY;
  ctx.strokeStyle = 'rgba(255,255,255,0.75)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(c.x, c.y - CRATE_HALF);
  ctx.lineTo(c.x, by + BALLOON_RY);
  ctx.stroke();
  ctx.fillStyle = info.color;
  ctx.beginPath();
  ctx.ellipse(c.x, by, BALLOON_RX, BALLOON_RY, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ctx.beginPath();
  ctx.ellipse(c.x - 7, by - 9, 5, 8, -0.4, 0, TAU);
  ctx.fill();
  text(ctx, info.badge, c.x, by + 1, { size: 15, align: 'center', color: '#1b1b2e', stroke: null });
  fillRoundRect(ctx, c.x - CRATE_HALF, c.y - CRATE_HALF, CRATE_HALF * 2, CRATE_HALF * 2, 6, '#c58b4a');
  ctx.strokeStyle = '#7a5226';
  ctx.lineWidth = 3;
  ctx.strokeRect(c.x - 15, c.y - 15, 30, 30);
  ctx.beginPath();
  ctx.moveTo(c.x - 15, c.y - 15);
  ctx.lineTo(c.x + 15, c.y + 15);
  ctx.stroke();
}

/**
 * The dog popping out of the grass: `rise` in [0, 1] (0 = hidden), holding up the ducks that
 * were actually shot this wave, or laughing.
 */
export function drawDog(
  ctx: CanvasRenderingContext2D,
  x: number,
  baseY: number,
  rise: number,
  mood: 'happy' | 'laugh',
  held: readonly DuckKind[],
  time: number,
): void {
  if (rise <= 0) return;
  const y = baseY - rise * 112 + (mood === 'laugh' ? -Math.abs(Math.sin(time * 14)) * 6 : 0);
  ctx.save();
  ctx.translate(x, y);
  if (mood === 'happy') {
    // Ducks held up by the feet, head down, in the colours of the kinds that were hit.
    const n = held.length;
    const gap = n > 2 ? 50 : 66;
    for (let i = 0; i < n; i++) {
      drawDuckSprite(ctx, held[i] as DuckKind, (i - (n - 1) / 2) * gap, -70, {
        facing: 1,
        rot: Math.PI / 2,
        wing: -0.6,
        dead: true,
        scale: 0.85,
      });
    }
    // Paws gripping the outer ducks by the neck.
    ctx.fillStyle = '#b5733c';
    ctx.beginPath();
    const px = ((n - 1) / 2) * gap;
    ctx.ellipse(-px, -46, 10, 9, 0, 0, TAU);
    if (n > 1) {
      ctx.moveTo(px + 10, -46);
      ctx.ellipse(px, -46, 10, 9, 0, 0, TAU);
    }
    ctx.fill();
  }
  // Head
  ctx.fillStyle = '#b5733c';
  ctx.beginPath();
  ctx.ellipse(0, 0, 34, 30, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = '#6b3d1c';
  ctx.beginPath();
  ctx.ellipse(-32, -2, 12, 26, 0.3, 0, TAU);
  ctx.ellipse(32, -2, 12, 26, -0.3, 0, TAU);
  ctx.fill();
  ctx.fillStyle = '#f3dcc0';
  ctx.beginPath();
  ctx.ellipse(0, 14, 20, 15, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = '#1b1b1b';
  ctx.beginPath();
  ctx.ellipse(0, 6, 8, 6, 0, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = '#1b1b1b';
  if (mood === 'laugh') {
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(-12, -10, 6, Math.PI, 0);
    ctx.moveTo(18, -10);
    ctx.arc(12, -10, 6, Math.PI, 0);
    ctx.stroke();
    ctx.fillStyle = '#7a1f1f';
    ctx.beginPath();
    ctx.ellipse(0, 22, 10, 7, 0, 0, Math.PI);
    ctx.fill();
  } else {
    ctx.fillStyle = '#1b1b1b';
    ctx.beginPath();
    ctx.arc(-12, -10, 4, 0, TAU);
    ctx.moveTo(16, -10);
    ctx.arc(12, -10, 4, 0, TAU);
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 16, 8, 0.2, Math.PI - 0.2);
    ctx.stroke();
  }
  ctx.restore();
}

/** Small duck icon for the hit tracker. */
export function trackerDuck(ctx: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  ctx.beginPath();
  ctx.ellipse(x, y, 11 * s, 8.5 * s, 0, 0, TAU);
  ctx.moveTo(x + 16 * s, y - 7 * s);
  ctx.arc(x + 10 * s, y - 7 * s, 6 * s, 0, TAU);
  ctx.fill();
}
