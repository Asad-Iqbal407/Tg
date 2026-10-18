import { describe, expect, it } from 'vitest';
import type { AudioLike } from '../src/core/audio';
import { Input } from '../src/core/input';
import { Rng } from '../src/core/rng';
import { HillGame, type HillProbe } from '../src/games/hill/hill';
import { BIOME_M, BIOMES, biomeIndexAt, lapAt, physicsAt } from '../src/games/hill/biomes';
import { blendSlices, Scenery } from '../src/games/hill/scenery';
import { PX_PER_M, Terrain } from '../src/games/hill/terrain';
import { Vehicle, type VehicleSpec } from '../src/games/hill/vehicle';
import { GAMES } from '../src/games/registry';
import { type BoostId, type GameResult, type GameServices, type Insets, NO_INSETS } from '../src/games/types';
import { defaultSkin, SKINS, toSkinData } from '../src/meta/catalog';
import { cornerSizes, createGame, mockCtx } from './helpers';

const DT = 1 / 60;
const DEG = Math.PI / 180;
const hillDef = GAMES.find((g) => g.id === 'hill')!;
const VEHICLES = ['car-jeep', 'car-monster', 'car-racer', 'car-rover'];

/** Catalog values for each vehicle (src/meta/catalog.ts), for tests that drive a Vehicle directly. */
const SPECS: Record<string, VehicleSpec> = {
  'car-jeep': { power: 1, maxSpeed: 540, grip: 0.32, wheelR: 20, suspension: 0.35, airControl: 1 },
  'car-monster': { power: 1.15, maxSpeed: 500, grip: 0.4, wheelR: 27, suspension: 0.25, airControl: 0.85 },
  'car-racer': { power: 1.35, maxSpeed: 700, grip: 0.27, wheelR: 17, suspension: 0.45, airControl: 1.1 },
  'car-rover': { power: 1.05, maxSpeed: 560, grip: 0.34, wheelR: 22, suspension: 0.3, airControl: 1.7 },
};

/**
 * Headless driver. `hold` keeps gas down on the ground and balances the chassis in the air. `skilled`
 * also lifts off a wheelie. `flip` spins forward over a jump that gives about a second of air, and
 * `spin` spins over any air. Both spin modes finish the turn with the same balance controller.
 */
export type BotMode = 'hold' | 'skilled' | 'flip' | 'spin';

export interface BotOptions {
  seed: number;
  skinId?: string;
  mode?: BotMode;
  /** Full turns to attempt per air phase (flip and spin modes). */
  flips?: number;
  seconds?: number;
  boosts?: BoostId[];
  width?: number;
  height?: number;
  insets?: Insets;
  /** Start the car this many px above the ground at x = 200 (a drop test). */
  drop?: number;
  /** Called once per simulation step, before the step, with the car's state. */
  trace?: (p: HillProbe, step: number, want: { gas: boolean; brake: boolean }, game: HillGame) => void;
}

export interface BotRun {
  result: GameResult;
  meters: number;
  /** Crash reason, or '' if the run was still going when the time limit hit. */
  reason: string;
  seconds: number;
  game: HillGame;
}

interface BotState {
  airRot: number;
  lastAngle: number;
}

