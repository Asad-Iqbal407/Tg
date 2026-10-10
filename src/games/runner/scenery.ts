import { TAU } from '../../core/math';
import { Rng } from '../../core/rng';
import { type Camera, NEAR } from './camera';
import { type Look, ZONES } from './palette';
import { createSurface, type GlowSprites, rand, resolutionOf, type Surface } from './surface';

/**
 * The world around the track: cached sky and skyline, ballast, sleepers and shaded rails, and
 * near scenery streaming past (building facades with lit windows, walls, lamps, stations, tunnels
 * and bridges). Everything is a pure function of world z, so it never touches the gameplay RNG.
 *
 * Draw order: sky → ground/track → horizon haze → side scenery (far → near) → [sorted world objects].
 * Side scenery lives outside |x| = TRACK_HW (or above the camera), so it can never hide anything
 * on the track and needs no depth sorting against obstacles.
 */

export const SEG = 20;
export type EnvKind = 'city' | 'station' | 'tunnel' | 'bridge';

export const TRACK_HW = 4.4;
const WALL_X = 5.2;
const WALL_H = 1.8;
const BUILD_X = 7.6;
const BUILD_DEPTH = 10;
const LOT = 12;
const TUNNEL_H = 10.8;
const TUNNEL_SHOULDER = 9.2;
const TUNNEL_TOP_HW = 3.6;
const PLATFORM_X = 4.5;
const PLATFORM_H = 1.0;
const CANOPY_X = 4.8;
const CANOPY_Y = 6.2;
const WATER_Y = -28;
export const GANTRY_EVERY = 40;
/** Overhead structures sit above the highest camera (8.4 m + roof lift) so they never cross the track ahead. */
const GANTRY_Y = 11;
const WIRE_Y = 10.4;
const SKY_MARGIN = 24;
const SKY_BELOW = 70;

/** Per-frame drawing state shared by the scenery and prop renderers. */
export interface View {
  ctx: CanvasRenderingContext2D;
  cam: Camera;
  look: Look;
  /** Runner's world z (track distance). */
  dist: number;
  /** Visible track length ahead. */
  far: number;
  time: number;
  speed: number;
  reducedMotion: boolean;
  glow: GlowSprites;
}

/**
 * Environment segment kind at segment index `seg` (SEG metres each). Runs depart from a station,
 * reach a first tunnel at 400 m, and then every 600 m block holds one tunnel, bridge or station.
 */
export function envAt(seg: number): EnvKind {
  if (seg < 5) return 'station';
  if (seg < 30) return seg >= 20 && seg < 27 ? 'tunnel' : 'city';
  const block = Math.floor(seg / 30);
  const r = rand(block, 1);
  const kind: EnvKind = r < 0.42 ? 'tunnel' : r < 0.72 ? 'bridge' : 'station';
  const len =
    kind === 'tunnel'
      ? 6 + Math.floor(rand(block, 2) * 4)
      : kind === 'bridge'
        ? 5 + Math.floor(rand(block, 3) * 3)
        : 5;
  const start = block * 30 + 4 + Math.floor(rand(block, 4) * (22 - len));
  return seg >= start && seg < start + len ? kind : 'city';
}

export const envAtZ = (zw: number): EnvKind => envAt(Math.floor(zw / SEG));

/** Whether a catenary gantry stands at world z (open city stretches only). */
export function gantryAt(zw: number): boolean {
  return envAtZ(zw) === 'city' && envAtZ(zw + GANTRY_EVERY) !== 'tunnel';
}

export class Scenery {
  private readonly skies = new Map<number, Surface>();
  private skyRes = 0;
  private groundGrad: CanvasGradient | null = null;
  private groundKey = -1;
  private hazeGrad: CanvasGradient | null = null;
  private hazeKey = -1;
  /** Env kinds of the visible segments, refreshed once per frame. */
  private readonly kinds: EnvKind[] = [];
  private firstSeg = 0;
  private lastSeg = 0;

  constructor(
    private readonly W: number,
    private readonly H: number,
    private readonly unit: number,
    /** Horizon y the sky cache is built for (the camera's widest framing). */
    private readonly skyHz: number,
  ) {}

  /** Refresh the per-frame segment table; call once before the draw passes. */
  begin(v: View): void {
    this.firstSeg = Math.floor((v.dist + NEAR) / SEG);
    this.lastSeg = Math.floor((v.dist + v.far) / SEG);
    this.kinds.length = 0;
    for (let s = this.firstSeg; s <= this.lastSeg; s++) this.kinds.push(envAt(s));
  }

  private kindOf(seg: number): EnvKind {
    return this.kinds[seg - this.firstSeg] ?? envAt(seg);
  }

  /** Whether the runner is inside a tunnel (dims the sky-lit effects). */
  inTunnel(dist: number): boolean {
    return envAtZ(dist) === 'tunnel';
  }

  // ---------------------------------------------------------------- sky

