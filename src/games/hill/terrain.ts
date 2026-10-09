import { hash1 } from '../draw';

export const STEP = 10;
export const PX_PER_M = 25;

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

/** Endless, deterministic 1-D terrain built from octaves of value noise. Heights are in screen-down px. */
export class Terrain {
  private readonly samples: number[] = [];

  constructor(
    private readonly seed: number,
    readonly baseY = 330,
  ) {}

  private noise(x: number, salt: number): number {
    const i = Math.floor(x);
    const f = x - i;
    const a = hash1(i * 1.731 + salt + this.seed * 0.0137) * 2 - 1;
    const b = hash1((i + 1) * 1.731 + salt + this.seed * 0.0137) * 2 - 1;
    return a + (b - a) * smooth(f);
  }

  /** Raw analytic height; samples cache this at STEP resolution. */
  private compute(x: number): number {
    const m = x / PX_PER_M;
    const ramp = Math.min(1, Math.max(0, (x - 250) / 900));
    const amp = ramp * (0.45 + Math.min(1.3, m / 2200));
    const hills = this.noise(x / 1100, 1) * 170 + this.noise(x / 420, 7) * 70 * Math.min(1.4, 0.6 + m / 2500);
    const bumps = this.noise(x / 95, 13) * 9 * ramp;
    return this.baseY + hills * amp + bumps;
  }

  private ensure(index: number): void {
    while (this.samples.length <= index + 1) this.samples.push(this.compute(this.samples.length * STEP));
  }

  heightAt(x: number): number {
    const xi = Math.max(0, x) / STEP;
    const i = Math.floor(xi);
    this.ensure(i);
    const a = this.samples[i] as number;
    const b = this.samples[i + 1] as number;
    return a + (b - a) * (xi - i);
  }

  /** Point on the terrain polyline nearest to (x, y), searching within ±r horizontally. */
  closest(x: number, y: number, r: number): { px: number; py: number; d: number; nx: number; ny: number } {
    const i0 = Math.max(0, Math.floor((x - r) / STEP));
    const i1 = Math.floor((x + r) / STEP);
    this.ensure(i1 + 1);
    let best = { px: x, py: this.heightAt(x), d: Infinity, nx: 0, ny: -1 };
    for (let i = i0; i <= i1; i++) {
      const ax = i * STEP;
      const ay = this.samples[i] as number;
      const bx = ax + STEP;
      const by = this.samples[i + 1] as number;
      const dx = bx - ax;
      const dy = by - ay;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
      const px = ax + dx * t;
      const py = ay + dy * t;
      const d = Math.hypot(x - px, y - py);
      if (d < best.d) {
        // Outward normal of this segment (pointing up out of the ground).
        const len = Math.hypot(dx, dy);
        best = { px, py, d, nx: dy / len, ny: -dx / len };
      }
    }
    return best;
  }

  slopeAt(x: number): number {
    return (this.heightAt(x + 4) - this.heightAt(x - 4)) / 8;
  }
}
