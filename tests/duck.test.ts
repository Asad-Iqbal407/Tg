import { describe, expect, it } from 'vitest';
import type { AudioLike, PlayOptions, SfxName } from '../src/core/audio';
import { chooseLogicalSize, fittedArea } from '../src/core/engine';
import { Input } from '../src/core/input';
import { Rng } from '../src/core/rng';
import { BALLOON_DY, sceneFor } from '../src/games/duck/art';
import {
  AIM,
  DUCK_INFO,
  DUCKS_PER_ROUND,
  type DuckKind,
  flyTime,
  hitRadius,
  isStepRound,
  kindWeights,
  PACE,
  requiredHits,
  roundSpeed,
  speedScale,
  TOUCH_BONUS,
  wavePlan,
} from '../src/games/duck/tuning';
import { type BoostId, type GameInstance, type Insets, NO_INSETS } from '../src/games/types';
import { defaultSkin, toSkinData } from '../src/meta/catalog';
import { gameById, mockCtx } from './helpers';

const DT = 1 / 60;
const def = gameById('duck');

interface SimDuck {
  kind: DuckKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  speed: number;
  state: 'fly' | 'hit' | 'fall' | 'escape' | 'gone';
  hit: boolean;
  t: number;
  turnT: number;
  hx: number[];
  hy: number[];
}

interface SimCrate {
  kind: 'slowmo' | 'scatter' | 'ammo';
  x: number;
  y: number;
  vy: number;
  alive: boolean;
}

/** The simulation state the regression tests poke at. */
interface DuckSim extends GameInstance {
  round: number;
  phase: 'intro' | 'wave' | 'waveEnd' | 'roundEnd' | 'over';
  phaseT: number;
  plan: number[];
  ducks: SimDuck[];
  leaving: SimDuck[];
  crates: SimCrate[];
  results: string[];
  shots: number;
  combo: number;
  powers: { slowmo: number; scatter: number };
  headStart: boolean;
  guardian: boolean;
  retry: boolean;
  aimX: number;
  aimY: number;
  waveT: number;
  waveFly: number;
  dogT: number;
  dogMode: string;
  dogStay: boolean;
  dogPending: boolean;
  dogKinds: string[];
  grassTop: number;
  stats: Record<string, number>;
  readonly scatterActive: boolean;
  readonly shotRadius: number;
  snapLock: number;
  layoutBar(): { x: number; y: number; w: number; h: number; s: number };
}

class RecordingAudio implements AudioLike {
  readonly played: SfxName[] = [];
  play(name: SfxName, _opts?: PlayOptions): void {
    this.played.push(name);
  }
  engine() {
    return { set: () => undefined, stop: () => undefined };
  }
}

interface MakeOptions {
  seed?: number;
  boosts?: BoostId[];
  width?: number;
  height?: number;
  insets?: Insets;
  powerDuration?: number;
  preview?: boolean;
  ctx?: CanvasRenderingContext2D;
}

function make(opts: MakeOptions = {}): { g: DuckSim; input: Input; audio: RecordingAudio } {
  const input = new Input();
  const audio = new RecordingAudio();
  const game = def.create({
    ctx: opts.ctx ?? mockCtx(),
    width: opts.width ?? def.width,
    height: opts.height ?? def.height,
    insets: opts.insets ?? NO_INSETS,
    input,
    audio,
    rng: new Rng(opts.seed ?? 1),
    loadout: {
      skin: toSkinData(defaultSkin('duck')),
      boosts: new Set(opts.boosts ?? []),
      powerDuration: opts.powerDuration ?? 1,
    },
    reducedMotion: false,
    haptic: () => undefined,
    preview: opts.preview,
  });
  return { g: game as unknown as DuckSim, input, audio };
}

function step(g: DuckSim, input: Input, seconds: number, each?: () => void): void {
  for (let i = 0; i < Math.round(seconds * 60); i++) {
    each?.();
    g.update(DT);
    input.postUpdate();
  }
}

/** Step until `cond` holds (fails after `max` seconds). */
function until(g: DuckSim, input: Input, cond: () => boolean, max = 30, each?: () => void): void {
  for (let i = 0; i < max * 60; i++) {
    if (cond()) return;
    each?.();
    g.update(DT);
    input.postUpdate();
  }
  throw new Error('condition not reached');
}