function wrap(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

function decide(p: HillProbe, mode: BotMode, flips: number, st: BotState): { gas: boolean; brake: boolean } {
  if (p.crashed) return { gas: false, brake: false };
  if (p.airT === 0) {
    st.airRot = 0;
    st.lastAngle = p.angle;
    // Lift the nose if a wheelie gets going on the skilled line.
    if (mode !== 'hold' && p.angle < -0.5) return { gas: false, brake: true };
    return { gas: true, brake: false };
  }
  const delta = wrap(p.angle - st.lastAngle);
  st.airRot += delta;
  const w = delta / DT;
  st.lastAngle = p.angle;
  // A jump with room for a full turn, predicted from its angles and the speed (real flights run
  // about 0.7x the prediction, so this only picks the long jumps).
  const roomy = p.kickers.some((k) => {
    if (p.x < k.start || p.x > k.end) return false;
    const air = (2 * p.speed * (Math.sin(k.lipAngle) + Math.cos(k.lipAngle) * Math.tan(k.landAngle))) / 980;
    return air >= 1.5;
  });
  const spinning = (mode === 'flip' && roomy) || mode === 'spin';
  if (spinning && p.airT > 0.12 && Math.abs(st.airRot) < Math.PI * 2 * flips - 1.2)
    return { gas: false, brake: true };
  // PD on the chassis angle against the surface it will land on: brake pitches nose-down, gas
  // nose-up. Over a jump that is the landing slope, so the nose comes down before touchdown.
  const landing = p.kickers.find((k) => p.x >= k.lip && p.x <= k.landEnd);
  const target = landing ? landing.landAngle : p.groundAngle(p.x);
  const err = wrap(p.angle - target);
  const u = -(6 * err + 3.5 * w);
  if (u > 0.5) return { gas: false, brake: true };
  if (u < -0.5) return { gas: true, brake: false };
  return { gas: false, brake: false };
}

/** Test-only access to the car's private simulation state. */
function carOf(game: HillGame): Vehicle {
  return (game as unknown as { car: Vehicle }).car;
}

/** Drive one run with a simple policy and report where it ended. */
export function runBot(opts: BotOptions): BotRun {
  const skin = toSkinData(SKINS.find((s) => s.id === (opts.skinId ?? 'car-jeep'))!);
  const { game: instance, input } = createGame(hillDef, {
    seed: opts.seed,
    skin,
    boosts: opts.boosts,
    width: opts.width,
    height: opts.height,
    insets: opts.insets,
  });
  const game = instance as HillGame;
  if (opts.drop) {
    const car = carOf(game);
    car.reset(200, 0);
    for (const p of car.pts) {
      p.y -= opts.drop;
      p.py -= opts.drop;
    }
  }
  const mode = opts.mode ?? 'hold';
  const flips = opts.flips ?? 1;
  const maxSteps = Math.round((opts.seconds ?? 300) * 60);
  const st: BotState = { airRot: 0, lastAngle: 0 };
  let steps = 0;
  while (steps < maxSteps && !game.isOver()) {
    const p = game.probe();
    const want = decide(p, mode, flips, st);
    opts.trace?.(p, steps, want, game);
    input.setVirtual('right', want.gas, 'bot');
    input.setVirtual('left', want.brake, 'bot');
    game.update(DT);
    input.postUpdate();
    steps++;
    if (p.crashed && game.isOver()) break;
  }
  const probe = game.probe();
  return {
    result: game.getResult(),
    meters: probe.meters,
    reason: probe.crashReason,
    seconds: steps * DT,
    game,
  };
}

/** A hill game whose audio is a stub, so the tests can see the engine handle. */
function gameWithAudio(audio: AudioLike): HillGame {
  const services: GameServices = {
    ctx: mockCtx(),
    width: hillDef.width,
    height: hillDef.height,
    input: new Input(),
    audio,
    rng: new Rng(3),
    loadout: { skin: toSkinData(defaultSkin('hill')), boosts: new Set(), powerDuration: 1 },
    insets: NO_INSETS,
    reducedMotion: false,
    haptic: () => undefined,
  };
  return new HillGame(services);
}

describe('Hill Rider driving', () => {
  it('every vehicle drives past 800 m on seeds 1-3 with a simple hold-gas policy', () => {
    for (const skinId of VEHICLES)
      for (const seed of [1, 2, 3]) {
        const run = runBot({ seed, skinId, mode: 'hold', seconds: 120 });
        expect(run.meters, `${skinId} seed ${seed}`).toBeGreaterThan(800);
      }
  }, 60_000);

  it('the Rally Racer survives early terrain under hold-gas', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const run = runBot({ seed, skinId: 'car-racer', mode: 'hold', seconds: 60 });
      expect(run.meters, `seed ${seed}`).toBeGreaterThan(300);
    }
  }, 30_000);

  it('a skilled airborne input lands a full flip, for every vehicle', () => {
    for (const skinId of VEHICLES) {
      const run = runBot({ seed: 1, skinId, mode: 'spin', flips: 1, seconds: 4, drop: 500 });
      expect(run.result.stats.flips ?? 0, skinId).toBe(1);
      expect(run.reason, skinId).toBe('');
    }
  }, 30_000);

  it('a car that stands on its tail is flipped over within a few seconds', () => {
    let stops = 0;
    const game = gameWithAudio({
      play() {},
      engine: () => ({
        set() {},
        stop: () => {
          stops++;
        },
      }),
    });
    carOf(game).reset(200, -1.7);
    for (let t = 0; t < 4 && !game.probe().crashed; t += DT) game.update(DT);
    expect(game.probe().crashed).toBe(true);
    expect(game.probe().crashReason).toBe('Flipped over!');
    expect(stops).toBeGreaterThan(0);
  });

  it('runs out of fuel a few seconds after the tank empties, once the car has stopped', () => {
    const { game: instance, input } = createGame(hillDef, { seed: 3 });
    const game = instance as HillGame;
    let emptyAt = -1;
    let t = 0;
    while (!game.isOver() && t < 150) {
      if (emptyAt < 0 && game.probe().fuel <= 0) emptyAt = t;
      game.update(DT);
      input.postUpdate();
      t += DT;
    }
    expect(emptyAt).toBeGreaterThan(60);
    expect(game.isOver()).toBe(true);
    expect(game.probe().crashReason).toBe('Out of fuel!');
    const after = t - emptyAt;
    expect(after).toBeGreaterThan(2.5);
    expect(after).toBeLessThan(6);
  }, 30_000);

  it('destroy() stops the engine drone once, even if called twice', () => {
    let stops = 0;
    const game = gameWithAudio({
      play() {},
      engine: () => ({
        set() {},
        stop: () => {
          stops++;
        },
      }),
    });
    for (let i = 0; i < 30; i++) game.update(DT);
    game.destroy();
    game.destroy();
    expect(stops).toBe(1);
  });
});

