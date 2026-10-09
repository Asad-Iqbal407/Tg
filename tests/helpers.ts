import { NullAudio } from '../src/core/audio';
import { Input } from '../src/core/input';
import { Rng } from '../src/core/rng';
import { MemoryBackend, PersistentStore } from '../src/core/storage';
import { GAMES } from '../src/games/registry';
import type { BoostId, GameDefinition, GameInstance, SkinData } from '../src/games/types';
import { ArcadeService } from '../src/meta/arcade';
import { defaultSkin, toSkinData } from '../src/meta/catalog';
import { defaultProfile, type Profile, PROFILE_VERSION, sanitizeProfile } from '../src/meta/profile';

/** A CanvasRenderingContext2D stand-in that accepts every call and property write. */
export function mockCtx(): CanvasRenderingContext2D {
  const state: Record<string | symbol, unknown> = {};
  const gradient = { addColorStop: () => undefined };
  return new Proxy(state, {
    get(target, key) {
      if (key in target) return target[key];
      if (key === 'createLinearGradient' || key === 'createRadialGradient' || key === 'createPattern')
        return () => gradient;
      if (key === 'measureText') return () => ({ width: 10 });
      return () => undefined;
    },
    set(target, key, value) {
      target[key] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
}

export function createGame(
  def: GameDefinition,
  opts: { seed?: number; boosts?: BoostId[]; skin?: SkinData; input?: Input } = {},
): { game: GameInstance; input: Input } {
  const input = opts.input ?? new Input();
  const game = def.create({
    ctx: mockCtx(),
    width: def.width,
    height: def.height,
    input,
    audio: new NullAudio(),
    rng: new Rng(opts.seed ?? 1),
    loadout: {
      skin: opts.skin ?? toSkinData(defaultSkin(def.id)),
      boosts: new Set(opts.boosts ?? []),
      powerDuration: 1,
    },
    reducedMotion: false,
    haptic: () => undefined,
  });
  return { game, input };
}

export function gameById(id: string): GameDefinition {
  const def = GAMES.find((g) => g.id === id);
  if (!def) throw new Error(id);
  return def;
}

export function makeArcade(now: () => Date = () => new Date(2026, 9, 9, 12)): {
  arcade: ArcadeService;
  store: PersistentStore<Profile>;
  backend: MemoryBackend;
} {
  const backend = new MemoryBackend();
  const store = new PersistentStore<Profile>({
    key: 'test',
    version: PROFILE_VERSION,
    backend,
    defaults: () => defaultProfile(0),
    sanitize: sanitizeProfile,
  });
  return { arcade: new ArcadeService(store, GAMES, now), store, backend };
}
