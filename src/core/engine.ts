export interface LoopOptions {
  /** Simulation step in seconds (default 1/60). */
  fixedDt?: number;
  /** Most steps simulated per animation frame before the backlog is dropped. */
  maxSteps?: number;
  /** Called at the start of every animation frame, before any step (e.g. to poll gamepads). */
  poll?: () => void;
}

/**
 * Fixed-timestep loop: simulation always advances in `fixedDt` steps (deterministic physics,
 * identical feel on 60/120/144 Hz displays). A frame is rendered only when at least one step ran
 * or `invalidate()` was called, so high-refresh displays don't repaint identical images.
 */
export class GameLoop {
  private rafId = 0;
  private last = 0;
  private acc = 0;
  private running = false;
  private dirty = true;
  private fpsFrames = 0;
  private fpsTime = 0;
  private readonly fixedDt: number;
  private readonly maxSteps: number;
  private readonly poll: (() => void) | undefined;
  /** Rendered frames per second, measured over half-second windows. */
  fps = 0;

  constructor(
    private readonly step: (dt: number) => void,
    private readonly render: (frameDt: number) => void,
    opts: LoopOptions = {},
  ) {
    this.fixedDt = opts.fixedDt ?? 1 / 60;
    this.maxSteps = opts.maxSteps ?? 5;
    this.poll = opts.poll;
  }

  get isRunning(): boolean {
    return this.running;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.dirty = true;
    this.last = performance.now();
    this.acc = 0;
    this.fpsFrames = 0;
    this.fpsTime = 0;
    this.rafId = requestAnimationFrame(this.frame);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.rafId);
  }

  /** Force a render on the next frame even if no simulation step runs (e.g. after a resize). */
  invalidate(): void {
    this.dirty = true;
  }

  private readonly frame = (now: number): void => {
    if (!this.running) return;
    const frameDt = Math.min(0.25, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    this.poll?.();
    if (!this.running) return;
    this.acc += frameDt;
    let steps = 0;
    while (this.acc >= this.fixedDt && steps < this.maxSteps) {
      this.step(this.fixedDt);
      this.acc -= this.fixedDt;
      steps++;
      if (!this.running) return;
    }
    if (steps === this.maxSteps) this.acc = 0; // drop backlog instead of spiralling
    this.fpsTime += frameDt;
    if (steps > 0 || this.dirty) {
      this.dirty = false;
      this.fpsFrames++;
      this.render(frameDt);
    }
    if (this.fpsTime >= 0.5) {
      this.fps = Math.round(this.fpsFrames / this.fpsTime);
      this.fpsFrames = 0;
      this.fpsTime = 0;
    }
    if (this.running) this.rafId = requestAnimationFrame(this.frame);
  };
}

/** The part of a game definition that describes its logical size. */
export interface SizeSpec {
  /** Design size: the default, and the anchor the flexible size grows or shrinks from. */
  width: number;
  height: number;
  viewport?: { minWidth?: number; maxWidth?: number; minHeight?: number; maxHeight?: number };
}

export interface LogicalSize {
  width: number;
  height: number;
}

const clampTo = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/**
 * Pick the logical size inside the definition's viewport range that best fills an
 * `availW` x `availH` CSS-pixel box. The design size is the anchor: on a wider box the width grows
 * first (then the height shrinks toward its minimum); on a taller box the height grows first (then
 * the width shrinks). Whatever the range cannot absorb is letterboxed. Results are even integers.
 */
export function chooseLogicalSize(spec: SizeSpec, availW: number, availH: number): LogicalSize {
  const r = spec.viewport ?? {};
  const minW = Math.min(r.minWidth ?? spec.width, spec.width);
  const maxW = Math.max(r.maxWidth ?? spec.width, spec.width);
  const minH = Math.min(r.minHeight ?? spec.height, spec.height);
  const maxH = Math.max(r.maxHeight ?? spec.height, spec.height);
  if (!(availW > 0 && availH > 0) || !Number.isFinite(availW / availH)) {
    return { width: spec.width, height: spec.height };
  }
  const aspect = availW / availH;
  let w = spec.width;
  let h = spec.height;
  if (aspect > w / h) {
    w = clampTo(h * aspect, minW, maxW);
    if (w / h < aspect) h = clampTo(w / aspect, minH, h);
  } else {
    h = clampTo(w / aspect, minH, maxH);
    if (w / h > aspect) w = clampTo(h * aspect, minW, w);
  }
  const even = (v: number, lo: number, hi: number) => clampTo(2 * Math.round(v / 2), lo, hi);
  return { width: even(w, minW, maxW), height: even(h, minH, maxH) };
}

/** CSS-pixel area a `size` canvas occupies when letterboxed into an `availW` x `availH` box. */
export function fittedArea(size: LogicalSize, availW: number, availH: number): number {
  if (!(availW > 0 && availH > 0)) return 0;
  const s = Math.min(availW / size.width, availH / size.height);
  return size.width * size.height * s * s;
}

/**
 * Letterboxed, DPI-aware canvas. Games draw in a logical resolution (chosen per run with
 * `setLogicalSize`); the viewport centres the canvas in its container's content box (so
 * safe-area padding is respected) and sizes the backing store so it maps 1:1 onto device pixels.
 */
export class Viewport {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  /** Upper bound on backing-store pixels per logical pixel (a quality / battery knob). */
  maxScale = 2.5;
  /**
   * Called after a refit in which the container or the canvas changed size. The backing store
   * may have been cleared, so a paused host should redraw.
   */
  onRefit: (() => void) | null = null;
  private w: number;
  private h: number;
  private sx = 1;
  private sy = 1;
  private cssW = 0;
  private cssH = 0;
  private boxW = 0;
  private boxH = 0;
  private readonly observer: ResizeObserver;
  private dprQuery: MediaQueryList | null = null;

