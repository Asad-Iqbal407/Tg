import { clamp, wrapAngle } from '../../core/math';
import type { Terrain } from './terrain';

export const SUBSTEPS = 6;
const ITERATIONS = 6;
export const GRAVITY = 980;

/** Engine acceleration (px/s²) at standstill, before the vehicle's power (traction limits it too). */
const DRIVE_ACCEL = 600;
const BRAKE_DECEL = 950;
const REVERSE_ACCEL = 320;
const ROLL_DECEL = 22;
/** Air control (rad/s²) once truly airborne, after a short debounce that ignores micro-hops. */
const AIR_TORQUE = 13;
const AIR_DELAY = 0.12;
const AIR_RAMP = 0.15;
/** Throttle reaction torque with both wheels down (rad/s², fades out towards top speed). */
const GROUND_TORQUE = 2.4;
/** Brake (rear wheel only) or gas (front wheel only) torque that helps level the car. */
const RECOVER_TORQUE = 3.5;
/** Angular damping (1/s) while any point touches the ground. */
const GROUND_SPIN_DAMP = 1.2;
/** Suspension travel (px) from the loaded rest position. */
const BUMP_TRAVEL = 10;
const DROOP_TRAVEL = 8;

export interface VehicleSpec {
  power: number;
  maxSpeed: number;
  /** Tyre grip (0.27-0.40 in the catalog); scales traction and braking. */
  grip: number;
  wheelR: number;
  /** Suspension stiffness (0.25 soft ... 0.45 stiff). */
  suspension: number;
  airControl: number;
}

export interface VPoint {
  x: number;
  y: number;
  px: number;
  py: number;
  r: number;
  invMass: number;
  grounded: boolean;
}

export interface DriveInput {
  throttle: number;
  brake: number;
  /** Reversing burns fuel; braking to a stop doesn't. */
  canReverse: boolean;
}

export interface PhysicsEnv {
  gravity: number;
  grip: number;
}

interface Stick {
  a: number;
  b: number;
  len: number;
}

/** Contact scratch for the terrain query (avoids allocating in the physics hot loop). */
interface Hit {
  px: number;
  py: number;
  d: number;
  nx: number;
  ny: number;
}

/** Point indices. 0/1 are the wheels; 2..6 form the rigid body (6 is the driver's head). */
export const REAR = 0;
export const FRONT = 1;
export const HEAD = 6;
const BODY_FIRST = 2;

/**
 * Soft-body car: two wheel points on damped spring struts under a rigid five-point body,
 * integrated with Verlet at 6 substeps. Drive, braking and torques are explicit accelerations,
 * so traction, climbing ability and air control can be tuned independently.
 */
export class Vehicle {
  pts: VPoint[] = [];
  /** Wheel spin (rad/s) and angle, for rendering and engine pitch. */
  readonly wheelSpin = [0, 0];
  readonly wheelAngle = [0, 0];
  /** Seconds since no point touched the ground (0 while any point is down). */
  airT = 0;
  /** Unit ground tangent under the grounded wheels (last known). */
  readonly tangent = { x: 1, y: 0 };
  private sticks: Stick[] = [];
  private readonly hit: Hit = { px: 0, py: 0, d: 0, nx: 0, ny: -1 };
  private readonly contactN = [
    { x: 0, y: -1 },
    { x: 0, y: -1 },
  ];
  /** Rest position of each wheel in the body frame (u along the chassis, v "down"). */
  private readonly restU = [0, 0];
  private readonly restV = [0, 0];
  private bodyMass = 1;
  private bodyInertia = 1;
  private readonly springK: number;
  private readonly springC: number;
  private readonly preload: number;
  /** Tyre friction coefficient: the jeep's 0.32 grip climbs ~30° on dry ground. */
  private readonly mu: number;
  private readonly spinCap: number;
  // Scratch frame, recomputed by frame().
  private ox = 0;
  private oy = 0;
  private eux = 1;
  private euy = 0;
  /** 1 / substep duration. */
  private invDt = 60 * SUBSTEPS;

