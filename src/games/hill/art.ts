import { TAU } from '../../core/math';
import { fillRoundRect, roundRectPath, shade } from '../draw';

/** Body styles; each one has its own silhouette. */
export const CarStyle = { Jeep: 0, Monster: 1, Racer: 2, Rover: 3 } as const;
export type CarStyle = (typeof CarStyle)[keyof typeof CarStyle];

/** Style for a vehicle skin: the catalog's `style` param, refined by known skin ids. */
export function carStyle(skinId: string, styleParam: number): CarStyle {
  if (skinId === 'car-racer') return CarStyle.Racer;
  if (skinId === 'car-rover') return CarStyle.Rover;
  if (skinId === 'car-monster') return CarStyle.Monster;
  return styleParam >= 0 && styleParam <= 3 ? (styleParam as CarStyle) : CarStyle.Jeep;
}

export interface CarPaint {
  body: string;
  trim: string;
  helmet: string;
}

/** What the renderer needs from the simulation, in the car's local frame (x forward, y down). */
export interface CarPose {
  style: CarStyle;
  /** Wheel centres relative to the chassis bottom centre (local frame). */
  wheels: readonly { x: number; y: number }[];
  /** Strut mount points (local frame). */
  mounts: readonly { x: number; y: number }[];
  wheelR: number;
  /** Wheel rotation relative to the chassis (radians). */
  wheelAngles: readonly number[];
  /** Driver head centre (local frame). */
  head: { x: number; y: number };
  /** Blinking antenna light / brake lights. */
  braking: boolean;
  time: number;
}

function poly(ctx: CanvasRenderingContext2D, pts: readonly number[]): void {
  ctx.beginPath();
  ctx.moveTo(pts[0] as number, pts[1] as number);
  for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i] as number, pts[i + 1] as number);
  ctx.closePath();
}

function strokeLines(ctx: CanvasRenderingContext2D, pts: readonly number[]): void {
  ctx.beginPath();
  ctx.moveTo(pts[0] as number, pts[1] as number);
  for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i] as number, pts[i + 1] as number);
  ctx.stroke();
}

/** Coil-over strut from the body mount to the wheel hub. */
function drawStrut(ctx: CanvasRenderingContext2D, ax: number, ay: number, bx: number, by: number, w: number) {
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  ctx.strokeStyle = '#3a3d46';
  ctx.lineWidth = w * 0.55;
  strokeLines(ctx, [ax, ay, bx, by]);
  // Spring coil: a zigzag whose pitch follows the compressed length.
  ctx.strokeStyle = '#d8dce6';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  const turns = 6;
  for (let i = 0; i <= turns * 2; i++) {
    const t = 0.12 + (0.7 * i) / (turns * 2);
    const side = i % 2 === 0 ? -1 : 1;
    const x = ax + dx * t + nx * side * w * 0.6;
    const y = ay + dy * t + ny * side * w * 0.6;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
}

function drawWheel(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  angle: number,
  style: CarStyle,
): void {
  ctx.fillStyle = '#17171b';
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fill();
  // Tread blocks.
  const blocks = style === CarStyle.Monster ? 12 : style === CarStyle.Racer ? 0 : 9;
  if (blocks > 0) {
    ctx.strokeStyle = '#2c2c33';
    ctx.lineWidth = style === CarStyle.Monster ? 4 : 2.5;
    ctx.beginPath();
    for (let k = 0; k < blocks; k++) {
      const a = angle + (k * TAU) / blocks;
      const c = Math.cos(a);
      const s = Math.sin(a);
      ctx.moveTo(x + c * r * 0.78, y + s * r * 0.78);
      ctx.lineTo(x + c * (r - 0.5), y + s * (r - 0.5));
    }
    ctx.stroke();
  }
  const hub = style === CarStyle.Racer ? 0.62 : style === CarStyle.Monster ? 0.5 : 0.55;
  ctx.fillStyle = style === CarStyle.Rover ? '#c9a94a' : style === CarStyle.Racer ? '#d7dbe4' : '#9aa0ad';
  ctx.beginPath();
  ctx.arc(x, y, r * hub, 0, TAU);
  ctx.fill();
  const spokes = style === CarStyle.Rover ? 6 : style === CarStyle.Racer ? 5 : 3;
  ctx.strokeStyle = style === CarStyle.Rover ? '#7a6420' : '#2b2b33';
  ctx.lineWidth = style === CarStyle.Rover ? 1.6 : 3;
  ctx.beginPath();
  for (let k = 0; k < spokes; k++) {
    const a = angle + (k * TAU) / spokes;
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(a) * r * hub, y + Math.sin(a) * r * hub);
  }
  ctx.stroke();
  ctx.fillStyle = '#2b2b33';
  ctx.beginPath();
  ctx.arc(x, y, r * 0.14, 0, TAU);
  ctx.fill();
}

