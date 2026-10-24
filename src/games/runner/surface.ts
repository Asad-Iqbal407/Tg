/** Offscreen canvas used to cache static art; null when no canvas exists (headless tests). */
export type Surface = HTMLCanvasElement | OffscreenCanvas;
export type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export function createSurface(w: number, h: number): { surface: Surface; ctx: Ctx2D } | null {
  let surface: Surface | null = null;
  if (typeof OffscreenCanvas !== 'undefined') surface = new OffscreenCanvas(w, h);
  else if (typeof document !== 'undefined') {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    surface = c;
  }
  const ctx = surface?.getContext('2d') as Ctx2D | null | undefined;
  return surface && ctx ? { surface, ctx } : null;
}

/** Backing-store pixels per logical pixel of the target context (1 when unknown). */
export function resolutionOf(ctx: CanvasRenderingContext2D): number {
  const t = typeof ctx.getTransform === 'function' ? ctx.getTransform() : undefined;
  const a = t && typeof t.a === 'number' ? Math.abs(t.a) : 1;
  return Math.min(2, Math.max(0.5, Math.round(a * 4) / 4 || 1));
}

/** Deterministic integer hash of (a, b) in [0, 1) for stable cosmetic variety. */
export function rand(a: number, b = 0): number {
  let h = Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul((b | 0) + 0x9e37, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Soft radial glows, pre-rendered once per colour and blitted with drawImage. */
export class GlowSprites {
  private readonly cache = new Map<string, Surface | null>();

  /** Draw a glow of radius r centred on (x, y); `rgb` is an "r,g,b" string. No-op without canvases. */
  draw(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, rgb: string): void {
    let sprite = this.cache.get(rgb);
    if (sprite === undefined) {
      const made = createSurface(64, 64);
      sprite = null;
      if (made) {
        const g = made.ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
        g.addColorStop(0, `rgba(${rgb},0.85)`);
        g.addColorStop(0.35, `rgba(${rgb},0.32)`);
        g.addColorStop(1, `rgba(${rgb},0)`);
        made.ctx.fillStyle = g;
        made.ctx.fillRect(0, 0, 64, 64);
        sprite = made.surface;
      }
      this.cache.set(rgb, sprite);
    }
    if (sprite && r > 0.5) ctx.drawImage(sprite, x - r, y - r, r * 2, r * 2);
  }
}
