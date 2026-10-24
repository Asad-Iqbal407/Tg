import { describe, expect, it } from 'vitest';
import { NullAudio } from '../src/core/audio';
import { Input } from '../src/core/input';
import { Rng } from '../src/core/rng';
import { CHUNKS, END_CHUNK, START_CHUNK } from '../src/games/platformer/chunks';
import {
  buildLevel,
  GROUND_ROW,
  type LevelData,
  ROWS,
  type Spawn,
  T,
  Tile,
  validateChunk,
} from '../src/games/platformer/level';
import { HERO } from '../src/games/platformer/sprites';
import { themeFor } from '../src/games/platformer/themes';
import { enemySpeedScale, levelTimeLimit, PHYS, worldLabel } from '../src/games/platformer/tuning';
import { type BoostId, type GameInstance, type Insets, NO_INSETS } from '../src/games/types';
import { defaultSkin, toSkinData } from '../src/meta/catalog';
import { gameById, mockCtx } from './helpers';

const DT = 1 / 60;
const def = gameById('platformer');

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
  vx: number;
  vy: number;
  onGround: boolean;
}

interface Hero extends Box {
  power: 0 | 1 | 2;
  invuln: number;
  dead: boolean;
}

interface Foe extends Box {
  kind: string;
  state: 'walk' | 'shell' | 'shellMove' | 'squished' | 'dead';
  active: boolean;
  patrol: boolean;
  speed: number;
}

/** The simulation state the regression tests poke at. */
interface PQ extends GameInstance {
  player: Hero;
  enemies: Foe[];
  items: unknown[];
  level: LevelData;
  levelNum: number;
  phase: 'play' | 'dying' | 'flag' | 'walkoff' | 'tally';
  lives: number;
  timeLeft: number;
  checkpointReached: boolean;
  showBanner: boolean;
  enemiesWaiting: boolean;
  camX: number;
  camY: number;
  stats: Record<string, number>;
  texts: { items: { x: number; y: number; text: string }[] };
  doorX: number;
  W: number;
  H: number;
  makeEnemy(sp: Spawn, speedScale: number): Foe;
  loadLevel(fresh: boolean): void;
  syncPlayerSize(): void;
  die(): void;
}

function make(
  opts: { seed?: number; boosts?: BoostId[]; width?: number; height?: number; insets?: Insets } = {},
): { g: PQ; input: Input } {
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
      skin: toSkinData(defaultSkin('platformer')),
      boosts: new Set(opts.boosts ?? []),
      powerDuration: 1,
    },
    reducedMotion: false,
    haptic: () => undefined,
  });
  return { g: game as unknown as PQ, input };
}

function step(g: PQ, input: Input, seconds: number, each?: () => boolean | void): void {
  for (let i = 0; i < Math.round(seconds * 60); i++) {
    g.update(DT);
    input.postUpdate();
    if (each?.() === true) return;
  }
}

/** Replace the course with flat ground (and no enemies, items or coins) so a test can build its own. */
function flatten(g: PQ): void {
  const { level } = g;
  level.tiles.fill(Tile.Empty);
  for (let c = 0; c < level.cols; c++) {
    level.tiles[GROUND_ROW * level.cols + c] = Tile.Ground;
    level.tiles[(GROUND_ROW + 1) * level.cols + c] = Tile.Ground;
  }
  level.contents.clear();
  level.coins.length = 0;
  g.enemies.length = 0;
  g.items.length = 0;
  g.enemiesWaiting = false;
  // Keep the checkpoint and flag out of the way.
  level.checkpoint.x = level.cols * T;
  level.flagX = level.cols * T + 1000;
}

function setTile(g: PQ, col: number, row: number, tile: number): void {
  g.level.tiles[row * g.level.cols + col] = tile;
}

/** An enemy standing still on the ground (or on `feetY`), already active. */
function addFoe(g: PQ, kind: 'walker' | 'shellback' | 'spiky', x: number, feetY = GROUND_ROW * T): Foe {
  const e = g.makeEnemy({ kind, x: x + 13, y: feetY, patrol: false }, 1);
  e.active = true;
  e.vx = 0;
  g.enemies.push(e);
  return e;
}