function drawDriver(
  ctx: CanvasRenderingContext2D,
  head: { x: number; y: number },
  seatX: number,
  seatY: number,
  handX: number,
  handY: number,
  paint: CarPaint,
  space: boolean,
): void {
  ctx.lineCap = 'round';
  ctx.strokeStyle = paint.trim;
  ctx.lineWidth = 12;
  strokeLines(ctx, [seatX, seatY, head.x, head.y + 10]);
  ctx.strokeStyle = '#f6c18f';
  ctx.lineWidth = 5;
  strokeLines(ctx, [seatX + 2, (seatY + head.y) / 2 + 2, handX, handY]);
  ctx.lineCap = 'butt';
  ctx.fillStyle = '#f6c18f';
  ctx.beginPath();
  ctx.arc(head.x, head.y, 10, 0, TAU);
  ctx.fill();
  ctx.fillStyle = paint.helmet;
  ctx.beginPath();
  if (space) {
    // Bubble helmet with a visor.
    ctx.globalAlpha *= 0.9;
    ctx.arc(head.x, head.y, 13, 0, TAU);
    ctx.fill();
    ctx.globalAlpha /= 0.9;
    ctx.fillStyle = '#2a3b66';
    ctx.beginPath();
    ctx.ellipse(head.x + 4, head.y, 6, 8, 0, 0, TAU);
    ctx.fill();
  } else {
    ctx.arc(head.x, head.y - 2, 12, Math.PI, TAU);
    ctx.fill();
    ctx.fillRect(head.x - 12, head.y - 3, 24, 3);
  }
}

/**
 * Draw the car in its local frame: the caller has translated to the chassis bottom centre and
 * rotated to the chassis angle. Local units match the physics layout (body corners at ±46 px).
 */