  constructor(
    private readonly terrain: Terrain,
    readonly spec: VehicleSpec,
  ) {
    this.mu = Math.tan((30 * Math.PI) / 180) * (spec.grip / 0.32);
    this.spinCap = 5 + 1.5 * spec.airControl;
    // Body mass is fixed by the layout below; derive the spring from a target bounce frequency.
    const bodyMass = 4 + 1 / 2.4;
    const freq = 1.7 + 2.2 * spec.suspension;
    const w = 2 * Math.PI * freq;
    this.springK = (bodyMass * w * w) / 2;
    this.springC = 0.5 * Math.sqrt(2 * this.springK * bodyMass);
    // Preload carries half the body's weight, so the loaded car rests at the design height.
    this.preload = (bodyMass * GRAVITY) / 2;
  }

  /** Place the car at rest with its rear-to-front axis at `angle`, wheels just above the ground. */
  reset(x: number, angle: number): void {
    const r = this.spec.wheelR;
    const spread = (r - 20) * 0.6;
    const wy = 18 + (r - 20) * 0.3;
    const local: [number, number, number, number][] = [
      // x, y, radius, invMass
      [-32 - spread, wy, r, 0.5], // 0 rear wheel
      [34 + spread, wy, r, 0.5], // 1 front wheel
      [-46, 0, 4, 1], // 2 rear bottom
      [46, 0, 4, 1], // 3 front bottom
      [36, -24, 4, 1], // 4 front top
      [-44, -26, 4, 1], // 5 rear top
      [-6, -46, 11, 2.4], // 6 head
    ];
    // Body frame origin: mass centre of the rigid body points.
    let mx = 0;
    let my = 0;
    let mass = 0;
    for (let i = BODY_FIRST; i < local.length; i++) {
      const [lx, ly, , im] = local[i] as [number, number, number, number];
      mx += lx / im;
      my += ly / im;
      mass += 1 / im;
    }
    mx /= mass;
    my /= mass;
    let inertia = 0;
    for (let i = BODY_FIRST; i < local.length; i++) {
      const [lx, ly, , im] = local[i] as [number, number, number, number];
      inertia += ((lx - mx) ** 2 + (ly - my) ** 2) / im;
    }
    this.bodyMass = mass;
    this.bodyInertia = inertia;
    for (let w = 0; w < 2; w++) {
      const [lx, ly] = local[w] as [number, number, number, number];
      this.restU[w] = lx - mx;
      this.restV[w] = ly - my;
    }

    const ca = Math.cos(angle);
    const sa = Math.sin(angle);
    // Lowest wheel bottom sits 2 px above the highest ground under the car.
    let lift = Infinity;
    for (let w = 0; w < 2; w++) {
      const [lx, ly] = local[w] as [number, number, number, number];
      const wx = x + lx * ca - ly * sa;
      const wyRel = lx * sa + ly * ca;
      let ground = Infinity;
      for (let dx = -r; dx <= r; dx += r / 2) ground = Math.min(ground, this.terrain.heightAt(wx + dx));
      lift = Math.min(lift, ground - wyRel - r - 2);
    }
    this.pts = local.map(([lx, ly, pr, im]) => {
      const wx = x + lx * ca - ly * sa;
      const wy2 = lift + lx * sa + ly * ca;
      return { x: wx, y: wy2, px: wx, py: wy2, r: pr, invMass: im, grounded: false };
    });
    this.sticks = [];
    for (let i = BODY_FIRST; i < local.length; i++)
      for (let j = i + 1; j < local.length; j++) {
        const a = this.pts[i] as VPoint;
        const b = this.pts[j] as VPoint;
        this.sticks.push({ a: i, b: j, len: Math.hypot(a.x - b.x, a.y - b.y) });
      }
    this.wheelSpin[0] = this.wheelSpin[1] = 0;
    this.airT = 0;
  }

