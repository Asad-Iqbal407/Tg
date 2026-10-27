import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { textRun } from '../src/ui/overlay';
import { boostNames, type HintInputs, pickHint, toastLane } from '../src/ui/play';
import { PILL_ZONE, previewRect } from '../src/ui/previews';
import { countWord } from '../src/ui/screens/home';
import { GAMES } from '../src/games/registry';

const css = readFileSync(new URL('../src/styles/main.css', import.meta.url), 'utf8');

/** The body of the first `@media <query> {` block, up to its matching brace. */
function mediaBlock(query: string): string {
  const start = css.indexOf(`@media ${query} {`);
  expect(start).toBeGreaterThanOrEqual(0);
  let depth = 0;
  for (let i = css.indexOf('{', start); i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}' && --depth === 0) return css.slice(start, i);
  }
  return css.slice(start);
}

describe('rotate hint and fit chip', () => {
  const base: HintInputs = {
    game: true,
    paused: false,
    results: false,
    prompted: false,
    onDeclared: true,
    gateOwnsTurns: true,
    sawTouch: true,
    dismissed: false,
    refitGain: () => 2,
    rotateGain: () => 2,
  };

  it('offers the fit chip on the declared side and the rotate hint otherwise, never both', () => {
    expect(pickHint(base)).toEqual({ turn: false, fit: true });
    expect(pickHint({ ...base, onDeclared: false })).toEqual({ turn: true, fit: false });
    expect(pickHint({ ...base, refitGain: () => 1 })).toEqual({ turn: true, fit: false });
    expect(pickHint({ ...base, refitGain: () => 1, rotateGain: () => 1.2 })).toEqual({
      turn: false,
      fit: false,
    });
  });

  it('shows neither while paused, on the results or under the rotate prompt', () => {
    // Regression: the fit chip stayed up over the results dialog after a run ended.
    for (const k of ['paused', 'results', 'prompted'] as const) {
      expect(pickHint({ ...base, [k]: true })).toEqual({ turn: false, fit: false });
      expect(pickHint({ ...base, [k]: true, onDeclared: false })).toEqual({ turn: false, fit: false });
    }
    expect(pickHint({ ...base, game: false })).toEqual({ turn: false, fit: false });
  });

  it('keeps the rotate hint for touch players who have not dismissed it', () => {
    const turn = { ...base, onDeclared: false };
    expect(pickHint({ ...turn, sawTouch: false }).turn).toBe(false);
    expect(pickHint({ ...turn, dismissed: true }).turn).toBe(false);
  });

  it('is at least 44 CSS px tall (and the side chip 44 px wide) on touch screens', () => {
    const coarse = mediaBlock('(pointer: coarse)');
    expect(coarse).toMatch(/\.rotate-hint \{[^}]*min-height: 44px/);
    expect(coarse).toMatch(/\.rotate-hint--side \{[^}]*min-width: 44px/);
  });
});

describe('in-play toasts', () => {
  it('use the lane between the header buttons', () => {
    // P1 (360 px): pause 12-56, title 66-240, mute 250-294, fullscreen 304-348.
    expect(toastLane({ left: 66, right: 240, width: 174, height: 21 }, 360)).toEqual({
      left: 66,
      right: 120,
    });
    // Without the fullscreen button (iPhone Safari) the lane grows to the right.
    expect(toastLane({ left: 66, right: 294, width: 228, height: 21 }, 360)).toEqual({ left: 66, right: 66 });
  });

  it('fall back to the stylesheet placement when the title is hidden or too narrow', () => {
    expect(toastLane({ left: 0, right: 0, width: 0, height: 0 }, 844)).toBeNull();
    expect(toastLane({ left: 66, right: 150, width: 84, height: 21 }, 360)).toBeNull();
  });

  it('scroll a line that does not fit instead of cutting it off, and stay up long enough to read it', () => {
    // Regression: "Score 5,000 in Block Drop — claim your reward" was cut to "Score 5,000 in Block D…".
    const run = textRun(163, false);
    expect(run).not.toBeNull();
    expect(run!.shift).toBeLessThanOrEqual(-163);
    expect(run!.ms).toBeGreaterThan(2000);
    expect(run!.minShowMs).toBeGreaterThan(run!.ms + 1500);
    expect(textRun(0, false)).toBeNull();
    expect(textRun(0.5, false)).toBeNull();
    expect(textRun(Number.NaN, false)).toBeNull();
    // Reduced motion keeps the ellipsis.
    expect(textRun(163, true)).toBeNull();
  });

  it('read the lane from variables the play screen sets, with a fallback clear of three 44 px buttons', () => {
    const rule = css.slice(css.indexOf('body.is-playing .toasts {'));
    const body = rule.slice(0, rule.indexOf('}'));
    expect(body).toMatch(/left: var\(--play-toast-left, calc\(66px/);
    expect(body).toMatch(/right: var\(--play-toast-right, calc\(126px/);
  });
});

describe('game card art', () => {
  it('shows the whole Bubble Shooter board clear of the genre pill', () => {
    // Regression: the cropped board put its top rows under the pill in the top-left corner.
    const cards: [number, number][] = [
      [480, 270],
      [640, 300],
    ];
    for (const [tw, th] of cards) {
      const r = previewRect(720, 800, tw, th, 'contain');
      expect(r.x).toBeGreaterThanOrEqual(tw * PILL_ZONE - 0.01);
      expect(r.x + r.w).toBeLessThanOrEqual(tw + 0.01);
      expect(r.y).toBeGreaterThanOrEqual(0);
      expect(r.y + r.h).toBeLessThanOrEqual(th + 0.01);
      expect(r.w / r.h).toBeCloseTo(720 / 800, 5);
    }
  });

  it('crops other games to fill the card about their focus', () => {
    const r = previewRect(540, 960, 480, 270, 'cover', 0.75);
    expect(r.w).toBeCloseTo(480, 5);
    expect(r.y).toBeCloseTo((270 - r.h) * 0.75, 5);
    expect(r.h).toBeGreaterThan(270);
  });
});

describe('home copy', () => {
  it('counts the games it offers', () => {
    // Regression: the hero said "Five classic-inspired games" with ten in the grid.
    expect(GAMES.length).toBe(19);
    expect(countWord(GAMES.length)).toBe('19');
    expect(countWord(5)).toBe('Five');
    expect(countWord(20)).toBe('20');
  });
});

describe('boost toast', () => {
  it('names boosts as the shop does', () => {
    // Regression: the toast read "shield · head start" for the boosts the shop sells as Guardian and Power Start.
    expect(boostNames(['coin-doubler', 'shield', 'head-start'])).toBe(
      'Coin Doubler · Guardian · Power Start',
    );
    expect(boostNames([])).toBe('');
  });
});

describe('lobby art', () => {
  it('centres whole-board art when no pill sits in the top-left corner', () => {
    const r = previewRect(720, 800, 640, 300, 'contain', 0.5, 0);
    expect(r.x + r.w / 2).toBeCloseTo(320, 5);
  });
});