export function drawCar(ctx: CanvasRenderingContext2D, pose: CarPose, paint: CarPaint): void {
  const { style } = pose;
  const outline = shade(paint.body.startsWith('#') ? paint.body : '#e63946', -0.4);
  const r = pose.wheelR;

  // Struts behind the body.
  for (let w = 0; w < 2; w++) {
    const m = pose.mounts[w] as { x: number; y: number };
    const p = pose.wheels[w] as { x: number; y: number };
    drawStrut(ctx, m.x, m.y, p.x, p.y, style === CarStyle.Monster ? 9 : 7);
  }

  const head = pose.head;
  switch (style) {
    case CarStyle.Monster: {
      // Ladder frame, lifted pickup body with a cab and big fender flares.
      ctx.fillStyle = '#26262c';
      fillRoundRect(ctx, -44, -6, 90, 7, 3, '#26262c');
      drawDriver(ctx, head, -8, -18, 18, -24, paint, false);
      ctx.fillStyle = paint.body;
      poly(ctx, [-48, -8, 48, -8, 50, -22, 22, -24, 14, -44, -16, -44, -20, -26, -48, -26]);
      ctx.fill();
      ctx.strokeStyle = outline;
      ctx.lineWidth = 2;
      ctx.stroke();
      // Windows
      ctx.fillStyle = 'rgba(190,230,255,0.85)';
      poly(ctx, [-12, -40, 10, -40, 16, -26, -12, -26]);
      ctx.fill();
      // Fender flares
      ctx.strokeStyle = paint.trim;
      ctx.lineWidth = 5;
      for (let w = 0; w < 2; w++) {
        const p = pose.wheels[w] as { x: number; y: number };
        ctx.beginPath();
        ctx.arc(p.x, -6, r * 0.95, Math.PI * 1.08, Math.PI * 1.92);
        ctx.stroke();
      }
      fillRoundRect(ctx, 44, -20, 6, 6, 2, '#fff6b0');
      break;
    }
    case CarStyle.Racer: {
      // Low wedge with a canopy and a rear wing.
      drawDriver(ctx, { x: head.x, y: head.y + 6 }, -10, -8, 14, -16, paint, false);
      ctx.fillStyle = paint.body;
      poly(ctx, [-48, -2, 48, 2, 50, -4, 24, -12, 8, -18, -20, -22, -46, -20]);
      ctx.fill();
      ctx.strokeStyle = outline;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = 'rgba(160,215,255,0.55)';
      poly(ctx, [-20, -22, 8, -18, -2, -36, -16, -38]);
      ctx.fill();
      // Wing
      ctx.strokeStyle = '#222';
      ctx.lineWidth = 3;
      strokeLines(ctx, [-40, -20, -42, -32]);
      fillRoundRect(ctx, -54, -36, 24, 6, 2, paint.trim);
      // Racing stripe and number disc
      ctx.strokeStyle = paint.trim;
      ctx.lineWidth = 4;
      strokeLines(ctx, [-44, -12, 46, -4]);
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(-24, -12, 6, 0, TAU);
      ctx.fill();
      fillRoundRect(ctx, 44, -6, 6, 4, 2, '#fff6b0');
      break;
    }
    case CarStyle.Rover: {
      // Open tubular frame, solar panel and an antenna with a blinking light.
      ctx.strokeStyle = '#8d93a3';
      ctx.lineWidth = 3;
      strokeLines(ctx, [-44, -4, -36, -26, 20, -26, 40, -6]);
      ctx.strokeStyle = '#6a7080';
      strokeLines(ctx, [-44, -24, -50, -48]);
      ctx.fillStyle = pose.braking || Math.floor(pose.time * 2) % 2 === 0 ? '#ff5050' : '#5a1010';
      ctx.beginPath();
      ctx.arc(-50, -50, 3, 0, TAU);
      ctx.fill();
      // Solar panel
      ctx.fillStyle = '#1d3f8f';
      poly(ctx, [-46, -30, -22, -34, -22, -30, -46, -26]);
      ctx.fill();
      ctx.strokeStyle = '#6aa0ff';
      ctx.lineWidth = 1;
      strokeLines(ctx, [-38, -31.5, -38, -27.5]);
      strokeLines(ctx, [-30, -33, -30, -29]);
      drawDriver(ctx, head, -6, -12, 18, -20, paint, true);
      ctx.fillStyle = paint.body;
      poly(ctx, [-48, 2, 48, 2, 48, -6, 30, -12, -48, -12]);
      ctx.fill();
      ctx.strokeStyle = outline;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.strokeStyle = paint.trim;
      ctx.lineWidth = 3;
      strokeLines(ctx, [-44, -5, 40, -5]);
      fillRoundRect(ctx, 42, -8, 6, 4, 2, '#fff6b0');
      break;
    }
    default: {
      // Trail jeep: open tub, roll cage, spare wheel.
      ctx.strokeStyle = '#2b2b33';
      ctx.lineWidth = 4;
      ctx.lineCap = 'round';
      strokeLines(ctx, [-40, -18, -34, -44, 2, -44, 12, -16]);
      ctx.lineCap = 'butt';
      drawDriver(ctx, head, -10, -16, 18, -22, paint, false);
      ctx.fillStyle = paint.body;
      poly(ctx, [-46, 2, 46, 2, 48, -12, 16, -15, 10, -20, -2, -16, -46, -20]);
      ctx.fill();
      ctx.strokeStyle = outline;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.strokeStyle = paint.trim;
      ctx.lineWidth = 5;
      strokeLines(ctx, [-44, -8, 46, -6]);
      // Windshield frame
      ctx.strokeStyle = '#2b2b33';
      ctx.lineWidth = 3;
      strokeLines(ctx, [16, -15, 10, -32]);
      // Spare wheel
      ctx.fillStyle = '#1b1b1f';
      ctx.beginPath();
      ctx.arc(-50, -10, 9, 0, TAU);
      ctx.fill();
      ctx.fillStyle = '#777';
      ctx.beginPath();
      ctx.arc(-50, -10, 4, 0, TAU);
      ctx.fill();
      fillRoundRect(ctx, 43, -10, 6, 5, 2, '#fff6b0');
    }
  }
  // Brake light
  if (pose.braking) fillRoundRect(ctx, -48, -14, 4, 5, 1, '#ff3030');

  for (let w = 0; w < 2; w++) {
    const p = pose.wheels[w] as { x: number; y: number };
    drawWheel(ctx, p.x, p.y, r, pose.wheelAngles[w] as number, style);
  }
}

/** A red jerrycan, centred on (x, y), `s` px tall. */
export function drawJerrycan(ctx: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  const k = s / 36;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(k, k);
  // Body with a chamfered top-left corner where the spout sits.
  ctx.fillStyle = '#e63946';
  ctx.beginPath();
  ctx.moveTo(-6, -15);
  ctx.lineTo(12, -15);
  ctx.quadraticCurveTo(14, -15, 14, -13);
  ctx.lineTo(14, 16);
  ctx.quadraticCurveTo(14, 18, 12, 18);
  ctx.lineTo(-12, 18);
  ctx.quadraticCurveTo(-14, 18, -14, 16);
  ctx.lineTo(-14, -7);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#8f1d26';
  ctx.lineWidth = 2;
  ctx.stroke();
  // Handle
  roundRectPath(ctx, -1, -20, 12, 7, 3);
  ctx.strokeStyle = '#8f1d26';
  ctx.lineWidth = 3;
  ctx.stroke();
  // Spout
  ctx.fillStyle = '#c7c9d1';
  ctx.save();
  ctx.translate(-11, -12);
  ctx.rotate(-Math.PI / 4);
  ctx.fillRect(-3, -6, 6, 8);
  ctx.restore();
  // Embossed X
  ctx.strokeStyle = '#ff8a94';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(-8, -4);
  ctx.lineTo(8, 12);
  ctx.moveTo(8, -4);
  ctx.lineTo(-8, 12);
  ctx.stroke();
  ctx.restore();
}
