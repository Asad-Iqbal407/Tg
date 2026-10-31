import { clamp, TAU } from '../../core/math';
import { fillRoundRect, hash1, shade, text } from '../draw';
import { type Biome, BIOME_M, BIOMES, biomeIndexAt, mixHex } from './biomes';
import { type Kicker, PX_PER_M, STEP, type Terrain } from './terrain';

/** World x over which ground colours blend into the next biome. */
const BLEND_PX = 40 * PX_PER_M;
const BLEND_SLICES = 6;
const STAR_COUNT = 80;

/** Camera state the scenery needs: top-left world point and zoom (screen px per world px). */
/**
 * Walks the blend zone [solidEnd, b1) from `from` up to `end` in BLEND_SLICES flat-colour slices, calling `draw`
 * with each slice's span and blend amount; returns where it stopped (min(end, b1), or `from` if already past).
 * Slices are stepped by index, never re-derived from the position: re-deriving the index from a slice end that
 * landed a hair below a boundary once returned the same slice forever and froze the game near biome borders.
 */
export function blendSlices(
  from: number,
  end: number,
  solidEnd: number,
  b1: number,
  draw: (from: number, to: number, t: number) => void,
): number {
  const stop = Math.min(end, b1);
  if (!(from < stop)) return from;
  const width = (b1 - solidEnd) / BLEND_SLICES;
  let slice = clamp(Math.floor((from - solidEnd) / width), 0, BLEND_SLICES - 1);
  while (from < stop && slice < BLEND_SLICES) {
    const sliceEnd = Math.min(stop, slice === BLEND_SLICES - 1 ? b1 : solidEnd + (slice + 1) * width);
    if (sliceEnd > from) {
      draw(from, sliceEnd, (slice + 0.5) / BLEND_SLICES);
      from = sliceEnd;
    }
    slice++;
  }
  return Math.max(from, stop);
}

export interface View {
  x: number;
  y: number;
  zoom: number;
}

/**
 * Backgrounds and ground for Hill Rider. Gradients are built once per biome (the logical size is
 * fixed for a run), so a frame only fills cached styles.
 */
export class Scenery {
  private readonly sky = new Map<number, CanvasGradient>();
  private readonly ground = new Map<string, CanvasGradient>();
  private sun: CanvasGradient | null = null;
  private readonly stars: Float32Array;

  constructor(
    private readonly ctx: CanvasRenderingContext2D,
    private readonly W: number,
    private readonly H: number,
    private readonly origin: number,
  ) {
    this.stars = new Float32Array(STAR_COUNT * 3);
    for (let i = 0; i < STAR_COUNT; i++) {
      this.stars[i * 3] = hash1(i);
      this.stars[i * 3 + 1] = hash1(i + 50) * 0.65;
      this.stars[i * 3 + 2] = 0.4 + 0.6 * hash1(i + 3);
    }
  }

  private skyGradient(i: number): CanvasGradient {
    let g = this.sky.get(i);
    if (!g) {
      const b = BIOMES[i] as Biome;
      g = this.ctx.createLinearGradient(0, 0, 0, this.H);
      g.addColorStop(0, b.sky[0]);
      g.addColorStop(1, b.sky[1]);
      this.sky.set(i, g);
    }
    return g;
  }

  private groundGradient(a: number, b: number, t: number): CanvasGradient {
    const key = `${a}:${b}:${t.toFixed(3)}`;
    let g = this.ground.get(key);
    if (!g) {
      const ba = BIOMES[a] as Biome;
      const bb = BIOMES[b] as Biome;
      g = this.ctx.createLinearGradient(0, this.H * 0.3, 0, this.H * 1.1);
      g.addColorStop(0, t > 0 ? mixHex(ba.ground[0], bb.ground[0], t) : ba.ground[0]);
      g.addColorStop(1, t > 0 ? mixHex(ba.ground[1], bb.ground[1], t) : ba.ground[1]);
      if (this.ground.size > 64) this.ground.clear();
      this.ground.set(key, g);
    }
    return g;
  }

