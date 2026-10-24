import { clamp } from '../../core/math';
import type { Rng } from '../../core/rng';
import { airtimeAt, HIGH_TOP, laneX, LOW_TOP, progressAt, speedAt, TRAIN_H, WARMUP_M } from './config';

export type ObKind = 'low' | 'high' | 'train' | 'ramp';
export type PowerKind = 'magnet' | 'double' | 'sneakers' | 'jetpack';

export interface Obstacle {
  kind: ObKind;
  lane: number;
  /** World z of the near (front) end; the obstacle covers [z, z + len]. */
  z: number;
  len: number;
  h: number;
  /** Speed along the track once armed (negative = oncoming train). */
  vz: number;
  armed: boolean;
  /** Stable per-obstacle number for cosmetic variety (liveries, details). Never drawn from the RNG. */
  serial: number;
  dead: boolean;
}

export interface Coin {
  x: number;
  y: number;
  z: number;
  taken: boolean;
  pulled: boolean;
  /** Ramp or train the coin floats above, so it paints after that obstacle. */
  over: Obstacle | null;
}

export interface Power {
  kind: PowerKind;
  lane: number;
  z: number;
  taken: boolean;
}

export interface TrackWorld {
  obstacles: Obstacle[];
  coins: Coin[];
  powers: Power[];
}

/** Distance (m) at which each harder pattern unlocks. */
export const UNLOCK = {
  highBarrier: 200,
  twoLanes: 400,
  trainSideBarriers: 700,
  zigzag: 900,
  threeLaneRows: 1000,
  moving: 1300,
  doubleRows: 1500,
  trainWall: 1800,
} as const;

export const RAMP_LEN = 9;
export const COIN_SPACING = 2.2;

type Pattern = 'coins' | 'barriers' | 'trains' | 'moving' | 'zigzag';

/**
 * Seeded procedural track. Patterns are chosen and spaced from the eased progress curve at the
 * pattern's own position, so the layout depends only on the seed (never on the player) and all
 * spacing is expressed in seconds of running at the speed the runner will have there.
 */
export class TrackGenerator {
  /** World z where the next pattern starts. */
  nextZ = WARMUP_M;
  private lastPowerZ = 0;
  private nextBreatherZ = 800;
  private breatherDue = false;
  private serial = 0;

  constructor(
    private readonly rng: Rng,
    private readonly world: TrackWorld,
  ) {}

  /** Obstacle-free run-in: a coin trail that crosses the lanes, then a jump arc. */
  warmup(): void {
    this.coinLine(1, 14, 10);
    this.coinLine(0, 44, 8);
    this.coinLine(2, 72, 8);
    this.coinArc(1, 104, 4);
  }

  fill(until: number): void {
    while (this.nextZ < until) this.nextPattern();
  }

  private nextPattern(): void {
    const start = this.nextZ;
    const e = progressAt(start);
    const v = speedAt(start);
    let gapScale = 1;
    let len: number;
    if (this.breatherDue || start >= this.nextBreatherZ) {
      // Breather: coins only and a longer gap after hard patterns and every 700-900 m.
      this.breatherDue = false;
      this.nextBreatherZ = start + this.rng.range(700, 900);
      len = this.patCoins(start, true);
      gapScale = 1.5;
    } else {
      const pattern = this.rng.weighted<Pattern>([
        { value: 'coins', weight: 2.2 - 1.2 * e },
        { value: 'barriers', weight: 3 },
        { value: 'trains', weight: 2 + 2 * e },
        { value: 'moving', weight: start >= UNLOCK.moving ? 0.8 + 1.6 * e : 0 },
        { value: 'zigzag', weight: start >= UNLOCK.zigzag ? 1 + e : 0 },
      ]);
      switch (pattern) {
        case 'coins':
          len = this.patCoins(start, false);
          break;
        case 'barriers':
          len = this.patBarriers(start, e, v);
          break;
        case 'trains':
          len = this.patTrains(start, e);
          break;
        case 'moving':
          len = this.patMoving(start, e);
          break;
        default:
          len = this.patZigzag(start, e, v);
      }
    }
    this.nextZ = start + len + v * (1.6 - 0.65 * e) * gapScale;
  }

  private addOb(kind: ObKind, lane: number, z: number, len: number, h: number, vz = 0): Obstacle {
    const ob: Obstacle = { kind, lane, z, len, h, vz, armed: vz === 0, serial: this.serial++, dead: false };
    this.world.obstacles.push(ob);
    return ob;
  }

  private coin(x: number, y: number, z: number, over: Obstacle | null = null): void {
    this.world.coins.push({ x, y, z, taken: false, pulled: false, over });
  }

  private coinLine(
    lane: number,
    z0: number,
    n: number,
    y = 0.9,
    spacing = COIN_SPACING,
    over?: Obstacle,
  ): void {
    for (let i = 0; i < n; i++) this.coin(laneX(lane), y, z0 + i * spacing, over ?? null);
  }

  /** Arc of coins centred on z that rewards a jump (half-length scales with the jump at that speed). */
  private coinArc(lane: number, z: number, n = 3): void {
    const v = speedAt(z);
    const half = clamp(0.42 * airtimeAt(v) * v, 4.5, 7);
    for (let i = -n; i <= n; i++) {
      const dz = (i / n) * half;
      this.coin(laneX(lane), 1 + 1.6 * (1 - (dz / (half + 0.5)) ** 2), z + dz);
    }
  }

