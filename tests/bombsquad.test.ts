import { describe, expect, it, vi } from 'vitest';
import { NullAudio } from '../src/core/audio';
import { chooseLogicalSize, fittedArea } from '../src/core/engine';
import { Input } from '../src/core/input';
import { Rng } from '../src/core/rng';
import type { Action } from '../src/core/input';
import { touchTile } from '../src/games/bombsquad/bombsquad';
import { Arena, BORDER, CRATE, FLOOR, manhattan, PILLAR } from '../src/games/bombsquad/grid';
import {
  COMPACT_BOT_SCALE,
  COMPACT_HUD_PX,
  COMPACT_PLAYER_SCALE,
  drawScene,
  hudTextPx,
  lifePillScale,
  PLAYER_HEIGHT_TILES,
  type Palette,
  type SceneView,
  tileForCharacters,
} from '../src/games/bombsquad/render';
import type { Bomb, Bot, BotKind, Explosion, Item, Player } from '../src/games/bombsquad/types';
import { BOT_TOUCH_GRACE, FUSE, LIVES, WALKER_SPEED } from '../src/games/bombsquad/types';
import type { BoostId, GameDefinition, GameInstance, GameServices } from '../src/games/types';
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
  spawnTimer: number;
  wave: number;
  lives: number;
  layout(): { ts: number; ox: number; oy: number; clip?: { x: number; y: number; w: number; h: number } };
  addBomb(owner: Bomb['owner'], tx: number, ty: number, power: number, fuse: number): void;
}

function internals(game: GameInstance): Internals {
  return game as unknown as Internals;
}