  constructor(
    private readonly container: HTMLElement,
    width: number,
    height: number,
  ) {
    this.w = width;
    this.h = height;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'game-canvas';
    this.canvas.setAttribute('role', 'img');
    this.canvas.tabIndex = 0;
    const ctx = this.canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Canvas 2D is not supported in this browser');
    this.ctx = ctx;
    container.appendChild(this.canvas);
    this.observer = new ResizeObserver(() => this.fit());
    this.observer.observe(container);
    this.watchDpr();
    this.fit();
  }

  /** Logical width of the current run. */
  get width(): number {
    return this.w;
  }

  get height(): number {
    return this.h;
  }

  /** Backing-store pixels per logical pixel (horizontal). */
  get renderScale(): number {
    return this.sx;
  }

  /** Change the logical resolution (between runs) and refit. */
  setLogicalSize(width: number, height: number): void {
    if (width === this.w && height === this.h) return;
    this.w = width;
    this.h = height;
    this.fit();
  }

  /** CSS size of the container's content box: the area the canvas may occupy. */
  available(): LogicalSize {
    const rect = this.container.getBoundingClientRect();
    const cs = getComputedStyle(this.container);
    const px = (v: string) => parseFloat(v) || 0;
    return {
      width: Math.max(
        0,
        rect.width -
          px(cs.paddingLeft) -
          px(cs.paddingRight) -
          px(cs.borderLeftWidth) -
          px(cs.borderRightWidth),
      ),
      height: Math.max(
        0,
        rect.height -
          px(cs.paddingTop) -
          px(cs.paddingBottom) -
          px(cs.borderTopWidth) -
          px(cs.borderBottomWidth),
      ),
    };
  }

  fit(): void {
    const box = this.available();
    if (box.width < 1 || box.height < 1) return;
    const dpr = window.devicePixelRatio || 1;
    const scale = Math.min(box.width / this.w, box.height / this.h);
    // Snap the CSS size to whole device pixels so the backing store can map 1:1 onto the screen:
    // fill an axis exactly when within 2 device px of it, else keep the leftover even so the
    // centred canvas also starts on a whole device pixel.
    const snap = (logical: number, boxCss: number): number => {
      const boxDev = Math.max(1, Math.floor(boxCss * dpr));
      const dev = Math.min(boxDev, Math.max(1, Math.round(logical * scale * dpr)));
      if (boxDev - dev <= 2) return boxDev;
      return (boxDev - dev) % 2 === 0 ? dev : dev - 1;
    };
    const devW = snap(this.w, box.width);
    const devH = snap(this.h, box.height);
    const cssW = devW / dpr;
    const cssH = devH / dpr;
    // Backing pixels per logical pixel: device pixels (capped at a 2x DPR), kept within
    // [0.5, maxScale] so tiny canvases stay legible and huge ones stay affordable.
    const dprCap = Math.min(1, 2 / dpr);
    const perLogical = (devW * dprCap) / this.w;
    const k = (dprCap * Math.max(0.5, Math.min(perLogical, this.maxScale))) / perLogical;
    const bw = Math.max(1, Math.round(devW * k));
    const bh = Math.max(1, Math.round(devH * k));
    const resized =
      this.canvas.width !== bw ||
      this.canvas.height !== bh ||
      cssW !== this.cssW ||
      cssH !== this.cssH ||
      box.width !== this.boxW ||
      box.height !== this.boxH;
    this.boxW = box.width;
    this.boxH = box.height;
    if (cssW !== this.cssW || cssH !== this.cssH) {
      this.cssW = cssW;
      this.cssH = cssH;
      this.canvas.style.width = `${cssW}px`;
      this.canvas.style.height = `${cssH}px`;
    }
    if (this.canvas.width !== bw || this.canvas.height !== bh) {
      this.canvas.width = bw;
      this.canvas.height = bh;
    }
    this.sx = bw / this.w;
    this.sy = bh / this.h;
    if (resized) this.onRefit?.();
  }

  /** Reset the transform so subsequent drawing uses logical coordinates. */
  begin(): void {
    this.ctx.setTransform(this.sx, 0, 0, this.sy, 0, 0);
    this.ctx.imageSmoothingEnabled = true;
  }

  /** Map client (CSS) coordinates to logical ones; `inside` is true over the canvas. */
  toLogical = (clientX: number, clientY: number): { x: number; y: number; inside: boolean } => {
    const r = this.canvas.getBoundingClientRect();
    const x = ((clientX - r.left) / Math.max(1, r.width)) * this.w;
    const y = ((clientY - r.top) / Math.max(1, r.height)) * this.h;
    return { x, y, inside: x >= 0 && x <= this.w && y >= 0 && y <= this.h };
  };

  /** True when the client point lies on the canvas. */
  contains(clientX: number, clientY: number): boolean {
    return this.toLogical(clientX, clientY).inside;
  }

  private watchDpr(): void {
    this.dprQuery?.removeEventListener('change', this.onDprChange);
    this.dprQuery = null;
    if (typeof matchMedia !== 'function') return;
    this.dprQuery = matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
    this.dprQuery.addEventListener('change', this.onDprChange);
  }

  /** Moving the window to a screen with another pixel density doesn't resize the container. */
  private readonly onDprChange = (): void => {
    this.watchDpr();
    this.fit();
  };

  destroy(): void {
    this.observer.disconnect();
    this.dprQuery?.removeEventListener('change', this.onDprChange);
    this.dprQuery = null;
    this.onRefit = null;
    this.canvas.remove();
  }
}
