/**
 * Tiny pixel-art sprite system. Sprites are string grids; each character maps to a palette
 * colour ('.' is transparent). Rendered sprites are cached per palette on offscreen canvases
 * and blitted with smoothing disabled for crisp pixels.
 */
export type SpriteDef = readonly string[];
export type SpritePalette = Readonly<Record<string, string>>;

type Surface = HTMLCanvasElement | OffscreenCanvas;

function createSurface(w: number, h: number): Surface | null {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  if (typeof document !== 'undefined') {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  }
  return null;
}

const cache = new Map<string, Surface | null>();
let paletteIds = new WeakMap<object, number>();
let nextPaletteId = 1;
let defIds = new WeakMap<object, number>();
let nextDefId = 1;

function idOf(map: WeakMap<object, number>, o: object, next: () => number): number {
  let id = map.get(o);
  if (id === undefined) {
    id = next();
    map.set(o, id);
  }
  return id;
}

function paint(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  def: SpriteDef,
  pal: SpritePalette,
  x: number,
  y: number,
  px: number,
): void {
  for (let r = 0; r < def.length; r++) {
    const row = def[r] as string;
    for (let c = 0; c < row.length; c++) {
      const ch = row[c] as string;
      if (ch === '.' || ch === ' ') continue;
      const color = pal[ch];
      if (!color) continue;
      ctx.fillStyle = color;
      ctx.fillRect(x + c * px, y + r * px, px + 0.02, px + 0.02);
    }
  }
}

export function spriteSize(def: SpriteDef): { w: number; h: number } {
  return { w: def[0]?.length ?? 0, h: def.length };
}

/** Draw `def` with its top-left at (x, y), each sprite pixel `px` logical pixels wide. */
export function drawSprite(
  ctx: CanvasRenderingContext2D,
  def: SpriteDef,
  pal: SpritePalette,
  x: number,
  y: number,
  px: number,
  flip = false,
): void {
  const { w, h } = spriteSize(def);
  const key = `${idOf(defIds, def, () => nextDefId++)}:${idOf(paletteIds, pal, () => nextPaletteId++)}`;
  let surf = cache.get(key);
  if (surf === undefined) {
    surf = createSurface(w, h);
    if (surf) {
      const sctx = surf.getContext('2d') as
        CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
      if (sctx) paint(sctx, def, pal, 0, 0, 1);
      else surf = null;
    }
    if (cache.size > 400) cache.clear();
    cache.set(key, surf);
  }
  ctx.save();
  if (flip) {
    ctx.translate(x + w * px, y);
    ctx.scale(-1, 1);
    x = 0;
    y = 0;
  }
  if (surf && typeof ctx.drawImage === 'function') {
    const prev = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(surf as CanvasImageSource, x, y, w * px, h * px);
    ctx.imageSmoothingEnabled = prev;
  } else {
    paint(ctx, def, pal, x, y, px);
  }
  ctx.restore();
}

/** Test hook: forget cached surfaces. */
export function resetSpriteCache(): void {
  cache.clear();
  paletteIds = new WeakMap();
  defIds = new WeakMap();
  nextPaletteId = 1;
  nextDefId = 1;
}
