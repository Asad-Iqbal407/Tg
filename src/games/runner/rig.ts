import { TAU } from '../../core/math';
import { roundRectPath, shade } from '../draw';

/** Colours for a rig; derived once per run from the skin palette. */
export interface RigColors {
  body: string;
  bodyDark: string;
  accent: string;
  accentDark: string;
  skin: string;
  hair: string;
  shoes: string;
  sole: string;
  outline: string;
}

export function rigColors(
  body: string,
  accent: string,
  skin: string,
  hair: string,
  shoes: string,
): RigColors {
  return {
    body,
    bodyDark: shade(body, -0.28),
    accent,
    accentDark: shade(accent, -0.3),
    skin,
    hair,
    shoes,
    sole: shade(shoes, -0.12),
    outline: 'rgba(12,8,24,0.55)',
  };
}

/** Animation state for one frame. Mutated in place by the game; no allocation per frame. */
export class RigPose {
  /** Run-cycle phase (radians) and stride amplitude (0.8 slow .. 1.1 fast). */
  phase = 0;
  stride = 1;
  /** 0 grounded .. 1 fully tucked in the air; `rising` lifts the arms. */
  air = 0;
  rising = false;
  /** Rolling when true; `rollAngle` spins the ball. */
  rolling = false;
  rollAngle = 0;
  /** Lean into lane changes (radians) and squash/stretch scale about the feet. */
  lean = 0;
  sqX = 1;
  sqY = 1;
  /** 0 running, 1 splat against a train front, 2 tripped forward. */
  crash = 0;
  jetpack = false;
  sneakers = false;
  /** Seconds since the jetpack started, for flame flicker. */
  time = 0;
}

/**
 * Draw the runner seen from behind with its feet at (x, y) and `s` px per metre. The rig works in
 * metres (y up is negative): two-segment legs with knees, arms that swing in depth (forward arms
 * pass behind the torso), hoodie with backpack, and the back of the head under a backwards cap.
 */
export function drawRig(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  s: number,
  pose: RigPose,
  c: RigColors,
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (pose.rolling) {
    drawBall(ctx, pose, c);
    ctx.restore();
    return;
  }
  ctx.rotate(pose.lean);
  ctx.scale(pose.sqX, pose.sqY);

  const ph = pose.phase;
  const air = pose.air;
  const run = 1 - air;
  const hipY = -0.92 - run * 0.05 * pose.stride * Math.abs(Math.cos(ph)) - air * 0.04;
  const shoulderY = hipY - 0.52;

  // Legs: the swing leg (foot kicked back toward the camera) is drawn last.
  const rightSwing = Math.sin(ph) > 0;
  drawLeg(ctx, rightSwing ? -1 : 1, ph, hipY, pose, c);
  drawLeg(ctx, rightSwing ? 1 : -1, ph, hipY, pose, c);

  // Arms swinging forward pass behind the torso.
  for (let side = -1; side <= 1; side += 2)
    if (armSwing(side, ph, pose) > 0.15) drawArm(ctx, side, shoulderY, pose, c);
  drawTorso(ctx, hipY, shoulderY, pose, c);
  for (let side = -1; side <= 1; side += 2)
    if (armSwing(side, ph, pose) <= 0.15) drawArm(ctx, side, shoulderY, pose, c);
  drawHead(ctx, shoulderY, c);
  ctx.restore();
}

function legPhase(side: number, ph: number): number {
  return side > 0 ? ph : ph + Math.PI;
}

/** > 0 when the arm swings forward (away from the camera). Arms move opposite to the same-side leg. */
function armSwing(side: number, ph: number, pose: RigPose): number {
  if (pose.crash !== 0 || pose.air > 0.5) return -1;
  return -Math.sin(legPhase(side, ph)) * pose.stride;
}

function drawLeg(
  ctx: CanvasRenderingContext2D,
  side: number,
  ph: number,
  hipY: number,
  pose: RigPose,
  c: RigColors,
): void {
  const air = pose.air;
  const run = 1 - air;
  const lift = run * Math.max(0, Math.sin(legPhase(side, ph))) * pose.stride;
  const hipX = side * 0.11;
  // Running: the knee rises and the foot kicks up behind. Airborne: both knees tucked.
  const kneeY = hipY + 0.42 * (1 - 0.3 * lift) - air * 0.14;
  const footY = -0.42 * lift + air * (hipY + 0.5);
  const kneeX = side * (0.12 + 0.05 * air);
  const footX = side * (0.12 + 0.03 * lift + 0.08 * air);
  ctx.strokeStyle = c.accent;
  ctx.lineWidth = 0.2;
  ctx.beginPath();
  ctx.moveTo(hipX, hipY);
  ctx.lineTo(kneeX, kneeY);
  ctx.stroke();
  ctx.strokeStyle = c.accentDark;
  ctx.lineWidth = 0.165;
  ctx.beginPath();
  ctx.moveTo(kneeX, kneeY);
  ctx.lineTo(footX, footY - 0.1);
  ctx.stroke();
  const shoe = pose.sneakers ? '#2ec5ff' : c.shoes;
  ctx.fillStyle = shoe;
  ctx.beginPath();
  ctx.ellipse(footX, footY - 0.06, 0.11, 0.075, 0, 0, TAU);
  ctx.fill();
  if (lift > 0.35 || air > 0.5) {
    // The lifted foot shows its sole to the camera.
    ctx.fillStyle = c.sole;
    ctx.beginPath();
    ctx.ellipse(footX, footY - 0.03, 0.1, 0.045, 0, 0, TAU);
    ctx.fill();
  }
}