/** A pointer press at (x, y), processed by the next update. */
function tap(input: Input, x: number, y: number, opts: { touch?: boolean; inside?: boolean } = {}): void {
  const p = input.pointer;
  p.x = x;
  p.y = y;
  p.active = true;
  p.inside = opts.inside ?? true;
  p.touch = opts.touch ?? false;
  p.pressed = true;
}

/** Put the game into a wave with ducks well above the grass. */
function inWave(seed = 1, opts: MakeOptions = {}): { g: DuckSim; input: Input; audio: RecordingAudio } {
  const made = make({ seed, ...opts });
  until(made.g, made.input, () => made.g.phase === 'wave');
  step(made.g, made.input, 1.3);
  return made;
}

/** Freeze a duck at (x, y) moving with (vx, vy), with a matching position history. */
function placeDuck(d: SimDuck, x: number, y: number, vx = 0, vy = 0): void {
  d.x = x;
  d.y = y;
  d.vx = vx;
  d.vy = vy;
  d.speed = Math.hypot(vx, vy);
  d.turnT = 99;
  d.t = 5;
  for (let i = 0; i < d.hx.length; i++) {
    d.hx[i] = x - vx * DT * (i + 1);
    d.hy[i] = y - vy * DT * (i + 1);
  }
}

/** Keep every other duck far away so a shot can only hit what the test placed. */
function parkDucks(g: DuckSim, except?: SimDuck): void {
  for (const d of g.ducks) if (d !== except) placeDuck(d, 60, 60);
}

interface BotOptions {
  /** Seconds between shots while ducks fly. */
  cadence: number;
  /** Seconds before the first shot of a wave. */
  reaction: number;
  /** Aim error standard deviation in px. */
  noise: number;
  /** Perception lag (s): the bot aims where it saw the duck this long ago, plus linear lead. */
  lag: number;
}

const SKILLED: BotOptions = { cadence: 0.55, reaction: 0.6, noise: 12, lag: 0.2 };
const CASUAL: BotOptions = { cadence: 0.7, reaction: 0.8, noise: 18, lag: 0.25 };

interface BotRun {
  seconds: number;
  /** Share of the run with at least one duck that can be shot. */
  flying: number;
  /** Share of the run with any duck on screen (flying, falling or leaving). */
  onScreen: number;
  rounds: number;
  over: boolean;
  /** Arcade coins the run converts to. */
  arcadeCoins: number;
  stats: Record<string, number>;
}

/**
 * A scripted player modelled on human limits: it sees ducks `lag` seconds late, leads them
 * linearly (so turns fool it), and clicks at a steady cadence with Gaussian aim noise.
 */
function playBot(seed: number, seconds: number, bot: BotOptions): BotRun {
  const { g, input } = make({ seed });
  const rng = new Rng(seed * 7 + 1);
  const gauss = () => Math.sqrt(-2 * Math.log(1 - rng.next())) * Math.cos(2 * Math.PI * rng.next());
  const seen = new Map<SimDuck, { x: number; y: number }[]>();
  const lagFrames = Math.round(bot.lag * 60);
  let frames = 0;
  let flyingFrames = 0;
  let screenFrames = 0;
  let cool = bot.reaction;
  let target: SimDuck | null = null;
  for (let i = 0; i < seconds * 60 && !g.isOver(); i++) {
    const flying = g.ducks.filter((d) => d.state === 'fly');
    for (const d of flying) {
      let h = seen.get(d);
      if (!h) seen.set(d, (h = []));
      h.unshift({ x: d.x, y: d.y });
      if (h.length > lagFrames + 2) h.pop();
    }
    if (g.phase === 'wave' && flying.length > 0) {
      cool -= DT;
      if (!target || target.state !== 'fly') target = flying[0] ?? null;
      const h = target ? seen.get(target) : undefined;
      const a = h?.[Math.min(lagFrames, h.length - 1)];
      const b = h?.[Math.min(lagFrames + 1, h.length - 1)];
      if (cool <= 0 && a && b && a.y < g.grassTop - 30) {
        tap(
          input,
          a.x + (a.x - b.x) * 60 * bot.lag + gauss() * bot.noise,
          a.y + (a.y - b.y) * 60 * bot.lag + gauss() * bot.noise,
        );
        cool = bot.cadence;
      }
    } else {
      cool = bot.reaction;
      target = null;
    }
    frames++;
    if (flying.length > 0) flyingFrames++;
    if (g.ducks.length + g.leaving.length > 0) screenFrames++;
    g.update(DT);
    input.postUpdate();
  }
  const r = g.getResult();
  return {
    seconds: frames / 60,
    flying: flyingFrames / frames,
    onScreen: screenFrames / frames,
    rounds: r.stats.rounds ?? 0,
    over: g.isOver(),
    arcadeCoins: r.coins + Math.floor(r.score / def.scorePerCoin),
    stats: r.stats,
  };
}

