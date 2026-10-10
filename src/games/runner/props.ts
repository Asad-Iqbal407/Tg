import { TAU } from '../../core/math';
import { drawCoin, fillRoundRect, shade, text } from '../draw';
import { CAM_D, NEAR } from './camera';
import { HIGH_BOTTOM, HIGH_TOP, laneX, LOW_TOP, TRAIN_HW } from './config';
import type { View } from './scenery';
import { createSurface, rand, resolutionOf, type Surface } from './surface';
import type { Obstacle, Power, PowerKind } from './track';

export const POWER_INFO: Record<PowerKind, { label: string; color: string; base: number }> = {
  magnet: { label: 'COIN MAGNET', color: '#ff4d6d', base: 10 },
  double: { label: '2X SCORE', color: '#ffc21a', base: 12 },
  sneakers: { label: 'SUPER JUMP', color: '#2ec5ff', base: 12 },
  jetpack: { label: 'JETPACK', color: '#a35bff', base: 7 },
};

interface Livery {
  body: string;
  side: string;
  door: string;
  stripe: string;
  roof: string;
  rim: string;
  freight: boolean;
}

function livery(body: string, stripe: string, freight = false): Livery {
  return {
    body,
    side: shade(body, -0.2),
    door: shade(body, -0.38),
    stripe,
    roof: shade(body, -0.4),
    rim: shade(body, -0.12),
    freight,
  };
}

const LIVERIES: readonly Livery[] = [
  livery('#d7263d', '#f4f4f4'),
  livery('#1b998b', '#f2e94e'),
  livery('#3a86ff', '#ffbe0b'),
  livery('#a7b1c2', '#ef233c'),
  livery('#f77f00', '#1d3557'),
  livery('#7b2cbf', '#ffb703'),
  livery('#2d6a4f', '#b7e4c7'),
  livery('#f4b400', '#1d1d1d', true),
];
const CONTAINERS = ['#c0392b', '#2e86de', '#27ae60', '#d35400', '#8e44ad', '#16a085', '#7f8c8d'].map((c) => ({
  side: c,
  rib: shade(c, -0.3),
  roof: shade(c, -0.15),
}));

const SKIRT = '#17151f';
const GLASS = '#1a2747';
const GLASS_HI = 'rgba(170,215,255,0.32)';

/** Fog factor for an object `rel` metres ahead with view distance `far`. */
export function fogAt(rel: number, far: number): number {
  const band = 0.25 * far;
  return rel <= far - band ? 1 : Math.max(0, (far - rel) / band);
}

// ---------------------------------------------------------------- trains

