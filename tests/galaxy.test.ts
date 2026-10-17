import { describe, expect, it } from 'vitest';
import { NullAudio } from '../src/core/audio';
import { chooseLogicalSize, fittedArea } from '../src/core/engine';
import { Input } from '../src/core/input';
import { Rng } from '../src/core/rng';
import { type GameInstance, type GameResult, type Insets, NO_INSETS } from '../src/games/types';
import { defaultSkin, toSkinData } from '../src/meta/catalog';
import { createGame, gameById, mockCtx } from './helpers';

const DT = 1 / 60;

/** The slice of GalaxyGame's private state these regression tests inspect or drive. */
interface ProbeEnemy {
  kind: string;
  behavior: string;
  r: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  hp: number;
  maxHp: number;
  alive: boolean;
  stage: number;
  rage: number;
  windT: number;
  fireT: number;
  pattern: number;
  targetY: number;
  t: number;
  dirX: number;
  dirY: number;
}

interface ProbeBullet {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  dmg: number;
  alive: boolean;
  color: string;
}

interface Probe {
  wave: number;
  shipX: number;
  shipY: number;
  weapon: number;
  bombs: number;
  invuln: number;
  overdriveT: number;
  waveQueue: unknown[];
  enemies: ProbeEnemy[];
  enemyShots: ProbeBullet[];
  shots: ProbeBullet[];
  drops: { kind: string }[];
  boss: ProbeEnemy | null;
  spawnBoss(): void;
  groupKamikaze(): void;
  makeEnemy(kind: string, behavior: string, x: number, y: number): ProbeEnemy;
  damage(e: ProbeEnemy, amount: number): void;
  collect(kind: string): void;
  hpScale(): number;
  groupHover(): void;
}

function probe(game: GameInstance): Probe {
  return game as unknown as Probe;
}

interface SetupOptions {
  seed?: number;
  weapon?: number;
  width?: number;
  height?: number;
  insets?: Insets;
}

/** A galaxy run with no enemies on the field and no waves queued. */
function fresh(opts: SetupOptions = {}): { game: GameInstance; input: Input; g: Probe } {
  const { game, input } = createGame(gameById('galaxy'), {
    seed: opts.seed ?? 1,
    width: opts.width,
    height: opts.height,
    insets: opts.insets,
  });
  const g = probe(game);
  g.waveQueue = [];
  g.enemies = [];
  if (opts.weapon) g.weapon = opts.weapon;
  return { game, input, g };
}

/** Like fresh(), with the Mothership on the field, already past its entry and in place. */
function arena(opts: SetupOptions = {}): { game: GameInstance; input: Input; g: Probe; boss: ProbeEnemy } {
  const r = fresh(opts);
  r.g.wave = 5;
  r.g.spawnBoss();
  const boss = r.g.boss;
  if (!boss) throw new Error('boss did not spawn');
  boss.y = boss.targetY;
  boss.t = 3;
  // One active step settles the bob, so tests place shots where the boss really is.
  step(r.game, r.input, 1);
  return { ...r, boss };
}

function step(game: GameInstance, input: Input, frames: number): void {
  for (let i = 0; i < frames; i++) {
    game.update(DT);
    input.postUpdate();
  }
}

function shotAt(x: number, y: number): ProbeBullet {
  return { x, y, vx: 0, vy: 0, r: 4, dmg: 1, alive: true, color: '#9ff' };
}

/** A galaxy instance with a chosen power-duration multiplier (Overclock), built like createGame. */
function withPowerDuration(powerDuration: number): GameInstance {
  return gameById('galaxy').create({
    ctx: mockCtx(),
    width: 540,
    height: 960,
    input: new Input(),
    audio: new NullAudio(),
    rng: new Rng(1),
    loadout: { skin: toSkinData(defaultSkin('galaxy')), boosts: new Set(), powerDuration },
    insets: NO_INSETS,
    reducedMotion: false,
    haptic: () => undefined,
  });
}