describe('Duck Season viewport and layout', () => {
  it('declares the flexible width at a fixed height, for landscape play', () => {
    expect(def.viewport).toEqual({ minWidth: 640, maxWidth: 1280 });
    expect(def.height).toBe(540);
    expect(def.orientation).toBe('landscape');
  });

  it.each([640, 800, 960, 1280])('keeps ducks inside the screen and spreads them over %i px', (width) => {
    let maxX = 0;
    for (const seed of [1, 2, 3]) {
      const { g, input } = make({ seed, width });
      step(g, input, 40, () => {
        for (const d of g.ducks) {
          if (d.state !== 'fly') continue;
          expect(d.x).toBeGreaterThanOrEqual(0);
          expect(d.x).toBeLessThanOrEqual(width);
          maxX = Math.max(maxX, d.x);
        }
      });
    }
    expect(maxX).toBeGreaterThan(width * 0.8);
  });

  it('lifts the bottom HUD bar above the bottom inset and keeps it on the canvas', () => {
    for (const width of [800, 1280]) {
      const { g } = make({ width });
      const free = g.layoutBar();
      expect(free.y + free.h).toBeLessThanOrEqual(540);
      expect(free.x).toBeGreaterThanOrEqual(0);
      expect(free.x + free.w).toBeLessThanOrEqual(width);
      const { g: covered } = make({ width, insets: { top: 0, right: 30, bottom: 120, left: 20 } });
      const bar = covered.layoutBar();
      expect(bar.y + bar.h).toBeLessThanOrEqual(540 - 120);
      expect(bar.x).toBeGreaterThanOrEqual(20);
      expect(bar.x + bar.w).toBeLessThanOrEqual(width - 30);
    }
  });

  it('reads the live insets object at render time', () => {
    const insets: Insets = { top: 0, right: 0, bottom: 0, left: 0 };
    const { g } = make({ insets });
    const before = g.layoutBar().y;
    insets.bottom = 90;
    expect(g.layoutBar().y).toBe(before - 90);
  });

  it('skips the HUD and banners when rendering a card preview', () => {
    const drawn: string[] = [];
    const base = mockCtx() as unknown as Record<string | symbol, unknown>;
    const ctx = new Proxy(base, {
      get(target, key) {
        if (key === 'fillText') return (s: string) => drawn.push(s);
        return target[key];
      },
      set(target, key, value) {
        target[key] = value;
        return true;
      },
    }) as unknown as CanvasRenderingContext2D;
    const { g, input } = make({ ctx, preview: true });
    step(g, input, 0.3);
    g.render();
    expect(drawn).not.toContain('HIT');
    expect(drawn.some((s) => s.startsWith('ROUND'))).toBe(false);
    const { g: live, input: liveInput } = make({ ctx });
    step(live, liveInput, 0.3);
    live.render();
    expect(drawn).toContain('HIT');
  });
});