/** The game's sound player, so a test can check which effects were requested. */
function audioOf(game: GameInstance): NullAudio {
  return (game as unknown as { audio: NullAudio }).audio;
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
    contact: 0,
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
  it("a laid bomb sits on the player's tile and explodes after its fuse, returning its ammo", () => {
    const { game, input, i, arena } = quietGame(3);
    clearInterior(arena);
    expect(i.player.ammo).toBe(1);
    press(game, input, 'primary');
    expect(i.bombs.length).toBe(1);
    const bomb = i.bombs[0];
    expect([bomb?.tx, bomb?.ty]).toEqual([1, 1]);
    expect([bomb?.x, bomb?.y]).toEqual([1.5, 1.5]);
    expect(i.player.ammo).toBe(0);
    // The fuse started when the bomb was laid: after 2.0 s it still burns, and it blows up soon after 2.2 s.
    run(game, input, 2.0);
    expect(i.bombs.length).toBe(1);
    expect([bomb?.x, bomb?.y]).toEqual([1.5, 1.5]);
    run(game, input, 0.3);
    expect(i.bombs.length).toBe(0);
    expect(i.explosions.length).toBeGreaterThan(0);
    expect(i.player.ammo).toBe(1);
    expect(game.getResult().stats.bombs).toBe(1);
  });

  it('laying on a tile that already holds your bomb lays in front, and does nothing when both are taken', () => {
    const { game, input, i, arena } = quietGame(4);
    clearInterior(arena);
    i.player.ammoMax = 3;
    i.player.ammo = 3;
    press(game, input, 'primary');
    press(game, input, 'primary');
    expect(i.bombs.map((b) => [b.tx, b.ty])).toEqual([
      [1, 1],
      [2, 1],
    ]);
    expect(i.player.ammo).toBe(1);

    const empty = vi.spyOn(audioOf(game), 'play');
    press(game, input, 'primary');
    expect(i.bombs.length).toBe(2);
    expect(i.player.ammo).toBe(1);
    expect(empty).toHaveBeenCalledWith('empty');
  });

  it('does not lay in front on a tile the body already overlaps, so the player cannot walk through it', () => {
    const { game, input, i, arena } = quietGame(4);
    clearInterior(arena);
    i.player.ammoMax = 3;
    i.player.ammo = 3;
    // Own tile (1, 1) holds a bomb; the body reaches into the faced tile (2, 1).
    i.addBomb('player', 1, 1, 2, 100);
    i.player.x = 1.8;
    i.player.y = 1.5;
    i.player.facingX = 1;
    i.player.facingY = 0;
    const empty = vi.spyOn(audioOf(game), 'play');
    press(game, input, 'primary');
    expect(i.bombs.length).toBe(1);
    expect(i.player.ammo).toBe(3);
    expect(empty).toHaveBeenCalledWith('empty');

    // Clear of the body, the faced tile takes the bomb as usual.
    i.player.x = 1.5;
    press(game, input, 'primary');
    expect(i.bombs.map((b) => [b.tx, b.ty])).toEqual([
      [1, 1],
      [2, 1],
    ]);
  });

  it('a blast stops at a pillar and destroys exactly one crate', () => {
    const { game, input, i, arena } = quietGame(4);
    clearInterior(arena);
    setKind(arena, 3, 3, PILLAR);
    setKind(arena, 6, 3, CRATE);
    setKind(arena, 7, 3, CRATE);
    i.addBomb('bot', 5, 3, 3, 0.001);
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
    i.addBomb('bot', 5, 3, 2, 0.001);
    run(game, input, 0.1);
    expect(i.bots.length).toBe(0);
    expect(game.getResult().stats.kills).toBe(1);
  });

  it('a bomber needs two blasts and a single explosion never kills it twice', () => {
    const { game, input, i, arena } = quietGame(6);
    clearInterior(arena);
    i.bots = [makeBot('bomber', 5, 3)];
    i.addBomb('bot', 5, 3, 2, 0.001);
    run(game, input, 0.1);
    expect(i.bots.length).toBe(1);
    expect(i.bots[0]?.hp).toBe(1);
    i.addBomb('bot', 5, 3, 2, 0.001);
    run(game, input, 0.1);
    expect(i.bots.length).toBe(0);
  });

  it('a multi-kill from one explosion counts once and pays the bonus', () => {
    const { game, input, i, arena } = quietGame(7);
    clearInterior(arena);
    i.bots = [makeBot('walker', 5, 3), makeBot('walker', 4, 3), makeBot('walker', 6, 3)];
    const before = game.getResult().score;
    i.addBomb('bot', 5, 3, 2, 0.001);
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
    plain.i.addBomb('bot', 1, 1, 2, 0.001);
    run(plain.game, plain.input, 0.1);
    expect(plain.i.lives).toBe(LIVES - 1);

    const shielded = quietGame(8, ['shield']);
    clearInterior(shielded.arena);
    shielded.i.player.invuln = 0;
    expect(shielded.i.player.shielded).toBe(true);
    shielded.i.addBomb('bot', 1, 1, 2, 0.001);
    run(shielded.game, shielded.input, 0.1);
    expect(shielded.i.lives).toBe(LIVES);
    expect(shielded.i.player.shielded).toBe(false);
    expect(shielded.i.player.invuln).toBeGreaterThan(0);
  });

  it('punch kicks a laid bomb three tiles forward and keeps its fuse', () => {
    const { game, input, i, arena } = quietGame(9);
    clearInterior(arena);
    i.player.ammoMax = 2;
    i.player.ammo = 2;
    press(game, input, 'primary'); // on the player's tile (1, 1)
    press(game, input, 'primary'); // that tile is taken, so this one goes in front, on (2, 1)
    const bomb = i.bombs[1];
    expect([bomb?.tx, bomb?.ty]).toEqual([2, 1]);
    run(game, input, 0.5);
    const fuseBefore = bomb?.fuse ?? 0;
    press(game, input, 'secondary');
    expect([bomb?.tx, bomb?.ty]).toEqual([5, 1]);
    // The slide does not reset or pause the fuse: it runs on through the kick.
    expect(bomb?.fuse).toBeCloseTo(fuseBefore - 2 * DT, 9);
    run(game, input, 0.3);
    expect(bomb?.x).toBeCloseTo(5.5, 9);
    expect(bomb?.y).toBeCloseTo(1.5, 9);
    expect(i.bombs.length).toBe(2);
  });

  it('a kicked bomb stops short of a crate', () => {
    const { game, input, i, arena } = quietGame(22);
    clearInterior(arena);
    setKind(arena, 4, 1, CRATE);
    i.addBomb('player', 2, 1, 2, 10);
    const bomb = i.bombs[0];
    press(game, input, 'secondary');
    expect([bomb?.tx, bomb?.ty]).toEqual([3, 1]);
  });
});