/** Seconds a perfectly tracking, invulnerable ship needs to bring the Mothership down. */
function bossKillSeconds(weapon: number): number {
  const { game, input, g } = arena({ seed: 2, weapon });
  let seconds = 0;
  while (seconds < 120) {
    const boss = g.boss;
    if (!boss) break;
    // Hover 60 px above the cursor, so the ship sits near y=820 under the boss.
    g.invuln = 1e9;
    input.pointer.active = true;
    input.pointer.inside = true;
    input.pointer.x = boss.x;
    input.pointer.y = 880;
    game.update(DT);
    input.postUpdate();
    seconds += DT;
  }
  return seconds;
}

describe('Galaxy War boss', () => {
  it('takes hits on its wings and body, and misses air beside the hull', () => {
    const { game, input, g, boss } = arena();
    // Wing circle centre sits 70 px out; a shot 85 px out is inside it.
    g.shots.push(shotAt(boss.x + 85, boss.y - 6));
    const before = boss.hp;
    step(game, input, 1);
    expect(boss.hp).toBeLessThan(before);

    // Above the core circle, and far outside both wings: no damage.
    const { game: g2, input: in2, g: probe2, boss: boss2 } = arena();
    probe2.shots.push(shotAt(boss2.x, boss2.y - 60));
    probe2.shots.push(shotAt(boss2.x + 130, boss2.y - 6));
    const start2 = boss2.hp;
    step(g2, in2, 1);
    expect(boss2.hp).toBe(start2);
  });

  it('scales its hitbox with the hull at wide layouts', () => {
    const { game, input, g, boss } = arena({ width: 720, height: 1200 });
    // At W=720 the hull is 1.33x: the wing centre is about 93 px out and its radius about 48.
    g.shots.push(shotAt(boss.x + 93, boss.y - 6));
    const before = boss.hp;
    step(game, input, 1);
    expect(boss.hp).toBeLessThan(before);
  });

  it('normalises boss HP to the current weapon, so a stronger ship faces a tougher boss', () => {
    const hp = (weapon: number) => arena({ weapon }).boss.maxHp;
    // About 22 s at each weapon level's expected damage output.
    expect(hp(1)).toBeCloseTo(22 * 7, 0);
    expect(hp(5)).toBeCloseTo(22 * 46, 0);
    expect(hp(5)).toBeGreaterThan(hp(1) * 5);
  });

  it('caps boss growth with the boss index', () => {
    const hp = (wave: number) => {
      const { g } = fresh({ weapon: 1 });
      g.wave = wave;
      g.spawnBoss();
      return g.boss?.maxHp ?? 0;
    };
    // Index 2 (wave 10) is 1.25x the first boss; from index 5 on the growth is capped at 2x.
    expect(hp(10)).toBeCloseTo(hp(5) * 1.25, 5);
    expect(hp(25)).toBeCloseTo(hp(5) * 2, 5);
    expect(hp(40)).toBeCloseTo(hp(25), 5);
  });

  it('kills in roughly the target time with a perfectly tracking ship', () => {
    for (const weapon of [1, 5]) {
      const seconds = bossKillSeconds(weapon);
      expect(seconds).toBeGreaterThan(12);
      expect(seconds).toBeLessThan(35);
    }
  });

  it('keeps moving continuously when its rage level changes', () => {
    const { game, input, g, boss } = arena({ weapon: 3 });
    step(game, input, 300);
    // Cross the 66% threshold: rage rises, and the sway must not jump.
    g.damage(boss, boss.maxHp * 0.4);
    expect(boss.rage).toBe(1);
    const before = boss.x;
    step(game, input, 1);
    expect(Math.abs(boss.x - before)).toBeLessThan(4);
  });

  it('clears nearby enemy fire and drops a power-up on each rage change', () => {
    const { g, boss } = arena();
    g.enemyShots.push({
      x: boss.x + 10,
      y: boss.y + 50,
      vx: 0,
      vy: 0,
      r: 6,
      dmg: 1,
      alive: true,
      color: '#fff',
    });
    g.enemyShots.push({ x: boss.x, y: boss.y + 600, vx: 0, vy: 0, r: 6, dmg: 1, alive: true, color: '#fff' });
    const drops = g.drops.length;
    g.damage(boss, boss.maxHp * 0.4);
    expect(g.enemyShots.filter((b) => b.alive)).toHaveLength(1);
    expect(g.drops.length).toBe(drops + 1);
    expect(g.drops.at(-1)?.kind).toBe('power');
  });

  it('telegraphs every volley before it leaves the hull', () => {
    const { game, input, g, boss } = arena({ weapon: 1 });
    boss.fireT = 0;
    step(game, input, 1);
    expect(boss.windT).toBeGreaterThan(0);
    expect(g.enemyShots).toHaveLength(0);
    step(game, input, Math.ceil(0.45 / DT));
    expect(g.enemyShots.length).toBeGreaterThan(0);
  });
});