export function drawTrain(v: View, ob: Obstacle, rel: number, alpha: number): void {
  const { ctx, cam } = v;
  const lv = LIVERIES[ob.serial % LIVERIES.length]!;
  const cx = laneX(ob.lane);
  const x0 = cx - TRAIN_HW;
  const x1 = cx + TRAIN_HW;
  const h = ob.h;
  const zf = Math.max(rel, NEAR);
  const zb = Math.min(rel + ob.len, v.far + 40);
  if (zb <= zf) return;
  const cars = Math.max(1, Math.round(ob.len / 11));
  const carLen = ob.len / cars;
  const detail = cam.scale(rel) > 6;
  ctx.globalAlpha = alpha;

  // Oncoming train: headlight cone on its lane.
  if (ob.vz !== 0 && ob.armed && rel > 1) {
    const reach = Math.min(rel - 0.5, 34);
    ctx.fillStyle = 'rgba(255,244,190,0.2)';
    ctx.beginPath();
    const sa = cam.scale(rel);
    const sb = cam.scale(rel - reach);
    ctx.moveTo(cam.sx(cx - 0.9, sa), cam.sy(0.02, sa));
    ctx.lineTo(cam.sx(cx + 0.9, sa), cam.sy(0.02, sa));
    ctx.lineTo(cam.sx(cx + 1.4, sb), cam.sy(0.02, sb));
    ctx.lineTo(cam.sx(cx - 1.4, sb), cam.sy(0.02, sb));
    ctx.closePath();
    ctx.fill();
  }

  // Visible side face (the one facing the camera axis).
  const sideX = x0 > cam.x ? x0 : x1 < cam.x ? x1 : NaN;
  if (!Number.isNaN(sideX)) {
    if (lv.freight) {
      for (let c = cars - 1; c >= 0; c--) {
        const a = Math.max(zf, rel + c * carLen + (c === 0 ? 0 : 0.3));
        const b = Math.min(zb, rel + (c + 1) * carLen - 0.3);
        if (b <= a) continue;
        const k = c === 0 ? null : CONTAINERS[(ob.serial * 3 + c) % CONTAINERS.length]!;
        ctx.fillStyle = k ? k.side : lv.side;
        ctx.beginPath();
        cam.side(ctx, sideX, 0.45, k ? h - 0.05 : h, a, b);
        ctx.fill();
        if (detail && k) {
          ctx.fillStyle = k.rib;
          ctx.beginPath();
          for (let r = a + 0.6; r < b - 0.3; r += 1.1) cam.side(ctx, sideX, 0.6, h - 0.2, r, r + 0.18);
          ctx.fill();
        }
      }
      if (detail) {
        ctx.fillStyle = '#1d1d1d';
        ctx.beginPath();
        cam.side(ctx, sideX, 1.0, 1.25, zf, Math.min(zb, rel + carLen));
        ctx.fill();
      }
    } else {
      ctx.fillStyle = lv.side;
      ctx.beginPath();
      cam.side(ctx, sideX, 0.45, h, zf, zb);
      ctx.fill();
      ctx.fillStyle = lv.stripe;
      ctx.beginPath();
      cam.side(ctx, sideX, 1.05, 1.3, zf, zb);
      ctx.fill();
      if (detail) {
        ctx.fillStyle = lv.door;
        ctx.beginPath();
        for (let c = 0; c < cars; c++) {
          const a = rel + c * carLen + 0.44 * carLen;
          if (a < zf || a > zb) continue;
          cam.side(ctx, sideX, 0.5, 2.8, a, a + 0.11 * carLen);
        }
        ctx.fill();
        ctx.fillStyle = GLASS;
        ctx.beginPath();
        for (let c = 0; c < cars; c++) {
          const base = rel + c * carLen;
          for (let w = 0; w < 4; w++) {
            const a = base + (w < 2 ? 0.08 + w * 0.17 : 0.6 + (w - 2) * 0.17) * carLen;
            const b = a + 0.12 * carLen;
            if (b <= zf || a >= zb) continue;
            cam.side(ctx, sideX, 1.6, 2.6, Math.max(a, zf), b);
          }
          const d = base + 0.46 * carLen;
          if (d > zf && d < zb) cam.side(ctx, sideX, 1.7, 2.55, d, d + 0.07 * carLen);
        }
        ctx.fill();
        ctx.fillStyle = GLASS_HI;
        ctx.beginPath();
        for (let c = 0; c < cars; c++) {
          const base = rel + c * carLen;
          for (let w = 0; w < 4; w++) {
            const a = base + (w < 2 ? 0.08 + w * 0.17 : 0.6 + (w - 2) * 0.17) * carLen;
            if (a + 0.05 * carLen <= zf || a >= zb) continue;
            cam.sideTrap(ctx, sideX, Math.max(a, zf), 2.25, 2.55, a + 0.05 * carLen, 2.45, 2.55);
          }
        }
        ctx.fill();
      }
    }
    // Skirt with bogies, and the gaps between cars.
    ctx.fillStyle = SKIRT;
    ctx.beginPath();
    cam.side(ctx, sideX, 0, 0.47, zf, zb);
    for (let c = 1; c < cars; c++) {
      const g = rel + c * carLen;
      if (g > zf && g < zb) cam.side(ctx, sideX, 0, h, g - 0.25, g + 0.25);
    }
    ctx.fill();
    if (detail) {
      // Bogie wheels: circles on the side plane, foreshortened into ellipses.
      ctx.fillStyle = '#34323f';
      ctx.beginPath();
      const off = Math.abs(sideX - cam.x);
      for (let c = 0; c < cars; c++) {
        for (let e = 0; e < 2; e++) {
          for (let wheel = 0; wheel < 2; wheel++) {
            const wz = rel + c * carLen + (e === 0 ? 0.1 : 0.82) * carLen + wheel * 1.1;
            if (wz < Math.max(zf + 0.2, 0.5) || wz > zb) continue;
            cam.project(sideX, 0.34, wz);
            const ry = 0.32 * cam.ps;
            const rx = Math.max(1, (ry * off) / (wz + CAM_D));
            ctx.moveTo(cam.px + rx, cam.py);
            ctx.ellipse(cam.px, cam.py, rx, ry, 0, 0, TAU);
          }
        }
      }
      ctx.fill();
    }
  }

  // Roof with lighter rims, car seams, air-conditioning units and a pantograph.
  ctx.fillStyle = lv.roof;
  ctx.beginPath();
  cam.flat(ctx, x0, x1, h, zf, zb);
  ctx.fill();
  if (lv.freight) {
    ctx.fillStyle = CONTAINERS[(ob.serial * 3 + 1) % CONTAINERS.length]!.roof;
    ctx.beginPath();
    cam.flat(ctx, x0 + 0.05, x1 - 0.05, h, Math.max(zf, rel + carLen + 0.3), zb);
    ctx.fill();
  } else {
    ctx.fillStyle = lv.rim;
    ctx.beginPath();
    cam.flat(ctx, x0, x0 + 0.2, h + 0.005, zf, zb);
    cam.flat(ctx, x1 - 0.2, x1, h + 0.005, zf, zb);
    ctx.fill();
  }
  ctx.fillStyle = SKIRT;
  ctx.beginPath();
  for (let c = 1; c < cars; c++) {
    const g = rel + c * carLen;
    if (g > zf && g < zb) cam.flat(ctx, x0, x1, h + 0.01, g - 0.25, g + 0.25);
  }
  ctx.fill();
  if (detail && !lv.freight) {
    // Roof units are skipped close to the camera, where they would loom over the runner.
    for (let c = cars - 1; c >= 0; c--) {
      const a = rel + c * carLen + carLen * 0.4;
      const b = a + carLen * 0.2;
      if (b <= zf || a >= zb || a < 1) continue;
      ctx.fillStyle = '#8e93a3';
      ctx.beginPath();
      cam.flat(ctx, cx - 0.4, cx + 0.4, h + 0.28, a, b);
      ctx.fill();
      ctx.fillStyle = '#5d6170';
      ctx.beginPath();
      cam.front(ctx, cx - 0.4, cx + 0.4, h, h + 0.28, a);
      ctx.fill();
    }
    const pz = rel + 2.2;
    if (pz > 1 && pz < zb) {
      cam.project(cx - 0.55, h + 0.12, pz);
      const ax = cam.px;
      const ay = cam.py;
      const lw = Math.max(1, 0.05 * cam.ps);
      cam.project(cx, h + 1.0, pz + 0.5);
      const tx = cam.px;
      const ty = cam.py;
      cam.project(cx + 0.55, h + 0.12, pz);
      ctx.strokeStyle = '#2a2a33';
      ctx.lineWidth = lw;
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(tx, ty);
      ctx.lineTo(cam.px, cam.py);
      ctx.moveTo(tx - 0.45 * cam.ps, ty);
      ctx.lineTo(tx + 0.45 * cam.ps, ty);
      ctx.stroke();
    }
  }

  if (rel >= NEAR) drawTrainFront(v, ob, lv, rel, x0, x1);
  ctx.globalAlpha = 1;
}

