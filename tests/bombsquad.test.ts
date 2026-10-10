import { describe, expect, it } from 'vitest';
import { NullAudio } from '../src/core/audio';
import { Input } from '../src/core/input';
import { Rng } from '../src/core/rng';
import type { Action } from '../src/core/input';
import { Arena, BORDER, CRATE, FLOOR, manhattan, PILLAR } from '../src/games/bombsquad/grid';
import type { Bomb, Bot, BotKind, Explosion, Item, Player } from '../src/games/bombsquad/types';
import { FLIGHT_TIME, LIVES } from '../src/games/bombsquad/types';
import type { BoostId, GameInstance, GameServices } from '../src/games/types';
import { NO_INSETS } from '../src/games/types';
import { defaultSkin, toSkinData } from '../src/meta/catalog';
import { createGame, gameById, mockCtx } from './helpers';

const DT = 1 / 60;
const ACTIONS: Action[] = ['left', 'right', 'up', 'down', 'primary', 'secondary'];

/** Private state the tests inspect and arrange. */
interface Internals {
  arena: Arena;
  player: Player;
  bots: Bot[];
  bombs: Bomb[];
  explosions: Explosion[];
  items: Item[];
  spawnQueue: BotKind[];
  wave: number;
  lives: number;
  layout(): { ts: number; ox: number; oy: number };
  addBomb(
    owner: Bomb['owner'],
    tx: number,
    ty: number,
    fromX: number,
    fromY: number,
    power: number,
    fuse: number,
    flight: number,
  ): void;
}

function internals(game: GameInstance): Internals {
  return game as unknown as Internals;
}

function tilesOf(arena: Arena): Uint8Array {
  return (arena as unknown as { tiles: Uint8Array }).tiles;
}

function setKind(arena: Arena, x: number, y: number, kind: number): void {
  tilesOf(arena)[arena.index(x, y)] = kind;
}

/** Clears every interior tile so a test can lay out exactly what it needs. */
function clearInterior(arena: Arena): void {
  for (let y = 1; y < arena.rows - 1; y++) {
    for (let x = 1; x < arena.cols - 1; x++) setKind(arena, x, y, FLOOR);
  }
}

function makeBot(kind: BotKind, x: number, y: number): Bot {
  const bomber = kind === 'bomber';
  return {
    kind,
    x: x + 0.5,
    y: y + 0.5,
    hp: bomber ? 2 : 1,
    maxHp: bomber ? 2 : 1,
    speed: 0,
    path: [],
    goal: -1,
    repath: 99,
    bombCd: 99,
    touchCd: 99,
    wait: 1e9,
    flash: 0,
    facingX: 1,
    phase: 0,
  };
}

/** A fresh game with the random bot waves cleared, so a test controls every bot itself. */
function quietGame(seed = 1, boosts: BoostId[] = []) {
  const def = gameById('bombsquad');
  const { game, input } = createGame(def, { seed, boosts });
  const i = internals(game);
  i.spawnQueue = [];
  i.bots = [];
  i.player.invuln = 1e9;
  return { game, input, i, arena: i.arena };
}

/** Runs `seconds` of simulation with no input. */
function run(game: GameInstance, input: Input, seconds: number): void {
  for (let t = 0; t < seconds; t += DT) {
    game.update(DT);
    input.postUpdate();
  }
}

/** Presses an action for exactly one simulation step. */
function press(game: GameInstance, input: Input, action: Action): void {
  input.setVirtual(action, true, 'test');
  game.update(DT);
  input.postUpdate();
  input.setVirtual(action, false, 'test');
  game.update(DT);
  input.postUpdate();
}