function drawArm(
  ctx: CanvasRenderingContext2D,
  side: number,
  shoulderY: number,
  pose: RigPose,
  c: RigColors,
): void {
  const sx = side * 0.27;
  const sy = shoulderY + 0.07;
  let ex: number;
  let ey: number;
  let hx: number;
  let hy: number;
  if (pose.crash === 1) {
    ex = side * 0.48;
    ey = shoulderY - 0.05;
    hx = side * 0.58;
    hy = shoulderY - 0.32;
  } else if (pose.air > 0.5) {
    const up = pose.rising ? 1 : 0;
    ex = side * 0.46;
    ey = shoulderY + 0.06 - 0.12 * up;
    hx = side * (0.6 - 0.06 * up);
    hy = shoulderY - 0.02 - 0.3 * up;
  } else {
    const a = armSwing(side, pose.phase, pose);
    const back = Math.max(0, -a);
    ex = side * (0.37 + 0.05 * back);
    ey = shoulderY + 0.3 - 0.08 * a;
    hx = side * (0.31 - 0.08 * a + 0.05 * back);
    hy = shoulderY + 0.5 - 0.26 * a;
  }
  ctx.strokeStyle = c.body;
  ctx.lineWidth = 0.14;
  ctx.beginPath();
  ctx.moveTo(sx, sy);
  ctx.lineTo(ex, ey);
  ctx.lineTo(hx, hy);
  ctx.stroke();
  ctx.fillStyle = c.skin;
  ctx.beginPath();
  ctx.arc(hx, hy, 0.065, 0, TAU);
  ctx.fill();
}

function drawTorso(
  ctx: CanvasRenderingContext2D,
  hipY: number,
  shoulderY: number,
  pose: RigPose,
  c: RigColors,
): void {
  ctx.fillStyle = c.body;
  ctx.beginPath();
  ctx.moveTo(-0.2, hipY + 0.05);
  ctx.lineTo(0.2, hipY + 0.05);
  ctx.lineTo(0.27, shoulderY + 0.12);
  ctx.quadraticCurveTo(0.28, shoulderY - 0.02, 0.13, shoulderY - 0.03);
  ctx.lineTo(-0.13, shoulderY - 0.03);
  ctx.quadraticCurveTo(-0.28, shoulderY - 0.02, -0.27, shoulderY + 0.12);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = c.outline;
  ctx.lineWidth = 0.03;
  ctx.stroke();
  // Shaded right side and the hoodie's waistband.
  ctx.fillStyle = c.bodyDark;
  ctx.beginPath();
  ctx.moveTo(0.09, hipY + 0.05);
  ctx.lineTo(0.2, hipY + 0.05);
  ctx.lineTo(0.27, shoulderY + 0.12);
  ctx.lineTo(0.16, shoulderY + 0.06);
  ctx.closePath();
  ctx.fill();
  ctx.fillRect(-0.2, hipY - 0.03, 0.4, 0.08);
  if (pose.jetpack) {
    ctx.fillStyle = '#8d5cf6';
    for (let k = -1; k <= 1; k += 2) {
      ctx.beginPath();
      ctx.ellipse(k * 0.1, shoulderY + 0.3, 0.085, 0.21, 0, 0, TAU);
      ctx.fill();
    }
    ctx.fillStyle = '#4b2a8c';
    ctx.fillRect(-0.16, shoulderY + 0.48, 0.32, 0.06);
    // Flames flicker with time, not with the RNG.
    const f = 0.18 + 0.07 * Math.sin(pose.time * 47) + 0.05 * Math.sin(pose.time * 31);
    for (let k = -1; k <= 1; k += 2) {
      ctx.fillStyle = '#ffb703';
      ctx.beginPath();
      ctx.moveTo(k * 0.1 - 0.06, shoulderY + 0.53);
      ctx.lineTo(k * 0.1, shoulderY + 0.53 + f * 2);
      ctx.lineTo(k * 0.1 + 0.06, shoulderY + 0.53);
      ctx.fill();
      ctx.fillStyle = '#fff3c4';
      ctx.beginPath();
      ctx.moveTo(k * 0.1 - 0.03, shoulderY + 0.53);
      ctx.lineTo(k * 0.1, shoulderY + 0.53 + f);
      ctx.lineTo(k * 0.1 + 0.03, shoulderY + 0.53);
      ctx.fill();
    }
  } else {
    // Backpack with straps and a flap.
    ctx.strokeStyle = c.accentDark;
    ctx.lineWidth = 0.05;
    ctx.beginPath();
    ctx.moveTo(-0.14, shoulderY + 0.14);
    ctx.lineTo(-0.17, shoulderY + 0.01);
    ctx.moveTo(0.14, shoulderY + 0.14);
    ctx.lineTo(0.17, shoulderY + 0.01);
    ctx.stroke();
    ctx.fillStyle = c.accent;
    roundRectPath(ctx, -0.17, shoulderY + 0.12, 0.34, 0.36, 0.07);
    ctx.fill();
    ctx.fillStyle = c.accentDark;
    roundRectPath(ctx, -0.17, shoulderY + 0.12, 0.34, 0.13, 0.06);
    ctx.fill();
    ctx.fillRect(-0.09, shoulderY + 0.33, 0.18, 0.04);
  }
  // Hood resting on the shoulders.
  ctx.fillStyle = c.bodyDark;
  ctx.beginPath();
  ctx.ellipse(0, shoulderY + 0.04, 0.16, 0.075, 0, 0, TAU);
  ctx.fill();
}

