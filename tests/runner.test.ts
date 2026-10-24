import { describe, expect, it } from 'vitest';
import { NullAudio } from '../src/core/audio';
import { Input } from '../src/core/input';
import { Rng } from '../src/core/rng';
import {
  Kinematics,
  MAX_MULTIPLIER,
  MILESTONE_M,
  progressAt,
  speedAt,
  TRAIN_H,
  viewDistance,
  WARMUP_M,
} from '../src/games/runner/config';
import { depthKey, PLAYER_KEY } from '../src/games/runner/runner';
import { envAt } from '../src/games/runner/scenery';
import type { Coin, Obstacle, ObKind, TrackGenerator } from '../src/games/runner/track';
import { type BoostId, type GameInstance, type Insets, NO_INSETS } from '../src/games/types';
import { defaultSkin, toSkinData } from '../src/meta/catalog';
import { gameById, mockCtx } from './helpers';

const DT = 1 / 60;
const def = gameById('runner');

/** The simulation state the regression tests poke at. */
interface Runner extends GameInstance {
  distance: number;
  speed: number;
  lane: number;
  px: number;
  py: number;
  vy: number;
  grounded: boolean;
  graceT: number;
  stumbleT: number;
  shield: boolean;
  crashed: boolean;
  crashOb: Obstacle | null;
  obstacles: Obstacle[];
  coinList: Coin[];
  powers: Record<string, number>;
  stats: Record<string, number>;
  gen: TrackGenerator;
  milestone: number;
  hint: string | null;
  multiplier(): number;
}

interface MakeOptions {
  seed?: number;
  boosts?: BoostId[];
  width?: number;
  height?: number;
  insets?: Insets;
  reducedMotion?: boolean;
}

function make(opts: MakeOptions = {}): { g: Runner; input: Input } {
  const input = new Input();
  const game = def.create({
    ctx: mockCtx(),
    width: opts.width ?? def.width,
    height: opts.height ?? def.height,
    insets: opts.insets ?? NO_INSETS,
    input,
    audio: new NullAudio(),
    rng: new Rng(opts.seed ?? 1),
    loadout: {
      skin: toSkinData(defaultSkin('runner')),
      boosts: new Set(opts.boosts ?? []),
      powerDuration: 1,
    },
    reducedMotion: opts.reducedMotion ?? false,
    haptic: () => undefined,
  });
  return { g: game as unknown as Runner, input };
}

function step(g: Runner, input: Input, seconds: number, each?: () => void): void {
  for (let i = 0; i < Math.round(seconds * 60); i++) {
    g.update(DT);
    input.postUpdate();
    each?.();
  }
}

/** Empty the track ahead (and stop generation for a while) so a test can build its own scenario. */
function clearTrack(g: Runner): void {
  g.obstacles.length = 0;
  g.coinList.length = 0;
  g.gen.nextZ = g.distance + 600;
}

function addOb(g: Runner, kind: ObKind, lane: number, rel: number, len: number, h: number, vz = 0): Obstacle {
  const ob: Obstacle = { kind, lane, z: g.distance + rel, len, h, vz, armed: true, serial: 1, dead: false };
  g.obstacles.push(ob);
  return ob;
}

/** Run past the obstacle-free warm-up with collisions off, then hand back a clean track. */
function warmedUp(opts: MakeOptions = {}): { g: Runner; input: Input } {
  const r = make(opts);
  step(r.g, r.input, 3, () => (r.g.graceT = 1));
  r.g.graceT = 0;
  clearTrack(r.g);
  return r;
}