describe('Duck Season fairness', () => {
  it('never lets a hittable duck dip into the foreground grass once it has emerged', () => {
    for (const seed of [1, 2, 3, 4]) {
      const { g, input } = make({ seed });
      step(g, input, 60, () => {
        for (const d of g.ducks) {
          if (d.state === 'fly' && d.t > PACE.emerge) expect(d.y).toBeLessThan(g.grassTop - 40);
        }
      });
    }
  });

  it('spawns supply crates with the box above the grass and announces them', () => {
    for (let seed = 1; seed < 40; seed++) {
      const { g, input, audio } = make({ seed });
      until(g, input, () => g.phase === 'wave');
      const crate = g.crates[0];
      if (!crate) continue;
      expect(crate.y).toBeLessThanOrEqual(g.grassTop - 10);
      expect(audio.played).toContain('pop');
      return;
    }
    throw new Error('no crate spawned in 40 seeds');
  });

  it('tests shots against the frame on screen, before the ducks move', () => {
    const { g, input } = inWave();
    const d = g.ducks[0]!;
    parkDucks(g, d);
    // A fast duck (12 px per step) clipped near the trailing edge of the hit radius.
    placeDuck(d, 400, 200, 720, 0);
    tap(input, 400 - g.shotRadius + 4, 200);
    step(g, input, DT);
    expect(d.state).toBe('hit');
  });

  it('forgives about 50 ms of input latency on fast ducks', () => {
    const { g, input } = inWave();
    const d = g.ducks[0]!;
    parkDucks(g, d);
    placeDuck(d, 400, 200, 720, 0);
    // Aimed at where the duck was three frames ago (36 px behind): still a hit.
    tap(input, 400 - 36 - g.shotRadius + 4, 200);
    step(g, input, DT);
    expect(d.state).toBe('hit');

    const { g: g2, input: in2 } = inWave();
    const d2 = g2.ducks[0]!;
    parkDucks(g2, d2);
    placeDuck(d2, 400, 200, 720, 0);
    // Further back than the rewind window: a miss.
    tap(in2, 400 - 48 - g2.shotRadius - 4, 200);
    step(g2, in2, DT);
    expect(d2.state).toBe('fly');
  });

  it('uses a bigger hit radius for touch, and the reticle shows the real radius', () => {
    expect(hitRadius(1, true, false)).toBe(hitRadius(1, false, false) + TOUCH_BONUS);
    const { g, input } = inWave();
    const mouseR = g.shotRadius;
    const d = g.ducks[0]!;
    parkDucks(g, d);
    placeDuck(d, 400, 200);
    tap(input, 400 + mouseR + 4, 200, { touch: true });
    step(g, input, DT);
    expect(g.shotRadius).toBe(mouseR + TOUCH_BONUS);
    expect(d.state).toBe('hit');
  });

  it('ignores presses that land off the canvas (letterbox bars)', () => {
    const { g, input } = inWave();
    const shots = g.shots;
    tap(input, 0, 0, { inside: false });
    step(g, input, DT);
    expect(g.shots).toBe(shots);
  });

  it('collects a crate by shooting its balloon, without breaking the combo', () => {
    const { g, input } = inWave();
    parkDucks(g);
    g.crates = [{ kind: 'slowmo', x: 480, y: 330, vy: 0, alive: true }];
    g.combo = 5;
    tap(input, 480, 330 - BALLOON_DY);
    step(g, input, DT);
    expect(g.crates).toHaveLength(0);
    expect(g.stats.powerups).toBe(1);
    expect(g.powers.slowmo).toBeGreaterThan(0);
    expect(g.combo).toBe(5);
    // A plain miss still breaks it.
    tap(input, 700, 120);
    step(g, input, DT);
    expect(g.combo).toBe(0);
  });

  it('lets the remaining ducks fly off as soon as the shells run out', () => {
    const { g, input } = inWave(2);
    const [a, b] = g.ducks;
    parkDucks(g);
    placeDuck(a!, 300, 150);
    placeDuck(b!, 700, 150);
    tap(input, 300, 150);
    step(g, input, DT);
    expect(a!.state).toBe('hit');
    for (let i = 0; i < 2; i++) {
      tap(input, 500, 330);
      step(g, input, 4 * DT);
    }
    expect(g.shots).toBe(0);
    step(g, input, PACE.outOfShells + 0.05);
    // The first duck is still falling, but the second no longer idles in the air.
    expect(a!.state === 'fall' || a!.state === 'hit').toBe(true);
    expect(b!.state).toBe('escape');
  });
});

