import { describe, expect, it } from 'vitest';
import type { AudioLike, PlayOptions, SfxName } from '../src/core/audio';
import { Input } from '../src/core/input';
import { Rng } from '../src/core/rng';
import { BALLOON_DY } from '../src/games/duck/art';
import {
  AIM,
  DUCKS_PER_ROUND,
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
import { DuckGame as LegacyDuck } from '../src/games/duck/legacy_tmp';

const DT = 1 / 60;
const def = gameById('duck');

interface SimDuck {
  kind: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  speed: number;
  state: 'fly' | 'hit' | 'fall' | 'escape' | 'gone';
  hit: boolean;
  t: number;
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
  dogKinds: string[];
  grassTop: number;
  touchAim: boolean;
  stats: Record<string, number>;
  scatterActive: boolean;
  shotRadius: number;
  shoot(): void;
  startWave(): void;
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
  reducedMotion?: boolean;
}

function make(opts: MakeOptions = {}): { g: DuckSim; input: Input; audio: RecordingAudio } {
  const input = new Input();
  const audio = new RecordingAudio();
  const game = def.create({
    ctx: mockCtx(),
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
    reducedMotion: opts.reducedMotion ?? false,
    haptic: () => undefined,
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

/** Step until `cond` holds (or fail after `max` seconds). */
function until(g: DuckSim, input: Input, cond: () => boolean, max = 30): void {
  for (let i = 0; i < max * 60; i++) {
    if (cond()) return;
    g.update(DT);
    input.postUpdate();
  }
  throw new Error('condition not reached');
}

/** A pointer press at (x, y) on the canvas, processed by the next update. */
function tap(input: Input, x: number, y: number, touch = false): void {
  const p = input.pointer;
  p.x = x;
  p.y = y;
  p.active = true;
  p.inside = true;
  p.touch = touch;
  p.pressed = true;
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

interface BotStats {
  frames: number;
  flying: number;
  onScreen: number;
  rounds: number;
  over: boolean;
  score: number;
  coins: number;
}

interface BotDuck {
  x: number;
  y: number;
  state: string;
}

/**
 * A scripted player: it sees ducks `lag` seconds late, leads them linearly, and clicks at a steady
 * cadence with Gaussian aim noise (all seeded).
 */
function playBot(game: GameInstance, input: Input, seed: number, seconds: number, bot: BotOptions): BotStats {
  const g = game as unknown as { ducks: BotDuck[]; leaving?: BotDuck[]; phase: string };
  const rng = new Rng(seed * 7 + 1);
  const gauss = () => Math.sqrt(-2 * Math.log(1 - rng.next())) * Math.cos(2 * Math.PI * rng.next());
  const out: BotStats = { frames: 0, flying: 0, onScreen: 0, rounds: 0, over: false, score: 0, coins: 0 };
  const seen = new Map<BotDuck, { x: number; y: number }[]>();
  const lagFrames = Math.round(bot.lag * 60);
  let cool = bot.reaction;
  let target: BotDuck | null = null;
  for (let i = 0; i < seconds * 60 && !game.isOver(); i++) {
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
      if (cool <= 0 && a && b && a.y < 370) {
        const lead = bot.lag;
        tap(
          input,
          a.x + (a.x - b.x) * 60 * lead + gauss() * bot.noise,
          a.y + (a.y - b.y) * 60 * lead + gauss() * bot.noise,
        );
        cool = bot.cadence;
      }
    } else {
      cool = bot.reaction;
      target = null;
    }
    out.frames++;
    if (flying.length > 0) out.flying++;
    if (g.ducks.length + (g.leaving?.length ?? 0) > 0) out.onScreen++;
    game.update(DT);
    input.postUpdate();
  }
  const r = game.getResult();
  out.rounds = r.stats.rounds ?? 0;
  out.over = game.isOver();
  out.score = r.score;
  out.coins = r.coins;
  return out;
}

describe('Duck Season pacing', () => {
  it('explores', () => {
    for (const [name, bot] of [
      ['expert', { cadence: 0.45, reaction: 0.45, noise: 8, lag: 0.15 }],
      ['skilled', { cadence: 0.55, reaction: 0.6, noise: 12, lag: 0.2 }],
      ['casual', { cadence: 0.7, reaction: 0.8, noise: 18, lag: 0.25 }],
    ] as const) {
     for (const legacy of [true, false]) {
      let frames = 0;
      let flying = 0;
      let onScreen = 0;
      const rows: string[] = [];
      for (let seed = 1; seed <= 12; seed++) {
        let s: BotStats;
        if (legacy) {
          const input = new Input();
          const game = new LegacyDuck({
            ctx: mockCtx(),
            width: 960,
            height: 540,
            insets: NO_INSETS,
            input,
            audio: new RecordingAudio(),
            rng: new Rng(seed),
            loadout: { skin: toSkinData(defaultSkin('duck')), boosts: new Set(), powerDuration: 1 },
            reducedMotion: false,
            haptic: () => undefined,
          });
          s = playBot(game, input, seed, 600, bot);
        } else {
          const { g, input } = make({ seed });
          s = playBot(g, input, seed, 600, bot);
        }
        frames += s.frames;
        flying += s.flying;
        onScreen += s.onScreen;
        rows.push(`r${s.rounds} ${s.score} c${s.coins} ${(s.frames / 60).toFixed(0)}s`);
      }
      console.log(name, legacy ? 'OLD' : 'NEW', (flying / frames).toFixed(3), (onScreen / frames).toFixed(3), rows.join(' | '));
     }
    }
  });
});