  /** Sky, sun or planet, and stars, cross-fading from biome a to b by t. */
  drawSky(a: number, b: number, t: number): void {
    const ctx = this.ctx;
    const W = this.W;
    const H = this.H;
    ctx.fillStyle = this.skyGradient(a);
    ctx.fillRect(-20, -20, W + 40, H + 40);
    if (t > 0 && b !== a) {
      ctx.globalAlpha = t;
      ctx.fillStyle = this.skyGradient(b);
      ctx.fillRect(-20, -20, W + 40, H + 40);
      ctx.globalAlpha = 1;
    }
    const ba = BIOMES[a] as Biome;
    const bb = BIOMES[b] as Biome;
    const night = (ba.night ? 1 - t : 0) + (bb.night ? t : 0);
    const cx = W - Math.min(180, W * 0.16);
    const cy = H * 0.2;
    if (night > 0.02) {
      ctx.fillStyle = '#fff';
      for (let i = 0; i < STAR_COUNT; i++) {
        ctx.globalAlpha = night * (this.stars[i * 3 + 2] as number);
        ctx.fillRect((this.stars[i * 3] as number) * W, (this.stars[i * 3 + 1] as number) * H, 2, 2);
      }
      // Earth over the moon base, a red moon over the volcano.
      const lunar = (ba.gravity < 1 ? 1 - t : 0) + (bb.gravity < 1 ? t : 0);
      ctx.globalAlpha = night;
      ctx.fillStyle = lunar > 0.5 ? '#3b82f6' : '#b8432f';
      ctx.beginPath();
      ctx.arc(cx, cy, 46, 0, TAU);
      ctx.fill();
      ctx.fillStyle = lunar > 0.5 ? '#22c55e' : '#d9623f';
      ctx.beginPath();
      ctx.arc(cx - 10, cy - 10, 18, 0, TAU);
      ctx.arc(cx + 16, cy + 14, 12, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    if (night < 0.98) {
      if (!this.sun) {
        const sg = ctx.createRadialGradient(0, 0, 10, 0, 0, 120);
        sg.addColorStop(0, 'rgba(255,250,220,1)');
        sg.addColorStop(0.25, 'rgba(255,240,180,0.7)');
        sg.addColorStop(1, 'rgba(255,240,180,0)');
        this.sun = sg;
      }
      ctx.save();
      ctx.globalAlpha = 1 - night;
      ctx.translate(cx, cy);
      ctx.fillStyle = this.sun;
      ctx.fillRect(-120, -120, 240, 240);
      ctx.restore();
    }
  }

  /** Two layers of distant hills; their baselines follow the screen height. */
  drawParallax(a: number, b: number, t: number, view: View): void {
    const ctx = this.ctx;
    const ba = BIOMES[a] as Biome;
    const bb = BIOMES[b] as Biome;
    const k = this.H / 540;
    for (let layer = 0; layer < 2; layer++) {
      const par = layer === 0 ? 0.15 : 0.35;
      const base = this.H * (layer === 0 ? 0.6 : 0.72);
      const amp = (layer === 0 ? 130 : 95) * k;
      const wl = layer === 0 ? 260 : 180;
      const salt = layer + 1;
      ctx.fillStyle =
        t > 0
          ? mixHex(layer === 0 ? ba.far : ba.near, layer === 0 ? bb.far : bb.near, t)
          : layer === 0
            ? ba.far
            : ba.near;
      ctx.beginPath();
      ctx.moveTo(-10, this.H + 10);
      const off = view.x * par;
      // Vertical parallax, clamped so a big drop never lifts the hills off the bottom edge.
      const yOff = clamp((-(view.y - 330 + this.H * 0.45) * par * 0.3) / Math.max(0.6, view.zoom), -60, 60);
      for (let sx = -10; sx <= this.W + 20; sx += 20) {
        const wx = (sx + off) / wl;
        const i = Math.floor(wx);
        const f = wx - i;
        const h0 = hash1(i * 3.3 + salt);
        const h1 = hash1((i + 1) * 3.3 + salt);
        const h = h0 + (h1 - h0) * (f * f * (3 - 2 * f));
        ctx.lineTo(sx, base - h * amp + yOff);
      }
      ctx.lineTo(this.W + 20, this.H + 10);
      ctx.fill();
    }
  }

  /**
   * Ground between world x0..x1. Must be called with the camera transform applied; fills use
   * screen-space gradients so colours stay put while the terrain scrolls.
   */
  drawTerrain(terrain: Terrain, view: View, x0: number, x1: number): void {
    const startX = Math.floor(x0 / STEP) * STEP;
    const endX = x1 + STEP;
    const m0 = (startX - this.origin) / PX_PER_M;
    let k = Math.floor(Math.max(0, m0) / BIOME_M);
    let from = startX;
    while (from < endX) {
      // Biome k spans [b0, b1); its last BLEND_PX blend into biome k+1.
      const b1 = this.origin + (k + 1) * BIOME_M * PX_PER_M;
      const solidEnd = b1 - BLEND_PX;
      const ia = biomeIndexAt(k * BIOME_M);
      const ib = biomeIndexAt((k + 1) * BIOME_M);
      if (from < solidEnd) {
        const to = Math.min(endX, solidEnd);
        this.drawRun(terrain, view, from, to, ia, ib, 0);
        from = to;
      }
      from = blendSlices(from, endX, solidEnd, b1, (a, b, t) => this.drawRun(terrain, view, a, b, ia, ib, t));
      k++;
    }
  }

  private drawRun(
    terrain: Terrain,
    view: View,
    from: number,
    to: number,
    a: number,
    b: number,
    t: number,
  ): void {
    if (to <= from) return;
    const ctx = this.ctx;
    const ba = BIOMES[a] as Biome;
    const bb = BIOMES[b] as Biome;
    const bottom = view.y + this.H / view.zoom + 40;
    ctx.beginPath();
    ctx.moveTo(from, bottom);
    for (let x = from; x < to; x += STEP) ctx.lineTo(x, terrain.heightAt(x));
    // Overlap neighbours by a pixel so slices never show a seam.
    ctx.lineTo(to + 1, terrain.heightAt(to + 1));
    ctx.lineTo(to + 1, bottom);
    ctx.closePath();
    // Fill in screen space (the path is already transformed).
    ctx.save();
    ctx.translate(view.x, view.y);
    ctx.scale(1 / view.zoom, 1 / view.zoom);
    ctx.fillStyle = this.groundGradient(a, b, t);
    ctx.fill();
    ctx.restore();
    const grass = t > 0 ? mixHex(ba.grass, bb.grass, t) : ba.grass;
    ctx.beginPath();
    ctx.moveTo(from, terrain.heightAt(from));
    for (let x = from + STEP; x < to; x += STEP) ctx.lineTo(x, terrain.heightAt(x));
    ctx.lineTo(to + 1, terrain.heightAt(to + 1));
    ctx.lineJoin = 'round';
    ctx.strokeStyle = shade(grass.startsWith('#') ? grass : ba.grass, -0.35);
    ctx.lineWidth = 12;
    ctx.stroke();
    ctx.strokeStyle = grass;
    ctx.lineWidth = 7;
    ctx.stroke();
  }

  /** Wooden deck on each jump ramp with a striped lip, plus a warning sign before it. */
  drawKickers(terrain: Terrain, x0: number, x1: number): void {
    const ctx = this.ctx;
    for (const k of terrain.kickers) {
      if (k.lip + 20 < x0 || k.start - 60 > x1) continue;
      this.drawKicker(terrain, k);
    }
    ctx.lineJoin = 'miter';
  }

  private drawKicker(terrain: Terrain, k: Kicker): void {
    const ctx = this.ctx;
    const a = k.ramp + (k.lip - k.ramp) * 0.25;
    ctx.beginPath();
    ctx.moveTo(a, terrain.heightAt(a) - 3);
    for (let x = a + STEP; x <= k.lip; x += STEP) ctx.lineTo(x, terrain.heightAt(x) - 3);
    const lipY = terrain.heightAt(k.lip);
    ctx.lineTo(k.lip, lipY + 26);
    ctx.lineTo(k.lip - 30, lipY + 30);
    ctx.closePath();
    ctx.fillStyle = '#b07a3f';
    ctx.fill();
    ctx.strokeStyle = '#5e3b17';
    ctx.lineWidth = 3;
    ctx.stroke();
    // Planks
    ctx.strokeStyle = 'rgba(70,40,15,0.5)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let x = a + 24; x < k.lip - 6; x += 24) {
      const y = terrain.heightAt(x);
      ctx.moveTo(x, y - 4);
      ctx.lineTo(x + 4, y + 10);
    }
    ctx.stroke();
    // Striped lip
    ctx.save();
    ctx.translate(k.lip, lipY);
    ctx.rotate(-k.lipAngle);
    fillRoundRect(ctx, -18, -7, 18, 8, 2, '#ffd23f');
    ctx.fillStyle = '#222';
    ctx.fillRect(-14, -7, 4, 8);
    ctx.fillRect(-6, -7, 4, 8);
    ctx.restore();
    // Sign at the start of the run-in.
    const sx = k.start + 40;
    const sy = terrain.heightAt(sx);
    ctx.fillStyle = '#6b4a2a';
    ctx.fillRect(sx - 2, sy - 50, 4, 50);
    ctx.save();
    ctx.translate(sx, sy - 62);
    ctx.rotate(Math.PI / 4);
    fillRoundRect(ctx, -14, -14, 28, 28, 4, '#ffb703');
    ctx.restore();
    text(ctx, '⤴', sx, sy - 62, { size: 18, align: 'center', color: '#3a2a00', stroke: null });
  }

  /** Distance posts every 100 m. */
  drawSigns(terrain: Terrain, x0: number, x1: number): void {
    const ctx = this.ctx;
    const first = Math.max(1, Math.ceil((x0 - 30 - this.origin) / (100 * PX_PER_M)));
    for (let k = first; ; k++) {
      const wx = this.origin + k * 100 * PX_PER_M;
      if (wx > x1 + 30) break;
      const gy = terrain.heightAt(wx);
      ctx.fillStyle = '#6b4a2a';
      ctx.fillRect(wx - 2, gy - 46, 4, 46);
      fillRoundRect(ctx, wx - 28, gy - 68, 56, 26, 6, k % 5 === 0 ? '#ffd23f' : '#f4e3c1');
      text(ctx, `${k * 100}m`, wx, gy - 55, { size: 14, align: 'center', color: '#5b3a1e', stroke: null });
    }
  }
}