/** Put the hero (small unless `power`) with its left edge at `x`, feet at `feetY`, falling at `vy`. */
function placeHero(g: PQ, x: number, feetY: number, vy = 0, power: 0 | 1 | 2 = 0): Hero {
  const p = g.player;
  p.power = power;
  g.syncPlayerSize();
  p.x = x;
  p.y = feetY - p.h;
  p.vx = 0;
  p.vy = vy;
  p.onGround = false;
  p.invuln = 0;
  return p;
}

function heroAlive(g: PQ, lives: number): void {
  expect(g.phase).toBe('play');
  expect(g.player.dead).toBe(false);
  expect(g.lives).toBe(lives);
}

describe('Pixel Quest stomps', () => {
  it.each([26, 28, 34, 40])(
    'squashes two walkers %i px apart in one landing without hurting the hero',
    (d) => {
      for (const power of [0, 1] as const) {
        const { g, input } = make();
        flatten(g);
        const x0 = 30 * T;
        const a = addFoe(g, 'walker', x0);
        const b = addFoe(g, 'walker', x0 + d);
        const mid = (x0 + x0 + d + 26) / 2;
        const p = placeHero(g, mid - 11, a.y - 40, 300, power);
        const lives = g.lives;
        step(g, input, 0.4);
        heroAlive(g, lives);
        expect(p.power).toBe(power);
        expect(a.state).toBe('squished');
        expect(b.state).toBe('squished');
        expect(g.stats.stomps).toBe(2);
      }
    },
  );

  it('kicks a resting shell away from the hero, whatever the sub-pixel overlap, and never hurts', () => {
    for (let k = 0; k < 24; k++) {
      for (const side of [-1, 1]) {
        const { g, input } = make();
        flatten(g);
        const shell = addFoe(g, 'shellback', 40 * T);
        shell.state = 'shell';
        shell.h = 18;
        shell.y = GROUND_ROW * T - 18;
        const lives = g.lives;
        // Land slightly off-centre, starting at a different fractional height every time.
        placeHero(g, shell.x + 2 + side * 6, shell.y - 30 - k * 0.37, 380);
        let firstDir = 0;
        step(g, input, 0.5, () => {
          if (shell.state === 'shellMove' && firstDir === 0) firstDir = Math.sign(shell.vx);
          // Once kicked it keeps going the same way (no second kick by the same contact).
          if (firstDir !== 0) expect(Math.sign(shell.vx)).toBe(firstDir);
        });
        heroAlive(g, lives);
        expect(firstDir).toBe(-side);
        expect(g.stats.stomps).toBe(1);
      }
    }
  });

  it('stops a walking shellback in its shell and the bounce does not kick it', () => {
    const { g, input } = make();
    flatten(g);
    const e = addFoe(g, 'shellback', 40 * T);
    const lives = g.lives;
    placeHero(g, e.x + 2, e.y - 30, 300);
    step(g, input, 0.5, () => g.stats.stomps === 1);
    // Until the hero comes back down on it, the shell stays put.
    step(g, input, 0.25);
    heroAlive(g, lives);
    expect(g.stats.stomps).toBe(1);
    expect(e.state).toBe('shell');
    expect(e.vx).toBe(0);
  });

  it('still hurts when the hero walks into an enemy or lands on a spiky', () => {
    const side = make();
    flatten(side.g);
    addFoe(side.g, 'walker', 20 * T);
    placeHero(side.g, 20 * T - 30, GROUND_ROW * T);
    side.input.setVirtual('right', true, 'test');
    step(side.g, side.input, 1);
    expect(side.g.phase).toBe('dying');

    const spiky = make();
    flatten(spiky.g);
    const s = addFoe(spiky.g, 'spiky', 20 * T);
    placeHero(spiky.g, s.x + 2, s.y - 30, 300);
    step(spiky.g, spiky.input, 0.5);
    expect(spiky.g.phase).toBe('dying');
  });
});

