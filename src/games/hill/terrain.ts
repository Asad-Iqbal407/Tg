import { clamp, lerp } from '../../core/math';
import { hash1 } from '../draw';
import { biomeAt, BIOME_M, BIOMES } from './biomes';

export const STEP = 10;
export const PX_PER_M = 25;

const DEG = Math.PI / 180;
/** How far ahead (px) the surface steers toward the noise target. */
const LOOK = 80;
/** Largest slope change per px: keeps crests and dips rounded (radius >= ~170 px). */
const CURVATURE = 0.006;
/** The baseline offset left behind by a jump decays back to the noise over a few thousand px. */
const OFFSET_DECAY = Math.exp(-STEP / 6000);
/** Hard ceiling for the slope cap: below the static tip-over angle of every vehicle. */
const MAX_CAP_DEG = 33;
/** Gentle downhill the run-in eases into, so the car arrives at the ramp with speed. */
const RUN_IN_SLOPE = Math.tan(5 * DEG);
/** Biome cycle length in metres. */
const CYCLE_M = BIOME_M * BIOMES.length;

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

/** A jump: run-in, curved ramp up to a sharp lip, then a long landing slope and a run-out. */
export interface Kicker {
  start: number;
  ramp: number;
  /** World x of the take-off edge. */
  lip: number;
  /** End of the straight landing slope. */
  landEnd: number;
  end: number;
  /** Ramp angle at the lip and landing slope angle (radians, both positive). */
  lipAngle: number;
  landAngle: number;
  /** Slope where the run-in started. */
  s0: number;
}

export interface TerrainOptions {
  /** World x of the 0 m mark; difficulty and biomes are measured from here. */
  origin?: number;
  /** Take-off speed (px/s) that jump landings are sized for. */
  designSpeed?: number;
}

/**
 * Endless, deterministic 1-D terrain. A noise target (two octaves of value noise plus bumps) is
 * followed by a surface whose slope is capped (the cap grows slowly with distance and is lower
 * on ice) and whose curvature is limited, so every hill stays drivable. Jumps ("kickers") are
 * spliced in at seeded intervals that shrink with distance. Heights are in screen-down px, and
 * samples are generated strictly in order, so the result depends only on the seed and options.
 */
export class Terrain {
  private readonly samples: number[] = [];
  /** Every kicker generated so far, in order of x. */
  readonly kickers: Kicker[] = [];
  private readonly origin: number;
  private readonly designSpeed: number;
  private slope = 0;
  private offset = 0;
  private nextKickerX: number;
  private active: Kicker | null = null;

  constructor(
    private readonly seed: number,
    readonly baseY = 330,
    opts: TerrainOptions = {},
  ) {
    this.origin = opts.origin ?? 0;
    this.designSpeed = opts.designSpeed ?? 520;
    this.nextKickerX = this.origin + (110 + 50 * this.rand(0, 3)) * PX_PER_M;
    this.samples.push(this.target(0));
  }

  private rand(k: number, salt: number): number {
    return hash1(k * 7.13 + salt * 1.91 + this.seed * 0.0137);
  }

  private noise(x: number, salt: number): number {
    const i = Math.floor(x);
    const f = x - i;
    const a = hash1(i * 1.731 + salt + this.seed * 0.0137) * 2 - 1;
    const b = hash1((i + 1) * 1.731 + salt + this.seed * 0.0137) * 2 - 1;
    return a + (b - a) * smooth(f);
  }

  private metres(x: number): number {
    return (x - this.origin) / PX_PER_M;
  }

  /** Noise target height (before slope capping and jumps). */
  private target(x: number): number {
    const m = this.metres(x);
    const ramp = clamp((x - 250) / 900, 0, 1);
    const amp = ramp * (0.5 + Math.min(1.2, Math.max(0, m) / 2200));
    const hills =
      this.noise(x / 1100, 1) * 170 + this.noise(x / 420, 7) * 70 * Math.min(1.4, 0.6 + Math.max(0, m) / 2500);
    const bumps = this.noise(x / 95, 13) * 4 * ramp;
    return this.baseY + hills * amp + bumps;
  }

  /** Steepest allowed slope (as dy/dx) at a distance: 22° early, ~32° by 3 km, lower on ice. */
  capAt(x: number): number {
    const m = Math.max(0, this.metres(x));
    const deg = 22 + 10 * Math.min(1, m / 3000) + 2 * clamp((m - CYCLE_M) / CYCLE_M, 0, 1);
    return Math.tan(Math.min(MAX_CAP_DEG, deg * biomeAt(m).slope) * DEG);
  }

  /** 0 at the start, 1 by 3 km, up to 1.5 on later laps: drives jump size and frequency. */
  private difficulty(m: number): number {
    return Math.min(1, m / 3000) + 0.5 * clamp((m - CYCLE_M) / CYCLE_M, 0, 1);
  }