describe('Galaxy War enemies', () => {
  it('kamikazes lock on only once on screen, then dive at a capped speed', () => {
    const { game, input, g } = fresh({ seed: 4 });
    g.wave = 15;
    g.groupKamikaze();
    const divers = new Set<ProbeEnemy>();
    for (let i = 0; i < 480; i++) {
      game.update(DT);
      input.postUpdate();
      for (const e of g.enemies) {
        if (e.kind !== 'kamikaze' || !e.alive) continue;
        if (e.stage === 0) expect(e.y).toBeLessThan(70 + 140 * DT + 1);
        else expect(e.y).toBeGreaterThanOrEqual(70 - 1);
        if (e.stage === 2) {
          divers.add(e);
          expect(Math.hypot(e.vx, e.vy)).toBeLessThanOrEqual(540 + 1e-6);
        }
      }
    }
    expect(divers.size).toBeGreaterThan(0);
  });

  it('scales enemy HP smoothly and bounds the scaling after wave 15', () => {
    const { g } = fresh();
    g.wave = 2;
    const scout = g.makeEnemy('scout', 'sine', 0, 0);
    expect(scout.hp).toBeCloseTo(1.08, 6);
    g.wave = 15;
    const at15 = g.hpScale();
    expect(at15).toBeCloseTo(1 + 14 * 0.08, 6);
    g.wave = 40;
    expect(g.hpScale()).toBeCloseTo(at15, 6);
  });
});

describe('Galaxy War controls', () => {
  it('steers with the mouse only while the cursor is over the canvas', () => {
    const { game, input, g } = fresh();
    const x0 = g.shipX;
    const y0 = g.shipY;
    input.pointer.active = true;
    input.pointer.inside = false;
    input.pointer.x = 20;
    input.pointer.y = 100;
    step(game, input, 120);
    expect(g.shipX).toBeCloseTo(x0, 5);
    expect(g.shipY).toBeCloseTo(y0, 5);
  });

  it('hovers the ship just above the cursor so the cursor does not cover it', () => {
    const { game, input, g } = fresh();
    input.pointer.active = true;
    input.pointer.inside = true;
    input.pointer.x = 200;
    input.pointer.y = 500;
    step(game, input, 240);
    expect(g.shipX).toBeCloseTo(200, 0);
    expect(g.shipY).toBeCloseTo(440, 0);
  });

  it('moves the ship by the finger travel when touch-dragging, not to the finger', () => {
    const { game, input, g } = fresh();
    const x0 = g.shipX;
    const y0 = g.shipY;
    input.pointer.touch = true;
    input.pointer.active = true;
    input.pointer.inside = true;
    input.pointer.down = true;
    input.pointer.pressed = true;
    // Finger lands 150 px right of the ship: the ship must not jump there.
    input.pointer.x = x0 + 150;
    input.pointer.y = y0;
    step(game, input, 1);
    expect(Math.abs(g.shipX - x0)).toBeLessThan(2);
    // Dragging the finger 60 px left moves the ship 60 px left.
    input.pointer.pressed = false;
    input.pointer.x = x0 + 90;
    step(game, input, 30);
    expect(g.shipX).toBeCloseTo(x0 - 60, 0);
    expect(g.shipY).toBeCloseTo(y0, 0);
  });

  it('bombs with Space as well as the secondary action', () => {
    const { game, input, g } = fresh();
    const before = g.bombs;
    input.setVirtual('primary', true, 'test');
    step(game, input, 1);
    expect(g.bombs).toBe(before - 1);
  });

  it('keeps the ship above touch-control insets', () => {
    const insets = { top: 0, right: 0, bottom: 200, left: 0 };
    const { game, input, g } = fresh({ height: 960, insets });
    input.setVirtual('down', true, 'test');
    step(game, input, 300);
    expect(g.shipY).toBeLessThanOrEqual(960 - 40 - 200 + 1e-6);
  });
});

