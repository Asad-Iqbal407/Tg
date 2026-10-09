import { describe, expect, it } from 'vitest';
import type { Action, SwipeDir } from '../src/core/input';
import { Rng } from '../src/core/rng';
import { CHUNKS, END_CHUNK, START_CHUNK } from '../src/games/platformer/chunks';
import { buildLevel, validateChunk } from '../src/games/platformer/level';
import { GAMES } from '../src/games/registry';
import { Terrain } from '../src/games/hill/terrain';
import type { BoostId, GameResult } from '../src/games/types';
import { SKINS, toSkinData } from '../src/meta/catalog';
import { createGame } from './helpers';

const ACTIONS: Action[] = ['left', 'right', 'up', 'down', 'primary', 'secondary'];
const SWIPES: SwipeDir[] = ['left', 'right', 'up', 'down'];
const DT = 1 / 60;

function expectSaneResult(r: GameResult): void {
  expect(Number.isFinite(r.score)).toBe(true);
  expect(r.score).toBeGreaterThanOrEqual(0);
  expect(Number.isInteger(r.coins)).toBe(true);
  expect(r.coins).toBeGreaterThanOrEqual(0);
  expect(r.durationSec).toBeGreaterThan(0);
  for (const v of Object.values(r.stats)) {
    expect(Number.isFinite(v)).toBe(true);
    expect(v).toBeGreaterThanOrEqual(0);
  }
}

/** Drive a game with random (but seeded) inputs, rendering periodically. */
function fuzz(
  id: string,
  seed: number,
  seconds: number,
  boosts: BoostId[] = [],
  skinId?: string,
): { result: GameResult; over: boolean } {
  const def = GAMES.find((g) => g.id === id)!;
  const skin = skinId ? toSkinData(SKINS.find((s) => s.id === skinId)!) : undefined;
  const { game, input } = createGame(def, { seed, boosts, skin });
  const rng = new Rng(seed * 31 + 7);
  const held = new Set<Action>();
  let over = false;
  for (let i = 0; i < seconds * 60; i++) {
    if (i % 6 === 0) {
      for (const a of ACTIONS) {
        const want = rng.chance(0.25);
        if (want && !held.has(a)) {
          held.add(a);
          input.setVirtual(a, true, 'fuzz');
        } else if (!want && held.has(a)) {
          held.delete(a);
          input.setVirtual(a, false, 'fuzz');
        }
      }
      if (rng.chance(0.2)) input.pushSwipe(rng.pick(SWIPES));
      input.pointer.x = rng.range(0, def.width);
      input.pointer.y = rng.range(0, def.height);
      input.pointer.active = true;
      input.pointer.pressed = rng.chance(0.3);
      input.pointer.down = rng.chance(0.5);
    }
    game.update(DT);
    input.postUpdate();
    if (i % 30 === 0) game.render();
    if (game.isOver()) {
      over = true;
      break;
    }
  }
  game.render();
  const result = game.getResult();
  game.destroy();
  return { result, over };
}

describe.each(GAMES.map((g) => g.id))('%s', (id) => {
  it('survives 90s of random input without errors and reports a sane result', () => {
    for (const seed of [1, 2]) expectSaneResult(fuzz(id, seed, 90).result);
  });

  it('works with every boost and every skin', () => {
    expectSaneResult(fuzz(id, 5, 30, ['shield', 'head-start']).result);
    for (const skin of SKINS.filter((s) => s.gameId === id))
      expectSaneResult(fuzz(id, 9, 8, [], skin.id).result);
  });

  it('is deterministic for the same seed and inputs', () => {
    const a = fuzz(id, 77, 20).result;
    const b = fuzz(id, 77, 20).result;
    expect(a).toEqual(b);
  });
});

describe('game over conditions', () => {
  it.each(['runner', 'duck', 'galaxy'])('%s eventually ends when left idle', (id) => {
    const def = GAMES.find((g) => g.id === id)!;
    const { game, input } = createGame(def, { seed: 3 });
    let t = 0;
    while (!game.isOver() && t < 240) {
      game.update(DT);
      input.postUpdate();
      t += DT;
    }
    expect(game.isOver()).toBe(true);
  });

  it('hill rider ends when fuel runs out', () => {
    const def = GAMES.find((g) => g.id === 'hill')!;
    const { game, input } = createGame(def, { seed: 3 });
    let t = 0;
    while (!game.isOver() && t < 200) {
      game.update(DT);
      input.postUpdate();
      t += DT;
    }
    expect(game.isOver()).toBe(true);
    expect(game.getResult().durationSec).toBeGreaterThan(60);
  });
});

describe('Pixel Quest levels', () => {
  it('has valid hand-authored chunks', () => {
    for (const c of [START_CHUNK, END_CHUNK, ...CHUNKS]) expect(validateChunk(c)).toEqual([]);
  });

  it('builds deterministic, growing levels with a start and a flag', () => {
    for (let level = 1; level <= 8; level++) {
      const a = buildLevel(level, 1234);
      const b = buildLevel(level, 1234);
      expect(a.chunkNames).toEqual(b.chunkNames);
      expect(a.chunkNames[0]).toBe('start');
      expect(a.chunkNames.at(-1)).toBe('end');
      expect(a.flagX).toBeGreaterThan(a.start.x);
      expect(a.checkpoint.x).toBeGreaterThan(a.start.x);
      expect(a.checkpoint.x).toBeLessThan(a.flagX);
    }
    expect(buildLevel(6, 1).cols).toBeGreaterThan(buildLevel(1, 1).cols);
  });
});

describe('Hill Rider terrain', () => {
  it('is deterministic, continuous and starts flat', () => {
    const a = new Terrain(42);
    const b = new Terrain(42);
    for (let x = 0; x < 50_000; x += 137) expect(a.heightAt(x)).toBe(b.heightAt(x));
    expect(Math.abs(a.heightAt(0) - a.heightAt(200))).toBeLessThan(1);
    for (let x = 0; x < 20_000; x += 5) expect(Math.abs(a.heightAt(x + 5) - a.heightAt(x))).toBeLessThan(15);
  });

  it('returns outward normals from closest()', () => {
    const t = new Terrain(1);
    const x = 100;
    const y = t.heightAt(x) - 10;
    const c = t.closest(x, y, 20);
    expect(c.d).toBeGreaterThan(9);
    expect(c.d).toBeLessThan(11);
    expect(c.ny).toBeLessThan(0);
  });
});