describe('Metro Dash depth sorting', () => {
  it('paints trains and ramps that span the runner before the runner', () => {
    // A roof the runner stands on: front 5 m behind, 20 m long.
    expect(depthKey(-5, 20)).toBeGreaterThan(PLAYER_KEY);
    // A ramp the runner is climbing.
    expect(depthKey(-3, 9)).toBeGreaterThan(PLAYER_KEY);
    // Anything entirely ahead keeps its front as the key; anything behind paints after the runner.
    expect(depthKey(12, 20)).toBe(12);
    expect(depthKey(-30, 20)).toBeLessThan(PLAYER_KEY);
    // Thin barriers keep their own position.
    expect(depthKey(-0.2, 0.5)).toBeLessThan(PLAYER_KEY);
  });
});

describe('Metro Dash physics regressions', () => {
  it('counts a roof reached by running up a ramp (trainsRidden)', () => {
    const { g, input } = warmedUp();
    const lane = g.lane;
    addOb(g, 'ramp', lane, 15, 9, TRAIN_H);
    addOb(g, 'train', lane, 24, 30, TRAIN_H);
    step(g, input, 2.5);
    expect(g.crashed).toBe(false);
    expect(g.py).toBeCloseTo(TRAIN_H, 1);
    expect(g.stats.trainsRidden).toBe(1);
  });

  it('counts every new roof when hopping from train to train, but not re-landing on the same one', () => {
    const { g, input } = warmedUp();
    const lane = g.lane;
    addOb(g, 'ramp', lane, 10, 9, TRAIN_H);
    addOb(g, 'train', lane, 19, 25, TRAIN_H);
    addOb(g, 'train', lane, 44.5, 25, TRAIN_H);
    step(g, input, 1.5);
    input.setVirtual('up', true, 't');
    step(g, input, 0.1);
    input.setVirtual('up', false, 't');
    step(g, input, 2.5);
    expect(g.crashed).toBe(false);
    expect(g.stats.trainsRidden).toBe(2);
  });

  it('does not slide forward or snap onto the roof after a head-on train crash', () => {
    const { g, input } = warmedUp();
    const train = addOb(g, 'train', g.lane, 20, 30, TRAIN_H);
    let maxPy = 0;
    step(g, input, 3, () => (maxPy = Math.max(maxPy, g.py)));
    expect(g.crashed).toBe(true);
    expect(g.crashOb).toBe(train);
    expect(maxPy).toBeLessThan(0.5);
    expect(g.py).toBe(0);
    expect(train.z - g.distance).toBeGreaterThanOrEqual(0.44);
  });

  it('keeps the barrier that caused a crash in front of the runner', () => {
    const { g, input } = warmedUp();
    const barrier = addOb(g, 'low', g.lane, 15, 0.5, 1);
    step(g, input, 2.5);
    expect(g.crashed).toBe(true);
    expect(barrier.z - g.distance).toBeGreaterThan(0.4);
  });

  it('vaults onto a train during grace instead of sinking into the track', () => {
    const { g, input } = warmedUp();
    addOb(g, 'train', g.lane, 12, 40, TRAIN_H);
    g.graceT = 1.5;
    let minPy = 0;
    step(g, input, 2.5, () => (minPy = Math.min(minPy, g.py)));
    expect(minPy).toBeGreaterThanOrEqual(0);
    expect(g.crashed).toBe(false);
    expect(g.py).toBeCloseTo(TRAIN_H, 1);
  });

  it('never sinks below the track when the jetpack runs out', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const { g, input } = make({ seed });
      step(g, input, 12, () => (g.graceT = 1));
      g.graceT = 0;
      g.powers.jetpack = 1;
      let minPy = 0;
      step(g, input, 4, () => (minPy = Math.min(minPy, g.py)));
      expect(minPy, `seed ${seed}`).toBeGreaterThanOrEqual(0);
    }
  });

  it('treats swiping into the outer wall as a harmless bump', () => {
    const { g, input } = warmedUp();
    for (let i = 0; i < 6; i++) {
      input.pushSwipe('left');
      step(g, input, 0.25);
    }
    expect(g.lane).toBe(0);
    expect(g.crashed).toBe(false);
    expect(g.stumbleT).toBe(0);
  });

  it('lets the Guardian absorb a double stumble', () => {
    const { g, input } = warmedUp({ boosts: ['shield'] });
    addOb(g, 'train', 0, -5, 60, TRAIN_H);
    input.pushSwipe('left');
    step(g, input, 0.3);
    expect(g.stumbleT).toBeGreaterThan(0);
    input.pushSwipe('left');
    step(g, input, 0.3);
    expect(g.crashed).toBe(false);
    expect(g.shield).toBe(false);
  });

  it('still ends the run on a double stumble without a shield', () => {
    const { g, input } = warmedUp();
    addOb(g, 'train', 0, -5, 60, TRAIN_H);
    input.pushSwipe('left');
    step(g, input, 0.3);
    input.pushSwipe('left');
    step(g, input, 0.3);
    expect(g.crashed).toBe(true);
  });

  it('turns a sideways entry into a passing train into a stumble, not a crash', () => {
    const { g, input } = warmedUp();
    addOb(g, 'train', 0, -6, 40, TRAIN_H);
    // Force the lane change past the lane check, as a late swipe in the same frame would.
    g.lane = 0;
    step(g, input, 0.5);
    expect(g.crashed).toBe(false);
    expect(g.lane).toBe(1);
    expect(g.stumbleT).toBeGreaterThan(0);
  });

  it('blocks a lane change into a train that is about to arrive', () => {
    const { g, input } = warmedUp();
    // At ~14 m/s the front reaches the runner in ~0.07 s: too late to get across.
    addOb(g, 'train', 0, 1.2, 30, TRAIN_H);
    input.pushSwipe('left');
    step(g, input, 0.05);
    expect(g.lane).toBe(1);
  });
});