describe('bombs block movement', () => {
  it('a laid bomb blocks the player: they can step off it but not step back on', () => {
    const { game, input, i, arena } = quietGame(21);
    clearInterior(arena);
    press(game, input, 'primary'); // laid under the player on (1, 1)
    input.setVirtual('right', true, 'test');
    run(game, input, 0.5);
    input.setVirtual('right', false, 'test');
    expect(i.player.x).toBeGreaterThan(2.5);

    input.setVirtual('left', true, 'test');
    for (let t = 0; t < 1; t += DT) {
      game.update(DT);
      input.postUpdate();
      expect(Math.floor(i.player.x)).not.toBe(1);
    }
    input.setVirtual('left', false, 'test');
    expect(i.player.x).toBeGreaterThan(2.3);
    expect(i.bombs.length).toBe(1);
  });

  it('a laid bomb blocks a bot: it walks around the bomb and never steps onto it', () => {
    const { game, input, i, arena } = quietGame(23);
    clearInterior(arena);
    const walker = { ...makeBot('walker', 5, 1), speed: WALKER_SPEED, wait: 0, repath: 0, touchCd: 99 };
    i.bots = [walker];
    i.addBomb('player', 3, 1, 2, 100);
    for (let t = 0; t < 6; t += DT) {
      game.update(DT);
      input.postUpdate();
      expect(Math.floor(walker.x) === 3 && Math.floor(walker.y) === 1).toBe(false);
    }
    // It detours through the row below and makes it past the bomb.
    expect(i.bots).toContain(walker);
    expect(Math.floor(walker.x)).toBeLessThanOrEqual(2);
  });
});

/** One filled shape, as drawn: its colour and the last circle drawn before the fill (empty if none). */
interface Fill {
  style: string;
  circle: number[];
}

/** A canvas stand-in that records every fill in drawing order, with the colour and circle behind it. */
function recordFills(): { ctx: CanvasRenderingContext2D; fills: Fill[] } {
  const fills: Fill[] = [];
  let style = '';
  let circle: number[] = [];
  const ctx = new Proxy(mockCtx(), {
    get(target, key) {
      if (key === 'arc')
        return (...args: number[]) => {
          circle = args;
        };
      if (key === 'fill')
        return () => {
          fills.push({ style, circle });
          circle = [];
        };
      return Reflect.get(target, key);
    },
    set(target, key, value) {
      if (key === 'fillStyle') style = String(value);
      return Reflect.set(target, key, value);
    },
  });
  return { ctx, fills };
}

describe('rendering', () => {
  const palette: Palette = {
    suit: '#3b82f6',
    visor: '#e0f2fe',
    skin: '#f1c27d',
    hair: '#4b2e1e',
    bomb: '#111827',
    fuse: '#f97316',
    crate: '#a16207',
    stone: '#64748b',
    floor1: '#1e3a2f',
    floor2: '#1f4a36',
  };
  const TS = 48;
  const OX = 24;
  const OY = 60;

  /** Draws one frame of an otherwise empty arena (no HUD) with the given bomb and player. */
  function paintFrame(bomb: Bomb, player: Player): Fill[] {
    const arena = new Arena(960, 600, new Rng(1));
    clearInterior(arena);
    const { ctx, fills } = recordFills();
    const view: SceneView = {
      W: 960,
      H: 600,
      time: 0.5,
      preview: true,
      arena,
      layout: { ts: TS, ox: OX, oy: OY },
      palette,
      player,
      bots: [],
      bombs: [bomb],
      explosions: [],
      items: [],
      lives: LIVES,
      wave: 1,
      waveAge: 9,
      score: 0,
      ammo: 0,
      ammoMax: 1,
      compact: false,
      hudPx: COMPACT_HUD_PX,
    };
    drawScene(ctx, view);
    return fills;
  }

  function player(x: number, y: number): Player {
    return {
      x,
      y,
      facingX: 1,
      facingY: 0,
      ammo: 0,
      ammoMax: 1,
      speedUps: 0,
      blastUps: 0,
      bombUps: 0,
      shielded: false,
      invuln: 0,
      respawn: 0,
      punchCd: 0,
      walk: 0,
    };
  }

  function bombAt(tx: number, ty: number): Bomb {
    return {
      owner: 'player',
      power: 2,
      fuse: 1.5,
      maxFuse: FUSE,
      tx,
      ty,
      x: tx + 0.5,
      y: ty + 0.5,
      slide: 0,
      fromX: tx + 0.5,
      fromY: ty + 0.5,
      dead: false,
    };
  }

  it('draws a bomb under the player beneath the sprite, sunk to its feet, fuse over the sprite', () => {
    const fills = paintFrame(bombAt(1, 1), player(1.5, 1.5));
    const bodyAt = fills.findIndex((f) => f.style === palette.bomb);
    const shirtAt = fills.findIndex((f) => f.style === palette.suit);
    const sparkAt = fills.findIndex((f) => f.style === palette.fuse);
    expect(bodyAt).toBeGreaterThanOrEqual(0);
    expect(shirtAt).toBeGreaterThan(bodyAt);
    expect(sparkAt).toBeGreaterThan(shirtAt);
    // The sprite's legs end about 0.2 tile below the player's centre: the bomb must reach past that to show.
    const [, cy = 0, r = 0] = fills[bodyAt]?.circle ?? [];
    expect(cy + r).toBeGreaterThan(OY + (1.5 + 0.3) * TS);
  });

  it('draws a bomb the player is not standing on at the centre of its tile', () => {
    const fills = paintFrame(bombAt(3, 1), player(1.5, 1.5));
    const bodyAt = fills.findIndex((f) => f.style === palette.bomb);
    expect(bodyAt).toBeGreaterThanOrEqual(0);
    const [cx = 0, cy = 0] = fills[bodyAt]?.circle ?? [];
    expect(cx).toBeCloseTo(OX + 3.5 * TS, 9);
    expect(cy).toBeCloseTo(OY + 1.5 * TS, 9);
  });
});