  // ------------------------------------------------------------------ queries

  center(): { x: number; y: number } {
    const p2 = this.pts[2] as VPoint;
    const p4 = this.pts[4] as VPoint;
    return { x: (p2.x + p4.x) / 2, y: (p2.y + p4.y) / 2 };
  }

  /** Chassis angle (rear-bottom to front-bottom); positive is nose down. */
  angle(): number {
    const a = this.pts[2] as VPoint;
    const b = this.pts[3] as VPoint;
    return Math.atan2(b.y - a.y, b.x - a.x);
  }

  /** Chassis velocity (px/s), from the two bottom corners. */
  velocityX(): number {
    const p = this.pts[2] as VPoint;
    const q = this.pts[3] as VPoint;
    return ((p.x - p.px + q.x - q.px) / 2) * this.invDt;
  }

  velocityY(): number {
    const p = this.pts[2] as VPoint;
    const q = this.pts[3] as VPoint;
    return ((p.y - p.py + q.y - q.py) / 2) * this.invDt;
  }

  speed(): number {
    return Math.hypot(this.velocityX(), this.velocityY());
  }

  /** Chassis angular velocity (rad/s, positive = nose-down rotation). */
  angularVelocity(): number {
    const a = this.pts[2] as VPoint;
    const b = this.pts[3] as VPoint;
    const prev = Math.atan2(b.py - a.py, b.px - a.px);
    return wrapAngle(this.angle() - prev) * this.invDt;
  }

  wheelDown(w: number): boolean {
    return (this.pts[w] as VPoint).grounded;
  }

  /** Any of the chassis corners touches the ground. */
  bodyDown(): boolean {
    for (let i = BODY_FIRST; i < HEAD; i++) if ((this.pts[i] as VPoint).grounded) return true;
    return false;
  }

  headDown(): boolean {
    return (this.pts[HEAD] as VPoint).grounded;
  }

  /** Current strut compression for wheel w, in px (positive = compressed). */
  compression(w: number): number {
    this.frame();
    const p = this.pts[w] as VPoint;
    const v = (p.x - this.ox) * -this.euy + (p.y - this.oy) * this.eux;
    return (this.restV[w] as number) - v;
  }

  // ------------------------------------------------------------------ simulation

  /** Advance one 60 Hz tick. */
  step(dt: number, input: DriveInput, env: PhysicsEnv): void {
    const sdt = dt / SUBSTEPS;
    this.invDt = 1 / sdt;
    for (let i = 0; i < SUBSTEPS; i++) this.substep(sdt, input, env);
  }

  private substep(dt: number, input: DriveInput, env: PhysicsEnv): void {
    const pts = this.pts;
    const g = GRAVITY * env.gravity;
    const dt2 = dt * dt;
    for (const p of pts) {
      const vx = (p.x - p.px) * 0.9998;
      const vy = (p.y - p.py) * 0.9998;
      p.px = p.x;
      p.py = p.y;
      p.x += vx;
      p.y += vy + g * dt2;
    }

    this.applySprings(dt);
    this.applyTorque(dt, input, env);

    for (let it = 0; it < ITERATIONS; it++) {
      for (const s of this.sticks) {
        const a = pts[s.a] as VPoint;
        const b = pts[s.b] as VPoint;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.hypot(dx, dy) || 0.0001;
        const diff = (d - s.len) / d;
        const wsum = a.invMass + b.invMass;
        const ka = (a.invMass / wsum) * diff;
        const kb = (b.invMass / wsum) * diff;
        a.x += dx * ka;
        a.y += dy * ka;
        b.x -= dx * kb;
        b.y -= dy * kb;
      }
      this.solveStruts();
      this.collideGround(false);
    }
    this.collideGround(true);
    this.applyDrive(dt, input, env);

    const anyDown = pts.some((p) => p.grounded);
    this.airT = anyDown ? 0 : this.airT + dt;
    this.updateWheels(dt, input);
  }

