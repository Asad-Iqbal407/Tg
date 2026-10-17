import { describe, expect, it } from 'vitest';
import { declaresOrientation, isTouchPhone, needsRotation, orientationOf } from '../src/ui/orientation';

describe('orientationOf', () => {
  it('is landscape only when wider than tall', () => {
    expect(orientationOf(844, 390)).toBe('landscape');
    expect(orientationOf(390, 844)).toBe('portrait');
    expect(orientationOf(500, 500)).toBe('portrait');
  });
});

describe('isTouchPhone', () => {
  it('needs a coarse pointer and a short side under 600 CSS px', () => {
    expect(isTouchPhone(true, 390, 844)).toBe(true);
    expect(isTouchPhone(true, 844, 390)).toBe(true);
    expect(isTouchPhone(true, 599, 1000)).toBe(true);
    expect(isTouchPhone(true, 600, 1000)).toBe(false);
  });

  it('is false for tablets and for fine pointers at phone sizes', () => {
    expect(isTouchPhone(true, 768, 1024)).toBe(false);
    expect(isTouchPhone(true, 1024, 768)).toBe(false);
    expect(isTouchPhone(false, 390, 844)).toBe(false);
  });
});

describe('declaresOrientation', () => {
  it('is true only for a concrete orientation', () => {
    expect(declaresOrientation('landscape')).toBe(true);
    expect(declaresOrientation('portrait')).toBe(true);
    expect(declaresOrientation('any')).toBe(false);
    expect(declaresOrientation(undefined)).toBe(false);
  });
});

describe('needsRotation', () => {
  it('asks a touch phone held the other way to rotate', () => {
    expect(needsRotation('portrait', true, 844, 390)).toBe(true);
    expect(needsRotation('landscape', true, 390, 844)).toBe(true);
  });

  it('does not ask when the phone already matches the game', () => {
    expect(needsRotation('portrait', true, 390, 844)).toBe(false);
    expect(needsRotation('landscape', true, 844, 390)).toBe(false);
  });

  it('never asks for games with no declared orientation or with "any"', () => {
    expect(needsRotation(undefined, true, 390, 844)).toBe(false);
    expect(needsRotation(undefined, true, 844, 390)).toBe(false);
    expect(needsRotation('any', true, 390, 844)).toBe(false);
    expect(needsRotation('any', true, 844, 390)).toBe(false);
  });

  it('never asks on desktop, tablets or fine pointers', () => {
    expect(needsRotation('portrait', false, 844, 390)).toBe(false);
    expect(needsRotation('landscape', true, 768, 1024)).toBe(false);
    expect(needsRotation('landscape', true, 1024, 768)).toBe(false);
    expect(needsRotation('landscape', false, 1280, 800)).toBe(false);
  });

  it('is waived in the wrong orientation the player chose "Play anyway" in', () => {
    expect(needsRotation('portrait', true, 844, 390, 'landscape')).toBe(false);
    // The waiver names one orientation: holding the phone the other way from it asks again.
    expect(needsRotation('landscape', true, 390, 844, 'landscape')).toBe(true);
    expect(needsRotation('landscape', true, 390, 844, 'portrait')).toBe(false);
  });
});