describe('Galaxy War power-ups', () => {
  it('turns surplus power-ups into Overdrive, lengthened by Overclock', () => {
    const game = withPowerDuration(1.5);
    const g = probe(game);
    g.weapon = 5;
    g.collect('power');
    expect(g.overdriveT).toBeCloseTo(9, 5);
    expect(game.getResult().stats.powerups).toBe(1);
    expect(game.getResult().score).toBeGreaterThan(0);
  });

  it('builds a result that keeps every stat key stable', () => {
    const { game, g } = fresh();
    g.weapon = 5;
    g.collect('power');
    const result: GameResult = game.getResult();
    expect(Object.keys(result.stats)).toEqual(expect.arrayContaining(['powerups']));
  });
});

describe('Galaxy War layout', () => {
  it('renders without error at every corner of the viewport range, with touch insets', () => {
    for (const [width, height] of [
      [540, 900],
      [540, 1200],
      [720, 900],
      [720, 1200],
    ] as const) {
      const { game, input } = fresh({ width, height, insets: { top: 0, right: 0, bottom: 120, left: 0 } });
      input.setVirtual('left', true, 'test');
      step(game, input, 120);
      game.render();
      expect(game.isOver()).toBe(false);
    }
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

describe('Galaxy War phone layout', () => {
  const def = gameById('galaxy');

  it('is a portrait game that fills the portrait phone and tablet sizes', () => {
    expect(def.orientation).toBe('portrait');
    const v = def.viewport ?? {};
    for (const [name, [w, h]] of Object.entries({
      P1: [360, 740],
      P2: [390, 844],
      P3: [430, 932],
      T1: [768, 1024],
    })) {
      const stage = stageFor(w!, h!);
      const size = chooseLogicalSize(def, stage.w, stage.h);
      expect(size.width, name).toBeGreaterThanOrEqual(v.minWidth ?? def.width);
      expect(size.width, name).toBeLessThanOrEqual(v.maxWidth ?? def.width);
      expect(size.height, name).toBeGreaterThanOrEqual(v.minHeight ?? def.height);
      expect(size.height, name).toBeLessThanOrEqual(v.maxHeight ?? def.height);
      expect(fittedArea(size, stage.w, stage.h) / (stage.w * stage.h), name).toBeGreaterThanOrEqual(0.85);
    }
  });

  it('keeps the first-frame HUD text at least 12 CSS px on every phone size', () => {
    for (const [w, h] of [
      [360, 740],
      [390, 844],
      [430, 932],
    ] as const) {
      const stage = stageFor(w, h);
      const size = chooseLogicalSize(def, stage.w, stage.h);
      const scale = Math.min(stage.w / size.width, stage.h / size.height);
      const { ctx, sizes } = textRecorder(size.width * scale);
      const game = def.create({
        ctx,
        width: size.width,
        height: size.height,
        input: new Input(),
        audio: new NullAudio(),
        rng: new Rng(1),
        loadout: { skin: toSkinData(defaultSkin('galaxy')), boosts: new Set(), powerDuration: 1 },
        insets: NO_INSETS,
        reducedMotion: false,
        haptic: () => undefined,
      });
      game.render();
      expect(sizes.length, `${w}x${h}`).toBeGreaterThan(0);
      expect(Math.min(...sizes) * scale, `${w}x${h}`).toBeGreaterThanOrEqual(12);
    }
  });

  it('keeps a full line of hover ships inside the screen at the narrowest phone width', () => {
    const size = chooseLogicalSize(def, 360, 690);
    const { game, input, g } = fresh({ width: size.width, height: size.height });
    // Nine waves in, a hover line has six ships in it.
    g.wave = 9;
    g.groupHover();
    let checked = 0;
    for (let i = 0; i < 8 * 60; i++) {
      step(game, input, 1);
      for (const e of g.enemies) {
        if (!e.alive || e.behavior !== 'hover') continue;
        checked++;
        expect(e.x - e.r, `ship at x=${e.x}`).toBeGreaterThanOrEqual(0);
        expect(e.x + e.r, `ship at x=${e.x}`).toBeLessThanOrEqual(size.width);
      }
    }
    expect(checked).toBeGreaterThan(100);
  });
});