describe('Duck Season keyboard and gamepad aim', () => {
  it('accelerates while held and keeps diagonals at the same speed', () => {
    const { g, input } = make();
    g.aimX = 20;
    const x0 = g.aimX;
    input.setVirtual('right', true, 't');
    step(g, input, 0.1);
    expect((g.aimX - x0) / 0.1).toBeLessThan(AIM.minSpeed);
    step(g, input, 0.4);
    const xa = g.aimX;
    step(g, input, 0.1);
    expect((g.aimX - xa) / 0.1).toBeGreaterThan(AIM.maxSpeed * 0.95);
    input.setVirtual('right', false, 't');

    const { g: d, input: din } = make();
    d.aimX = 100;
    d.aimY = 100;
    din.setVirtual('right', true, 't');
    din.setVirtual('down', true, 't');
    step(d, din, 0.3);
    const x1 = d.aimX;
    const y1 = d.aimY;
    step(d, din, 0.05);
    expect(Math.hypot(d.aimX - x1, d.aimY - y1) / 0.05).toBeLessThanOrEqual(AIM.maxSpeed * 1.01);
  });

  it('drifts with a nearby duck when the keys are idle, but never in pointer mode', () => {
    const { g, input } = inWave();
    const d = g.ducks[0]!;
    parkDucks(g, d);
    input.setVirtual('left', true, 't');
    step(g, input, DT);
    input.setVirtual('left', false, 't');
    step(g, input, 0.2);
    placeDuck(d, g.aimX + 50, g.aimY, 120, 0);
    const gap0 = Math.hypot(d.x - g.aimX, d.y - g.aimY);
    step(g, input, 0.3);
    expect(Math.hypot(d.x - g.aimX, d.y - g.aimY)).toBeLessThan(gap0 * 0.5);

    const { g: p, input: pin } = inWave();
    const pd = p.ducks[0]!;
    parkDucks(p, pd);
    pin.pointer.x = 500;
    pin.pointer.y = 200;
    pin.pointer.active = true;
    step(p, pin, DT);
    placeDuck(pd, 540, 200, 120, 0);
    step(p, pin, 0.3);
    expect(p.aimX).toBe(500);
  });
});

describe('Duck Season power-ups and boosts', () => {
  it('stretches slow-mo and scatter with the Overclock upgrade', () => {
    const { g, input } = inWave(1, { powerDuration: 1.6 });
    parkDucks(g);
    g.crates = [{ kind: 'scatter', x: 480, y: 300, vy: 0, alive: true }];
    tap(input, 480, 300);
    step(g, input, DT);
    expect(g.powers.scatter).toBeCloseTo(9 * 1.6, 1);
  });

  it('never cancels the Power Start scatter with a scatter crate', () => {
    const { g, input } = inWave(1, { boosts: ['head-start'] });
    expect(g.scatterActive).toBe(true);
    parkDucks(g);
    g.crates = [{ kind: 'scatter', x: 480, y: 300, vy: 0, alive: true }];
    tap(input, 480, 300);
    step(g, input, DT);
    // Once the crate's own timer has run out, round 1 still has scatter.
    g.powers.scatter = 0;
    step(g, input, DT);
    expect(g.round).toBe(1);
    expect(g.scatterActive).toBe(true);
  });

  it('keeps the Power Start scatter for round 1 only', () => {
    const { g, input } = make({ boosts: ['head-start'] });
    expect(g.scatterActive).toBe(true);
    until(
      g,
      input,
      () => g.round === 2,
      120,
      () => {
        // Line every emerged duck up under the crosshair and shoot, so round 1 is cleared.
        const d = g.ducks.find((x) => x.state === 'fly' && x.t > 0.2);
        if (g.phase === 'wave' && d) {
          placeDuck(d, 480, 200);
          tap(input, 480, 200);
        }
      },
    );
    expect(g.scatterActive).toBe(false);
  });
});

/** Fail a round fast: every wave runs dry immediately. */
function failRound(g: DuckSim, input: Input): void {
  until(
    g,
    input,
    () => g.phase === 'roundEnd',
    60,
    () => {
      if (g.phase === 'wave') g.shots = 0;
    },
  );
}