describe('Pixel Quest jump feel', () => {
  /** Rise (px) of a jump from the ground, holding the button for `holdFrames` frames. */
  function jumpRise(holdFrames: number, ceiling?: { col: number; overlap: number }): number {
    const { g, input } = make();
    flatten(g);
    const col = 20;
    let x = col * T + 5;
    if (ceiling) {
      setTile(g, ceiling.col, GROUND_ROW - 4, Tile.Brick);
      // The hero's right edge reaches `overlap` px into the brick.
      x = ceiling.col * T + ceiling.overlap - 22;
    }
    const p = placeHero(g, x, GROUND_ROW * T);
    step(g, input, 0.2);
    expect(p.onGround).toBe(true);
    const startTop = p.y;
    let minTop = p.y;
    let frame = 0;
    input.setVirtual('primary', true, 'test');
    step(g, input, 1.2, () => {
      if (++frame === holdFrames) input.setVirtual('primary', false, 'test');
      minTop = Math.min(minTop, p.y);
    });
    return startTop - minTop;
  }

  it('a quick tap is a short hop and holding gives the full jump', () => {
    const tap = jumpRise(1);
    expect(tap).toBeGreaterThan(1.1 * T);
    expect(tap).toBeLessThan(1.8 * T);
    expect(jumpRise(60)).toBeGreaterThan(4.5 * T);
  });

  it.each([1, 3, 5, 8])('slides past a ceiling corner it clips by %i px instead of bonking', (overlap) => {
    expect(jumpRise(60, { col: 21, overlap })).toBeGreaterThan(4.5 * T);
  });

  it('still bonks on a block it is mostly under', () => {
    expect(jumpRise(60, { col: 21, overlap: 14 })).toBeLessThan(3 * T);
  });
});

describe('Pixel Quest blocks', () => {
  it.each([Tile.Brick, Tile.Question])(
    'collects a coin resting on a block bumped from below (tile %i)',
    (tile) => {
      const { g, input } = make();
      flatten(g);
      const col = 21;
      const row = GROUND_ROW - 4;
      setTile(g, col, row, tile);
      g.level.coins.push({ x: col * T + T / 2, y: (row - 1) * T + T / 2, taken: false });
      // A coin two tiles up is out of reach of the bump.
      g.level.coins.push({ x: col * T + T / 2, y: (row - 2) * T + T / 2, taken: false });
      placeHero(g, col * T + 7, GROUND_ROW * T);
      step(g, input, 0.2);
      input.setVirtual('primary', true, 'test');
      step(g, input, 0.8);
      expect(g.level.coins.map((c) => c.taken)).toEqual([true, false]);
      // The resting coin, plus the question block's own coin when there is one.
      expect(g.getResult().coins).toBe(tile === Tile.Question ? 2 : 1);
    },
  );
});

describe('Pixel Quest deaths and respawns', () => {
  it('a pit death does not hop the hero back up above the ground', () => {
    const { g, input } = make();
    flatten(g);
    for (let c = 20; c < 24; c++) {
      setTile(g, c, GROUND_ROW, Tile.Empty);
      setTile(g, c, GROUND_ROW + 1, Tile.Empty);
    }
    const p = placeHero(g, 21 * T, GROUND_ROW * T + 4, 200);
    const lives = g.lives;
    step(g, input, 1.5, () => g.phase === 'dying');
    expect(g.phase).toBe('dying');
    expect(g.lives).toBe(lives - 1);
    let minY = Infinity;
    step(g, input, 1.4, () => {
      if (g.phase !== 'dying') return true;
      minY = Math.min(minY, p.y);
    });
    expect(minY).toBeGreaterThan(ROWS * T);
  });

  it('places every checkpoint on open ground, away from enemies', () => {
    let clearance = 0;
    let n = 0;
    for (let level = 1; level <= 12; level++) {
      for (let seed = 1; seed <= 25; seed++) {
        const data = buildLevel(level, seed * 97);
        const col = Math.floor(data.checkpoint.x / T);
        expect(data.checkpoint.y).toBe(GROUND_ROW * T);
        expect(data.tiles[GROUND_ROW * data.cols + col]).toBe(Tile.Ground);
        for (let r = GROUND_ROW - 3; r < GROUND_ROW; r++)
          expect(data.tiles[r * data.cols + col]).toBe(Tile.Empty);
        const nearest = Math.min(...data.spawns.map((s) => Math.abs(Math.floor(s.x / T) - col)));
        expect(nearest).toBeGreaterThanOrEqual(3);
        clearance += Math.min(nearest, 10);
        n++;
      }
    }
    expect(clearance / n).toBeGreaterThan(6);
  });

  it('keeps enemies still after a respawn until the hero moves', () => {
    const { g, input } = make({ seed: 3 });
    g.checkpointReached = true;
    g.die();
    step(g, input, 3.5, () => g.phase === 'play');
    const before = g.enemies.map((e) => e.x);
    step(g, input, 2);
    expect(g.enemies.map((e) => e.x)).toEqual(before);
    input.setVirtual('right', true, 'test');
    step(g, input, 0.5);
    expect(g.enemies.some((e) => e.active && e.vx !== 0)).toBe(true);
  });

  it('respawns on the ground at the checkpoint, invulnerable, with no banner and time to look around', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const { g, input } = make({ seed });
      g.checkpointReached = true;
      g.die();
      step(g, input, 3.5, () => g.phase === 'play');
      expect(g.phase).toBe('play');
      const p = g.player;
      expect(p.y + p.h).toBe(GROUND_ROW * T);
      expect(Math.abs(p.x + p.w / 2 - g.level.checkpoint.x)).toBeLessThan(1);
      expect(p.invuln).toBeGreaterThan(0);
      expect(g.showBanner).toBe(false);
      const lives = g.lives;
      step(g, input, 4);
      heroAlive(g, lives);
    }
  });
});

