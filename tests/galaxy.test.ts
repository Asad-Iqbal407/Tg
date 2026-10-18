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
  hudScale(): number;
  shipScale(): number;
  waveBannerT: number;
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
  it('steers with the mouse over a letterbox bar towards the nearest point of the field', () => {
    // A fast swing past the canvas edge used to stop the ship short of the wall: the bar is part of the stage.
    const { game, input, g } = fresh();
    input.pointer.active = true;
    input.pointer.inside = false;
    input.pointer.x = -150;
    input.pointer.y = 600;
    step(game, input, 180);
    const reach = 26 * Math.cos(0.2) + 14 * Math.sin(0.2);
    expect(g.shipX).toBeCloseTo(reach, 3);
    expect(g.shipY).toBeCloseTo(540, 0);
  });

  it('holds still once the mouse has left the play stage', () => {
    const { game, input, g } = fresh();
    const x0 = g.shipX;
    const y0 = g.shipY;
    input.pointer.active = false;
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

  it('keeps the whole hull on the field when a drag runs past either wall', () => {
    const { game, input, g } = fresh({ width: 540, height: 960 });
    input.pointer.touch = true;
    input.pointer.active = true;
    input.pointer.inside = true;
    input.pointer.down = true;
    input.pointer.pressed = true;
    // The finger lands on the ship, then drags far past the left wall, then the right one.
    input.pointer.x = g.shipX;
    input.pointer.y = g.shipY;
    step(game, input, 1);
    input.pointer.pressed = false;
    input.pointer.x = -200;
    step(game, input, 240);
    // The wing tips reach 26 * cos(0.2) + 14 * sin(0.2) hull units at the steepest bank the ship draws.
    const reach = 26 * Math.cos(0.2) + 14 * Math.sin(0.2);
    expect(g.shipX).toBeCloseTo(reach, 6);
    input.pointer.x = 740;
    step(game, input, 240);
    expect(g.shipX).toBeCloseTo(540 - reach, 6);
  });

  it('keeps a popup earned at the wall on the field', () => {
    const { game, g } = fresh();
    g.shipX = 26;
    g.weapon = 5;
    g.collect('power');
    // The overdrive label is centred near the ship; its half-width must stay inside the field.
    const texts = (game as unknown as { texts: { items: { x: number; text: string }[] } }).texts.items;
    const item = texts.find((t) => t.text === 'OVERDRIVE!');
    expect(item).toBeDefined();
    const half = 'OVERDRIVE!'.length * 0.4 * 22;
    expect(item!.x - half).toBeGreaterThanOrEqual(0);
    expect(item!.x + half).toBeLessThanOrEqual(540);
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

const BOMB_FILL = '#ff9f1c';

/**
 * A context stand-in on a canvas drawn `cssWidth` px wide. It records the font size of each fillText,
 * and the centre and radius of each arc drawn in the bomb colour.
 */
function hudRecorder(cssWidth: number): {
  ctx: CanvasRenderingContext2D;
  sizes: number[];
  bombs: { x: number; y: number; r: number }[];
} {
  const sizes: number[] = [];
  const bombs: { x: number; y: number; r: number }[] = [];
  const base = mockCtx();
  (base as unknown as { canvas: unknown }).canvas = { clientWidth: cssWidth };
  // Track the drawing scale in force (save / scale / restore), so sizes are in logical px as drawn.
  let scale = 1;
  const saved: number[] = [];
  const ctx = new Proxy(base, {
    get(target, key) {
      if (key === 'save') return () => saved.push(scale);
      if (key === 'restore') return () => (scale = saved.pop() ?? 1);
      if (key === 'scale') return (sx: number) => (scale *= sx);
      if (key === 'fillText') {
        return () => {
          const m = /(\d+(?:\.\d+)?)px/.exec(target.font);
          if (m) sizes.push(Number(m[1]) * scale);
        };
      }
      if (key === 'arc') {
        return (x: number, y: number, r: number) => {
          if (target.fillStyle === BOMB_FILL) bombs.push({ x, y, r });
        };
      }
      return Reflect.get(target, key);
    },
  });
  return { ctx, sizes, bombs };
}

/** A galaxy run at a logical size, drawing into a recording context. */
function drawnRun(size: { width: number; height: number }, ctx: CanvasRenderingContext2D): GameInstance {
  return gameById('galaxy').create({
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

  it('keeps the first-frame HUD text at least 12 CSS px on phone sizes, landscape fallback included', () => {
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
      const { ctx, sizes } = hudRecorder(size.width * scale);
      drawnRun(size, ctx).render();
      expect(sizes.length, `${w}x${h}`).toBeGreaterThan(0);
      expect(Math.min(...sizes) * scale, `${w}x${h}`).toBeGreaterThanOrEqual(12);
    }
  });

  it('keeps five bombs clear of the weapon pill, wrapping onto a row above when they would reach it', () => {
    for (const [w, h] of [
      [360, 740],
      [740, 360],
      [844, 390],
      [932, 430],
    ] as const) {
      const stage = stageFor(w, h);
      const size = chooseLogicalSize(def, stage.w, stage.h);
      const scale = Math.min(stage.w / size.width, stage.h / size.height);
      const { ctx, bombs } = hudRecorder(size.width * scale);
      const game = drawnRun(size, ctx);
      const g = probe(game);
      g.bombs = 5;
      game.render();
      const k = g.hudScale();
      // The weapon pill spans W/2 +- 70 HUD units; a bomb's left edge must stay right of its right side.
      const pillRight = size.width / 2 + 70 * k;
      expect(bombs, `${w}x${h}`).toHaveLength(5);
      for (const b of bombs) {
        expect(Math.abs(b.r - 9 * k), `${w}x${h}`).toBeLessThan(1e-6);
        expect(b.x - b.r, `${w}x${h}`).toBeGreaterThanOrEqual(pillRight - 1e-6);
      }
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

  it('draws the ship at least 8% of the short side on a letterboxed landscape phone', () => {
    // The hull is 52 units wide. Share = its CSS width / the stage's short side, as the shell lays it out.
    const share = (cssWidth: number, stageW: number, stageH: number, w: number, h: number) => {
      const ctx = mockCtx();
      (ctx as unknown as { canvas: unknown }).canvas = {
        clientWidth: cssWidth,
        parentElement: { clientWidth: stageW, clientHeight: stageH },
      };
      const scale = probe(drawnRun({ width: w, height: h }, ctx)).shipScale();
      return { scale, share: (52 * scale * (cssWidth / w)) / Math.min(stageW, stageH) };
    };
    // Landscape fallback: the 720 x 900 run is 288 / 312 / 344 CSS px wide on the 360 / 390 / 430 px stages.
    for (const [name, cssW, stageW, stageH] of [
      ['L1', 288, 688, 360],
      ['L2', 312, 792, 390],
      ['L3', 344, 880, 430],
    ] as const) {
      const r = share(cssW, stageW, stageH, 720, 900);
      expect(r.share, name).toBeGreaterThanOrEqual(0.08);
      expect(r.scale, name).toBeGreaterThan(1);
    }
    // The preferred portrait phone already shows the hull at about 9.6%: it keeps its design size.
    expect(share(390, 390, 794, 540, 1098).scale).toBe(1);
    // Desktop and tablet stages keep the design size.
    expect(share(595, 1280, 744, 720, 900).scale).toBe(1);
    expect(share(768, 1024, 712, 720, 900).scale).toBe(1);
  });

  it('keeps the wave banner subtitle at least 12 CSS px on the landscape fallback', () => {
    for (const [w, h] of [
      [740, 360],
      [844, 390],
      [932, 430],
    ] as const) {
      const stage = stageFor(w, h);
      const size = chooseLogicalSize(def, stage.w, stage.h);
      const scale = Math.min(stage.w / size.width, stage.h / size.height);
      const { ctx, sizes } = hudRecorder(size.width * scale);
      const game = drawnRun(size, ctx);
      probe(game).wave = 1;
      probe(game).waveBannerT = 0.5;
      game.render();
      // Every text in the frame, the banner subtitle included, stays readable.
      expect(sizes.length, `${w}x${h}`).toBeGreaterThan(0);
      expect(Math.min(...sizes) * scale, `${w}x${h}`).toBeGreaterThanOrEqual(12);
    }
  });
});

describe('Galaxy War landscape phone fallback', () => {
  const def = gameById('galaxy');
  /** The definition the shell sizes a run with on a touch phone held landscape ("Play anyway"). */
  const landscape = { ...def, viewport: def.landscapeViewport };
  const PHONES = { L1: [740, 360], L2: [844, 390], L3: [932, 430] } as const;

  it('declares a landscape range that fills far more of a sideways phone than the portrait range', () => {
    expect(def.landscapeViewport).toBeDefined();
    for (const [name, [w, h]] of Object.entries(PHONES)) {
      const stage = stageFor(w, h);
      const before = chooseLogicalSize(def, stage.w, stage.h);
      const after = chooseLogicalSize(landscape, stage.w, stage.h);
      const fill = (s: { width: number; height: number }) => fittedArea(s, stage.w, stage.h) / (stage.w * stage.h);
      expect(fill(before), name).toBeLessThan(0.45);
      expect(fill(after), name).toBeGreaterThanOrEqual(0.64);
      // Enough height is kept for the vertical reaction distance the waves are tuned for.
      expect(after.height, name).toBeGreaterThanOrEqual(780);
    }
    // Portrait phones and desktop never use it: their sizes are unchanged.
    expect(chooseLogicalSize(def, 1280, 744)).toEqual({ width: 720, height: 900 });
  });

  it('keeps HUD text at least 12 CSS px and the ship at least 8% of the short side', () => {
    for (const [name, [w, h]] of Object.entries(PHONES)) {
      const stage = stageFor(w, h);
      const size = chooseLogicalSize(landscape, stage.w, stage.h);
      const scale = Math.min(stage.w / size.width, stage.h / size.height);
      const { ctx, sizes } = hudRecorder(size.width * scale);
      (ctx as unknown as { canvas: unknown }).canvas = {
        clientWidth: size.width * scale,
        parentElement: { clientWidth: stage.w, clientHeight: stage.h },
      };
      const game = drawnRun(size, ctx);
      probe(game).wave = 1;
      probe(game).waveBannerT = 0.5;
      game.render();
      expect(Math.min(...sizes) * scale, name).toBeGreaterThanOrEqual(12);
      const shipCss = 52 * probe(game).shipScale() * scale;
      expect(shipCss / Math.min(stage.w, stage.h), name).toBeGreaterThanOrEqual(0.08);
    }
  });

  it('keeps every curve swoop clear of the bottom HUD on the short landscape field', () => {
    const { game, input, g } = fresh({ width: 1040, height: 780 });
    (g as unknown as { groupCurve(): void }).groupCurve();
    let deepest = 0;
    for (let i = 0; i < 6 * 60; i++) {
      step(game, input, 1);
      for (const e of g.enemies) if (e.behavior === 'curve' && e.t > 0) deepest = Math.max(deepest, e.y);
    }
    // At the 960 design height the swoop bottoms out near y=430; it scales with the field height.
    expect(deepest).toBeGreaterThan(200);
    expect(deepest).toBeLessThan(780 * 0.5);
  });
});

describe('Galaxy War pickups and popups', () => {
  it('draws pickup letters at least 12 CSS px on a letterboxed phone stage', () => {
    const def = gameById('galaxy');
    for (const [w, h, landscapeRange] of [
      [360, 740, false],
      [844, 390, true],
      [844, 390, false],
    ] as const) {
      const stage = stageFor(w, h);
      const spec = landscapeRange ? { ...def, viewport: def.landscapeViewport } : def;
      const size = chooseLogicalSize(spec, stage.w, stage.h);
      const scale = Math.min(stage.w / size.width, stage.h / size.height);
      const { ctx, sizes } = hudRecorder(size.width * scale);
      (ctx as unknown as { canvas: unknown }).canvas = {
        clientWidth: size.width * scale,
        parentElement: { clientWidth: stage.w, clientHeight: stage.h },
      };
      const game = drawnRun(size, ctx);
      const g = probe(game) as unknown as { drops: { kind: string; x: number; y: number; vy: number; alive: boolean }[] };
      g.drops = [{ kind: 'power', x: 200, y: 300, vy: 0, alive: true }];
      sizes.length = 0;
      (game as unknown as { drawDrop(d: unknown): void }).drawDrop(g.drops[0]);
      expect(sizes, `${w}x${h}`).toHaveLength(1);
      // The box sways by up to 0.3 rad, which shrinks the glyph's on-screen height by cos(0.3).
      expect(sizes[0]! * scale * Math.cos(0.3), `${w}x${h}`).toBeGreaterThanOrEqual(12);
    }
  });

  it('stacks popups earned together at one spot instead of printing them over each other', () => {
    const { game, g } = fresh();
    const e1 = g.makeEnemy('scout', 'sine', 270, 400);
    const e2 = g.makeEnemy('scout', 'sine', 272, 402);
    // Build a chain so both kills show score popups.
    (g as unknown as { chain: number }).chain = 6;
    g.damage(e1, 99);
    g.damage(e2, 99);
    const items = (game as unknown as { texts: { items: { x: number; y: number; text: string; size: number }[] } })
      .texts.items;
    const scores = items.filter((t) => /x\d$/.test(t.text) && !t.text.startsWith('CHAIN'));
    expect(scores).toHaveLength(2);
    const [a, b] = scores as [(typeof scores)[0], (typeof scores)[0]];
    expect(Math.abs(a.y - b.y)).toBeGreaterThanOrEqual(a.size);
  });
});