describe('spawns', () => {
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
    for (const s of arena.botSpawns) i.addBomb('bot', s.x, s.y, 1, 100);
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
});

describe('walker contact', () => {
  it('a walker in touch range hurts only once it has held range for the grace period', () => {
    const { game, input, i, arena } = quietGame(24);
    clearInterior(arena);
    i.player.invuln = 0;
    // Stands still 0.4 tiles from the player, inside touch range.
    i.bots = [{ ...makeBot('walker', 1, 1), x: 1.9, y: 1.5, speed: 0, wait: 0, repath: 99, touchCd: 0 }];
    run(game, input, BOT_TOUCH_GRACE - 0.05);
    expect(i.lives).toBe(LIVES);
    run(game, input, 0.1);
    expect(i.lives).toBe(LIVES - 1);
  });

  it('a walker that leaves range inside the grace period never lands its touch', () => {
    const { game, input, i, arena } = quietGame(25);
    clearInterior(arena);
    i.player.invuln = 0;
    const walker = { ...makeBot('walker', 1, 1), x: 1.9, y: 1.5, speed: 0, wait: 0, repath: 99, touchCd: 0 };
    i.bots = [walker];
    run(game, input, BOT_TOUCH_GRACE / 2);
    walker.x = 4.5;
    run(game, input, 2);
    expect(i.lives).toBe(LIVES);
    expect(walker.contact).toBe(0);
  });

  it('a walker that shares the player tile closes in to touch range, so a corner is no refuge', () => {
    const { game, input, i, arena } = quietGame(26);
    clearInterior(arena);
    i.player.invuln = 0;
    // The player stands in a tile corner, 0.67 tiles from the walker at the tile centre: out of reach,
    // and the walker has no path to walk because it already stands on the player's tile.
    i.player.x = 5.97;
    i.player.y = 5.97;
    i.bots = [{ ...makeBot('walker', 5, 5), speed: WALKER_SPEED, wait: 0, repath: 99, touchCd: 0 }];
    run(game, input, 1);
    expect(i.lives).toBe(LIVES - 1);
  });

  it('a walker that stays in reach through invulnerability still holds range for the grace after it ends', () => {
    const { game, input, i, arena } = quietGame(27);
    clearInterior(arena);
    i.player.invuln = 0.5;
    i.bots = [{ ...makeBot('walker', 1, 1), x: 1.9, y: 1.5, speed: 0, wait: 0, repath: 99, touchCd: 0 }];
    run(game, input, 0.5 + BOT_TOUCH_GRACE / 2);
    expect(i.lives).toBe(LIVES);
    run(game, input, BOT_TOUCH_GRACE);
    expect(i.lives).toBe(LIVES - 1);
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
    i.addBomb('bot', 5, 3, 2, 0.001);
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

  it('keeps ammo, laid bombs, solid tiles and bot paths consistent through long random play', () => {
    for (const seed of [41, 42, 43]) {
      const { game, input } = createGame(gameById('bombsquad'), { seed });
      const i = internals(game);
      // Lives are not the subject here: keep the run going so it reaches later waves.
      i.lives = 999;
      // Three bombs in hand, so several of the player's bombs can be in flight at once.
      i.player.ammoMax = 3;
      i.player.ammo = 3;
      let laid = 0;
      const addBomb = i.addBomb.bind(i);
      i.addBomb = (owner, tx, ty, power, fuse) => {
        if (owner === 'player') laid++;
        addBomb(owner, tx, ty, power, fuse);
      };
      const rng = new Rng(seed);
      const held = new Set<Action>();
      for (let f = 0; f < 60 * 90 && !game.isOver(); f++) {
        if (f % 6 === 0) {
          for (const a of ACTIONS) {
            const want = rng.chance(0.25);
            if (want && !held.has(a)) {
              held.add(a);
              input.setVirtual(a, true, 'invariant');
            } else if (!want && held.has(a)) {
              held.delete(a);
              input.setVirtual(a, false, 'invariant');
            }
          }
        }
        game.update(DT);
        input.postUpdate();
        // Ammo comes back exactly when one of the player's own bombs goes off.
        const own = i.bombs.filter((b) => b.owner === 'player').length;
        expect(i.player.ammo + own).toBe(i.player.ammoMax);
        expect(game.getResult().stats.bombs ?? 0).toBe(laid);
        expect(i.arena.isSolid(Math.floor(i.player.x), Math.floor(i.player.y))).toBe(false);
        for (const bot of i.bots) {
          expect(i.arena.isSolid(Math.floor(bot.x), Math.floor(bot.y))).toBe(false);
          // With no bomb on the board nothing blocks the way, so every settled bot can reach the player.
          if (i.bombs.length === 0 && bot.wait <= 0 && bot.goal < 0) {
            const free = new Uint8Array(i.arena.cols * i.arena.rows);
            const from = { x: Math.floor(bot.x), y: Math.floor(bot.y) };
            const to = { x: Math.floor(i.player.x), y: Math.floor(i.player.y) };
            expect(i.arena.findPath(from.x, from.y, to.x, to.y, free)).not.toBeNull();
          }
        }
      }
    }
  });
});

/**
 * The phone test matrix as browser viewports, in CSS px. A short landscape phone keeps a 52 px rail on its left;
 * every other size has the 56 px header on top.
 */
const PHONE_MATRIX: readonly [string, number, number][] = [
  ['P1', 360, 740],
  ['P2', 390, 844],
  ['P3', 430, 932],
  ['L1', 740, 360],
  ['L2', 844, 390],
  ['L3', 932, 430],
  ['T1', 768, 1024],
  ['T2', 1024, 768],
  ['D1', 1280, 800],
];

/** The play stage (CSS px) that a browser viewport leaves for the canvas. */
function stageOf(width: number, height: number): { w: number; h: number } {
  return height <= 520 ? { w: width - 52, h: height } : { w: width, h: height - 56 };
}

describe('phone layout', () => {
  const def = gameById('bombsquad');

  it('is played in landscape, and its range fills a landscape stage at every size in the phone matrix', () => {
    expect(def.orientation).toBe('landscape');
    const range = def.viewport ?? {};
    for (const [name, width, height] of PHONE_MATRIX) {
      const stage = stageOf(width, height);
      const size = chooseLogicalSize(def, stage.w, stage.h);
      expect(size.width, name).toBeGreaterThanOrEqual(range.minWidth ?? def.width);
      expect(size.width, name).toBeLessThanOrEqual(range.maxWidth ?? def.width);
      expect(size.height, name).toBeGreaterThanOrEqual(range.minHeight ?? def.height);
      expect(size.height, name).toBeLessThanOrEqual(range.maxHeight ?? def.height);
      if (width > height) {
        expect(fittedArea(size, stage.w, stage.h) / (stage.w * stage.h), name).toBeGreaterThanOrEqual(0.85);
      }
    }
  });

  it('keeps seven rows of large tiles above the touch controls at every landscape phone size', () => {
    for (const [name, width, height] of LANDSCAPE_PHONES) {
      const { size, bottom } = phoneRun(width, height);
      const { game } = createGame(def, {
        width: size.width,
        height: size.height,
        insets: { top: 0, right: 0, bottom, left: 0 },
      });
      const i = internals(game);
      const lay = i.layout();
      expect(i.arena.rows, name).toBe(7);
      expect(lay.oy + i.arena.rows * lay.ts, name).toBeLessThanOrEqual(size.height - bottom);
    }
  });

  it('draws the player and the bots at least 8% of a landscape phone short side, with the touch controls on', () => {
    for (const [name, width, height] of LANDSCAPE_PHONES) {
      const { size, scale, bottom } = phoneRun(width, height);
      const { game } = createGame(def, {
        width: size.width,
        height: size.height,
        insets: { top: 0, right: 0, bottom, left: 0 },
      });
      const { ts } = internals(game).layout();
      const stage = stageOf(width, height);
      const short = Math.min(stage.w, stage.h);
      // The player stands on a tile and its sprite is PLAYER_HEIGHT_TILES tall; a walker is a circle of radius 0.3 tile.
      const player = PLAYER_HEIGHT_TILES * COMPACT_PLAYER_SCALE * ts * scale;
      const walker = 0.6 * COMPACT_BOT_SCALE * ts * scale;
      expect(player / short, `${name} player`).toBeGreaterThanOrEqual(0.08);
      expect(walker / short, `${name} walker`).toBeGreaterThanOrEqual(0.08);
    }
  });

  it('sets the HUD text at least 12 CSS px high on every landscape phone', () => {
    for (const [name, width, height] of LANDSCAPE_PHONES) {
      const { scale } = phoneRun(width, height);
      expect(COMPACT_HUD_PX * scale, name).toBeGreaterThanOrEqual(12);
    }
  });

  it('draws the touch HUD on a touch screen even when no button covers the canvas', () => {
    // The score is drawn at COMPACT_HUD_PX under the touch layout and at 20 px otherwise.
    const compact = `800 ${COMPACT_HUD_PX}px`;
    expect(fontsDrawn(def, true).some((f) => f.startsWith(compact))).toBe(true);
    expect(fontsDrawn(def, false).some((f) => f.startsWith(compact))).toBe(false);
  });

  it('keeps card previews on the desktop layout on a touch screen, and gives a run the touch layout', () => {
    const layoutOf = (coarse: boolean, preview: boolean) =>
      internals(runWithoutTouch(def, mockCtx(), coarse, preview)).layout();
    expect(layoutOf(true, true)).toEqual(layoutOf(false, true));
    expect(layoutOf(true, false)).not.toEqual(layoutOf(false, false));
  });
});

/**
 * A run with no touch controls on the canvas, built to draw into `ctx`. A coarse pointer makes it a touch screen, as a
 * phone's browser reports it; the pointer is read when the run is built, so the stub is removed straight after.
 */
function runWithoutTouch(
  def: GameDefinition,
  ctx: CanvasRenderingContext2D,
  coarsePointer: boolean,
  preview = false,
): GameInstance {
  if (coarsePointer) vi.stubGlobal('matchMedia', () => ({ matches: true }));
  try {
    return def.create({
      ctx,
      width: def.width,
      height: def.height,
      input: new Input(),
      audio: new NullAudio(),
      rng: new Rng(1),
      loadout: { skin: toSkinData(defaultSkin(def.id)), boosts: new Set(), powerDuration: 1 },
      insets: NO_INSETS,
      reducedMotion: false,
      haptic: () => undefined,
      preview,
    });
  } finally {
    vi.unstubAllGlobals();
  }
}

/** The font of every text draw in one rendered frame of a run with no touch controls on the canvas. */
function fontsDrawn(def: GameDefinition, coarsePointer: boolean): string[] {
  const fonts: string[] = [];
  const ctx = new Proxy(mockCtx(), {
    set(target, key, value) {
      if (key === 'font') fonts.push(String(value));
      return Reflect.set(target, key, value);
    },
  });
  runWithoutTouch(def, ctx, coarsePointer).render();
  return fonts;
}

/** The landscape phones of the matrix (the rows whose name starts with L). */
const LANDSCAPE_PHONES = PHONE_MATRIX.filter(([name]) => name.startsWith('L'));

/**
 * The logical size a landscape phone runs at, the scale its canvas is drawn at, and the logical rows the touch band
 * covers at the bottom. The band is the BOMB button, the 8 px inset the landscape layout leaves and the 6 px margin.
 */
function phoneRun(
  width: number,
  height: number,
): { size: { width: number; height: number }; scale: number; bottom: number } {
  const def = gameById('bombsquad');
  const stage = stageOf(width, height);
  const size = chooseLogicalSize(def, stage.w, stage.h);
  const scale = Math.min(stage.w / size.width, stage.h / size.height);
  const button = Math.min(72, Math.max(48, 0.16 * Math.min(width, height)));
  return { size, scale, bottom: Math.ceil((button + 14) / scale) };
}

describe('phone zoom and text', () => {
  const def = gameById('bombsquad');

  /**
   * A run drawn on a canvas scaled to `scale` CSS px per logical px, inside a play stage of `stage` CSS px, as a phone
   * draws it under touch controls. Returns the run and the font size of every text draw in one frame.
   */
  function screenRun(
    width: number,
    height: number,
    scale: number,
    stage: { w: number; h: number },
  ): { game: GameInstance; fonts: number[] } {
    const fonts: number[] = [];
    const ctx = new Proxy(mockCtx(), {
      set(target, key, value) {
        if (key === 'font') fonts.push(Number(/(\d+)px/.exec(String(value))?.[1]));
        return Reflect.set(target, key, value);
      },
    });
    Object.assign(ctx, {
      canvas: {
        getBoundingClientRect: () => ({ width: width * scale, height: height * scale }),
        parentElement: { getBoundingClientRect: () => ({ width: stage.w, height: stage.h }) },
      },
    });
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    let game: GameInstance;
    try {
      game = def.create({
        ctx,
        width,
        height,
        input: new Input(),
        audio: new NullAudio(),
        rng: new Rng(1),
        loadout: { skin: toSkinData(defaultSkin(def.id)), boosts: new Set(), powerDuration: 1 },
        insets: NO_INSETS,
        reducedMotion: false,
        haptic: () => undefined,
      });
    } finally {
      vi.unstubAllGlobals();
    }
    game.render();
    return { game, fonts };
  }

  it('finds the smallest tile at which the character and a walker reach 8% of a 390 px stage side', () => {
    expect(tileForCharacters(390, 0.4875)).toBe(74);
    expect(tileForCharacters(0, 0.4875)).toBe(0);
  });

  it('zooms the arena in on a portrait phone, so the character and a walker are at least 8% of the short side', () => {
    const { game } = screenRun(800, 760, 0.4875, { w: 390, h: 788 });
    const { ts } = internals(game).layout();
    expect((PLAYER_HEIGHT_TILES * COMPACT_PLAYER_SCALE * ts * 0.4875) / 390).toBeGreaterThanOrEqual(0.08);
    expect((0.6 * COMPACT_BOT_SCALE * ts * 0.4875) / 390).toBeGreaterThanOrEqual(0.08);
  });

  it('keeps the HUD text at least 12 CSS px at a portrait phone scale and at a turned phone under the controls', () => {
    for (const scale of [0.4875, 0.5133]) {
      const { fonts } = screenRun(800, 760, scale, { w: 390, h: 788 });
      expect(Math.min(...fonts) * scale, `scale ${scale}`).toBeGreaterThanOrEqual(12);
    }
  });

  it('runs the camera on the player when the zoomed arena is larger than its room, and clips it to the room', () => {
    const { game } = screenRun(800, 760, 0.4875, { w: 390, h: 788 });
    const i = internals(game);
    const lay = i.layout();
    const clip = lay.clip;
    expect(clip).toBeDefined();
    if (!clip) return;
    const playerX = lay.ox + i.player.x * lay.ts;
    expect(playerX).toBeGreaterThanOrEqual(clip.x);
    expect(playerX).toBeLessThanOrEqual(clip.x + clip.w);
    // The arena still covers the room at its far edge.
    expect(lay.ox + i.arena.cols * lay.ts).toBeGreaterThanOrEqual(clip.x + clip.w);
  });

  it('keeps the usual HUD text on a landscape phone and on a desktop', () => {
    expect(hudTextPx(0.6)).toBe(COMPACT_HUD_PX);
    expect(hudTextPx(0.93)).toBe(COMPACT_HUD_PX);
    expect(hudTextPx(0)).toBe(COMPACT_HUD_PX);
  });
});

describe('portrait screens (Play anyway, portrait tablets)', () => {
  const def = gameById('bombsquad');
  const PORTRAIT_PHONES = PHONE_MATRIX.filter(([name]) => name.startsWith('P'));

  /** A portrait phone's run: logical size, canvas scale and the logical rows the BOMB button covers at the bottom. */
  function portraitRun(width: number, height: number) {
    const stage = stageOf(width, height);
    const size = chooseLogicalSize(def, stage.w, stage.h);
    const scale = Math.min(stage.w / size.width, stage.h / size.height);
    const button = Math.min(72, Math.max(48, 0.16 * Math.min(width, height)));
    return { stage, size, scale, bottom: Math.ceil((button + 14) / scale) };
  }

  it('fills a portrait phone stage with a tall arena instead of a letterboxed strip', () => {
    // Before, the range stopped at 800 x 760, so a portrait phone that played anyway filled 46 to 50% of its stage.
    for (const [name, width, height] of [...PORTRAIT_PHONES, ['T1', 768, 1024] as const]) {
      const { stage, size } = portraitRun(width, height);
      expect(size.height, name).toBeGreaterThan(size.width);
      expect(fittedArea(size, stage.w, stage.h) / (stage.w * stage.h), name).toBeGreaterThanOrEqual(0.85);
    }
  });

  it('keeps every wide stage at the size the old range gave it', () => {
    const old = { ...def, viewport: { minWidth: 800, maxWidth: 1280, minHeight: 360, maxHeight: 760 } };
    for (const [name, width, height] of PHONE_MATRIX.filter(([n]) => !n.startsWith('P') && n !== 'T1')) {
      const stage = stageOf(width, height);
      expect(chooseLogicalSize(def, stage.w, stage.h), name).toEqual(
        chooseLogicalSize(old, stage.w, stage.h),
      );
    }
  });

  it('lays nine columns of large tiles across a portrait phone, with readable characters and HUD', () => {
    for (const [name, width, height] of PORTRAIT_PHONES) {
      const { stage, size, scale, bottom } = portraitRun(width, height);
      const { game } = createGame(def, {
        width: size.width,
        height: size.height,
        insets: { top: 0, right: 0, bottom, left: 0 },
      });
      const i = internals(game);
      const lay = i.layout();
      expect(i.arena.cols, name).toBe(9);
      expect(i.arena.rows, name).toBeGreaterThanOrEqual(13);
      // The whole arena shows above the controls, so no camera is needed.
      expect(lay.clip, name).toBeUndefined();
      expect(lay.oy + i.arena.rows * lay.ts, name).toBeLessThanOrEqual(size.height - bottom);
      const short = Math.min(stage.w, stage.h);
      expect(
        (PLAYER_HEIGHT_TILES * COMPACT_PLAYER_SCALE * lay.ts * scale) / short,
        name,
      ).toBeGreaterThanOrEqual(0.08);
      expect((0.6 * COMPACT_BOT_SCALE * lay.ts * scale) / short, name).toBeGreaterThanOrEqual(0.08);
      expect(hudTextPx(scale) * scale, name).toBeGreaterThanOrEqual(12);
    }
  });

  it('keeps a tall run sane through long random play', () => {
    const { size, bottom } = portraitRun(390, 844);
    const { game, input } = createGame(def, {
      seed: 5,
      width: size.width,
      height: size.height,
      insets: { top: 0, right: 0, bottom, left: 0 },
    });
    const rng = new Rng(11);
    for (let t = 0; t < 120 && !game.isOver(); t += DT) {
      if (rng.chance(0.05)) input.setVirtual(rng.pick(ACTIONS), rng.chance(0.6), 'test');
      game.update(DT);
      input.postUpdate();
      const p = internals(game).player;
      expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
    }
    const r = game.getResult();
    expect(Number.isFinite(r.score)).toBe(true);
  });

  it('sends the first bots of a wave from the far end of a tall arena', () => {
    // Before, the first spawn of a 9 x 15 arena was the end of the player's own top row, six tiles away.
    const arena = new Arena(630, 1280 - 120, new Rng(1), touchTile(630, 1280, 120));
    expect([arena.cols, arena.rows]).toEqual([9, 15]);
    const dist = arena.botSpawns.map((s) => manhattan(s.x, s.y, arena.playerSpawn.x, arena.playerSpawn.y));
    expect(dist.slice(0, 3).every((d) => d >= 12)).toBe(true);
    expect([...dist].sort((a, b) => b - a)).toEqual(dist);
    // A wide arena keeps its order: the far end of the top row first.
    const wide = new Arena(960, 600, new Rng(1));
    expect(wide.botSpawns[0]).toEqual({ x: wide.cols - 2, y: 1 });
  });

  it('caps the touch tile, so a touch tablet gets more tiles rather than a few very large ones', () => {
    // A portrait tablet under the controls: before the cap, 103 px tiles left a 9 x 9 arena.
    expect(touchTile(960, 1200, 90)).toBe(72);
    expect(new Arena(960, 1200 - 90, new Rng(1), touchTile(960, 1200, 90)).cols).toBe(11);
    // Phones keep their tiles: a landscape phone's seven rows and a portrait phone's nine columns.
    expect(touchTile(1218, 600, 118)).toBe(Math.floor((600 - 72 - 118) / 7));
    expect(touchTile(630, 1280, 120)).toBe(Math.floor((630 - 32) / 9));
  });

  it('draws the lives and ammo larger under touch controls, clear of the wave pill', () => {
    expect(lifePillScale(1218, 124)).toBe(1.25);
    // A narrow canvas with large HUD text: the pill shrinks to fit, and never below its usual size.
    for (const [W, waveW] of [
      [600, 160],
      [668, 136],
      [400, 200],
    ] as const) {
      const k = lifePillScale(W, waveW);
      expect(k).toBeGreaterThanOrEqual(1);
      if (k > 1) expect(8 + 176 * k + 12).toBeLessThanOrEqual(W / 2 - waveW / 2 + 1e-9);
    }
  });
});