  /** Body frame: mass-weighted origin of the rigid body and its chassis axis. */
  private frame(): void {
    let x = 0;
    let y = 0;
    let m = 0;
    for (let i = BODY_FIRST; i < this.pts.length; i++) {
      const p = this.pts[i] as VPoint;
      const mi = 1 / p.invMass;
      x += p.x * mi;
      y += p.y * mi;
      m += mi;
    }
    this.ox = x / m;
    this.oy = y / m;
    const a = this.pts[2] as VPoint;
    const b = this.pts[3] as VPoint;
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    this.eux = (b.x - a.x) / len;
    this.euy = (b.y - a.y) / len;
  }

  /** Move the body as a rigid unit: translate by (tx, ty) and rotate by dTheta about its origin. */
  private moveBody(tx: number, ty: number, dTheta: number): void {
    for (let i = BODY_FIRST; i < this.pts.length; i++) {
      const p = this.pts[i] as VPoint;
      const rx = p.x - this.ox;
      const ry = p.y - this.oy;
      p.x += tx - ry * dTheta;
      p.y += ty + rx * dTheta;
    }
  }

  /**
   * Positional constraint between wheel w and the body along unit direction n, removing error c.
   * The body responds with its generalised inverse mass at the wheel's location (so off-centre
   * corrections also rotate it).
   */
  private strutCorrect(w: number, nx: number, ny: number, c: number): void {
    const p = this.pts[w] as VPoint;
    const rx = p.x - this.ox;
    const ry = p.y - this.oy;
    const rn = rx * ny - ry * nx;
    const wb = 1 / this.bodyMass + (rn * rn) / this.bodyInertia;
    const lambda = -c / (p.invMass + wb);
    p.x += nx * lambda * p.invMass;
    p.y += ny * lambda * p.invMass;
    this.moveBody((-nx * lambda) / this.bodyMass, (-ny * lambda) / this.bodyMass, (-lambda * rn) / this.bodyInertia);
  }

  /** Keep each wheel on its strut axis and within its travel. */
  private solveStruts(): void {
    for (let w = 0; w < 2; w++) {
      this.frame();
      const p = this.pts[w] as VPoint;
      const evx = -this.euy;
      const evy = this.eux;
      const u = (p.x - this.ox) * this.eux + (p.y - this.oy) * this.euy;
      this.strutCorrect(w, this.eux, this.euy, u - (this.restU[w] as number));
      this.frame();
      const v = (p.x - this.ox) * evx + (p.y - this.oy) * evy;
      const rest = this.restV[w] as number;
      if (v < rest - BUMP_TRAVEL) this.strutCorrect(w, evx, evy, v - (rest - BUMP_TRAVEL));
      else if (v > rest + DROOP_TRAVEL) this.strutCorrect(w, evx, evy, v - (rest + DROOP_TRAVEL));
    }
  }

  /** Spring-damper along each strut, applied as accelerations (outside the rigid solve). */
  private applySprings(dt: number): void {
    const scale = this.invDt;
    this.frame();
    // Body velocity (translation of the origin and spin), from Verlet positions.
    let vx = 0;
    let vy = 0;
    let m = 0;
    for (let i = BODY_FIRST; i < this.pts.length; i++) {
      const p = this.pts[i] as VPoint;
      const mi = 1 / p.invMass;
      vx += (p.x - p.px) * mi;
      vy += (p.y - p.py) * mi;
      m += mi;
    }
    vx = (vx / m) * scale;
    vy = (vy / m) * scale;
    const spin = this.angularVelocity();
    const evx = -this.euy;
    const evy = this.eux;
    const dt2 = dt * dt;
    for (let w = 0; w < 2; w++) {
      const p = this.pts[w] as VPoint;
      const rx = p.x - this.ox;
      const ry = p.y - this.oy;
      const v = rx * evx + ry * evy;
      // Velocity of the body point currently under the wheel.
      const bx = vx - ry * spin;
      const by = vy + rx * spin;
      const rel = ((p.x - p.px) * scale - bx) * evx + ((p.y - p.py) * scale - by) * evy;
      const f = this.preload - this.springK * (v - (this.restV[w] as number)) - this.springC * rel;
      p.x += evx * f * p.invMass * dt2;
      p.y += evy * f * p.invMass * dt2;
      const torque = -f * (rx * evy - ry * evx);
      this.moveBody(
        (-evx * f * dt2) / this.bodyMass,
        (-evy * f * dt2) / this.bodyMass,
        (torque / this.bodyInertia) * dt2,
      );
    }
  }

