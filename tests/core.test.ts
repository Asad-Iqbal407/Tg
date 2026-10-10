import { afterEach, describe, expect, it, vi } from 'vitest';
import { AudioEngine } from '../src/core/audio';
import { chooseLogicalSize, fittedArea, GameLoop, type SizeSpec } from '../src/core/engine';
import { type AttachOptions, Input } from '../src/core/input';
import { clamp, formatCompact, rectsOverlap, wrapAngle } from '../src/core/math';
import { hashString, Rng } from '../src/core/rng';
import { BaseGame } from '../src/games/base';
import { NO_INSETS } from '../src/games/types';
import { gameById, mockCtx } from './helpers';

describe('Rng', () => {
  it('is deterministic for a given seed', () => {
    const a = new Rng(42);
    const b = new Rng(42);
    const seqA = Array.from({ length: 20 }, () => a.next());
    const seqB = Array.from({ length: 20 }, () => b.next());
    expect(seqA).toEqual(seqB);
    expect(seqA.every((v) => v >= 0 && v < 1)).toBe(true);
  });

  it('produces integers within inclusive bounds and covers the range', () => {
    const r = new Rng(7);
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i++) {
      const v = r.int(1, 6);
      expect(v).toBeGreaterThanOrEqual(1);
      expect(v).toBeLessThanOrEqual(6);
      seen.add(v);
    }
    expect(seen.size).toBe(6);
  });

  it('respects weights and never picks zero-weight items', () => {
    const r = new Rng(3);
    const counts = { a: 0, b: 0, c: 0 };
    for (let i = 0; i < 5000; i++)
      counts[
        r.weighted([
          { value: 'a' as const, weight: 3 },
          { value: 'b' as const, weight: 1 },
          { value: 'c' as const, weight: 0 },
        ])
      ]++;
    expect(counts.c).toBe(0);
    expect(counts.a / counts.b).toBeGreaterThan(2.3);
    expect(counts.a / counts.b).toBeLessThan(3.8);
  });

  it('throws on empty picks', () => {
    expect(() => new Rng(1).pick([])).toThrow();
  });

  it('forks an independent stream without advancing the parent', () => {
    const a = new Rng(99);
    const b = new Rng(99);
    const fx = a.fork();
    for (let i = 0; i < 50; i++) fx.next();
    expect(a.next()).toBe(b.next());
    expect(new Rng(99).fork().next()).toBe(new Rng(99).fork().next());
    expect(new Rng(99).fork().next()).not.toBe(new Rng(99).next());
  });

  it('hashes strings stably', () => {
    expect(hashString('2026-10-09')).toBe(hashString('2026-10-09'));
    expect(hashString('a')).not.toBe(hashString('b'));
  });
});

describe('math helpers', () => {
  it('clamps, wraps angles and overlaps rects', () => {
    expect(clamp(5, 0, 3)).toBe(3);
    expect(clamp(-1, 0, 3)).toBe(0);
    expect(Math.abs(Math.abs(wrapAngle(Math.PI * 3)) - Math.PI)).toBeLessThan(1e-9);
    expect(wrapAngle(Math.PI / 2 + Math.PI * 4)).toBeCloseTo(Math.PI / 2);
    expect(rectsOverlap({ x: 0, y: 0, w: 10, h: 10 }, { x: 9, y: 9, w: 5, h: 5 })).toBe(true);
    expect(rectsOverlap({ x: 0, y: 0, w: 10, h: 10 }, { x: 10, y: 0, w: 5, h: 5 })).toBe(false);
    expect(formatCompact(12_345)).toBe('12.3K');
    expect(formatCompact(2_500_000)).toBe('2.5M');
  });
});