describe('Metro Dash progression', () => {
  it('follows the eased speed curve and soft cap', () => {
    expect(speedAt(0)).toBe(13);
    expect(speedAt(1000)).toBeCloseTo(13 + 20 * progressAt(1000), 6);
    expect(speedAt(20000)).toBeLessThan(33);
    expect(speedAt(20000)).toBeGreaterThan(32.9);
    for (let d = 0; d < 10000; d += 250) expect(speedAt(d + 250)).toBeGreaterThan(speedAt(d));
  });

  it('reaches 1000 m in about a minute and keeps speeding up after three minutes', () => {
    const { g, input } = make({ seed: 2 });
    let t1000 = 0;
    let v180 = 0;
    for (let i = 1; i <= 60 * 240; i++) {
      g.graceT = 1;
      g.update(DT);
      input.postUpdate();
      if (!t1000 && g.distance >= MILESTONE_M) t1000 = i * DT;
      if (i === 60 * 180) v180 = g.speed;
    }
    expect(t1000).toBeGreaterThan(55);
    expect(t1000).toBeLessThan(68);
    expect(g.speed).toBeGreaterThan(v180 + 1);
  });

  it('starts with an obstacle-free warm-up and unlocks hard patterns gradually', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const { g } = make({ seed });
      g.gen.fill(2500);
      const first = (pred: (o: Obstacle) => boolean) =>
        Math.min(...g.obstacles.filter(pred).map((o) => o.z), Infinity);
      expect(first(() => true)).toBeGreaterThanOrEqual(WARMUP_M);
      expect(first((o) => o.kind === 'high')).toBeGreaterThanOrEqual(200);
      expect(first((o) => o.vz !== 0)).toBeGreaterThanOrEqual(1300);
    }
  });

  it('never kills an idle player during the warm-up', () => {
    for (let seed = 1; seed <= 60; seed++) {
      const { g, input } = make({ seed });
      step(g, input, 7);
      expect(g.crashed, `seed ${seed}`).toBe(false);
    }
  });

  it('never places coins inside trains or barriers, or walls off all three lanes without a ramp', () => {
    for (let seed = 1; seed <= 12; seed++) {
      const { g } = make({ seed });
      g.gen.fill(6000);
      const statics = g.obstacles.filter((o) => o.vz === 0);
      for (const c of g.coinList) {
        const lane = Math.round(c.x / 2.4) + 1;
        for (const o of statics) {
          if (o.lane !== lane) continue;
          if (o.kind === 'train') expect(c.z < o.z - 0.3 || c.z > o.z + o.len + 0.3 || c.y > o.h).toBe(true);
          if ((o.kind === 'low' || o.kind === 'high') && Math.abs(c.z - o.z) < 0.6) {
            const [y0, y1] = o.kind === 'low' ? [0.35, 1.0] : [1.25, 2.6];
            expect(c.y <= y0 - 0.35 || c.y >= y1 + 0.35).toBe(true);
          }
        }
      }
      for (let z = 0; z < 6000; z += 2) {
        const walled = [0, 1, 2].every((l) =>
          statics.some((o) => o.kind === 'train' && o.lane === l && z >= o.z && z <= o.z + o.len),
        );
        if (walled) expect(statics.some((o) => o.kind === 'ramp' && o.z <= z && o.z > z - 60)).toBe(true);
      }
    }
  });
});