function drawTrainFront(v: View, ob: Obstacle, lv: Livery, rel: number, x0: number, x1: number): void {
  const { ctx, cam } = v;
  const h = ob.h;
  cam.project(x0, h, rel);
  const ax = cam.px;
  const ay = cam.py;
  const s = cam.ps;
  const w = (x1 - x0) * s;
  const hh = h * s;
  const bottom = ay + hh;
  fillRoundRect(ctx, ax, ay, w, hh, w * 0.1, lv.body);
  ctx.fillStyle = SKIRT;
  ctx.fillRect(ax, bottom - 0.45 * s, w, 0.45 * s);
  ctx.fillStyle = lv.stripe;
  ctx.fillRect(ax, bottom - 1.3 * s, w, 0.25 * s);
  if (lv.freight) {
    // Locomotive: narrow cab windows and hazard chevrons.
    fillRoundRect(ctx, ax + w * 0.12, bottom - 2.85 * s, w * 0.32, 0.8 * s, w * 0.04, GLASS);
    fillRoundRect(ctx, ax + w * 0.56, bottom - 2.85 * s, w * 0.32, 0.8 * s, w * 0.04, GLASS);
    ctx.fillStyle = '#1d1d1d';
    ctx.beginPath();
    for (let k = 0; k < 4; k++) {
      const bx = ax + (k / 4) * w;
      ctx.moveTo(bx, bottom - 0.45 * s);
      ctx.lineTo(bx + w * 0.12, bottom - 0.45 * s);
      ctx.lineTo(bx + w * 0.22, bottom - 1.0 * s);
      ctx.lineTo(bx + w * 0.1, bottom - 1.0 * s);
      ctx.closePath();
    }
    ctx.fill();
  } else {
    fillRoundRect(ctx, ax + w * 0.09, bottom - 2.8 * s, w * 0.82, 1.1 * s, w * 0.06, GLASS);
    ctx.fillStyle = GLASS_HI;
    ctx.beginPath();
    ctx.moveTo(ax + w * 0.14, bottom - 2.75 * s);
    ctx.lineTo(ax + w * 0.34, bottom - 2.75 * s);
    ctx.lineTo(ax + w * 0.22, bottom - 1.75 * s);
    ctx.lineTo(ax + w * 0.12, bottom - 1.75 * s);
    ctx.closePath();
    ctx.fill();
    if (s > 9) {
      // Destination display.
      ctx.fillStyle = '#0c0c12';
      ctx.fillRect(ax + w * 0.2, bottom - 3.15 * s, w * 0.6, 0.27 * s);
      ctx.fillStyle = '#ffb000';
      for (let k = 0; k < 6; k++)
        ctx.fillRect(ax + w * (0.24 + k * 0.088), bottom - 3.08 * s, w * 0.06, 0.13 * s);
    }
  }
  // Headlights; an armed oncoming train flashes and glows.
  const live = ob.vz !== 0 && ob.armed;
  const flash = live && Math.sin(v.time * 16) > 0;
  const lr = Math.max(1.5, 0.15 * s);
  ctx.fillStyle = live ? (flash ? '#ffffff' : '#fff3b0') : '#ffd27a';
  ctx.beginPath();
  ctx.arc(ax + w * 0.18, bottom - 0.8 * s, lr, 0, TAU);
  ctx.moveTo(ax + w * 0.82 + lr, bottom - 0.8 * s);
  ctx.arc(ax + w * 0.82, bottom - 0.8 * s, lr, 0, TAU);
  ctx.fill();
  if (live) {
    const gr = lr * (flash ? 4.5 : 3.4);
    v.glow.draw(ctx, ax + w * 0.18, bottom - 0.8 * s, gr, '255,248,205');
    v.glow.draw(ctx, ax + w * 0.82, bottom - 0.8 * s, gr, '255,248,205');
  }
  ctx.fillStyle = '#2b2b33';
  ctx.fillRect(ax + w * 0.42, bottom - 0.55 * s, w * 0.16, 0.25 * s);
}