describe('arena layout', () => {
  it('has solid borders, pillars on even coordinates and a free spawn area', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const arena = new Arena(960, 600, new Rng(seed));
      expect(arena.cols % 2).toBe(1);
      expect(arena.rows % 2).toBe(1);
      for (let x = 0; x < arena.cols; x++) {
        expect(arena.isSolid(x, 0)).toBe(true);
        expect(arena.isSolid(x, arena.rows - 1)).toBe(true);
        expect(arena.kindAt(x, 0)).toBe(BORDER);
      }
      for (let y = 0; y < arena.rows; y++) {
        expect(arena.isSolid(0, y)).toBe(true);
        expect(arena.isSolid(arena.cols - 1, y)).toBe(true);
      }

      let pillars = 0;
      for (let y = 0; y < arena.rows; y++) {
        for (let x = 0; x < arena.cols; x++) {
          if (arena.kindAt(x, y) !== PILLAR) continue;
          pillars++;
          expect(x % 2).toBe(0);
          expect(y % 2).toBe(0);
        }
      }
      // 19 x 11 at design size: pillars at x 2..16 and y 2..8.
      if (seed === 1) expect(pillars).toBe(8 * 4);

      // No crates within Manhattan distance 2 of the player's spawn, and the two first steps are open.
      const { x: sx, y: sy } = arena.playerSpawn;
      for (let y = sy - 2; y <= sy + 2; y++) {
        for (let x = sx - 2; x <= sx + 2; x++) {
          if (Math.abs(x - sx) + Math.abs(y - sy) > 2 || !arena.inBounds(x, y)) continue;
          expect(arena.isCrate(x, y)).toBe(false);
        }
      }
      expect(arena.isSolid(2, 1)).toBe(false);
      expect(arena.isSolid(1, 2)).toBe(false);
    }
  });

  it('keeps bot spawns at least 6 tiles from the player and on free tiles', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const arena = new Arena(960, 600, new Rng(seed));
      expect(arena.botSpawns.length).toBeGreaterThanOrEqual(4);
      for (const s of arena.botSpawns) {
        expect(Math.abs(s.x - 1) + Math.abs(s.y - 1)).toBeGreaterThanOrEqual(6);
        expect(arena.isSolid(s.x, s.y)).toBe(false);
      }
    }
  });
});

describe('pathing', () => {
  it('finds a bot path from every spawn to the player on at least 100 seeds', () => {
    for (let seed = 1; seed <= 120; seed++) {
      const arena = new Arena(960, 600, new Rng(seed));
      const occupied = new Uint8Array(arena.cols * arena.rows);
      for (const s of arena.botSpawns) {
        const path = arena.findPath(s.x, s.y, 1, 1, occupied);
        expect(path, `seed ${seed} spawn ${s.x},${s.y}`).not.toBeNull();
      }
    }
  });
});

describe('determinism', () => {
  it('plays the same with the same seed and inputs', () => {
    const drive = (seed: number) => {
      const { game, input } = createGame(gameById('bombsquad'), { seed });
      const rng = new Rng(seed * 7 + 3);
      const held = new Set<Action>();
      for (let i = 0; i < 60 * 40; i++) {
        if (i % 9 === 0) {
          for (const a of ACTIONS) {
            const want = rng.chance(0.2);
            if (want && !held.has(a)) {
              held.add(a);
              input.setVirtual(a, true, 'det');
            } else if (!want && held.has(a)) {
              held.delete(a);
              input.setVirtual(a, false, 'det');
            }
          }
        }
        game.update(DT);
        input.postUpdate();
        if (game.isOver()) break;
      }
      return game.getResult();
    };
    expect(drive(11)).toEqual(drive(11));
    expect(drive(12)).toEqual(drive(12));
  });
});