describe('Metro Dash speed scaling', () => {
  it('keeps the jump apex while airtime, roll time and stride adapt to speed', () => {
    const k = new Kinematics();
    const apex = (v: number) => {
      k.update(v);
      return k.jumpV ** 2 / (2 * k.gravity);
    };
    const base = apex(13);
    for (const v of [16, 20, 25, 30, 33]) expect(apex(v)).toBeCloseTo(base, 2);
    k.update(13);
    const { airtime, rollTime, strideHz } = k;
    k.update(33);
    expect(k.airtime).toBeLessThan(airtime * 0.8);
    // A jump at top speed covers ~16 m of track instead of ~21 m with a fixed airtime.
    expect(k.airtime * 33).toBeLessThan(17.5);
    expect(k.rollTime).toBeLessThan(rollTime);
    expect(strideHz).toBeGreaterThanOrEqual(2.4);
    expect(k.strideHz).toBeLessThanOrEqual(3.5);
    expect(viewDistance(13)).toBe(110);
    expect(viewDistance(33)).toBe(175);
  });

  it('arms oncoming trains with the same warning time at any speed', () => {
    for (const d of [1500, 6000]) {
      const { g, input } = warmedUp();
      g.distance = d;
      g.speed = speedAt(d);
      clearTrack(g);
      const train = addOb(g, 'train', 1, 140, 20, TRAIN_H, -12);
      train.armed = false;
      let warning = 0;
      step(g, input, 6, () => {
        if (train.armed && !warning) warning = (train.z - g.distance) / (g.speed - train.vz);
      });
      expect(warning, `at ${d} m`).toBeGreaterThan(2.2);
      expect(warning, `at ${d} m`).toBeLessThan(2.6);
    }
  });

  it('raises the multiplier once per 1000 m milestone, capped at 8', () => {
    const { g, input } = warmedUp();
    expect(g.multiplier()).toBe(1);
    g.distance = MILESTONE_M - 1;
    clearTrack(g);
    step(g, input, 0.2, () => (g.graceT = 1));
    expect(g.milestone).toBe(1);
    expect(g.multiplier()).toBe(2);
    g.distance = 20 * MILESTONE_M;
    expect(g.multiplier()).toBe(MAX_MULTIPLIER);
    g.powers.double = 5;
    expect(g.multiplier()).toBe(2 * MAX_MULTIPLIER);
  });
});