describe('Duck Season round transitions', () => {
  it('uses the Guardian without a game-over sting, then ends with the dog rising', () => {
    const { g, input, audio } = make({ boosts: ['shield'] });
    failRound(g, input);
    expect(audio.played).toContain('warning');
    expect(audio.played).not.toContain('gameover');
    until(g, input, () => g.phase === 'intro');
    expect(g.retry).toBe(true);
    expect(g.guardian).toBe(false);
    expect(g.round).toBe(1);
    failRound(g, input);
    expect(audio.played).toContain('gameover');
    until(g, input, () => g.phase === 'over');
    expect(g.phaseT).toBeLessThan(0.05);
    expect(g.dogStay).toBe(true);
    expect(g.dogT).toBeLessThan(0.05);
  });

  it('lets a click skip the round result after a short beat', () => {
    const { g, input } = make();
    failRound(g, input);
    tap(input, 300, 200);
    step(g, input, DT);
    expect(g.phase).toBe('roundEnd');
    step(g, input, PACE.roundSkip);
    tap(input, 300, 200);
    step(g, input, DT);
    expect(g.phase).toBe('over');
  });

  it('starts the next pair shortly after a wave is decided, while shot ducks still fall', () => {
    const { g, input } = inWave(3);
    const [a, b] = g.ducks;
    parkDucks(g);
    placeDuck(a!, 300, 120);
    placeDuck(b!, 700, 120);
    tap(input, 300, 120);
    step(g, input, DT);
    tap(input, 700, 120);
    step(g, input, DT);
    expect(g.phase).toBe('waveEnd');
    step(g, input, PACE.nextWave + DT);
    expect(g.phase).toBe('wave');
    expect(g.leaving.some((d) => d.state === 'fall' || d.state === 'hit')).toBe(true);
    // The dog then holds up the kinds that were actually shot.
    until(g, input, () => !g.dogPending);
    expect([...g.dogKinds].sort()).toEqual([a!.kind, b!.kind].sort());
    expect(g.dogMode).toBe('happy');
  });

  it('keeps ducks in the air for most of the session', () => {
    let flying = 0;
    let onScreen = 0;
    let total = 0;
    for (const seed of [1, 2, 3, 4]) {
      const run = playBot(seed, 150, SKILLED);
      flying += run.flying * run.seconds;
      onScreen += run.onScreen * run.seconds;
      total += run.seconds;
    }
    // Before the redesign a scripted player saw flying ducks only 23-36% of the time.
    expect(flying / total).toBeGreaterThan(0.45);
    expect(onScreen / total).toBeGreaterThan(0.65);
  });
});

describe('Duck Season difficulty curve', () => {
  it('raises duck speed smoothly, without a ceiling but without jumps', () => {
    let prev = roundSpeed(1);
    expect(prev).toBe(1);
    for (let r = 2; r <= 60; r++) {
      const s = roundSpeed(r);
      expect(s).toBeGreaterThan(prev);
      expect(s - prev).toBeLessThan(0.11);
      prev = s;
    }
    expect(roundSpeed(4)).toBeCloseTo(1.27, 1);
    expect(roundSpeed(12)).toBeCloseTo(1.64, 1);
  });

  it('never stacks a required-hits step on top of a speed step', () => {
    for (let r = 2; r <= 40; r++) {
      expect(requiredHits(r)).toBeGreaterThanOrEqual(requiredHits(r - 1));
      expect(requiredHits(r) - requiredHits(r - 1)).toBeLessThanOrEqual(1);
      if (isStepRound(r)) expect(speedScale(r)).toBeLessThan(speedScale(r - 1));
    }
    expect(requiredHits(1)).toBe(6);
    expect(requiredHits(16)).toBe(9);
  });

  it('keeps every duck kind in the mix', () => {
    for (let r = 1; r <= 60; r++) {
      const w = kindWeights(r);
      const total = w.reduce((s, k) => s + k.weight, 0);
      const share = (kind: string) => w.find((k) => k.value === kind)!.weight / total;
      expect(share('green')).toBeGreaterThanOrEqual(0.14);
      expect(share('gold')).toBeLessThanOrEqual(0.1);
      expect(share('red')).toBeLessThanOrEqual(0.4);
    }
  });

  it('plans ten ducks per round, mixing in triples only later', () => {
    const rng = new Rng(5);
    for (let r = 1; r <= 30; r++) {
      const plan = wavePlan(r, rng);
      expect(plan.reduce((s, n) => s + n, 0)).toBe(DUCKS_PER_ROUND);
      if (r < 8) expect(plan).toEqual([2, 2, 2, 2, 2]);
    }
    expect(flyTime(1, 2)).toBeGreaterThan(flyTime(20, 2));
    expect(flyTime(20, 3)).toBeGreaterThan(flyTime(20, 2));
  });

  it('lets a casual player through the first rounds, ends long runs, and pays a sensible amount', () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const casual = playBot(seed, 900, CASUAL);
      expect(casual.rounds).toBeGreaterThanOrEqual(4);
      expect(casual.over).toBe(true);
      expect(casual.arcadeCoins).toBeGreaterThanOrEqual(30);
      expect(casual.arcadeCoins).toBeLessThanOrEqual(400);
    }
  });
});