describe('Hill Rider air control and torque', () => {
  /** A vehicle lifted `lift` px above flat ground at x = 200, at rest. */
  function lifted(skinId: string, lift: number): Vehicle {
    const car = new Vehicle(new Terrain(1), SPECS[skinId]!);
    car.reset(200, 0);
    for (const p of car.pts) {
      p.y -= lift;
      p.py -= lift;
    }
    return car;
  }

  it('ignores micro-hops: no air torque until the car has been airborne for 0.12 s', () => {
    const coast = lifted('car-jeep', 400);
    const brake = lifted('car-jeep', 400);
    let early = 0;
    let late = 0;
    for (let i = 0; i < 90; i++) {
      coast.step(DT, { throttle: 0, brake: 0, canReverse: true }, { gravity: 1, grip: 1 });
      brake.step(DT, { throttle: 0, brake: 1, canReverse: true }, { gravity: 1, grip: 1 });
      if (brake.airT < 0.1) early = Math.abs(brake.angle() - coast.angle());
      if (brake.airT > 0.4) late = Math.abs(brake.angle() - coast.angle());
    }
    expect(early).toBeLessThan(0.01);
    expect(late).toBeGreaterThan(0.05);
  });

  it('the Rally Racer does not rear up when it holds gas on flat ground at lunar gravity', () => {
    const car = new Vehicle(new Terrain(1), SPECS['car-racer']!);
    car.reset(60, 0);
    let minAngle = 0;
    for (let i = 0; i < 90; i++) {
      car.step(DT, { throttle: 1, brake: 0, canReverse: true }, { gravity: 0.45, grip: 0.95 });
      minAngle = Math.min(minAngle, car.angle());
    }
    expect(minAngle).toBeGreaterThan(-20 * DEG);
  });
});