  private applyTorque(dt: number, input: DriveInput, env: PhysicsEnv): void {
    const rear = this.wheelDown(REAR);
    const front = this.wheelDown(FRONT);
    const anyDown = this.airT === 0 && (rear || front || this.bodyDown() || this.headDown());
    const omega = this.angularVelocity();
    let torque = 0;
    if (this.airT > AIR_DELAY) {
      const k = clamp((this.airT - AIR_DELAY) / AIR_RAMP, 0, 1);
      torque =
        (input.brake - input.throttle) * AIR_TORQUE * this.spec.airControl * k * Math.sqrt(env.gravity);
      if (torque * omega > 0 && Math.abs(omega) >= this.spinCap) torque = 0;
    } else if (rear && front) {
      const v = this.vAlong();
      const fade = Math.max(0, 1 - v / this.spec.maxSpeed);
      const braking = input.brake > 0 && v > 8 ? 0.7 : 0;
      torque = (braking - input.throttle) * GROUND_TORQUE * this.spec.power * fade * env.gravity;
    } else if (rear) {
      torque = input.brake * RECOVER_TORQUE * env.gravity;
    } else if (front) {
      torque = -input.throttle * RECOVER_TORQUE * env.gravity;
    }
    if (anyDown) torque -= omega * GROUND_SPIN_DAMP;
    if (torque === 0) return;
    // Rotate every point about the overall centre of mass.
    let cx = 0;
    let cy = 0;
    let m = 0;
    for (const p of this.pts) {
      const mi = 1 / p.invMass;
      cx += p.x * mi;
      cy += p.y * mi;
      m += mi;
    }
    cx /= m;
    cy /= m;
    const k = torque * dt * dt;
    for (const p of this.pts) {
      const dx = p.x - cx;
      const dy = p.y - cy;
      p.x -= dy * k;
      p.y += dx * k;
    }
  }

  /** Chassis velocity along the ground tangent (px/s). */
  private vAlong(): number {
    return this.velocityX() * this.tangent.x + this.velocityY() * this.tangent.y;
  }

  /** Engine, brakes and rolling resistance act on the whole car along the ground tangent. */
  private applyDrive(dt: number, input: DriveInput, env: PhysicsEnv): void {
    const rear = this.wheelDown(REAR);
    const front = this.wheelDown(FRONT);
    const n = (rear ? 1 : 0) + (front ? 1 : 0);
    if (n === 0) return;
    let tx = 0;
    let ty = 0;
    for (let w = 0; w < 2; w++) {
      if (!this.wheelDown(w)) continue;
      const c = this.contactN[w] as { x: number; y: number };
      tx += -c.y;
      ty += c.x;
    }
    const len = Math.hypot(tx, ty) || 1;
    this.tangent.x = tx / len;
    this.tangent.y = ty / len;
    const v = this.vAlong();
    const share = n / 2;
    // Traction limit: friction coefficient times the normal load (cos of the slope).
    const traction = this.mu * env.grip * GRAVITY * env.gravity * Math.abs(this.tangent.x) * share;
    const max = this.spec.maxSpeed;
    let dv = 0;
    if (input.throttle > 0) {
      const fade = v > 0 ? Math.max(0, 1 - v / max) : 1;
      dv = Math.min(DRIVE_ACCEL * this.spec.power * fade, traction) * input.throttle * dt;
    } else if (input.brake > 0 && (v > 8 || !input.canReverse)) {
      dv = -Math.sign(v) * Math.min(Math.abs(v), Math.min(BRAKE_DECEL, traction * 1.4) * dt);
    } else if (input.brake > 0) {
      const revMax = max * 0.4;
      const fade = v < 0 ? Math.max(0, 1 - (v / revMax) ** 2) : 1;
      dv = -Math.min(REVERSE_ACCEL * this.spec.power * fade, traction) * input.brake * dt;
    } else {
      dv = -Math.sign(v) * Math.min(Math.abs(v), ROLL_DECEL * dt);
    }
    if (dv === 0) return;
    const ddx = this.tangent.x * dv * dt;
    const ddy = this.tangent.y * dv * dt;
    for (const p of this.pts) {
      p.x += ddx;
      p.y += ddy;
    }
  }