describe('bombs and blasts', () => {
  it('a thrown bomb explodes after its fuse and returns its ammo', () => {
    const { game, input, i } = quietGame(3);
    clearInterior(i.arena);
    expect(i.player.ammo).toBe(1);
    press(game, input, 'primary');
    expect(i.bombs.length).toBe(1);
    expect(i.player.ammo).toBe(0);
    run(game, input, 2.3); // landed after 0.25 s, so 2.05 s of a 2.2 s fuse have passed
    expect(i.bombs.length).toBe(1);
    run(game, input, 0.3);
    expect(i.bombs.length).toBe(0);
    expect(i.explosions.length).toBeGreaterThan(0);
    expect(i.player.ammo).toBe(1);
    expect(game.getResult().stats.bombs).toBe(1);
  });

  it('a blast stops at a pillar and destroys exactly one crate', () => {
    const { game, input, i, arena } = quietGame(4);
    clearInterior(arena);
    setKind(arena, 3, 3, PILLAR);
    setKind(arena, 6, 3, CRATE);
    setKind(arena, 7, 3, CRATE);
    i.addBomb('bot', 5, 3, 5.5, 3.5, 3, 0.001, 0);
    run(game, input, 0.1);
    expect(arena.kindAt(3, 3)).toBe(PILLAR);
    expect(arena.kindAt(6, 3)).toBe(FLOOR);
    expect(arena.kindAt(7, 3)).toBe(CRATE);
    expect(game.getResult().stats.blocks).toBe(1);
    const hit = new Set(i.explosions.flatMap((e) => e.tiles));
    expect(hit.has(arena.index(4, 3))).toBe(true);
    expect(hit.has(arena.index(6, 3))).toBe(true);
    expect(hit.has(arena.index(7, 3))).toBe(false);
    expect(hit.has(arena.index(3, 3))).toBe(false);
  });

  it('a bot caught by a blast dies and counts as a kill', () => {
    const { game, input, i, arena } = quietGame(5);
    clearInterior(arena);
    i.bots = [makeBot('walker', 5, 3)];
    i.addBomb('bot', 5, 3, 5.5, 3.5, 2, 0.001, 0);
    run(game, input, 0.1);
    expect(i.bots.length).toBe(0);
    expect(game.getResult().stats.kills).toBe(1);
  });

  it('a bomber needs two blasts and a single explosion never kills it twice', () => {
    const { game, input, i, arena } = quietGame(6);
    clearInterior(arena);
    i.bots = [makeBot('bomber', 5, 3)];
    i.addBomb('bot', 5, 3, 5.5, 3.5, 2, 0.001, 0);
    run(game, input, 0.1);
    expect(i.bots.length).toBe(1);
    expect(i.bots[0]?.hp).toBe(1);
    i.addBomb('bot', 5, 3, 5.5, 3.5, 2, 0.001, 0);
    run(game, input, 0.1);
    expect(i.bots.length).toBe(0);
  });

  it('a multi-kill from one explosion counts once and pays the bonus', () => {
    const { game, input, i, arena } = quietGame(7);
    clearInterior(arena);
    i.bots = [makeBot('walker', 5, 3), makeBot('walker', 4, 3), makeBot('walker', 6, 3)];
    const before = game.getResult().score;
    i.addBomb('bot', 5, 3, 5.5, 3.5, 2, 0.001, 0);
    run(game, input, 0.1);
    const stats = game.getResult().stats;
    expect(stats.kills).toBe(3);
    expect(stats.multikill).toBe(3);
    // Three walkers at 100 each, plus 100 for each kill beyond the first.
    expect(game.getResult().score - before).toBe(300 + 200);
  });

  it('a blast that reaches the player costs a life, and a shield absorbs that hit', () => {
    const plain = quietGame(8);
    clearInterior(plain.arena);
    plain.i.player.invuln = 0;
    plain.i.addBomb('bot', 1, 1, 1.5, 1.5, 2, 0.001, 0);
    run(plain.game, plain.input, 0.1);
    expect(plain.i.lives).toBe(LIVES - 1);

    const shielded = quietGame(8, ['shield']);
    clearInterior(shielded.arena);
    shielded.i.player.invuln = 0;
    expect(shielded.i.player.shielded).toBe(true);
    shielded.i.addBomb('bot', 1, 1, 1.5, 1.5, 2, 0.001, 0);
    run(shielded.game, shielded.input, 0.1);
    expect(shielded.i.lives).toBe(LIVES);
    expect(shielded.i.player.shielded).toBe(false);
    expect(shielded.i.player.invuln).toBeGreaterThan(0);
  });

  it('punch kicks a landed bomb three tiles forward and keeps its fuse', () => {
    const { game, input, i, arena } = quietGame(9);
    clearInterior(arena);
    i.addBomb('player', 2, 1, 1.5, 1.5, 2, 2.2, 0);
    const bomb = i.bombs[0];
    expect(bomb).toBeDefined();
    run(game, input, 0.5);
    const fuseBefore = bomb?.fuse ?? 0;
    press(game, input, 'secondary');
    expect(bomb?.tx).toBe(5);
    expect(bomb?.ty).toBe(1);
    expect(bomb?.flight).toBeGreaterThan(0);
    expect(bomb?.flight).toBeLessThanOrEqual(FLIGHT_TIME);
    // A bomb in flight does not burn its fuse, so the kick keeps the remaining time exactly.
    expect(bomb?.fuse).toBe(fuseBefore);
  });

  it('a throw lands on the last free tile when the far tile is blocked', () => {
    const { game, input, i, arena } = quietGame(10);
    clearInterior(arena);
    setKind(arena, 4, 1, CRATE);
    press(game, input, 'primary');
    expect(i.bombs.length).toBe(1);
    const landed = i.bombs[0];
    expect(landed?.tx).toBe(3);
    expect(landed?.ty).toBe(1);
  });
});