  drawSky(v: View): void {
    const { ctx, cam, look } = v;
    const res = resolutionOf(ctx);
    if (res !== this.skyRes) {
      this.skies.clear();
      this.skyRes = res;
    }
    const blending = look.from !== look.to && look.t < 1;
    const b = this.sky(look.to);
    const a = blending ? this.sky(look.from) : null;
    for (const key of this.skies.keys()) if (key !== look.to && key !== look.from) this.skies.delete(key);
    const oy = Math.round(cam.hz - this.skyHz);
    if (!b) {
      const g = ctx.createLinearGradient(0, 0, 0, cam.hz);
      const zone = ZONES[look.to]!;
      g.addColorStop(0, zone.skyTop);
      g.addColorStop(0.55, zone.skyMid);
      g.addColorStop(1, zone.skyLow);
      ctx.fillStyle = g;
      ctx.fillRect(-20, -20, this.W + 40, cam.hz + 24);
      return;
    }
    if (oy > 0) {
      ctx.fillStyle = ZONES[look.to]!.skyTop;
      ctx.fillRect(-20, -20, this.W + 40, oy + 21);
    }
    const w = this.W + 2 * SKY_MARGIN;
    const h = this.skyHz + SKY_BELOW;
    const x = -SKY_MARGIN - cam.x * 2.5 * this.unit;
    if (a) {
      ctx.drawImage(a, x, oy, w, h);
      ctx.globalAlpha = look.t;
      ctx.drawImage(b, x, oy, w, h);
      ctx.globalAlpha = 1;
    } else ctx.drawImage(b, x, oy, w, h);
  }

  private sky(idx: number): Surface | null {
    const hit = this.skies.get(idx);
    if (hit) return hit;
    const built = this.buildSky(idx);
    if (built) this.skies.set(idx, built);
    return built;
  }