describe('Hill Rider terrain and biomes', () => {
  it('caps slopes outside jumps so every hill is within reach of the weakest vehicle', () => {
    for (const seed of [1, 2, 3]) {
      const t = new Terrain(seed);
      t.ensureTo(3000 * PX_PER_M);
      let maxUp = 0;
      let maxDown = 0;
      for (let x = 200; x < 3000 * PX_PER_M; x += 2) {
        if (t.kickerAt(x)) continue;
        const s = Math.atan(t.slopeAt(x));
        if (s > 0) maxDown = Math.max(maxDown, s);
        else maxUp = Math.max(maxUp, -s);
      }
      expect(maxUp, `seed ${seed} uphill`).toBeLessThan(33.5 * DEG);
      expect(maxDown, `seed ${seed} downhill`).toBeLessThan(37.5 * DEG);
    }
  });

  it('places jumps in every stretch, with lips that get steeper with distance', () => {
    const t = new Terrain(5);
    t.ensureTo(4000 * PX_PER_M);
    const early = t.kickers.filter((k) => k.start < 800 * PX_PER_M);
    const late = t.kickers.filter((k) => k.start > 2400 * PX_PER_M);
    expect(early.length).toBeGreaterThan(0);
    expect(late.length).toBeGreaterThan(0);
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(mean(late.map((k) => k.lipAngle))).toBeGreaterThan(mean(early.map((k) => k.lipAngle)));
    for (const k of t.kickers) {
      expect(k.lipAngle).toBeGreaterThan(20 * DEG);
      expect(k.lipAngle).toBeLessThan(40 * DEG);
    }
  });

  it('blends gravity and grip across biome borders instead of jumping', () => {
    const out = { gravity: 1, grip: 1 };
    let prev: { gravity: number; grip: number } | null = null;
    let worst = 0;
    for (let m = 0; m < 4000; m += 0.5) {
      physicsAt(m, out);
      if (prev) worst = Math.max(worst, Math.abs(out.gravity - prev.gravity), Math.abs(out.grip - prev.grip));
      prev = { ...out };
    }
    expect(worst).toBeLessThan(0.05);
  });

  it('cycles the biomes after the lunar base and gets tougher on each lap', () => {
    const lap = BIOMES.length * BIOME_M;
    expect(biomeIndexAt(2400)).toBe(3);
    expect(biomeIndexAt(lap)).toBe(0);
    expect(lapAt(lap - 1)).toBe(1);
    expect(lapAt(lap)).toBe(2);
  });
});

describe('Hill Rider rendering', () => {
  it('renders at the corners of the viewport range, with touch insets', () => {
    const insets: Insets = { top: 0, right: 0, bottom: 120, left: 0 };
    for (const size of cornerSizes(hillDef)) {
      const { game } = createGame(hillDef, { seed: 4, ...size, insets });
      for (let i = 0; i < 120; i++) game.update(DT);
      expect(() => game.render()).not.toThrow();
    }
  });

  // Regression: the ground blend at each biome border re-derived its slice from the last slice end; a slice end
  // a hair below a boundary gave the same slice again and the render loop never ended (the game froze at ~770 m).
  it('walks every biome-border blend in six contiguous slices that end at the border', () => {
    for (let k = 0; k < 60; k++) {
      const b1 = 200 + (k + 1) * BIOME_M * PX_PER_M;
      const solidEnd = b1 - 40 * PX_PER_M;
      const width = (b1 - solidEnd) / 6;
      for (let start = 0; start < 6; start++) {
        const from = solidEnd + start * width;
        const spans: [number, number, number][] = [];
        const end = blendSlices(from, Infinity, solidEnd, b1, (a, b, t) => spans.push([a, b, t]));
        expect(end, `border ${k}`).toBe(b1);
        expect(spans.length, `border ${k} from slice ${start}`).toBe(6 - start);
        expect(spans[0]?.[0]).toBe(from);
        for (let i = 1; i < spans.length; i++) expect(spans[i]?.[0]).toBe(spans[i - 1]?.[1]);
        expect(spans[spans.length - 1]?.[1]).toBe(b1);
      }
      // A window that stops inside the blend stops there, and one already past the border draws nothing.
      expect(blendSlices(solidEnd, solidEnd + 10, solidEnd, b1, () => undefined)).toBe(solidEnd + 10);
      let calls = 0;
      expect(blendSlices(b1 + 5, b1 + 900, solidEnd, b1, () => calls++)).toBe(b1 + 5);
      expect(calls).toBe(0);
    }
  });

  it('draws the ground across every biome border of the first three laps without hanging', () => {
    const scenery = new Scenery(mockCtx(), 960, 540, 200);
    const terrain = new Terrain(7, 330, { origin: 200 });
    for (let k = 1; k <= 3 * BIOMES.length; k++) {
      const border = 200 + k * BIOME_M * PX_PER_M;
      for (let x0 = border - 1400; x0 < border + 200; x0 += 37.3) {
        const view = { x: x0, y: 0, zoom: 0.8 };
        expect(() => scenery.drawTerrain(terrain, view, x0, x0 + 960 / 0.8)).not.toThrow();
      }
    }
  });

  it('renders a run that drives through the first biome border', () => {
    const run = runBot({
      seed: 1,
      seconds: 150,
      trace: (p, step, _want, game) => {
        if (step % 10 === 0 && p.meters < 900) game.render();
      },
    });
    expect(run.meters).toBeGreaterThan(830);
  });
});