/** Can a hero standing somewhere in columns col-1..col+1 bump the block at (col, row)? */
function bumpable(data: LevelData, col: number, row: number): boolean {
  const at = (c: number, r: number) => data.tiles[r * data.cols + c] ?? Tile.Empty;
  for (const sc of [col - 1, col, col + 1]) {
    if (sc < 0 || sc >= data.cols) continue;
    for (let s = row + 1; s < ROWS; s++) {
      if (at(sc, s) === Tile.Empty) continue;
      const gap = s - row;
      let clear = gap >= 2 && gap <= 6;
      for (let r = row + 1; clear && r < s; r++) clear = at(col, r) === Tile.Empty;
      if (clear) return true;
      break;
    }
  }
  return false;
}

describe('Pixel Quest power-ups', () => {
  it('has only bumpable question blocks in every chunk (sky-walk included)', () => {
    for (const c of [START_CHUNK, END_CHUNK, ...CHUNKS]) expect(validateChunk(c)).toEqual([]);
    const sky = CHUNKS.find((c) => c.name === 'sky-walk');
    expect(sky?.rows.some((r) => r.includes('M'))).toBe(true);
  });

  it('puts a reachable power block before and after the checkpoint in every level', () => {
    for (let level = 1; level <= 12; level++) {
      for (let seed = 1; seed <= 25; seed++) {
        const data = buildLevel(level, seed * 131);
        const cpCol = Math.floor(data.checkpoint.x / T);
        let before = 0;
        let after = 0;
        for (const [idx, content] of data.contents) {
          if (content !== 'power') continue;
          const col = idx % data.cols;
          const row = Math.floor(idx / data.cols);
          expect(bumpable(data, col, row)).toBe(true);
          if (col < cpCol) before++;
          else after++;
        }
        expect(before).toBeGreaterThan(0);
        expect(after).toBeGreaterThan(0);
      }
    }
  });

  it('gives walkers on islands and platforms a patrol so they stay where they matter', () => {
    let checked = 0;
    for (let seed = 1; seed <= 60 && checked < 5; seed++) {
      const data = buildLevel(3, seed);
      if (!data.chunkNames.includes('islands')) continue;
      checked++;
      for (const s of data.spawns) {
        const col = Math.floor(s.x / T);
        const below = (c: number) => data.tiles[GROUND_ROW * data.cols + c] === Tile.Ground;
        // Ground on both sides within three columns, and a pit nearby: a narrow island.
        if (!below(col - 2) && !below(col + 2)) expect(s.patrol).toBe(true);
      }
    }
    expect(checked).toBeGreaterThan(0);

    // A patrolling walker on a 3-wide ledge is still there seconds later.
    const { g, input } = make();
    flatten(g);
    for (let c = 30; c < 33; c++) setTile(g, c, 9, Tile.Hard);
    const e = g.makeEnemy({ kind: 'walker', x: 31 * T + T / 2, y: 9 * T, patrol: true }, 1);
    g.enemies.push(e);
    placeHero(g, 27 * T, GROUND_ROW * T);
    step(g, input, 5);
    expect(e.state).toBe('walk');
    expect(e.y + e.h).toBeCloseTo(9 * T, 3);
  });
});

