import { describe, expect, it } from 'vitest';
import { Input } from '../src/core/input';
import { clamp, formatCompact, rectsOverlap, wrapAngle } from '../src/core/math';
import { hashString, Rng } from '../src/core/rng';

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