describe('Duck Season determinism', () => {
  it('renders without touching the simulation', () => {
    const play = (renderEvery: number) => {
      const { g, input } = make({ seed: 11 });
      for (let i = 0; i < 60 * 40; i++) {
        if (i % 90 === 0) tap(input, 200 + (i % 500), 150);
        g.update(DT);
        input.postUpdate();
        if (renderEvery > 0 && i % renderEvery === 0) g.render();
      }
      return g.getResult();
    };
    expect(play(1)).toEqual(play(0));
  });

  it('keeps the stat keys that missions and achievements read', () => {
    const run = playBot(2, 120, SKILLED);
    expect(run.rounds).toBeGreaterThan(0);
    const known = [
      'ducks',
      'hits',
      'shots',
      'rounds',
      'bestRound',
      'perfectRounds',
      'doubleKills',
      'goldenDucks',
      'powerups',
    ];
    for (const k of Object.keys(run.stats)) expect(known).toContain(k);
    expect(run.stats.ducks).toBeGreaterThan(0);
    expect(run.stats.bestRound).toBe(run.rounds);
  });
});

/** A context stand-in that records every fillStyle it is given, in drawing order. */
function fillRecorder(): { ctx: CanvasRenderingContext2D; fills: unknown[] } {
  const fills: unknown[] = [];
  const ctx = new Proxy(mockCtx(), {
    set(target, key, value) {
      if (key === 'fillStyle') fills.push(value);
      return Reflect.set(target, key, value);
    },
  });
  return { ctx, fills };
}

describe('Duck Season draw order and snapping', () => {
  it('draws the big tree behind the ducks, so a duck in the air is never hidden by it', () => {
    const { ctx, fills } = fillRecorder();
    const { g } = inWave(2, { ctx });
    expect(g.ducks.some((d) => d.state === 'fly')).toBe(true);
    fills.length = 0;
    g.render();
    const canopy = sceneFor(g.round).canopy;
    let lastCanopy = -1;
    let firstDuck = -1;
    fills.forEach((f, i) => {
      if (canopy.includes(f as string)) lastCanopy = i;
      if (firstDuck < 0 && g.ducks.some((d) => f === DUCK_INFO[d.kind].body)) firstDuck = i;
    });
    expect(lastCanopy).toBeGreaterThanOrEqual(0);
    expect(firstDuck).toBeGreaterThan(lastCanopy);
  });

  it('lets the secondary action snap onto the nearest duck, then holds the reticle briefly', () => {
    const { g, input } = inWave(3);
    parkDucks(g);
    const d = g.ducks[0]!;
    placeDuck(d, 300, 200);
    g.aimX = 270;
    g.aimY = 200;
    input.setVirtual('secondary', true, 't');
    step(g, input, DT);
    input.setVirtual('secondary', false, 't');
    expect(Math.hypot(g.aimX - 300, g.aimY - 200)).toBeLessThan(2);
    // Keys wait during the lock, so the reticle stays on the duck long enough to shoot.
    input.setVirtual('right', true, 't');
    step(g, input, 0.15);
    expect(Math.abs(g.aimX - 300)).toBeLessThan(2);
    step(g, input, 0.3);
    expect(g.snapLock).toBe(0);
    // Once the lock is over (and the duck is out of reach), the keys steer again.
    d.state = 'escape';
    const x0 = g.aimX;
    step(g, input, 0.2);
    input.setVirtual('right', false, 't');
    expect(g.aimX).toBeGreaterThan(x0 + 20);
  });

  it('does nothing when there is no flying duck to snap onto', () => {
    const { g, input } = inWave(4);
    for (const d of g.ducks) d.state = 'escape';
    g.aimX = 300;
    g.aimY = 200;
    input.setVirtual('secondary', true, 't');
    step(g, input, DT);
    input.setVirtual('secondary', false, 't');
    expect(g.snapLock).toBe(0);
    expect(g.aimX).toBe(300);
  });
});