  private maybePower(lane: number, z: number): boolean {
    if (z - this.lastPowerZ < 320 || !this.rng.chance(0.7)) return false;
    this.lastPowerZ = z;
    const kind = this.rng.weighted<PowerKind>([
      { value: 'magnet', weight: 3 },
      { value: 'double', weight: 2 },
      { value: 'sneakers', weight: 2 },
      { value: 'jetpack', weight: 1.4 },
    ]);
    this.world.powers.push({ kind, lane, z, taken: false });
    return true;
  }

  private patCoins(start: number, breather: boolean): number {
    const lane = this.rng.int(0, 2);
    const n = breather ? this.rng.int(12, 16) : this.rng.int(7, 12);
    const hasPower = this.maybePower(lane, start);
    const z0 = start + (hasPower ? 6 : 0);
    if (breather && this.rng.chance(0.5)) {
      // A trail that switches lanes halfway.
      const half = Math.floor(n / 2);
      const next = lane === 1 ? (this.rng.chance(0.5) ? 0 : 2) : 1;
      this.coinLine(lane, z0, half);
      this.coinLine(next, z0 + half * COIN_SPACING + 5, n - half);
      return n * COIN_SPACING + 11;
    }
    this.coinLine(lane, z0, n);
    return n * COIN_SPACING + 6;
  }

  private barrierRow(z: number, lanes: readonly number[], e: number): void {
    for (const lane of lanes) {
      const high = z >= UNLOCK.highBarrier && this.rng.chance(0.35 + 0.2 * e);
      this.addOb(high ? 'high' : 'low', lane, z, 0.5, high ? HIGH_TOP : LOW_TOP);
      if (!high && this.rng.chance(0.4)) this.coinArc(lane, z);
    }
  }

  private patBarriers(start: number, e: number, v: number): number {
    const rows = start >= UNLOCK.doubleRows && this.rng.chance(0.5) ? 2 : 1;
    const spacing = v * Math.max(0.85, 1.25 - 0.35 * e);
    const maxCount = start < UNLOCK.twoLanes ? 1 : start < UNLOCK.threeLaneRows ? 2 : 3;
    for (let r = 0; r < rows; r++) {
      const count = this.rng.int(1, maxCount);
      const lanes = this.rng.shuffle([0, 1, 2]).slice(0, count);
      this.barrierRow(start + r * spacing, lanes, e);
      const free = [0, 1, 2].find((l) => !lanes.includes(l));
      if (free !== undefined && this.rng.chance(0.6)) this.coinLine(free, start + r * spacing - 4, 5);
    }
    return (rows - 1) * spacing + 4;
  }

  private patTrains(start: number, e: number): number {
    const withRamp = this.rng.chance(0.35 + 0.2 * e);
    const maxTrains =
      start < UNLOCK.twoLanes ? 1 : withRamp && start >= UNLOCK.trainWall && this.rng.chance(0.35) ? 3 : 2;
    const count = this.rng.int(1, maxTrains);
    if (count === 3) this.breatherDue = true;
    const lanes = this.rng.shuffle([0, 1, 2]).slice(0, count);
    const rampLane = withRamp ? (lanes[0] as number) : -1;
    let longest = 0;
    for (const lane of lanes) {
      const offset = lane === rampLane ? RAMP_LEN : this.rng.range(0, 6);
      const len = this.rng.pick([16, 22, 28, 34]);
      const ramp = lane === rampLane ? this.addOb('ramp', lane, start, RAMP_LEN, TRAIN_H) : null;
      const train = this.addOb('train', lane, start + offset, len, TRAIN_H);
      if (ramp) {
        // Coins up the ramp, then along the roof.
        for (let i = 0; i < 4; i++) {
          const z = start + 1 + i * COIN_SPACING;
          this.coin(laneX(lane), TRAIN_H * ((z - start) / RAMP_LEN) + 0.9, z, ramp);
        }
        this.coinLine(lane, start + RAMP_LEN + 1, Math.floor(len / 2.4), TRAIN_H + 0.9, 2.4, train);
      }
      longest = Math.max(longest, offset + len);
    }
    for (const lane of [0, 1, 2]) {
      if (lanes.includes(lane)) continue;
      if (start >= UNLOCK.trainSideBarriers && this.rng.chance(0.35))
        this.barrierRow(start + this.rng.range(4, longest - 4), [lane], e);
      else if (this.rng.chance(0.6) && !this.maybePower(lane, start + 2))
        this.coinLine(lane, start + 2, Math.floor(longest / 2.6));
    }
    return longest;
  }

  private patMoving(start: number, e: number): number {
    const lane = this.rng.int(0, 2);
    const len = this.rng.pick([18, 24]);
    this.addOb('train', lane, start + 42, len, TRAIN_H, -(8 + 6 * e));
    const others = [0, 1, 2].filter((l) => l !== lane);
    const coinLane = this.rng.pick(others);
    this.coinLine(coinLane, start + 4, 10);
    const other = others.find((l) => l !== coinLane);
    if (other !== undefined && e > 0.45 && this.rng.chance(0.6)) this.barrierRow(start + 18, [other], e);
    return 42 + len;
  }

  private patZigzag(start: number, e: number, v: number): number {
    let free = this.rng.int(0, 2);
    const spacing = v * Math.max(airtimeAt(v) + 0.3, 1.05 - 0.25 * e);
    for (let r = 0; r < 3; r++) {
      const z = start + r * spacing;
      for (let lane = 0; lane < 3; lane++) {
        if (lane === free) continue;
        const high = this.rng.chance(0.5);
        this.addOb(high ? 'high' : 'low', lane, z, 0.5, high ? HIGH_TOP : LOW_TOP);
      }
      this.coinLine(free, z - 3, 3);
      free = clamp(free + (this.rng.chance(0.5) ? 1 : -1), 0, 2);
    }
    this.breatherDue = true;
    return 2 * spacing + 3;
  }
}