describe('Pixel Quest progression', () => {
  it('labels courses by world and stage and changes the look per stage', () => {
    expect([1, 2, 3, 4, 5, 8, 9].map(worldLabel)).toEqual(['1-1', '1-2', '1-3', '1-4', '2-1', '2-4', '3-1']);
    expect(themeFor(4).cave).toBe(true);
    expect(themeFor(1).name).not.toBe(themeFor(2).name);
  });

  it('speeds enemies up and keeps the clock relevant as levels go on', () => {
    expect(enemySpeedScale(1)).toBe(1);
    expect(enemySpeedScale(5)).toBeGreaterThan(1.2);
    expect(enemySpeedScale(30)).toBeCloseTo(1.45);
    expect(enemySpeedScale(30, true)).toBeCloseTo(1.2);
    for (let level = 1; level <= 12; level++) {
      for (let seed = 1; seed <= 10; seed++) {
        const data = buildLevel(level, seed);
        const limit = levelTimeLimit(data.cols * T, level);
        const walk = (data.cols * T) / PHYS.walkMax;
        expect(limit).toBeGreaterThan(walk * 1.6);
        expect(limit).toBeLessThan(120);
      }
    }

    const { g } = make();
    const slow = g.enemies.find((e) => e.kind === 'walker')?.speed ?? 0;
    g.levelNum = 8;
    g.loadLevel(true);
    const fast = g.enemies.find((e) => e.kind === 'walker')?.speed ?? 0;
    expect(fast).toBeGreaterThan(slow * 1.4);
    expect(g.timeLeft).toBeLessThan(120);
  });

  it('adds walkers from level 4 on', () => {
    const count = (level: number) => {
      let n = 0;
      for (let seed = 1; seed <= 40; seed++) n += buildLevel(level, seed).spawns.length;
      return n / 40;
    };
    expect(count(9)).toBeGreaterThan(count(3) + 1);
  });

  it('walks into the castle door, then starts the next course', () => {
    const { g, input } = make();
    const p = placeHero(g, g.level.flagX - 3 * T, GROUND_ROW * T);
    g.enemies.length = 0;
    input.setVirtual('right', true, 'test');
    step(g, input, 4, () => g.phase === 'tally');
    expect(g.phase).toBe('tally');
    expect(p.x + p.w / 2).toBeGreaterThanOrEqual(g.doorX);
    expect(p.x + p.w / 2).toBeLessThan(g.doorX + 6);
    step(g, input, 12, () => g.levelNum === 2);
    expect(g.levelNum).toBe(2);
    expect(g.stats.levels).toBe(1);
    expect(g.stats.world).toBe(1);
    expect(g.showBanner).toBe(true);
  });
});

describe('Pixel Quest presentation', () => {
  it('keeps score pop-ups where they happened in the world', () => {
    const { g, input } = make();
    flatten(g);
    const e = addFoe(g, 'walker', 40 * T);
    placeHero(g, e.x + 2, e.y - 30, 300);
    g.camX = 40 * T - 300;
    step(g, input, 0.2);
    const pop = g.texts.items.find((t) => t.text === '100');
    expect(pop).toBeDefined();
    expect(Math.abs((pop?.x ?? 0) - (e.x + e.w / 2))).toBeLessThan(1);
  });

  it('gives the big hero its own taller sprite', () => {
    const small = HERO.small.stand;
    const big = HERO.big.stand;
    expect(big.length).toBeGreaterThan(small.length + 4);
    expect(big[0]?.length).toBeGreaterThan(small[0]?.length ?? 0);
    for (const pose of ['stand', 'walkA', 'walkB', 'jump'] as const) {
      const rows = HERO.big[pose];
      expect(new Set(rows.map((r) => r.length)).size).toBe(1);
    }
  });

  it.each([
    [800, 0],
    [960, 0],
    [1280, 0],
    [800, 120],
    [1280, 150],
  ])(
    'frames the hero and the ground above the touch controls at %i wide, %i px bottom inset',
    (W, bottom) => {
      const insets = { top: 0, right: 0, bottom, left: 0 };
      const { g, input } = make({ width: W, insets });
      g.enemies.length = 0;
      input.setVirtual('right', true, 'test');
      step(g, input, 2.5);
      const p = g.player;
      const feet = p.y + p.h - g.camY;
      // Feet and a strip of floor stay above the covered area; the hero stays under the HUD.
      expect(feet).toBeLessThanOrEqual(g.H - bottom - 16);
      expect(p.y - g.camY).toBeGreaterThan(60);
      // Looking ahead: the hero sits in the left part of the view while running right.
      const sx = p.x + p.w / 2 - g.camX;
      expect(sx).toBeGreaterThan(0.25 * W);
      expect(sx).toBeLessThan(0.45 * W);
    },
  );
});