// ---------------------------------------------------------------- ramps

export function drawRamp(v: View, ob: Obstacle, rel: number, alpha: number): void {
  const { ctx, cam } = v;
  const cx = laneX(ob.lane);
  const x0 = cx - 1.0;
  const x1 = cx + 1.0;
  const z0 = Math.max(rel, NEAR);
  const z1 = rel + ob.len;
  if (z1 <= z0) return;
  const t0 = (z0 - rel) / ob.len;
  const y0 = ob.h * t0;
  ctx.globalAlpha = alpha;
  // Side truss.
  const sideX = x0 > cam.x ? x0 : x1 < cam.x ? x1 : NaN;
  if (!Number.isNaN(sideX)) {
    ctx.fillStyle = '#6b4a24';
    ctx.beginPath();
    cam.sideTrap(ctx, sideX, z0, 0, y0, z1, 0, ob.h);
    ctx.fill();
    ctx.strokeStyle = '#4a3218';
    ctx.lineWidth = Math.max(1, 0.08 * cam.scale(z0));
    ctx.beginPath();
    for (let k = 1; k < 4; k++) {
      const t = k / 4;
      const z = rel + ob.len * t;
      if (z <= z0) continue;
      const s = cam.scale(z);
      ctx.moveTo(cam.sx(sideX, s), cam.sy(0, s));
      ctx.lineTo(cam.sx(sideX, s), cam.sy(ob.h * t, s));
    }
    ctx.stroke();
  }
  // Deck, treads and painted up-chevrons.
  ctx.fillStyle = '#d0954a';
  ctx.beginPath();
  cam.slope(ctx, x0, x1, y0, z0, ob.h, z1);
  ctx.fill();
  ctx.fillStyle = '#9a6a30';
  ctx.beginPath();
  for (let k = 1; k < 9; k++) {
    const t = k / 9;
    if (t < t0) continue;
    cam.slope(ctx, x0, x1, ob.h * t, rel + ob.len * t, ob.h * (t + 0.025), rel + ob.len * (t + 0.025));
  }
  ctx.fill();
  ctx.fillStyle = '#fff6d6';
  ctx.beginPath();
  for (let k = 0; k < 2; k++) {
    const t = 0.25 + k * 0.32;
    if (t < t0) continue;
    rampPoint(v, cx - 0.65, ob, rel, t, true);
    rampPoint(v, cx, ob, rel, t + 0.12, false);
    rampPoint(v, cx + 0.65, ob, rel, t, false);
    rampPoint(v, cx + 0.65, ob, rel, t + 0.06, false);
    rampPoint(v, cx, ob, rel, t + 0.18, false);
    rampPoint(v, cx - 0.65, ob, rel, t + 0.06, false);
    ctx.closePath();
  }
  ctx.fill();
  if (t0 <= 0) {
    ctx.fillStyle = '#ffd23f';
    ctx.beginPath();
    cam.front(ctx, x0, x1, 0, 0.12, rel);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function rampPoint(v: View, x: number, ob: Obstacle, rel: number, t: number, move: boolean): void {
  v.cam.project(x, ob.h * t + 0.01, rel + ob.len * t);
  if (move) v.ctx.moveTo(v.cam.px, v.cam.py);
  else v.ctx.lineTo(v.cam.px, v.cam.py);
}

// ---------------------------------------------------------------- barriers

/**
 * Low barriers are A-frame hurdles with an up-chevron (jump); high barriers are overhead gantries
 * with an open gap, a down-chevron and a blinking lamp (roll under).
 */
export function drawBarrier(v: View, ob: Obstacle, rel: number, alpha: number): void {
  const { ctx, cam } = v;
  if (rel < NEAR + 0.3) return;
  const cx = laneX(ob.lane);
  const low = ob.kind === 'low';
  // Fade out once passed, so a barrier doesn't loom over the bottom of the screen.
  ctx.globalAlpha = rel < 0 ? alpha * Math.max(0, 1 + rel / 2.5) : alpha;
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath();
  cam.flat(ctx, cx - 1.15, cx + 1.15, 0.02, rel - 0.25, rel + 0.7);
  ctx.fill();
  const s = cam.scale(rel);
  const left = cam.sx(cx - TRAIN_HW, s);
  const w = 2 * TRAIN_HW * s;
  const y0 = cam.sy(low ? 0.42 : HIGH_BOTTOM, s);
  const y1 = cam.sy(low ? LOW_TOP : HIGH_TOP, s);
  const hh = y0 - y1;
  const ground = cam.sy(0, s);
  if (low) {
    // Splayed A-frame legs.
    ctx.fillStyle = '#d9d9e3';
    ctx.beginPath();
    for (let e = -1; e <= 1; e += 2) {
      const xa = cam.sx(cx + e * 1.12, s);
      const xb = cam.sx(cx + e * 0.86, s);
      const lw = 0.07 * s;
      ctx.moveTo(xa - lw, ground);
      ctx.lineTo(xa + lw, ground);
      ctx.lineTo(xb + lw, y1);
      ctx.lineTo(xb - lw, y1);
      ctx.closePath();
    }
    ctx.fill();
  } else {
    ctx.fillStyle = '#3a3a46';
    const pw = Math.max(2, 0.16 * s);
    ctx.fillRect(left, cam.sy(HIGH_TOP + 0.15, s), pw, ground - cam.sy(HIGH_TOP + 0.15, s));
    ctx.fillRect(left + w - pw, cam.sy(HIGH_TOP + 0.15, s), pw, ground - cam.sy(HIGH_TOP + 0.15, s));
  }
  // Striped board.
  ctx.fillStyle = low ? '#f4f4f4' : '#ffd23f';
  ctx.fillRect(left, y1, w, hh);
  ctx.save();
  ctx.beginPath();
  ctx.rect(left, y1, w, hh);
  ctx.clip();
  ctx.fillStyle = low ? '#e63946' : '#1d1d1d';
  const stripe = Math.max(4, w / 7);
  ctx.beginPath();
  for (let sx = left - hh; sx < left + w + hh; sx += stripe * 2) {
    ctx.moveTo(sx, y1 + hh);
    ctx.lineTo(sx + stripe, y1 + hh);
    ctx.lineTo(sx + stripe + hh, y1);
    ctx.lineTo(sx + hh, y1);
    ctx.closePath();
  }
  ctx.fill();
  ctx.restore();
  ctx.strokeStyle = 'rgba(0,0,0,0.45)';
  ctx.lineWidth = Math.max(1, 0.05 * s);
  ctx.strokeRect(left, y1, w, hh);
  if (s > 7) {
    // Affordance badge: up-chevron to jump, down-chevron to roll.
    const bx = left + w / 2;
    const by = y1 + hh / 2;
    const br = Math.min(hh * 0.42, 0.34 * s);
    ctx.fillStyle = low ? '#c1121f' : '#1d1d1d';
    ctx.beginPath();
    ctx.arc(bx, by, br * 1.25, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = br * 0.42;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    const d = low ? 1 : -1;
    ctx.moveTo(bx - br * 0.65, by + d * br * 0.35);
    ctx.lineTo(bx, by - d * br * 0.35);
    ctx.lineTo(bx + br * 0.65, by + d * br * 0.35);
    ctx.stroke();
    ctx.lineCap = 'butt';
  }
  if (!low) {
    const on = Math.sin(v.time * 9 + ob.serial) > 0;
    const lx = left + w / 2;
    const ly = cam.sy(HIGH_TOP + 0.18, s);
    const lr = Math.max(1.5, 0.13 * s);
    ctx.fillStyle = on ? '#ff3b3b' : '#6b1a1a';
    ctx.beginPath();
    ctx.arc(lx, ly, lr, 0, TAU);
    ctx.fill();
    if (on) {
      ctx.fillStyle = 'rgba(255,60,60,0.28)';
      ctx.beginPath();
      ctx.arc(lx, ly, lr * 3, 0, TAU);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
}

// ---------------------------------------------------------------- coins

/** Pre-rendered coin spin frames, drawn with drawImage instead of a gradient per coin. */
export class CoinSprites {
  private sheet: Surface | null = null;
  private res = 0;
  private cell = 0;
  private failed = false;
  static readonly FRAMES = 8;

  draw(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, spin: number): void {
    const res = resolutionOf(ctx);
    if (res !== this.res) {
      this.res = res;
      this.sheet = null;
      this.failed = false;
    }
    if (!this.sheet && !this.failed) this.build();
    const sx = Math.abs(spin);
    if (!this.sheet || r > this.cell * 0.45) {
      drawCoin(ctx, x, y, r, sx);
      return;
    }
    const f = Math.min(CoinSprites.FRAMES - 1, Math.round((1 - sx) * (CoinSprites.FRAMES - 1)));
    const cellPx = this.cell * this.res;
    const size = r / 0.45;
    ctx.drawImage(this.sheet, f * cellPx, 0, cellPx, cellPx, x - size / 2, y - size / 2, size, size);
  }

  private build(): void {
    this.cell = 56;
    const cellPx = this.cell * this.res;
    const made = createSurface(Math.ceil(cellPx * CoinSprites.FRAMES), Math.ceil(cellPx));
    if (!made) {
      this.failed = true;
      return;
    }
    const c = made.ctx as CanvasRenderingContext2D;
    c.scale(this.res, this.res);
    for (let f = 0; f < CoinSprites.FRAMES; f++) {
      const spin = 1 - f / (CoinSprites.FRAMES - 1);
      drawCoin(c, f * this.cell + this.cell / 2, this.cell / 2, this.cell * 0.45, spin);
    }
    this.sheet = made.surface;
  }
}

// ---------------------------------------------------------------- power-ups

export function drawPower(v: View, pw: Power, rel: number, alpha: number): void {
  const { ctx, cam } = v;
  const info = POWER_INFO[pw.kind];
  const x = laneX(pw.lane);
  const bob = Math.sin(v.time * 3 + pw.z) * 0.12;
  ctx.globalAlpha = alpha;
  // Ground ring and light beam make it visible from far away.
  cam.project(x, 0.02, rel);
  const gs = cam.ps;
  ctx.strokeStyle = info.color;
  ctx.lineWidth = Math.max(1.5, 0.1 * gs);
  ctx.beginPath();
  ctx.ellipse(cam.px, cam.py, 1.0 * gs, Math.max(1, 1.0 * gs * (cam.h / (rel + 9.4))), 0, 0, TAU);
  ctx.stroke();
  ctx.fillStyle = info.color;
  ctx.globalAlpha = alpha * 0.16;
  ctx.beginPath();
  cam.front(ctx, x - 0.55, x + 0.55, 0, 5, rel);
  ctx.fill();
  ctx.globalAlpha = alpha * 0.22;
  ctx.beginPath();
  cam.front(ctx, x - 0.2, x + 0.2, 0, 5, rel);
  ctx.fill();
  ctx.globalAlpha = alpha;
  cam.project(x, 1.35 + bob, rel);
  const r = Math.max(4, 0.8 * cam.ps);
  const spin = 0.55 + 0.45 * Math.abs(Math.cos(v.time * 1.6 + pw.z));
  ctx.save();
  ctx.translate(cam.px, cam.py);
  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  ctx.beginPath();
  ctx.arc(0, 0, r * 1.45, 0, TAU);
  ctx.fill();
  ctx.scale(spin, 1);
  ctx.fillStyle = info.color;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = Math.max(1.5, r * 0.13);
  ctx.stroke();
  drawPowerIcon(ctx, pw.kind, 0, 0, r * 0.62, '#ffffff');
  ctx.restore();
  ctx.globalAlpha = 1;
}

export function drawPowerIcon(
  ctx: CanvasRenderingContext2D,
  kind: PowerKind,
  x: number,
  y: number,
  r: number,
  color: string,
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  switch (kind) {
    case 'magnet':
      ctx.lineWidth = r * 0.42;
      ctx.beginPath();
      ctx.arc(0, -r * 0.05, r * 0.58, Math.PI, 0, true);
      ctx.moveTo(-r * 0.58, -r * 0.05);
      ctx.lineTo(-r * 0.58, -r * 0.62);
      ctx.moveTo(r * 0.58, -r * 0.05);
      ctx.lineTo(r * 0.58, -r * 0.62);
      ctx.stroke();
      break;
    case 'double':
      text(ctx, '2X', 0, r * 0.06, { size: r * 1.35, align: 'center', color, stroke: null, weight: 900 });
      break;
    case 'sneakers':
      ctx.beginPath();
      ctx.moveTo(-r, r * 0.45);
      ctx.lineTo(-r * 0.75, -r * 0.55);
      ctx.lineTo(-r * 0.15, -r * 0.55);
      ctx.lineTo(0, -r * 0.05);
      ctx.lineTo(r, r * 0.12);
      ctx.lineTo(r, r * 0.45);
      ctx.closePath();
      ctx.fill();
      ctx.lineWidth = r * 0.16;
      ctx.beginPath();
      ctx.moveTo(-r * 0.2, -r * 0.85);
      ctx.lineTo(r * 0.5, -r * 0.85);
      ctx.moveTo(r * 0.05, -r * 0.55);
      ctx.lineTo(r * 0.75, -r * 0.55);
      ctx.stroke();
      break;
    case 'jetpack':
      fillRoundRect(ctx, -r * 0.62, -r * 0.8, r * 0.5, r * 1.25, r * 0.2, color);
      fillRoundRect(ctx, r * 0.12, -r * 0.8, r * 0.5, r * 1.25, r * 0.2, color);
      ctx.beginPath();
      ctx.moveTo(-r * 0.55, r * 0.55);
      ctx.lineTo(-r * 0.37, r * 1.0);
      ctx.lineTo(-r * 0.19, r * 0.55);
      ctx.moveTo(r * 0.19, r * 0.55);
      ctx.lineTo(r * 0.37, r * 1.0);
      ctx.lineTo(r * 0.55, r * 0.55);
      ctx.fill();
      break;
  }
  ctx.restore();
}

/** Cosmetic variety: stable per obstacle and never drawn from the gameplay RNG. */
export function variety(ob: Obstacle, salt: number): number {
  return rand(ob.serial, salt);
}
