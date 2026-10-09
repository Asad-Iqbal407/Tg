/**
 * Fixed-timestep loop: simulation always advances in `fixedDt` steps (deterministic physics,
 * identical feel on 60/120/144 Hz displays) while rendering happens once per animation frame.
 */
export class GameLoop {
  private rafId = 0;
  private last = 0;
  private acc = 0;
  private running = false;
  private fpsFrames = 0;
  private fpsTime = 0;
  fps = 0;

  constructor(
    private readonly step: (dt: number) => void,
    private readonly render: (frameDt: number) => void,
    private readonly fixedDt = 1 / 60,
    private readonly maxSteps = 5,
  ) {}

  get isRunning(): boolean {
    return this.running;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    this.acc = 0;
    this.rafId = requestAnimationFrame(this.frame);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.rafId);
  }

  private readonly frame = (now: number): void => {
    if (!this.running) return;
    const frameDt = Math.min(0.25, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    this.acc += frameDt;
    let steps = 0;
    while (this.acc >= this.fixedDt && steps < this.maxSteps) {
      this.step(this.fixedDt);
      this.acc -= this.fixedDt;
      steps++;
      if (!this.running) return;
    }
    if (steps === this.maxSteps) this.acc = 0; // drop backlog instead of spiralling
    this.fpsFrames++;
    this.fpsTime += frameDt;
    if (this.fpsTime >= 0.5) {
      this.fps = Math.round(this.fpsFrames / this.fpsTime);
      this.fpsFrames = 0;
      this.fpsTime = 0;
    }
    this.render(frameDt);
    if (this.running) this.rafId = requestAnimationFrame(this.frame);
  };
}

/**
 * Letterboxed, DPI-aware canvas. Games draw in a fixed logical resolution; the viewport scales
 * the backing store so output stays crisp on high-density screens without changing game logic.
 */
export class Viewport {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  renderScale = 1;
  private readonly observer: ResizeObserver;

  constructor(
    private readonly container: HTMLElement,
    readonly width: number,
    readonly height: number,
  ) {
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
    this.fit();
  }

  fit(): void {
    const rect = this.container.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const scale = Math.min(rect.width / this.width, rect.height / this.height);
    const cssW = Math.floor(this.width * scale);
    const cssH = Math.floor(this.height * scale);
    this.canvas.style.width = `${cssW}px`;
    this.canvas.style.height = `${cssH}px`;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.renderScale = Math.max(0.5, Math.min(scale * dpr, 2.5));
    const bw = Math.round(this.width * this.renderScale);
    const bh = Math.round(this.height * this.renderScale);
    if (this.canvas.width !== bw || this.canvas.height !== bh) {
      this.canvas.width = bw;
      this.canvas.height = bh;
    }
  }

  /** Reset the transform so subsequent drawing uses logical coordinates. */
  begin(): void {
    this.ctx.setTransform(this.renderScale, 0, 0, this.renderScale, 0, 0);
    this.ctx.imageSmoothingEnabled = true;
  }

  toLogical = (clientX: number, clientY: number): { x: number; y: number } => {
    const r = this.canvas.getBoundingClientRect();
    return {
      x: ((clientX - r.left) / Math.max(1, r.width)) * this.width,
      y: ((clientY - r.top) / Math.max(1, r.height)) * this.height,
    };
  };

  destroy(): void {
    this.observer.disconnect();
    this.canvas.remove();
  }
}