function drawHead(ctx: CanvasRenderingContext2D, shoulderY: number, c: RigColors): void {
  const cy = shoulderY - 0.21;
  ctx.fillStyle = c.skin;
  ctx.fillRect(-0.055, shoulderY - 0.1, 0.11, 0.1);
  ctx.beginPath();
  ctx.ellipse(-0.172, cy + 0.02, 0.035, 0.055, 0, 0, TAU);
  ctx.ellipse(0.172, cy + 0.02, 0.035, 0.055, 0, 0, TAU);
  ctx.fill();
  // Back of the head is hair.
  ctx.fillStyle = c.hair;
  ctx.beginPath();
  ctx.arc(0, cy, 0.175, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = c.outline;
  ctx.lineWidth = 0.03;
  ctx.stroke();
  // Backwards cap: dome, band, snapback opening and the brim over the neck.
  ctx.fillStyle = c.accent;
  ctx.beginPath();
  ctx.arc(0, cy - 0.015, 0.185, Math.PI, 0);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = c.accentDark;
  ctx.fillRect(-0.185, cy - 0.03, 0.37, 0.05);
  ctx.fillStyle = c.hair;
  ctx.beginPath();
  ctx.arc(0, cy - 0.03, 0.05, Math.PI, 0);
  ctx.fill();
  ctx.fillStyle = c.accentDark;
  ctx.beginPath();
  ctx.ellipse(0, cy + 0.045, 0.13, 0.035, 0, 0, Math.PI);
  ctx.fill();
}

function drawBall(ctx: CanvasRenderingContext2D, pose: RigPose, c: RigColors): void {
  const r = 0.5;
  // A forward roll seen from behind: the tucked body's features scroll over the ball vertically,
  // pivoting about the ball's centre (translate first) so it stays on the ground.
  ctx.translate(0, -r);
  ctx.strokeStyle = 'rgba(255,255,255,0.4)';
  ctx.lineWidth = 0.05;
  ctx.beginPath();
  for (let side = -1; side <= 1; side += 2) {
    const a0 = side < 0 ? Math.PI * 0.75 : -Math.PI * 0.25;
    ctx.moveTo(Math.cos(a0) * r * 1.3, Math.sin(a0) * r * 1.3);
    ctx.arc(0, 0, r * 1.3, a0, a0 + Math.PI * 0.5);
  }
  ctx.stroke();
  ctx.save();
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, TAU);
  ctx.fillStyle = c.body;
  ctx.fill();
  ctx.clip();
  const t = (((pose.rollAngle / TAU) % 1) + 1) % 1;
  for (let k = 0; k < 2; k++) {
    const y = ((t + k * 0.5) % 1) * 2.6 * r - 1.3 * r;
    // Backpack band, then the head with its cap half a turn later.
    ctx.fillStyle = c.accent;
    ctx.fillRect(-0.3, y - 0.12, 0.6, 0.24);
    ctx.fillStyle = c.accentDark;
    ctx.fillRect(-0.3, y - 0.12, 0.6, 0.06);
    const hy = y + 1.3 * r > 1.3 * r ? y - 1.3 * r : y + 1.3 * r;
    ctx.fillStyle = c.hair;
    ctx.beginPath();
    ctx.arc(0, hy, 0.17, 0, TAU);
    ctx.fill();
    ctx.fillStyle = c.accent;
    ctx.beginPath();
    ctx.arc(0, hy - 0.02, 0.18, Math.PI, 0);
    ctx.fill();
  }
  // Shading gives the ball volume.
  ctx.fillStyle = 'rgba(10,6,24,0.28)';
  ctx.beginPath();
  ctx.arc(0.16, 0.14, r, 0, TAU);
  ctx.arc(-0.06, -0.05, r * 0.92, 0, TAU, true);
  ctx.fill();
  ctx.restore();
  ctx.strokeStyle = c.outline;
  ctx.lineWidth = 0.03;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, TAU);
  ctx.stroke();
  // Shoes peeking out under the ball.
  ctx.fillStyle = c.sole;
  ctx.beginPath();
  ctx.ellipse(-0.14, r * 0.93, 0.1, 0.05, 0, 0, TAU);
  ctx.ellipse(0.14, r * 0.93, 0.1, 0.05, 0, 0, TAU);
  ctx.fill();
}