  private updateWheels(dt: number, input: DriveInput): void {
    const maxW = this.spec.maxSpeed / this.spec.wheelR;
    for (let w = 0; w < 2; w++) {
      const p = this.pts[w] as VPoint;
      let spin = this.wheelSpin[w] as number;
      if (p.grounded) {
        const c = this.contactN[w] as { x: number; y: number };
        const vt = ((p.x - p.px) * -c.y + (p.y - p.py) * c.x) / dt;
        spin = vt / p.r;
        // A little wheelspin under full throttle at low speed.
        if (input.throttle > 0) spin += (maxW - spin) * 0.08;
      } else if (input.throttle > 0) spin = Math.min(maxW, spin + maxW * 2 * dt);
      else if (input.brake > 0) spin *= 1 - Math.min(1, 12 * dt);
      else spin *= 1 - 0.4 * dt;
      this.wheelSpin[w] = spin;
      this.wheelAngle[w] = (this.wheelAngle[w] as number) + spin * dt;
    }
  }

  /**
   * Position-only pushes during constraint iterations; the final pass (`contact`) also decides
   * which points touch the ground (with a small tolerance) and applies restitution and friction.
   * Wheels roll freely; the chassis corners and head slide with friction.
   */
  private collideGround(contact: boolean): void {
    const hit = this.hit;
    for (let i = 0; i < this.pts.length; i++) {
      const p = this.pts[i] as VPoint;
      if (contact) p.grounded = false;
      this.terrain.closestInto(p.x, p.y, p.r + 2, hit);
      let nx = hit.nx;
      let ny = hit.ny;
      let pen = p.r - hit.d;
      const surface = this.terrain.heightAt(p.x);
      if (p.y > surface) {
        // Centre is underground: push straight out along the surface normal.
        const sl = this.terrain.slopeAt(p.x);
        const len = Math.hypot(sl, 1);
        nx = sl / len;
        ny = -1 / len;
        pen = p.r + (p.y - surface) / len;
      } else if (hit.d > 0.0001) {
        nx = (p.x - hit.px) / hit.d;
        ny = (p.y - hit.py) / hit.d;
      }
      if (pen <= (contact ? -1.5 : 0)) continue;
      if (pen > 0) {
        p.x += nx * pen;
        p.y += ny * pen;
      }
      if (!contact) continue;
      p.grounded = true;
      if (i < 2) {
        const c = this.contactN[i] as { x: number; y: number };
        c.x = nx;
        c.y = ny;
      }
      const vx = p.x - p.px;
      const vy = p.y - p.py;
      const tx = -ny;
      const ty = nx;
      let vn = vx * nx + vy * ny;
      let vt = vx * tx + vy * ty;
      if (vn < 0) vn = -vn * 0.12;
      if (i >= 2) vt *= 0.92;
      p.px = p.x - (nx * vn + tx * vt);
      p.py = p.y - (ny * vn + ty * vt);
    }
  }
}