  /** Bake gradient, stars, sun or moon, clouds and a two-layer skyline into one surface. */
  private buildSky(idx: number): Surface | null {
    const zone = ZONES[idx]!;
    const u = this.unit;
    const w = this.W + 2 * SKY_MARGIN;
    const hz = this.skyHz;
    const h = hz + SKY_BELOW;
    const res = this.skyRes || 1;
    const made = createSurface(Math.ceil(w * res), Math.ceil(h * res));
    if (!made) return null;
    const c = made.ctx;
    c.scale(res, res);
    const rng = new Rng(4242 + idx * 977);
    const g = c.createLinearGradient(0, 0, 0, hz);
    g.addColorStop(0, zone.skyTop);
    g.addColorStop(0.55, zone.skyMid);
    g.addColorStop(1, zone.skyLow);
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);
    // Stars
    c.fillStyle = '#ffffff';
    const stars = Math.round(220 * zone.stars * (w / 540));
    for (let i = 0; i < stars; i++) {
      c.globalAlpha = rng.range(0.25, 0.95);
      const sz = rng.chance(0.1) ? 2.2 : 1.3;
      c.fillRect(rng.range(0, w), rng.range(0, hz * 0.72), sz * u, sz * u);
    }
    c.globalAlpha = 1;
    // Sun or moon, a little right of centre so it shows between the facades.
    const sx = w / 2 + 110 * u;
    const sy = hz - (zone.moon ? 150 : 62) * u;
    const glowR = (zone.moon ? 120 : 190) * u;
    const glow = c.createRadialGradient(sx, sy, 0, sx, sy, glowR);
    glow.addColorStop(0, zone.moon ? 'rgba(200,215,255,0.45)' : 'rgba(255,236,190,0.95)');
    glow.addColorStop(0.25, zone.moon ? 'rgba(160,170,255,0.18)' : 'rgba(255,170,110,0.5)');
    glow.addColorStop(1, 'rgba(255,120,90,0)');
    c.fillStyle = glow;
    c.fillRect(sx - glowR, sy - glowR, glowR * 2, glowR * 2);
    c.fillStyle = zone.sun;
    c.beginPath();
    c.arc(sx, sy, (zone.moon ? 24 : 40) * u, 0, TAU);
    c.fill();
    if (zone.moon) {
      c.fillStyle = 'rgba(120,130,180,0.35)';
      c.beginPath();
      c.arc(sx - 7 * u, sy - 5 * u, 6 * u, 0, TAU);
      c.arc(sx + 8 * u, sy + 6 * u, 4 * u, 0, TAU);
      c.fill();
    } else {
      // Sunset bands across the disc.
      c.fillStyle = zone.skyLow;
      for (let i = 0; i < 3; i++) c.fillRect(sx - 44 * u, sy + (10 + i * 10) * u, 88 * u, (2 + i * 1.5) * u);
    }
    // Clouds
    if (!zone.moon) {
      for (let i = 0; i < 7; i++) {
        const cx = rng.range(0, w);
        const cy = rng.range(hz * 0.25, hz * 0.8);
        const cw = rng.range(60, 160) * u;
        c.globalAlpha = rng.range(0.12, 0.28);
        c.fillStyle = idx === 3 ? '#ffffff' : '#ffc0b0';
        c.beginPath();
        c.ellipse(cx, cy, cw, cw * 0.12, 0, 0, TAU);
        c.ellipse(cx + cw * 0.3, cy - cw * 0.07, cw * 0.5, cw * 0.1, 0, 0, TAU);
        c.fill();
      }
      c.globalAlpha = 1;
    }
    // Far skyline (no windows), then near skyline with lit windows and antenna lights.
    for (let layer = 0; layer < 2; layer++) {
      c.fillStyle = layer === 0 ? zone.skylineFar : zone.skylineNear;
      let x = -10;
      while (x < w + 10) {
        const bw = rng.range(22, 64) * u;
        const bh = (layer === 0 ? rng.range(40, 120) : rng.range(26, 150)) * u;
        c.fillRect(x, hz - bh, bw + 0.5, bh + SKY_BELOW);
        if (layer === 1) {
          if (rng.chance(0.3)) {
            c.fillRect(x + bw * 0.45, hz - bh - 16 * u, 2 * u, 16 * u);
            c.fillStyle = '#ff4d4d';
            c.fillRect(x + bw * 0.45 - u, hz - bh - 18 * u, 4 * u, 3 * u);
            c.fillStyle = zone.skylineNear;
          }
          c.fillStyle = zone.windowLit;
          c.globalAlpha = 0.65;
          for (let wy = hz - bh + 7 * u; wy < hz - 5 * u; wy += 9 * u)
            for (let wx = 4 * u; wx < bw - 5 * u; wx += 7 * u)
              if (rng.next() < zone.lit * 0.8) c.fillRect(x + wx, wy, 3 * u, 4 * u);
          c.globalAlpha = 1;
          c.fillStyle = zone.skylineNear;
        }
        x += bw + rng.range(-4, 8) * u;
      }
    }
    return made.surface;
  }

  // ---------------------------------------------------------------- ground & track

  drawGround(v: View): void {
    const { ctx, cam, look, dist, far } = v;
    const key = Math.round(cam.hz) * 4096 + look.version;
    if (!this.groundGrad || key !== this.groundKey) {
      const g = ctx.createLinearGradient(0, cam.hz, 0, this.H);
      g.addColorStop(0, look.groundFar);
      g.addColorStop(0.3, look.ground);
      g.addColorStop(1, look.ground);
      this.groundGrad = g;
      this.groundKey = key;
    }
    ctx.fillStyle = this.groundGrad;
    ctx.fillRect(-20, cam.hz, this.W + 40, this.H - cam.hz + 40);

    let water = false;
    for (const k of this.kinds) if (k === 'bridge') water = true;
    if (water) this.drawWater(v);

    // Shoulders and sidewalks, batched per colour.
    ctx.fillStyle = look.bed;
    ctx.beginPath();
    for (let seg = this.firstSeg; seg <= this.lastSeg; seg++) {
      const kind = this.kindOf(seg);
      const z0 = Math.max(NEAR, seg * SEG - dist);
      const z1 = Math.min(far, seg * SEG + SEG - dist);
      if (z1 <= z0) continue;
      const outer = kind === 'bridge' ? 4.75 : WALL_X;
      cam.flat(ctx, -outer, -TRACK_HW, 0, z0, z1);
      cam.flat(ctx, TRACK_HW, outer, 0, z0, z1);
    }
    ctx.fill();
    ctx.fillStyle = look.sidewalk;
    ctx.beginPath();
    for (let seg = this.firstSeg; seg <= this.lastSeg; seg++) {
      const kind = this.kindOf(seg);
      if (kind === 'bridge' || kind === 'tunnel') continue;
      const z0 = Math.max(NEAR, seg * SEG - dist);
      const z1 = Math.min(far, seg * SEG + SEG - dist);
      if (z1 <= z0) continue;
      const outer = water ? 240 : BUILD_X;
      cam.flat(ctx, -outer, -WALL_X, 0, z0, z1);
      cam.flat(ctx, WALL_X, outer, 0, z0, z1);
    }
    ctx.fill();

    this.drawTrack(v);
  }

  private drawWater(v: View): void {
    const { ctx, cam, look, dist, far } = v;
    for (let seg = this.lastSeg; seg >= this.firstSeg; seg--) {
      if (this.kindOf(seg) !== 'bridge' || this.kindOf(seg + 1) === 'bridge') continue;
      // `seg` is the far end of a bridge run; find its start.
      let start = seg;
      while (this.kindOf(start - 1) === 'bridge' && start - 1 >= this.firstSeg - 8) start--;
      const z0 = start * SEG - dist;
      const z1 = Math.min(far + 40, seg * SEG + SEG - dist);
      const zn = Math.max(NEAR, z0);
      if (z1 <= zn) continue;
      ctx.fillStyle = look.tunnelDark;
      if (z1 < far) {
        ctx.beginPath();
        cam.front(ctx, -400, -4.6, WATER_Y, 0, z1);
        cam.front(ctx, 4.6, 400, WATER_Y, 0, z1);
        ctx.fill();
      }
      ctx.fillStyle = look.water;
      ctx.beginPath();
      cam.flat(ctx, -600, -4.6, WATER_Y, zn, z1);
      cam.flat(ctx, 4.6, 600, WATER_Y, zn, z1);
      ctx.fill();
      // Glints drift with distance so the water reads as moving.
      ctx.fillStyle = look.waterHi;
      ctx.beginPath();
      for (let i = 0; i < 26; i++) {
        const gz = z0 + ((rand(i, 7) * (z1 - z0) - dist * 0.15 + 1000) % Math.max(1, z1 - z0));
        if (gz < zn) continue;
        const gx = (rand(i, 9) > 0.5 ? 1 : -1) * (8 + rand(i, 8) * 60);
        cam.flat(ctx, gx, gx + 3 + rand(i, 5) * 6, WATER_Y, gz, gz + 0.6);
      }
      ctx.fill();
      if (z0 > NEAR) {
        ctx.fillStyle = look.tunnelDark;
        ctx.beginPath();
        cam.front(ctx, -400, -4.6, WATER_Y, 0, z0);
        cam.front(ctx, 4.6, 400, WATER_Y, 0, z0);
        ctx.fill();
      }
    }
  }

  private drawTrack(v: View): void {
    const { ctx, cam, look, dist, far } = v;
    ctx.fillStyle = look.ballast;
    ctx.beginPath();
    cam.flat(ctx, -TRACK_HW, TRACK_HW, 0, NEAR, far);
    ctx.fill();
    ctx.fillStyle = look.bed;
    ctx.beginPath();
    for (let lane = -1; lane <= 1; lane++) cam.flat(ctx, lane * 2.4 - 1.3, lane * 2.4 + 1.3, 0, NEAR, far);
    ctx.fill();
    // Sleepers, stretched along z at speed as a cheap motion blur.
    const zMax = Math.min(far, 80);
    const len = 0.42 + (v.reducedMotion ? 0 : Math.max(0, v.speed - 14) * 0.022);
    const off = dist % 1.6;
    ctx.fillStyle = look.sleeper;
    ctx.beginPath();
    for (let z = NEAR - off; z < zMax; z += 1.6) {
      const z0 = Math.max(NEAR, z);
      const z1 = z + len;
      if (z1 <= z0) continue;
      for (let lane = -1; lane <= 1; lane++)
        cam.flat(ctx, lane * 2.4 - 1.12, lane * 2.4 + 1.12, 0.03, z0, z1);
    }
    ctx.fill();
    // Rails: a shadow on the ballast, a dark web facing the camera axis, a steel head with a
    // polished highlight, all fading out with distance instead of converging into a bright spike.
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.beginPath();
    for (let lane = -1; lane <= 1; lane++) {
      for (let r = -1; r <= 1; r += 2) {
        const x = lane * 2.4 + r * 0.72;
        cam.flat(ctx, x - 0.13, x + 0.13, 0.035, NEAR, far);
      }
    }
    ctx.fill();
    ctx.fillStyle = look.railSide;
    ctx.beginPath();
    for (let lane = -1; lane <= 1; lane++) {
      for (let r = -1; r <= 1; r += 2) {
        const x = lane * 2.4 + r * 0.72;
        const face = x > cam.x ? x - 0.04 : x + 0.04;
        cam.side(ctx, face, 0, 0.17, NEAR, far);
      }
    }
    ctx.fill();
    for (let pass = 0; pass < 2; pass++) {
      const z0 = pass === 0 ? NEAR : 45;
      const z1 = pass === 0 ? 45 : far;
      ctx.globalAlpha = pass === 0 ? 1 : 0.6;
      ctx.fillStyle = look.rail;
      ctx.beginPath();
      for (let lane = -1; lane <= 1; lane++) {
        for (let r = -1; r <= 1; r += 2) {
          const x = lane * 2.4 + r * 0.72;
          cam.flat(ctx, x - 0.04, x + 0.04, 0.17, z0, z1);
        }
      }
      ctx.fill();
      if (pass === 0) {
        ctx.fillStyle = look.railHi;
        ctx.beginPath();
        for (let lane = -1; lane <= 1; lane++) {
          for (let r = -1; r <= 1; r += 2) {
            const x = lane * 2.4 + r * 0.72;
            cam.flat(ctx, x - 0.015, x + 0.015, 0.171, z0, z1);
          }
        }
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    // Tunnels: darker track.
    let any = false;
    for (let seg = this.firstSeg; seg <= this.lastSeg; seg++) {
      if (this.kindOf(seg) !== 'tunnel') continue;
      const z0 = Math.max(NEAR, seg * SEG - dist);
      const z1 = Math.min(far, seg * SEG + SEG - dist);
      if (z1 <= z0) continue;
      if (!any) {
        ctx.fillStyle = 'rgba(8,6,20,0.38)';
        ctx.beginPath();
        any = true;
      }
      cam.flat(ctx, -WALL_X, WALL_X, 0.18, z0, z1);
    }
    if (any) ctx.fill();
  }

  // ---------------------------------------------------------------- side scenery

  drawSides(v: View): void {
    this.drawBuildings(v);
    this.drawLamps(v);
    for (let seg = this.lastSeg; seg >= this.firstSeg; seg--) {
      const kind = this.kindOf(seg);
      const z0w = seg * SEG;
      const z0 = z0w - v.dist;
      const z1 = Math.min(v.far + 20, z0 + SEG);
      if (z1 <= NEAR) continue;
      if (kind === 'city') this.drawWalls(v, seg, z0, z1);
      else if (kind === 'station') this.drawStation(v, seg, z0, z1);
      else if (kind === 'tunnel') this.drawTunnel(v, seg, z0, z1);
      else this.drawBridge(v, z0, z1);
    }
  }

  private lotBlocked(z0w: number, z1w: number): boolean {
    const a = envAtZ(z0w);
    const b = envAtZ(z1w - 0.01);
    return a === 'tunnel' || a === 'bridge' || b === 'tunnel' || b === 'bridge';
  }

  private drawBuildings(v: View): void {
    const first = Math.floor((v.dist + NEAR) / LOT);
    const last = Math.floor((v.dist + v.far) / LOT);
    for (let j = last; j >= first; j--) {
      if (this.lotBlocked(j * LOT, j * LOT + LOT)) continue;
      this.drawBuilding(v, j, -1);
      this.drawBuilding(v, j, 1);
    }
  }

  private drawBuilding(v: View, j: number, side: number): void {
    const { ctx, cam, look, dist } = v;
    const sk = side > 0 ? 1 : 2;
    const alley = rand(j, 10 + sk) > 0.74 ? 3 + rand(j, 12 + sk) * 2 : 0;
    const z0w = j * LOT + alley;
    const z1w = j * LOT + LOT;
    const z0 = z0w - dist;
    const z1 = Math.min(z1w - dist, v.far + 30);
    if (z1 <= NEAR + 0.05 || z0 > v.far) return;
    const rh = rand(j, 20 + sk);
    const h = 9 + 17 * rh * rh;
    const ci = Math.floor(rand(j, 30 + sk) * 4);
    const x = side * BUILD_X;
    const xo = side * (BUILD_X + BUILD_DEPTH);
    const zn = Math.max(z0, NEAR);
    const fogA = z0 > v.far - 30 ? Math.max(0, (v.far - z0) / 30) : 1;
    ctx.globalAlpha = fogA;
    // End face toward the camera, roof when seen from above, then the facade along the track.
    if (z0 > NEAR) {
      ctx.fillStyle = look.buildingEnd[ci]!;
      ctx.beginPath();
      cam.front(ctx, Math.min(x, xo), Math.max(x, xo), 0, h, z0);
      ctx.fill();
    }
    if (h < cam.h) {
      ctx.fillStyle = look.buildingTrim[ci]!;
      ctx.beginPath();
      cam.flat(ctx, Math.min(x, xo), Math.max(x, xo), h, zn, z1);
      ctx.fill();
    }
    ctx.fillStyle = look.buildingFace[ci]!;
    ctx.beginPath();
    cam.side(ctx, x, 0, h, zn, z1);
    ctx.fill();
    ctx.fillStyle = look.buildingTrim[ci]!;
    ctx.beginPath();
    cam.side(ctx, x, h - 0.5, h, zn, z1);
    cam.side(ctx, x, 3.2, 3.45, zn, z1);
    ctx.fill();

    const s0 = cam.scale(Math.max(z0, NEAR));
    // Windows: one dark pass, then lit ones on top, each a single path.
    const cs = 2.2 + 0.7 * rand(j, 40 + sk);
    const ww = cs * 0.55;
    if (s0 * ww > 1.6) {
      const seed = j * 7 + sk;
      for (let pass = 0; pass < 2; pass++) {
        ctx.fillStyle = pass === 0 ? look.windowDark : look.windowLit;
        ctx.beginPath();
        for (let zw = z0w + 0.9; zw + ww < z1w - 0.5; zw += cs) {
          const za = zw - dist;
          if (za < NEAR) continue;
          if (za > v.far) break;
          const sa = cam.scale(za);
          const sb = cam.scale(za + ww);
          const xa = cam.sx(x, sa);
          const xb = cam.sx(x, sb);
          const col = Math.round((zw - z0w) / cs);
          for (let row = 0, y = 4.2; y + 1.7 < h - 0.9; row++, y += 3.1) {
            const lit = rand(seed * 131 + col, row) < look.lit;
            if (lit !== (pass === 1)) continue;
            ctx.moveTo(xa, cam.sy(y, sa));
            ctx.lineTo(xb, cam.sy(y, sb));
            ctx.lineTo(xb, cam.sy(y + 1.7, sb));
            ctx.lineTo(xa, cam.sy(y + 1.7, sa));
            ctx.closePath();
          }
        }
        if (z0 > NEAR) {
          // Windows on the end face (screen-aligned rectangles).
          for (let k = 0; k < 4; k++) {
            const wx = BUILD_X + 1 + k * 2.3;
            for (let row = 0, y = 4.2; y + 1.7 < h - 0.9; row++, y += 3.1) {
              const lit = rand(seed * 977 + k, row) < look.lit;
              if (lit !== (pass === 1)) continue;
              cam.front(ctx, side > 0 ? wx : -wx - 1.2, side > 0 ? wx + 1.2 : -wx, y, y + 1.7, z0);
            }
          }
        }
        ctx.fill();
      }
      // Shop fronts at street level with a coloured awning.
      if (rand(j, 50 + sk) > 0.3) {
        ctx.fillStyle = look.windowLit;
        ctx.globalAlpha = fogA * 0.5;
        ctx.beginPath();
        cam.side(ctx, x, 0.4, 2.6, Math.max(NEAR, z0 + 0.6), z1 - 0.6);
        ctx.fill();
        ctx.globalAlpha = fogA;
        ctx.fillStyle = look.neon[Math.floor(rand(j, 60 + sk) * 3)]!;
        ctx.beginPath();
        cam.sideTrap(ctx, x, Math.max(NEAR, z0 + 0.4), 2.6, 3.1, z1 - 0.4, 2.6, 3.1);
        ctx.fill();
      }
    }
    // Neon blade sign sticking out toward the track.
    if (z0 > NEAR + 1 && rand(j, 70 + sk) > 0.55) {
      const zs = z0 + 1.2;
      const xi = side * 6.5;
      const color = look.neon[Math.floor(rand(j, 80 + sk) * 3)]!;
      const top = Math.min(h - 1, 9.5);
      ctx.fillStyle = color;
      ctx.globalAlpha = fogA * 0.22;
      ctx.beginPath();
      cam.front(ctx, Math.min(xi, x) - 0.5, Math.max(xi, x) + 0.5, 3.4, top + 0.6, zs);
      ctx.fill();
      ctx.globalAlpha = fogA;
      ctx.beginPath();
      cam.front(ctx, Math.min(xi, x), Math.max(xi, x), 4, top, zs);
      ctx.fill();
      ctx.fillStyle = 'rgba(10,6,24,0.75)';
      ctx.beginPath();
      cam.front(ctx, Math.min(xi, x) + 0.14, Math.max(xi, x) - 0.14, 4.14, top - 0.14, zs);
      ctx.fill();
      ctx.fillStyle = color;
      ctx.beginPath();
      const step = (top - 4.6) / 3;
      for (let k = 0; k < 3; k++) {
        const y = 4.5 + k * step;
        cam.front(ctx, Math.min(xi, x) + 0.3, Math.max(xi, x) - 0.3, y, y + step * 0.55, zs);
      }
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  private drawLamps(v: View): void {
    const { ctx, cam, dist, far } = v;
    const first = Math.ceil((dist + NEAR - 6) / 24);
    const last = Math.floor((dist + far - 6) / 24);
    ctx.fillStyle = '#20182e';
    ctx.beginPath();
    for (let k = last; k >= first; k--) {
      const zw = k * 24 + 6;
      if (envAtZ(zw) !== 'city') continue;
      const z = zw - dist;
      if (z < NEAR + 0.3) continue;
      for (let side = -1; side <= 1; side += 2) {
        cam.front(ctx, side * 6.3 - 0.09, side * 6.3 + 0.09, 0, 5.8, z);
        cam.front(ctx, Math.min(side * 5.5, side * 6.3), Math.max(side * 5.5, side * 6.3), 5.7, 5.85, z);
      }
    }
    ctx.fill();
    for (let k = last; k >= first; k--) {
      const zw = k * 24 + 6;
      if (envAtZ(zw) !== 'city') continue;
      const z = zw - dist;
      if (z < NEAR + 0.3) continue;
      for (let side = -1; side <= 1; side += 2) {
        cam.project(side * 5.58, 5.55, z);
        v.glow.draw(ctx, cam.px, cam.py, 1.1 * cam.ps, '255,226,160');
      }
    }
    ctx.fillStyle = '#fff1c4';
    ctx.beginPath();
    for (let k = last; k >= first; k--) {
      const zw = k * 24 + 6;
      if (envAtZ(zw) !== 'city') continue;
      const z = zw - dist;
      if (z < NEAR + 0.3) continue;
      for (let side = -1; side <= 1; side += 2)
        cam.front(ctx, Math.min(side * 5.4, side * 5.75), Math.max(side * 5.4, side * 5.75), 5.5, 5.7, z);
    }
    ctx.fill();
  }

  private drawWalls(v: View, seg: number, z0: number, z1: number): void {
    const { ctx, cam, look } = v;
    const zn = Math.max(NEAR, z0);
    const zm = z0 + SEG / 2;
    // Two panels per segment in alternating shades so the walls visibly stream past.
    for (let half = 0; half < 2; half++) {
      const a = half === 0 ? zn : Math.max(NEAR, zm);
      const b = half === 0 ? Math.min(zm, z1) : z1;
      if (b <= a) continue;
      ctx.fillStyle = (seg + half) % 2 === 0 ? look.wall : look.wallDark;
      ctx.beginPath();
      cam.side(ctx, -WALL_X, 0, WALL_H, a, b);
      cam.side(ctx, WALL_X, 0, WALL_H, a, b);
      ctx.fill();
    }
    ctx.fillStyle = look.wallTop;
    ctx.beginPath();
    cam.flat(ctx, -WALL_X - 0.35, -WALL_X, WALL_H, zn, z1);
    cam.flat(ctx, WALL_X, WALL_X + 0.35, WALL_H, zn, z1);
    ctx.fill();
    // Graffiti tags: a colour panel with a bright squiggle.
    for (let side = -1; side <= 1; side += 2) {
      const r = rand(seg, side > 0 ? 90 : 91);
      if (r < 0.45) continue;
      const ga = z0 + 2 + rand(seg, side > 0 ? 92 : 93) * 8;
      const gb = ga + 4 + r * 4;
      if (gb <= NEAR + 0.5 || ga > v.far) continue;
      const a = Math.max(NEAR, ga);
      const x = side * (WALL_X - 0.01);
      ctx.fillStyle = look.neon[Math.floor(r * 30) % 3]!;
      ctx.beginPath();
      cam.sideTrap(ctx, x, a, 0.35, 1.45, gb, 0.25, 1.55);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.lineWidth = Math.max(1, 0.08 * cam.scale(a));
      ctx.beginPath();
      for (let k = 0; k <= 6; k++) {
        const z = a + ((gb - a) * k) / 6;
        const y = k % 2 === 0 ? 0.6 : 1.2;
        const s = cam.scale(z);
        if (k === 0) ctx.moveTo(cam.sx(x, s), cam.sy(y, s));
        else ctx.lineTo(cam.sx(x, s), cam.sy(y, s));
      }
      ctx.stroke();
    }
  }

  private drawStation(v: View, seg: number, z0: number, z1: number): void {
    const { ctx, cam, look } = v;
    const zn = Math.max(NEAR, z0);
    // Platform edge face, yellow safety strip and tiled top.
    ctx.fillStyle = look.wallDark;
    ctx.beginPath();
    cam.side(ctx, -PLATFORM_X, 0, PLATFORM_H, zn, z1);
    cam.side(ctx, PLATFORM_X, 0, PLATFORM_H, zn, z1);
    ctx.fill();
    ctx.fillStyle = look.sidewalk;
    ctx.beginPath();
    cam.flat(ctx, -BUILD_X, -PLATFORM_X - 0.35, PLATFORM_H, zn, z1);
    cam.flat(ctx, PLATFORM_X + 0.35, BUILD_X, PLATFORM_H, zn, z1);
    ctx.fill();
    ctx.fillStyle = '#ffd23f';
    ctx.beginPath();
    cam.flat(ctx, -PLATFORM_X - 0.35, -PLATFORM_X, PLATFORM_H, zn, z1);
    cam.flat(ctx, PLATFORM_X, PLATFORM_X + 0.35, PLATFORM_H, zn, z1);
    ctx.fill();
    const startsHere = this.kindOf(seg - 1) !== 'station';
    if (startsHere && z0 > NEAR) {
      ctx.fillStyle = look.wallDark;
      ctx.beginPath();
      cam.front(ctx, -BUILD_X, -PLATFORM_X, 0, PLATFORM_H, z0);
      cam.front(ctx, PLATFORM_X, BUILD_X, 0, PLATFORM_H, z0);
      ctx.fill();
    }
    // Pillars and a hanging sign, then the canopy over the platforms.
    for (let k = 1; k >= 0; k--) {
      const pz = z0 + 5 + k * 10;
      if (pz < NEAR + 0.2 || pz > v.far) continue;
      ctx.fillStyle = look.wall;
      ctx.beginPath();
      cam.front(ctx, -6.6, -6.2, PLATFORM_H, CANOPY_Y, pz);
      cam.front(ctx, 6.2, 6.6, PLATFORM_H, CANOPY_Y, pz);
      ctx.fill();
      if (k === 0) {
        ctx.fillStyle = '#1d3a8a';
        ctx.beginPath();
        cam.front(ctx, -CANOPY_X - 2.1, -CANOPY_X - 0.1, 4.6, 5.3, pz);
        cam.front(ctx, CANOPY_X + 0.1, CANOPY_X + 2.1, 4.6, 5.3, pz);
        ctx.fill();
        ctx.fillStyle = '#f4f4f4';
        ctx.beginPath();
        cam.front(ctx, -CANOPY_X - 1.8, -CANOPY_X - 0.4, 4.85, 5.05, pz);
        cam.front(ctx, CANOPY_X + 0.4, CANOPY_X + 1.8, 4.85, 5.05, pz);
        ctx.fill();
      }
    }
    ctx.fillStyle = look.wallTop;
    ctx.beginPath();
    cam.flat(ctx, -BUILD_X, -CANOPY_X, CANOPY_Y, zn, z1);
    cam.flat(ctx, CANOPY_X, BUILD_X, CANOPY_Y, zn, z1);
    ctx.fill();
    ctx.fillStyle = look.wallDark;
    ctx.beginPath();
    cam.side(ctx, -CANOPY_X, CANOPY_Y - 0.35, CANOPY_Y, zn, z1);
    cam.side(ctx, CANOPY_X, CANOPY_Y - 0.35, CANOPY_Y, zn, z1);
    ctx.fill();
    ctx.fillStyle = '#fff4d6';
    ctx.beginPath();
    cam.side(ctx, -CANOPY_X, CANOPY_Y - 0.42, CANOPY_Y - 0.35, zn, z1);
    cam.side(ctx, CANOPY_X, CANOPY_Y - 0.42, CANOPY_Y - 0.35, zn, z1);
    ctx.fill();
    if (startsHere && z0 > NEAR) {
      ctx.fillStyle = look.wallDark;
      ctx.beginPath();
      cam.front(ctx, -BUILD_X, -CANOPY_X, CANOPY_Y - 0.35, CANOPY_Y, z0);
      cam.front(ctx, CANOPY_X, BUILD_X, CANOPY_Y - 0.35, CANOPY_Y, z0);
      ctx.fill();
    }
  }

  private drawTunnel(v: View, seg: number, z0: number, z1: number): void {
    const { ctx, cam, look } = v;
    const zn = Math.max(NEAR, z0);
    const zm = z0 + SEG / 2;
    for (let half = 0; half < 2; half++) {
      const a = half === 0 ? zn : Math.max(NEAR, zm);
      const b = half === 0 ? Math.min(zm, z1) : z1;
      if (b <= a) continue;
      ctx.fillStyle = (seg + half) % 2 === 0 ? look.tunnel : look.tunnelDark;
      ctx.beginPath();
      cam.side(ctx, -WALL_X, 0, TUNNEL_SHOULDER, a, b);
      cam.side(ctx, WALL_X, 0, TUNNEL_SHOULDER, a, b);
      ctx.fill();
    }
    // Chamfered upper corners and ceiling.
    ctx.fillStyle = look.tunnelDark;
    ctx.beginPath();
    for (let side = -1; side <= 1; side += 2) {
      const sa = cam.scale(zn);
      const sb = cam.scale(z1);
      ctx.moveTo(cam.sx(side * WALL_X, sa), cam.sy(TUNNEL_SHOULDER, sa));
      ctx.lineTo(cam.sx(side * WALL_X, sb), cam.sy(TUNNEL_SHOULDER, sb));
      ctx.lineTo(cam.sx(side * TUNNEL_TOP_HW, sb), cam.sy(TUNNEL_H, sb));
      ctx.lineTo(cam.sx(side * TUNNEL_TOP_HW, sa), cam.sy(TUNNEL_H, sa));
      ctx.closePath();
    }
    cam.flat(ctx, -TUNNEL_TOP_HW, TUNNEL_TOP_HW, TUNNEL_H, zn, z1);
    ctx.fill();
    // A stripe and streaming wall and ceiling lights: a strong speed cue.
    ctx.fillStyle = look.wallDark;
    ctx.beginPath();
    cam.side(ctx, -WALL_X + 0.01, 1.2, 1.5, zn, z1);
    cam.side(ctx, WALL_X - 0.01, 1.2, 1.5, zn, z1);
    ctx.fill();
    ctx.fillStyle = '#ffe9b0';
    ctx.beginPath();
    for (let k = 0; k < 4; k++) {
      const a = z0 + 1 + k * 5;
      if (a < NEAR || a > v.far) continue;
      cam.side(ctx, -WALL_X + 0.02, 5.2, 5.5, a, a + 1.4);
      cam.side(ctx, WALL_X - 0.02, 5.2, 5.5, a, a + 1.4);
      cam.flat(ctx, -0.3, 0.3, TUNNEL_H - 0.02, a, a + 2.4);
    }
    ctx.fill();
    // Entrance portal: a wide concrete face with the arched opening cut out.
    if (this.kindOf(seg - 1) !== 'tunnel' && z0 > NEAR) {
      const s = cam.scale(z0);
      ctx.fillStyle = look.wallDark;
      ctx.beginPath();
      cam.front(ctx, -60, 60, 0, 15, z0);
      this.archPath(ctx, cam, s, 0);
      ctx.fill('evenodd');
      ctx.fillStyle = look.wallTop;
      ctx.beginPath();
      this.archPath(ctx, cam, s, 0.7);
      this.archPath(ctx, cam, s, 0);
      ctx.fill('evenodd');
      ctx.fillStyle = '#ffd23f';
      ctx.beginPath();
      cam.front(ctx, -3, 3, TUNNEL_H + 1.2, TUNNEL_H + 2.2, z0);
      ctx.fill();
      ctx.fillStyle = '#1d1d1d';
      ctx.beginPath();
      for (let k = -3; k < 3; k += 1) cam.front(ctx, k + 0.1, k + 0.5, TUNNEL_H + 1.3, TUNNEL_H + 2.1, z0);
      ctx.fill();
    }
  }

  /** Arched tunnel opening at the scale of depth `s`, grown outward by `grow` metres. */
  private archPath(ctx: CanvasRenderingContext2D, cam: Camera, s: number, grow: number): void {
    const hw = WALL_X + grow;
    const sh = TUNNEL_SHOULDER + grow * 0.6;
    const th = TUNNEL_H + grow;
    const tw = TUNNEL_TOP_HW + grow * 0.5;
    ctx.moveTo(cam.sx(-hw, s), cam.sy(0, s));
    ctx.lineTo(cam.sx(-hw, s), cam.sy(sh, s));
    ctx.lineTo(cam.sx(-tw, s), cam.sy(th, s));
    ctx.lineTo(cam.sx(tw, s), cam.sy(th, s));
    ctx.lineTo(cam.sx(hw, s), cam.sy(sh, s));
    ctx.lineTo(cam.sx(hw, s), cam.sy(0, s));
    ctx.closePath();
  }

  private drawBridge(v: View, z0: number, z1: number): void {
    const { ctx, cam, look } = v;
    const zn = Math.max(NEAR, z0);
    // Steel truss: verticals and diagonals as thin quads, then the top chord.
    ctx.fillStyle = look.wallDark;
    ctx.beginPath();
    for (let side = -1; side <= 1; side += 2) {
      const x = side * 5.3;
      for (let k = 2; k >= 0; k--) {
        const pz = z0 + k * (SEG / 2);
        if (pz < NEAR + 0.3 || pz > v.far) continue;
        cam.front(ctx, x - 0.18, x + 0.18, 0, 6.2, pz);
        const qz = pz + SEG / 2;
        if (qz <= v.far + 10) cam.sideTrap(ctx, x, Math.max(NEAR, pz), 0, 0.5, qz, 5.6, 6.2);
      }
      cam.side(ctx, x, 5.75, 6.25, zn, z1);
    }
    ctx.fill();
    // Railings with posts.
    ctx.fillStyle = look.wallTop;
    ctx.beginPath();
    for (let side = -1; side <= 1; side += 2) {
      const x = side * 4.75;
      cam.side(ctx, x, 1.0, 1.12, zn, z1);
      cam.side(ctx, x, 0.5, 0.58, zn, z1);
      for (let pz = z0 + 2.5 - (z0 % 2.5); pz < z1; pz += 2.5) {
        if (pz < NEAR + 0.3) continue;
        cam.front(ctx, x - 0.05, x + 0.05, 0, 1.12, pz);
      }
    }
    ctx.fill();
  }

  // ---------------------------------------------------------------- overhead & haze

  /** Catenary gantry at relative z with wires to the next one (drawn in the sorted world pass). */
  drawGantry(v: View, z: number, alpha: number): void {
    const { ctx, cam } = v;
    if (z < NEAR + 0.5) return;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = '#272033';
    ctx.beginPath();
    cam.front(ctx, -5.1, -4.8, 0, GANTRY_Y + 0.4, z);
    cam.front(ctx, 4.8, 5.1, 0, GANTRY_Y + 0.4, z);
    cam.front(ctx, -5.1, 5.1, GANTRY_Y, GANTRY_Y + 0.35, z);
    for (let lane = -1; lane <= 1; lane++)
      cam.front(ctx, lane * 2.4 - 0.04, lane * 2.4 + 0.04, WIRE_Y, GANTRY_Y, z);
    ctx.fill();
    // Contact wires to the next gantry.
    const za = Math.max(z, -2);
    const zb = Math.min(z + GANTRY_EVERY, v.far);
    if (zb > za) {
      const sa = cam.scale(za);
      const sb = cam.scale(zb);
      ctx.strokeStyle = 'rgba(30,24,40,0.75)';
      ctx.lineWidth = Math.max(1, 0.05 * sa);
      ctx.beginPath();
      for (let lane = -1; lane <= 1; lane++) {
        ctx.moveTo(cam.sx(lane * 2.4, sa), cam.sy(WIRE_Y, sa));
        ctx.lineTo(cam.sx(lane * 2.4, sb), cam.sy(WIRE_Y, sb));
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  /** Aerial perspective: a haze band over the horizon, drawn over the far ground before the scenery. */
  drawHaze(v: View): void {
    const { ctx, cam, look } = v;
    const top = cam.hz - 40 * this.unit;
    const bottom = cam.hz + 90 * this.unit;
    const key = Math.round(cam.hz) * 4096 + look.version;
    if (!this.hazeGrad || key !== this.hazeKey) {
      const [r, g, b] = look.hazeRgb;
      const c = `${Math.round(r)},${Math.round(g)},${Math.round(b)}`;
      const grad = ctx.createLinearGradient(0, top, 0, bottom);
      grad.addColorStop(0, `rgba(${c},0)`);
      grad.addColorStop(0.32, `rgba(${c},0.6)`);
      grad.addColorStop(1, `rgba(${c},0)`);
      this.hazeGrad = grad;
      this.hazeKey = key;
    }
    ctx.fillStyle = this.hazeGrad;
    ctx.fillRect(-20, top, this.W + 40, bottom - top);
  }
}
