import { describe, expect, it } from 'vitest';
import type { BoostId, GameResult, Insets } from '../src/games/types';
import { type HillGame, type HillProbe } from '../src/games/hill/hill';
import { GAMES } from '../src/games/registry';
import { SKINS, toSkinData } from '../src/meta/catalog';
import { createGame } from './helpers';

const DT = 1 / 60;
const hillDef = GAMES.find((g) => g.id === 'hill')!;

/**
 * Headless driver. `hold` keeps gas down on the ground and only balances in the air. `skilled`
 * also lifts off a wheelie. `flip` rotates forward in the air until `flips` full turns are done,
 * then balances for the landing.
 */
export type BotMode = 'hold' | 'skilled' | 'flip';

export interface BotOptions {
  seed: number;
  skinId?: string;
  mode?: BotMode;
  /** Full turns to attempt per air phase (flip mode). */
  flips?: number;
  seconds?: number;
  boosts?: BoostId[];
  width?: number;
  height?: number;
  insets?: Insets;
  /** Called once per simulation step, before the step, with the car's state. */
  trace?: (p: HillProbe, step: number, want: { gas: boolean; brake: boolean }) => void;
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
  const airborne = p.airT > 0;
  if (!airborne) {
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
  // Only spin on a jump, once clearly airborne (not on a micro-hop). Stop short of the turn and
  // let the controller finish it, so the car lands level with the slope instead of on its head.
  const onJump = p.kickers.some((k) => p.x >= k.start && p.x <= k.end);
  if (mode === 'flip' && onJump && p.airT > 0.12 && Math.abs(st.airRot) < Math.PI * 2 * flips - 1.2)
    return { gas: false, brake: true };
  // PD on the chassis angle against the ground under the car: brake pitches nose-down, gas nose-up.
  const err = wrap(p.angle - p.groundAngle(p.x));
  const u = -(6 * err + 3.5 * w);
  (globalThis as unknown as { __r?: number }).__r = st.airRot;
  (globalThis as unknown as { __dbg?: string[] }).__dbg?.push(`x=${p.x.toFixed(1)} a=${p.angle.toFixed(4)} err=${err.toFixed(4)} w=${w.toFixed(4)} u=${u.toFixed(3)} airRot=${st.airRot.toFixed(3)} onJump=${onJump}`);
  if (u > 0.5) return { gas: false, brake: true };
  if (u < -0.5) return { gas: true, brake: false };
  return { gas: false, brake: false };
}

/** Drive one run with a simple policy and report where it ended. */
export function runBot(opts: BotOptions): BotRun {
  const skinId = opts.skinId ?? 'car-jeep';
  const skin = toSkinData(SKINS.find((s) => s.id === skinId)!);
  const { game: instance, input } = createGame(hillDef, {
    seed: opts.seed,
    skin,
    boosts: opts.boosts,
    width: opts.width,
    height: opts.height,
    insets: opts.insets,
  });
  const game = instance as HillGame;
  const mode = opts.mode ?? 'hold';
  const flips = opts.flips ?? 1;
  const maxSteps = Math.round((opts.seconds ?? 300) * 60);
  const st: BotState = { airRot: 0, lastAngle: 0 };
  let steps = 0;
  while (steps < maxSteps && !game.isOver()) {
    const p = game.probe();
    const want = decide(p, mode, flips, st);
    opts.trace?.(p, steps, want);
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

describe('Hill Rider bot', () => {
  it('runs a headless driver without errors', () => {
    const run = runBot({ seed: 1, seconds: 5 });
    expect(run.seconds).toBeGreaterThan(4);
    expect(run.result.durationSec).toBeGreaterThan(4);
  });
});