describe('Metro Dash input forgiveness and onboarding', () => {
  it('buffers a jump pressed just before landing', () => {
    const { g, input } = warmedUp();
    input.pushSwipe('up');
    step(g, input, 0.5);
    expect(g.grounded).toBe(false);
    input.pushSwipe('up');
    step(g, input, 0.6);
    expect(g.stats.jumps).toBe(2);
  });

  it('allows a jump for a moment after running off the end of a roof (coyote time)', () => {
    const { g, input } = warmedUp();
    addOb(g, 'train', g.lane, -10, 12, TRAIN_H);
    g.py = TRAIN_H;
    g.grounded = true;
    for (let i = 0; i < 60 && g.grounded; i++) step(g, input, DT);
    expect(g.grounded).toBe(false);
    step(g, input, 2 * DT);
    input.pushSwipe('up');
    step(g, input, DT);
    expect(g.stats.jumps).toBe(1);
    expect(g.vy).toBeGreaterThan(0);
  });

  it("explains the first obstacle in the runner's lane well before it arrives", () => {
    let checked = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const { g, input } = make({ seed });
      g.gen.fill(400);
      const ahead = g.obstacles.filter((o) => o.lane === 1).sort((a, b) => a.z - b.z)[0];
      if (!ahead) continue;
      let warnedAt = -1;
      step(g, input, 30, () => {
        if (warnedAt < 0 && g.hint !== null && g.hint !== 'lanes') warnedAt = ahead.z - g.distance;
      });
      if (warnedAt < 0) continue;
      checked++;
      // At least a second of running at the warm-up speed.
      expect(warnedAt, `seed ${seed}`).toBeGreaterThan(13);
    }
    expect(checked).toBeGreaterThan(20);
  });

  it('plays the same track with and without reduced motion', () => {
    const run = (reducedMotion: boolean) => {
      const { g, input } = make({ seed: 12, reducedMotion });
      const rng = new Rng(3);
      for (let i = 0; i < 60 * 30; i++) {
        if (i % 15 === 0) input.pushSwipe(rng.pick(['left', 'right', 'up', 'down'] as const));
        g.update(DT);
        input.postUpdate();
        if (i % 10 === 0) g.render();
      }
      const track = g.obstacles.map((o) => `${o.kind}${o.lane}@${o.z.toFixed(2)}`).join(',');
      return `${JSON.stringify(g.getResult())}|${track}`;
    };
    expect(run(true)).toBe(run(false));
  });
});

describe('Metro Dash screen sizes', () => {
  const SIZES: [number, number][] = [
    [540, 960],
    [540, 900],
    [540, 1200],
    [720, 1200],
    [1706, 900],
    [1706, 1200],
  ];

  it('plays identically at every logical size (speed and track never depend on the screen)', () => {
    const results = SIZES.map(([width, height]) => {
      const { g, input } = make({ seed: 9, width, height });
      const rng = new Rng(5);
      for (let i = 0; i < 60 * 25; i++) {
        if (i % 20 === 0) input.pushSwipe(rng.pick(['left', 'right', 'up', 'down'] as const));
        g.update(DT);
        input.postUpdate();
      }
      return JSON.stringify(g.getResult());
    });
    for (const r of results) expect(r).toBe(results[0]);
  });

  it('renders every corner size, with insets, across zones and environments', () => {
    for (const [width, height] of SIZES) {
      const { g, input } = make({
        seed: 4,
        width,
        height,
        insets: { top: 40, right: 0, bottom: 120, left: 0 },
      });
      for (let i = 0; i < 60 * 8; i++) {
        g.graceT = 1;
        g.update(DT);
        input.postUpdate();
        if (i % 20 === 0) g.render();
      }
      // Jump ahead through a tunnel, a bridge or a station and later zones.
      g.distance = 3400;
      g.gen.fill(3700);
      step(g, input, 1, () => (g.graceT = 1));
      expect(() => g.render()).not.toThrow();
    }
  });

  it('lays out stations, tunnels and bridges along the line', () => {
    const kinds = new Set<string>();
    for (let seg = 0; seg < 1000; seg++) kinds.add(envAt(seg));
    expect([...kinds].sort()).toEqual(['bridge', 'city', 'station', 'tunnel']);
    expect(envAt(0)).toBe('station');
    expect(envAt(22)).toBe('tunnel');
  });
});