describe('Duck Season HUD on small screens', () => {
  it('draws the HUD larger when the canvas is drawn small, and keeps the design size on desktop', () => {
    // A phone draws the 800-wide canvas at about 0.49 CSS px per logical px.
    const phoneCtx = mockCtx();
    (phoneCtx as unknown as { canvas: unknown }).canvas = { clientWidth: 390 };
    const phone = make({ ctx: phoneCtx, width: 800, height: 540 }).g;
    expect(phone.layoutBar().s).toBeCloseTo(1.2);

    const landscapeCtx = mockCtx();
    (landscapeCtx as unknown as { canvas: unknown }).canvas = { clientWidth: 844 };
    expect(make({ ctx: landscapeCtx, width: 1170, height: 540 }).g.layoutBar().s).toBeCloseTo(1.11, 1);

    expect(make({ width: 800, height: 540 }).g.layoutBar().s).toBe(1);
    expect(make({ width: 1280, height: 540 }).g.layoutBar().s).toBe(1);
  });
});

/** The play stage (CSS px) inside a browser window, as the shell lays it out. */
function stageFor(w: number, h: number): { w: number; h: number } {
  if (w > h && h <= 520) return { w: w - 52, h };
  return { w, h: h - (w <= 720 ? 50 : 56) };
}

/** A context stand-in on a canvas drawn `cssWidth` px wide; records the font size of each fillText. */
function textRecorder(cssWidth: number): { ctx: CanvasRenderingContext2D; sizes: number[] } {
  const sizes: number[] = [];
  const base = mockCtx();
  (base as unknown as { canvas: unknown }).canvas = { clientWidth: cssWidth };
  const ctx = new Proxy(base, {
    get(target, key) {
      if (key !== 'fillText') return Reflect.get(target, key);
      return () => {
        const m = /(\d+(?:\.\d+)?)px/.exec(target.font);
        if (m) sizes.push(Number(m[1]));
      };
    },
  });
  return { ctx, sizes };
}

describe('Duck Season phone layout', () => {
  it('fills the landscape phone and tablet sizes inside its viewport range', () => {
    const v = def.viewport ?? {};
    for (const [name, [w, h]] of Object.entries({
      L1: [740, 360],
      L2: [844, 390],
      L3: [932, 430],
      T2: [1024, 768],
    })) {
      const stage = stageFor(w!, h!);
      const size = chooseLogicalSize(def, stage.w, stage.h);
      expect(size.width, name).toBeGreaterThanOrEqual(v.minWidth ?? def.width);
      expect(size.width, name).toBeLessThanOrEqual(v.maxWidth ?? def.width);
      expect(fittedArea(size, stage.w, stage.h) / (stage.w * stage.h), name).toBeGreaterThanOrEqual(0.85);
    }
  });

  it('keeps the first-frame HUD and round banner text at least 12 CSS px on every phone size', () => {
    for (const [w, h] of [
      [360, 740],
      [390, 844],
      [430, 932],
      [740, 360],
      [844, 390],
      [932, 430],
    ] as const) {
      const stage = stageFor(w, h);
      const size = chooseLogicalSize(def, stage.w, stage.h);
      const scale = Math.min(stage.w / size.width, stage.h / size.height);
      const { ctx, sizes } = textRecorder(size.width * scale);
      make({ ctx, width: size.width, height: size.height }).g.render();
      expect(sizes.length, `${w}x${h}`).toBeGreaterThan(0);
      expect(Math.min(...sizes) * scale, `${w}x${h}`).toBeGreaterThanOrEqual(12);
    }
  });
});