describe('spawns and aim', () => {
  it('never spawns a bot on top of the player, even when the player stands on a spawn point', () => {
    const { game, input, i, arena } = quietGame(15);
    const spawn = arena.botSpawns[0];
    if (!spawn) throw new Error('no bot spawn point');
    i.player.invuln = 0;
    i.player.x = spawn.x + 0.5;
    i.player.y = spawn.y + 0.5;
    const px = Math.floor(i.player.x);
    const py = Math.floor(i.player.y);
    i.spawnQueue = ['walker', 'walker', 'bomber'];
    i.spawnTimer = 0;
    let checked = 0;
    for (let t = 0; t < 2; t += DT) {
      game.update(DT);
      input.postUpdate();
      // Each bot is checked on the step it appears, before it has had time to walk toward the player.
      for (; checked < i.bots.length; checked++) {
        const bot = i.bots[checked];
        if (!bot) continue;
        expect(manhattan(Math.floor(bot.x), Math.floor(bot.y), px, py)).toBeGreaterThanOrEqual(6);
      }
    }
    expect(checked).toBe(3);
    expect(i.lives).toBe(LIVES);
  });

  it('a due bot waits while every far spawn point is taken, then appears', () => {
    const { game, input, i, arena } = quietGame(16);
    // Long-fused bombs hold every spawn point without going off during the test.
    for (const s of arena.botSpawns) i.addBomb('bot', s.x, s.y, s.x + 0.5, s.y + 0.5, 1, 100, 0);
    i.spawnQueue = ['walker'];
    i.spawnTimer = 0;
    run(game, input, 1);
    expect(i.bots.length).toBe(0);
    expect(i.spawnQueue.length).toBe(1);
    i.bombs = [];
    run(game, input, 0.2);
    expect(i.bots.length).toBe(1);
    expect(i.spawnQueue.length).toBe(0);
  });

  it('a pointer resting over the HUD or the margins does not steer the throw off the grid', () => {
    const { game, input, i, arena } = quietGame(17);
    clearInterior(arena);
    const { ts, ox, oy } = i.layout();
    const centre = (tx: number, ty: number) => ({ x: ox + (tx + 0.5) * ts, y: oy + (ty + 0.5) * ts });
    i.player.x = 5.5;
    i.player.y = 5.5;
    i.player.facingX = 1;
    i.player.facingY = 0;
    const throwAt = (x: number, y: number): number[] | null => {
      Object.assign(input.pointer, { x, y, inside: true, active: true, touch: false });
      i.bombs = [];
      i.player.ammo = 1;
      press(game, input, 'primary');
      const b = i.bombs[0];
      return b ? [b.tx, b.ty] : null;
    };
    // Over the HUD strip and in the left margin: both fall back to the facing direction (right).
    expect(throwAt(480, 20)).toEqual([8, 5]);
    expect(throwAt(4, oy + 2 * ts)).toEqual([8, 5]);
    // Over the arena itself, the throw follows the pointer's tile.
    const up = centre(5, 2);
    expect(throwAt(up.x, up.y)).toEqual([5, 2]);
  });
});