describe('Input', () => {
  it('tracks edges per simulation step and multiple holders', () => {
    const input = new Input();
    input.setVirtual('left', true, 'a');
    expect(input.isDown('left')).toBe(true);
    expect(input.wasPressed('left')).toBe(true);
    input.postUpdate();
    expect(input.wasPressed('left')).toBe(false);
    input.setVirtual('left', true, 'b');
    expect(input.wasPressed('left')).toBe(false);
    input.setVirtual('left', false, 'a');
    expect(input.isDown('left')).toBe(true);
    input.setVirtual('left', false, 'b');
    expect(input.isDown('left')).toBe(false);
    expect(input.wasReleased('left')).toBe(true);
    expect(input.axisX()).toBe(0);
  });

  it('queues swipes until the step ends and ignores input while disabled', () => {
    const input = new Input();
    input.pushSwipe('up');
    expect(input.consumeSwipe()).toBe('up');
    expect(input.consumeSwipe()).toBeNull();
    input.setEnabled(false);
    input.pushSwipe('left');
    input.setVirtual('primary', true);
    expect(input.consumeSwipe()).toBeNull();
    expect(input.isDown('primary')).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------
// Flexible logical size

const RANGES: Record<string, SizeSpec> = {
  runner: {
    width: 540,
    height: 960,
    viewport: { minWidth: 540, maxWidth: 1706, minHeight: 900, maxHeight: 1200 },
  },
  galaxy: {
    width: 540,
    height: 960,
    viewport: { minWidth: 540, maxWidth: 720, minHeight: 900, maxHeight: 1200 },
  },
  platformer: { width: 960, height: 540, viewport: { minWidth: 800, maxWidth: 1280 } },
  duck: { width: 960, height: 540, viewport: { minWidth: 800, maxWidth: 1280 } },
  hill: {
    width: 960,
    height: 540,
    viewport: { minWidth: 880, maxWidth: 1280, minHeight: 540, maxHeight: 760 },
  },
};

describe('chooseLogicalSize', () => {
  it.each([
    // game, available stage (CSS px), expected logical size
    ['runner', 390, 794, 540, 1100], // portrait phone: taller field fills the screen
    ['runner', 1366, 712, 1706, 900], // desktop: widest view
    ['runner', 820, 1124, 700, 960], // portrait tablet
    ['galaxy', 390, 794, 540, 1100],
    ['galaxy', 1366, 712, 720, 900], // capped at 720 wide, rest is letterbox
    ['galaxy', 820, 1124, 700, 960],
    ['platformer', 844, 334, 1280, 540], // landscape phone
    ['platformer', 796, 390, 1102, 540], // landscape phone with the header rail
    ['platformer', 390, 794, 800, 540], // portrait phone: narrowest view, letterboxed
    ['duck', 1366, 712, 1036, 540],
    ['hill', 820, 1124, 880, 760], // portrait tablet: as tall as allowed
    ['hill', 1366, 712, 1036, 540],
    ['hill', 1920, 1024, 1012, 540],
  ])('%s in %ix%i -> %ix%i', (id, aw, ah, w, hgt) => {
    expect(chooseLogicalSize(RANGES[id]!, aw, ah)).toEqual({ width: w, height: hgt });
  });

  it('keeps the design size for games without a range, or with nothing to measure', () => {
    const fixed = { width: 960, height: 540 };
    expect(chooseLogicalSize(fixed, 390, 794)).toEqual(fixed);
    expect(chooseLogicalSize(fixed, 2000, 500)).toEqual(fixed);
    expect(chooseLogicalSize(RANGES.runner!, 0, 0)).toEqual({ width: 540, height: 960 });
    expect(chooseLogicalSize(RANGES.runner!, NaN, 100)).toEqual({ width: 540, height: 960 });
  });

  it('always returns even sizes inside the range', () => {
    const rng = new Rng(5);
    for (const spec of Object.values(RANGES)) {
      const v = spec.viewport!;
      for (let i = 0; i < 300; i++) {
        const s = chooseLogicalSize(spec, rng.range(200, 3000), rng.range(200, 3000));
        expect(s.width % 2).toBe(0);
        expect(s.height % 2).toBe(0);
        expect(s.width).toBeGreaterThanOrEqual(v.minWidth ?? spec.width);
        expect(s.width).toBeLessThanOrEqual(v.maxWidth ?? spec.width);
        expect(s.height).toBeGreaterThanOrEqual(v.minHeight ?? spec.height);
        expect(s.height).toBeLessThanOrEqual(v.maxHeight ?? spec.height);
      }
    }
  });

  it('reads the ranges declared by the real game definitions', () => {
    for (const id of ['runner', 'platformer', 'duck', 'hill', 'galaxy']) {
      const def = gameById(id);
      const s = chooseLogicalSize(def, 1366, 712);
      expect(s.width).toBeGreaterThanOrEqual(def.viewport?.minWidth ?? def.width);
      expect(s.width).toBeLessThanOrEqual(def.viewport?.maxWidth ?? def.width);
    }
  });

  it('measures letterboxed area', () => {
    expect(fittedArea({ width: 960, height: 540 }, 480, 540)).toBeCloseTo(480 * 270);
    expect(fittedArea({ width: 540, height: 960 }, 0, 100)).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------
// Game loop

describe('GameLoop', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('renders only after a simulation step or an invalidate()', () => {
    let pending: FrameRequestCallback | null = null;
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      pending = cb;
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', () => undefined);
    vi.spyOn(performance, 'now').mockReturnValue(0);
    let steps = 0;
    let renders = 0;
    let polls = 0;
    const loop = new GameLoop(
      () => steps++,
      () => renders++,
      { poll: () => polls++ },
    );
    const frame = (t: number) => (pending as unknown as FrameRequestCallback)(t);
    loop.start();
    frame(0); // first frame always renders
    expect([steps, renders]).toEqual([0, 1]);
    frame(1000 / 120); // half a step at 120 Hz: nothing to draw
    expect([steps, renders]).toEqual([0, 1]);
    frame(1000 / 60 + 0.5);
    expect([steps, renders]).toEqual([1, 2]);
    loop.invalidate();
    frame(1000 / 60 + 1);
    expect([steps, renders]).toEqual([1, 3]);
    expect(polls).toBe(4);
    loop.stop();
  });
});

// ---------------------------------------------------------------------------------------------
// Input: pointer ownership, pointer area and keyboard focus

class FakeStage extends EventTarget {
  getBoundingClientRect() {
    return { left: 0, top: 0, right: 400, bottom: 800, width: 400, height: 800 };
  }
  setPointerCapture(): void {}
}

/** Canvas occupies client y 200..600 of a 400x800 stage, mapped 1:1 onto a 400x400 game. */
const canvasMapper = (cx: number, cy: number) => {
  const x = cx;
  const y = cy - 200;
  return { x, y, inside: x >= 0 && x <= 400 && y >= 0 && y <= 400 };
};

function ptr(
  type: string,
  id: number,
  x: number,
  y: number,
  extra: Partial<{ pointerType: string; button: number; buttons: number }> = {},
): Event {
  const e = new Event(type, { cancelable: true });
  Object.assign(e, {
    pointerId: id,
    clientX: x,
    clientY: y,
    pointerType: 'touch',
    button: 0,
    buttons: 1,
    ...extra,
  });
  return e;
}

function key(type: 'keydown' | 'keyup', code: string, target?: unknown): Event {
  const e = new Event(type, { cancelable: true });
  Object.assign(e, { code });
  if (target) Object.defineProperty(e, 'target', { value: target });
  return e;
}

function setup(opts: AttachOptions = {}) {
  const win = new EventTarget();
  vi.stubGlobal('window', win);
  const stage = new FakeStage();
  const input = new Input();
  input.attach(stage as unknown as HTMLElement, canvasMapper, opts);
  return { input, stage, win, p: input.pointer };
}

describe('Input pointer', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('ignores presses in the letterbox unless the game uses the whole stage', () => {
    const a = setup();
    a.stage.dispatchEvent(ptr('pointerdown', 1, 200, 700));
    expect(a.p.pressed).toBe(false);
    expect(a.p.down).toBe(false);
    a.win.dispatchEvent(ptr('pointerup', 1, 200, 700));
    a.stage.dispatchEvent(ptr('pointerdown', 2, 100, 300));
    expect([a.p.pressed, a.p.down, a.p.inside, a.p.x, a.p.y]).toEqual([true, true, true, 100, 100]);

    const b = setup({ pointerArea: 'stage' });
    b.stage.dispatchEvent(ptr('pointerdown', 1, 200, 700));
    expect([b.p.pressed, b.p.down, b.p.inside]).toEqual([true, true, false]);
    expect(b.p.y).toBe(500);
  });

  it('keeps the first finger as the owner of the game pointer', () => {
    const { input, stage, win, p } = setup({ pointerArea: 'stage' });
    stage.dispatchEvent(ptr('pointerdown', 1, 100, 300));
    input.postUpdate();
    // A second finger lands, moves and lifts: the owner is untouched.
    stage.dispatchEvent(ptr('pointerdown', 2, 300, 500));
    expect(p.pressed).toBe(false);
    win.dispatchEvent(ptr('pointermove', 2, 320, 520));
    expect([p.x, p.y, p.down]).toEqual([100, 100, true]);
    win.dispatchEvent(ptr('pointerup', 2, 320, 520));
    expect(p.down).toBe(true);
    expect(p.released).toBe(false);
    win.dispatchEvent(ptr('pointermove', 1, 150, 350));
    expect([p.x, p.y]).toEqual([150, 150]);
  });

  it('never lets a finger that started on a touch button move or release the pointer', () => {
    const { stage, win, p } = setup({ pointerArea: 'stage' });
    stage.dispatchEvent(ptr('pointerdown', 1, 100, 300));
    // Pointer 7 went down on a button (its pointerdown never reached the stage).
    win.dispatchEvent(ptr('pointermove', 7, 380, 780));
    win.dispatchEvent(ptr('pointerup', 7, 380, 780));
    expect([p.x, p.y, p.down]).toEqual([100, 100, true]);
  });

  it('hands the pointer to a remaining finger when the owner lifts', () => {
    const { input, stage, win, p } = setup({ pointerArea: 'stage' });
    stage.dispatchEvent(ptr('pointerdown', 1, 100, 300));
    stage.dispatchEvent(ptr('pointerdown', 2, 300, 500));
    win.dispatchEvent(ptr('pointermove', 2, 310, 510));
    input.postUpdate();
    win.dispatchEvent(ptr('pointerup', 1, 100, 300));
    expect([p.down, p.pressed, p.x, p.y]).toEqual([true, false, 310, 310]);
    win.dispatchEvent(ptr('pointermove', 2, 200, 400));
    expect([p.x, p.y]).toEqual([200, 200]);
    win.dispatchEvent(ptr('pointerup', 2, 200, 400));
    expect(p.down).toBe(false);
    expect(p.released).toBe(true);
  });

  it('follows a hovering mouse only over the pointer area', () => {
    const mouse = { pointerType: 'mouse', buttons: 0 };
    const a = setup();
    a.win.dispatchEvent(ptr('pointermove', 1, 50, 250, mouse));
    expect([a.p.active, a.p.inside, a.p.x, a.p.y]).toEqual([true, true, 50, 50]);
    a.win.dispatchEvent(ptr('pointermove', 1, 50, 20, mouse)); // header, above the canvas
    expect([a.p.active, a.p.inside, a.p.x, a.p.y]).toEqual([false, false, 50, 50]);

    const b = setup({ pointerArea: 'stage' });
    b.win.dispatchEvent(ptr('pointermove', 1, 50, 700, mouse)); // letterbox bar: still the stage
    expect([b.p.active, b.p.inside, b.p.y]).toEqual([true, false, 500]);
    b.win.dispatchEvent(ptr('pointermove', 1, 50, 900, mouse)); // outside the stage
    expect([b.p.active, b.p.y]).toEqual([false, 500]);
  });

  it('keeps steering while a pressed mouse drags off the canvas', () => {
    const { stage, win, p } = setup();
    stage.dispatchEvent(ptr('pointerdown', 1, 50, 250, { pointerType: 'mouse' }));
    win.dispatchEvent(ptr('pointermove', 1, 50, 150, { pointerType: 'mouse' }));
    expect([p.down, p.inside, p.y]).toEqual([true, false, -50]);
  });

  it('maps the right mouse button to secondary over the game area', () => {
    const { input, stage, win } = setup();
    stage.dispatchEvent(ptr('pointerdown', 1, 50, 250, { pointerType: 'mouse', button: 2, buttons: 2 }));
    expect(input.isDown('secondary')).toBe(true);
    win.dispatchEvent(ptr('pointerup', 1, 50, 250, { pointerType: 'mouse', button: 2, buttons: 0 }));
    expect(input.isDown('secondary')).toBe(false);
  });

  it('drops pointer ownership while disabled', () => {
    const { input, stage, win, p } = setup();
    stage.dispatchEvent(ptr('pointerdown', 1, 100, 300));
    input.setEnabled(false);
    expect(p.down).toBe(false);
    stage.dispatchEvent(ptr('pointerdown', 2, 100, 300));
    expect(p.down).toBe(false);
    input.setEnabled(true);
    win.dispatchEvent(ptr('pointerup', 1, 100, 300));
    expect(p.released).toBe(false);
  });
});

describe('Input keyboard', () => {
  afterEach(() => vi.unstubAllGlobals());

  const button = { tagName: 'BUTTON', closest: (sel: string) => (sel.includes('button') ? button : null) };

  it('leaves Enter/Space alone while disabled', () => {
    const { input, win } = setup();
    input.setEnabled(false);
    const e = key('keydown', 'Enter');
    win.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(false);
  });

  it('lets focused buttons handle Enter/Space, but still steers with arrows', () => {
    const { input, win } = setup();
    const enter = key('keydown', 'Enter', button);
    win.dispatchEvent(enter);
    expect(enter.defaultPrevented).toBe(false);
    expect(input.isDown('primary')).toBe(false);
    const left = key('keydown', 'ArrowLeft', button);
    win.dispatchEvent(left);
    expect(left.defaultPrevented).toBe(true);
    expect(input.isDown('left')).toBe(true);
  });

  it('claims Enter/Space for the game when nothing interactive is focused', () => {
    const { input, win } = setup();
    const e = key('keydown', 'Space');
    win.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
    expect(input.wasPressed('primary')).toBe(true);
    win.dispatchEvent(key('keyup', 'Space'));
    expect(input.isDown('primary')).toBe(false);
  });
});

describe('Input gamepad', () => {
  afterEach(() => vi.unstubAllGlobals());

  const pad = (axes: number[], pressed: number[] = []) => ({
    connected: true,
    axes,
    buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: pressed.includes(i) })),
  });

  it('needs a firm vertical stick push for up/down but keeps the d-pad exact', () => {
    let pads = [pad([0.8, -0.45])];
    vi.stubGlobal('navigator', { getGamepads: () => pads });
    const input = new Input();
    input.pollGamepads();
    expect(input.isDown('right')).toBe(true);
    expect(input.isDown('up')).toBe(false);
    pads = [pad([0.8, -0.7])];
    input.pollGamepads();
    expect(input.isDown('up')).toBe(true);
    pads = [pad([0, 0], [12])];
    input.pollGamepads();
    expect([input.isDown('up'), input.isDown('right')]).toEqual([true, false]);
  });

  it('ignores buttons still held from a menu until they are released', () => {
    let pads = [pad([0, 0], [0])];
    vi.stubGlobal('navigator', { getGamepads: () => pads });
    const input = new Input();
    input.setEnabled(false);
    input.setEnabled(true);
    input.pollGamepads();
    expect(input.isDown('primary')).toBe(false);
    pads = [pad([0, 0])];
    input.pollGamepads();
    pads = [pad([0, 0], [0])];
    input.pollGamepads();
    expect(input.wasPressed('primary')).toBe(true);
  });

  it('reports menu button edges, ignoring buttons held when the menu opened', () => {
    let pads = [pad([0, 0], [9])];
    vi.stubGlobal('navigator', { getGamepads: () => pads });
    const input = new Input();
    input.primePadMenu();
    expect(input.pollPadMenu()).toBeNull();
    pads = [pad([0, 0])];
    expect(input.pollPadMenu()).toBeNull();
    pads = [pad([0, 0], [9])];
    expect(input.pollPadMenu()?.start).toBe(true);
    pads = [pad([0, 0.9], [9])];
    expect(input.pollPadMenu()).toMatchObject({ next: true, start: false });
  });
});

// ---------------------------------------------------------------------------------------------
// Shared game plumbing and audio

class SparkGame extends BaseGame {
  protected tick(): void {
    this.particles.emit({ x: 0, y: 0, count: 20 });
  }
  render(): void {}
}

describe('BaseGame', () => {
  it('never consumes the gameplay RNG for particles, whatever the motion setting', () => {
    for (const reducedMotion of [false, true]) {
      const rng = new Rng(1234);
      const game = new SparkGame({
        ctx: mockCtx(),
        width: 100,
        height: 100,
        insets: NO_INSETS,
        input: new Input(),
        audio: new AudioEngine(),
        rng,
        loadout: { skin: { id: 's', palette: {}, params: {} }, boosts: new Set(), powerDuration: 1 },
        reducedMotion,
        haptic: () => undefined,
      });
      for (let i = 0; i < 30; i++) game.update(1 / 60);
      expect(rng.next()).toBe(new Rng(1234).next());
    }
  });
});

describe('AudioEngine without an audio context', () => {
  it('hands out inert engine handles that can be paused and stopped', () => {
    const audio = new AudioEngine();
    const engine = audio.engine();
    expect(() => {
      engine.set(0.5, 1);
      audio.setPaused(true);
      engine.set(1, 1);
      audio.setPaused(false);
      audio.stopEngines();
      engine.set(1, 1);
      engine.stop();
    }).not.toThrow();
    expect(audio.paused).toBe(false);
  });
});