  private planKicker(x: number): Kicker {
    const k = this.kickers.length;
    const m = this.metres(x);
    const d = this.difficulty(m);
    // Jumps get steeper faster than the slope cap grows, so a full turn fits in the air by about
    // 2 km. A short ramp keeps launch speed (a long climb would bleed it); the landing drops away.
    const j = clamp(m / 1800, 0, 1) + clamp((m - 2 * CYCLE_M) / CYCLE_M, 0, 0.5);
    const lipDeg = 27 + 7 * j + (this.rand(k, 1) - 0.5) * 4;
    const lipAngle = lipDeg * DEG;
    const landAngle = (30 + 4 * j) * DEG;
    const runIn = 200 + 100 * this.rand(k, 2);
    const rampLen = 50 + 40 * this.rand(k, 3);
    // Size the landing for the design speed: flight time on a slope falling away at landAngle.
    const g = 980 * Math.max(0.7, biomeAt(m).gravity);
    const v = this.designSpeed;
    const t = (2 * v * (Math.sin(lipAngle) + Math.cos(lipAngle) * Math.tan(landAngle))) / g;
    const landLen = clamp(v * Math.cos(lipAngle) * t * 1.15 + 60, 260, 900);
    const start = x;
    const ramp = start + runIn;
    const lip = ramp + rampLen;
    const landEnd = lip + landLen;
    const end = landEnd + 280;
    const spacing = lerp(320, 190, Math.min(1, d)) - 30 * Math.max(0, d - 1) + 110 * this.rand(k, 4);
    this.nextKickerX = end + spacing * PX_PER_M;
    const kicker: Kicker = { start, ramp, lip, landEnd, end, lipAngle, landAngle, s0: this.slope };
    this.kickers.push(kicker);
    return kicker;
  }

  private kickerSlope(k: Kicker, x: number): number {
    if (x < k.ramp) return lerp(k.s0, RUN_IN_SLOPE, smooth((x - k.start) / (k.ramp - k.start)));
    if (x < k.lip) return lerp(RUN_IN_SLOPE, -Math.tan(k.lipAngle), (x - k.ramp) / (k.lip - k.ramp));
    const land = Math.tan(k.landAngle);
    if (x < k.landEnd) return land;
    return lerp(land, 0, smooth((x - k.landEnd) / (k.end - k.landEnd)));
  }

  private generate(i: number): number {
    const prev = this.samples[i - 1] as number;
    const x = i * STEP;
    const mid = x - STEP / 2;
    if (!this.active && x >= this.nextKickerX && Math.abs(this.slope) < Math.tan(12 * DEG))
      this.active = this.planKicker(x - STEP);
    let s: number;
    const k = this.active;
    if (k && mid < k.end) {
      s = this.kickerSlope(k, mid);
    } else {
      if (k) {
        // Continue from wherever the jump left the surface; the offset fades back to the noise.
        this.active = null;
        this.offset = prev - this.target(x - STEP);
      }
      const want = (this.target(x + LOOK) + this.offset - prev) / (STEP + LOOK);
      const cap = this.capAt(x);
      s = clamp(clamp(want, this.slope - CURVATURE * STEP, this.slope + CURVATURE * STEP), -cap, cap * 1.15);
      this.offset *= OFFSET_DECAY;
    }
    this.slope = s;
    return prev + s * STEP;
  }

  private ensure(index: number): void {
    while (this.samples.length <= index + 1) this.samples.push(this.generate(this.samples.length));
  }

  /** Generate the terrain (and its kickers) at least up to world x. */
  ensureTo(x: number): void {
    this.ensure(Math.ceil(Math.max(0, x) / STEP));
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
    const out = { px: x, py: 0, d: Infinity, nx: 0, ny: -1 };
    this.closestInto(x, y, r, out);
    return out;
  }

  /** Allocation-free `closest()` for the physics hot loop. */
  closestInto(
    x: number,
    y: number,
    r: number,
    out: { px: number; py: number; d: number; nx: number; ny: number },
  ): void {
    const i0 = Math.max(0, Math.floor((x - r) / STEP));
    const i1 = Math.floor((x + r) / STEP);
    this.ensure(i1 + 1);
    out.px = x;
    out.py = this.heightAt(x);
    out.d = Infinity;
    out.nx = 0;
    out.ny = -1;
    for (let i = i0; i <= i1; i++) {
      const ax = i * STEP;
      const ay = this.samples[i] as number;
      const dy = (this.samples[i + 1] as number) - ay;
      const t = clamp(((x - ax) * STEP + (y - ay) * dy) / (STEP * STEP + dy * dy), 0, 1);
      const px = ax + STEP * t;
      const py = ay + dy * t;
      const d = Math.hypot(x - px, y - py);
      if (d < out.d) {
        // Outward normal of this segment (pointing up out of the ground).
        const len = Math.hypot(STEP, dy);
        out.px = px;
        out.py = py;
        out.d = d;
        out.nx = dy / len;
        out.ny = -STEP / len;
      }
    }
  }

  slopeAt(x: number): number {
    return (this.heightAt(x + 4) - this.heightAt(x - 4)) / 8;
  }

  /** The kicker whose ramp-to-landing span contains x, if any. */
  kickerAt(x: number): Kicker | null {
    for (let i = this.kickers.length - 1; i >= 0; i--) {
      const k = this.kickers[i] as Kicker;
      if (x >= k.start && x <= k.end) return k;
      if (k.end < x) break;
    }
    return null;
  }
}