describe('waves, items and stats', () => {
  it('wave 2 starts only after wave 1 is cleared', () => {
    const { game, input, i } = quietGame(11);
    i.spawnQueue = ['walker', 'walker'];
    i.bots = [];
    run(game, input, 0.5);
    expect(i.bots.length).toBeGreaterThan(0);
    for (let t = 0; t < 4; t += DT) {
      game.update(DT);
      input.postUpdate();
      expect(i.wave).toBe(1);
    }
    i.bots = [];
    run(game, input, 1.0);
    expect(i.wave).toBe(1);
    run(game, input, 0.8);
    expect(i.wave).toBe(2);
    expect(game.getResult().stats.wave).toBe(2);
  });

  it('wave clear pays 200 per wave number', () => {
    const { game, input, i } = quietGame(12);
    i.bots = [];
    i.spawnQueue = [];
    const before = game.getResult().score;
    run(game, input, 1.6);
    expect(i.wave).toBe(2);
    expect(game.getResult().score - before).toBe(200);
  });

  it('powerups count pickups, and the stat keys mean what the arena says', () => {
    const { game, input, i } = quietGame(13);
    i.items = [{ kind: 'speed', x: 1, y: 1 }];
    run(game, input, 0.05);
    expect(i.items.length).toBe(0);
    expect(i.player.speedUps).toBe(1);
    const stats = game.getResult().stats;
    expect(stats.powerups).toBe(1);
    expect(stats.bombs ?? 0).toBe(0);
    expect(stats.kills ?? 0).toBe(0);
    expect(stats.blocks ?? 0).toBe(0);
    expect(stats.wave).toBe(1);
  });

  it('coins follow kills, crates and the highest wave reached', () => {
    const { game, input, i, arena } = quietGame(14);
    clearInterior(arena);
    i.bots = [makeBot('walker', 5, 3)];
    i.addBomb('bot', 5, 3, 5.5, 3.5, 2, 0.001, 0);
    run(game, input, 0.1);
    expect(game.getResult().coins).toBe(1 + 0 + 2 * 1);
  });
});

describe('robustness', () => {
  it('renders the preview (card art) without HUD or banner and without throwing', () => {
    const def = gameById('bombsquad');
    const services: GameServices = {
      ctx: mockCtx(),
      width: def.width,
      height: def.height,
      insets: NO_INSETS,
      input: new Input(),
      audio: new NullAudio(),
      rng: new Rng(5),
      loadout: { skin: toSkinData(defaultSkin('bombsquad')), boosts: new Set(), powerDuration: 1 },
      reducedMotion: false,
      haptic: () => undefined,
      preview: true,
    };
    const game = def.create(services);
    for (let t = 0; t < 120; t++) game.update(DT);
    expect(() => game.render()).not.toThrow();
  });

  it('keeps the player finite and inside the arena after long random play', () => {
    for (const seed of [31, 32, 33]) {
      const { game, input } = createGame(gameById('bombsquad'), { seed });
      const i = internals(game);
      const rng = new Rng(seed);
      const held = new Set<Action>();
      for (let f = 0; f < 60 * 60; f++) {
        if (f % 6 === 0) {
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
        }
        game.update(DT);
        input.postUpdate();
        expect(Number.isFinite(i.player.x)).toBe(true);
        expect(Number.isFinite(i.player.y)).toBe(true);
        if (game.isOver()) break;
      }
      game.render();
      const r = game.getResult();
      expect(Number.isFinite(r.score)).toBe(true);
    }
  });
});
