import { describe, expect, it } from 'vitest';
import { chooseLogicalSize, fittedArea } from '../src/core/engine';
import type { Input } from '../src/core/input';
import { pongGame } from '../src/games/pong';
import { BALL_R, DESIGN_H, headHeight, paddleHalf, type Table, tableFor } from '../src/games/pong/geometry';
import { type BoostId, type GameInstance, NO_INSETS, type SkinData } from '../src/games/types';
import { cornerSizes, createGame } from './helpers';

const DT = 1 / 60;
const MAX_ANGLE = Math.PI / 3;
const SKIN: SkinData = { id: 'pong-test', palette: {}, params: {} };

/** The private state the tests need to set up scenarios and read results. */
interface Internals {
  readonly H: number;
  ball: { x: number; y: number; vx: number; vy: number; speed: number };
  playerY: number;
  rival: { y: number };
  playerPts: number;
  rivalPts: number;
  shieldUsed: boolean;
  server: 'player' | 'computer';
  serving: boolean;
  shots: number;
  readonly isEnding: boolean;
  table(): Table;
  contact(side: 'player' | 'computer', x: number): void;
  scorePoint(side: 'player' | 'computer'): void;
}

function peek(game: GameInstance): Internals {
  return game as unknown as Internals;
}

/** A fresh match, with the first serve still to come. */
function fresh(seed = 1, boosts: BoostId[] = [], width?: number, height?: number, insets = NO_INSETS) {
  return createGame(pongGame, { seed, skin: SKIN, boosts, width, height, insets });
}

/** One fixed simulation step, as the shell runs it. */
function step(game: GameInstance, input: Input, n = 1): void {
  for (let i = 0; i < n; i++) {
    game.update(DT);
    input.postUpdate();
  }
}

/**
 * Scores a point for `side` the way play does: the ball leaves the table on that side during one step. The
 * ball is put in play first, so the serve delay does not get in the way.
 */
function score(game: GameInstance, side: 'player' | 'computer'): void {
  const g = peek(game);
  const t = g.table();
  const r = BALL_R * (g.H / DESIGN_H);
  g.serving = false;
  g.ball.y = (t.top + t.bottom) / 2;
  g.ball.vy = 0;
  if (side === 'player') {
    g.ball.x = t.right + r + 1;
    g.ball.vx = 1;
  } else {
    g.ball.x = t.left - r - 1;
    g.ball.vx = -1;
  }
  game.update(DT);
}

/** Runs until the next serve launches, and returns the ball's direction (+1 toward the computer). */
function waitForServe(game: GameInstance): number {
  const g = peek(game);
  let guard = 0;
  while (g.serving && guard++ < 600) game.update(DT);
  return Math.sign(g.ball.vx);
}

/**
 * A player who follows the ball's height, the way a simple script would: it reads the ball as it was `delaySec`
 * ago, and holds the up or down key until its paddle is within a few px of that height. It steps each frame.
 */
function trackerStep(game: GameInstance, input: Input, history: number[], delayFrames: number): void {
  const g = peek(game);
  const t = g.table();
  history.push(g.ball.y);
  const seen = history[Math.max(0, history.length - 1 - delayFrames)] ?? g.ball.y;
  const mid = (t.top + t.bottom) / 2;
  const want = !g.serving && g.ball.vx < 0 ? seen : mid;
  input.setVirtual('up', want < g.playerY - 3, 'script');
  input.setVirtual('down', want > g.playerY + 3, 'script');
}

/** Plays one whole match with the tracking script. Returns the final counts and the frames it took. */
function trackedMatch(seed: number, delaySec: number, maxSec = 900) {
  const { game, input } = fresh(seed, [], undefined, undefined, NO_INSETS);
  const g = peek(game);
  const delayFrames = Math.round(delaySec * 60);
  const history: number[] = [];
  let frames = 0;
  while (!game.isOver() && frames < maxSec * 60) {
    trackerStep(game, input, history, delayFrames);
    step(game, input);
    frames++;
  }
  return { game, playerPts: g.playerPts, rivalPts: g.rivalPts, over: game.isOver(), frames };
}

describe('Ping Pong definition', () => {
  it('is a landscape stage game with the agreed controls and touch buttons', () => {
    expect(pongGame.id).toBe('pong');
    expect(pongGame.orientation).toBe('landscape');
    expect(pongGame.pointerArea).toBe('stage');
    expect(pongGame.viewport).toEqual({ minWidth: 800, maxWidth: 1200, minHeight: 480, maxHeight: 640 });
    expect(pongGame.touchButtons.map((b) => [b.action, b.label, b.side])).toEqual([
      ['up', 'UP', 'left'],
      ['down', 'DOWN', 'right'],
    ]);
  });

  it('emits exactly the stat keys it labels', () => {
    const { game, input } = fresh(7);
    for (let i = 0; i < 60 * 40; i++) step(game, input);
    expect(Object.keys(game.getResult().stats).sort()).toEqual(Object.keys(pongGame.statLabels).sort());
  });
});

describe('Ping Pong rules', () => {
  it('scores 100 per point the player wins, and nothing for the computer', () => {
    const { game } = fresh();
    const g = peek(game);
    score(game, 'player');
    score(game, 'player');
    score(game, 'computer');
    const r = game.getResult();
    expect(g.playerPts).toBe(2);
    expect(g.rivalPts).toBe(1);
    expect(r.score).toBe(200);
    expect(r.stats.points).toBe(2);
    expect(r.stats.rallies).toBe(3);
  });

  it('adds 50 for a rally longer than ten shots, whichever side wins it', () => {
    const { game } = fresh();
    const g = peek(game);
    g.shots = 11;
    score(game, 'computer');
    expect(game.getResult().score).toBe(50);
    g.shots = 11;
    score(game, 'player');
    expect(game.getResult().score).toBe(50 + 150);
    expect(game.getResult().stats.longestRally).toBe(11);
  });

  it('counts an ace only when the player serves and the computer never returns it', () => {
    const { game } = fresh();
    const g = peek(game);
    g.server = 'player';
    g.shots = 1;
    score(game, 'player');
    expect(game.getResult().stats.aces).toBe(1);
    g.server = 'player';
    g.shots = 4;
    score(game, 'player');
    expect(game.getResult().stats.aces).toBe(1);
    g.server = 'computer';
    g.shots = 1;
    score(game, 'computer');
    expect(game.getResult().stats.aces).toBe(1);
  });

  it('is not over at 10 to 10, and ends on 12 to 10 by two', () => {
    const { game } = fresh();
    const g = peek(game);
    g.playerPts = 10;
    g.rivalPts = 10;
    score(game, 'player');
    expect([g.playerPts, g.rivalPts]).toEqual([11, 10]);
    expect(g.isEnding).toBe(false);
    expect(game.getResult().stats.wins ?? 0).toBe(0);
    score(game, 'player');
    expect([g.playerPts, g.rivalPts]).toEqual([12, 10]);
    expect(g.isEnding).toBe(true);
    expect(game.getResult().stats.wins).toBe(1);
  });

  it('ends on 11 to 9 for the player, and for the computer when it leads by two', () => {
    const won = fresh();
    const w = peek(won.game);
    w.playerPts = 10;
    w.rivalPts = 9;
    score(won.game, 'player');
    expect(w.isEnding).toBe(true);
    expect(won.game.getResult().stats.wins).toBe(1);

    const lost = fresh();
    const l = peek(lost.game);
    l.playerPts = 9;
    l.rivalPts = 10;
    score(lost.game, 'computer');
    expect([l.playerPts, l.rivalPts]).toEqual([9, 11]);
    expect(l.isEnding).toBe(true);
    expect(lost.game.getResult().stats.wins ?? 0).toBe(0);
  });

  it('alternates serves between the two sides, each from the centre', () => {
    const { game } = fresh();
    const g = peek(game);
    const dirs: number[] = [];
    for (let i = 0; i < 4; i++) {
      const t = g.table();
      expect(g.serving).toBe(true);
      expect(g.ball.x).toBeCloseTo((t.left + t.right) / 2, 6);
      expect(g.ball.y).toBeCloseTo((t.top + t.bottom) / 2, 6);
      dirs.push(waitForServe(game));
      score(game, g.server === 'player' ? 'computer' : 'player');
    }
    expect(dirs).toEqual([1, -1, 1, -1]);
  });

  it('bends the return by where the ball meets the paddle: centre straight, edge steep', () => {
    for (const offset of [-1, -0.5, 0, 0.5, 1]) {
      const { game, input } = fresh();
      const g = peek(game);
      const t = g.table();
      const u = g.H / DESIGN_H;
      const half = paddleHalf(t);
      const mid = (t.top + t.bottom) / 2;
      g.serving = false;
      g.playerY = mid;
      g.ball.x = t.left + (22 + 12) * u + BALL_R * u + 2;
      g.ball.y = mid + offset * half;
      g.ball.vx = -400;
      g.ball.vy = 0;
      g.ball.speed = 400;
      step(game, input);
      expect(g.ball.vx).toBeGreaterThan(0);
      expect(Math.atan2(g.ball.vy, g.ball.vx)).toBeCloseTo(offset * MAX_ANGLE, 2);
    }
  });

  it('speeds the ball up on each hit, up to the cap', () => {
    const { game } = fresh();
    const g = peek(game);
    const u = g.H / DESIGN_H;
    g.ball.y = (g.table().top + g.table().bottom) / 2;
    const before = g.ball.speed;
    g.contact('player', g.table().left + 100);
    expect(g.ball.speed).toBeGreaterThan(before);
    for (let i = 0; i < 200; i++) g.contact('computer', g.table().right - 100);
    expect(g.ball.speed).toBeCloseTo(780 * u, 6);
  });

  it('bounces off the top and bottom walls without losing speed', () => {
    const { game, input } = fresh();
    const g = peek(game);
    const t = g.table();
    const u = g.H / DESIGN_H;
    const r = BALL_R * u;
    g.serving = false;
    g.ball.x = (t.left + t.right) / 2;
    g.ball.y = t.top + r + 1;
    g.ball.vx = 200;
    g.ball.vy = -300;
    const speed = Math.hypot(g.ball.vx, g.ball.vy);
    step(game, input);
    expect(g.ball.vy).toBeGreaterThan(0);
    expect(g.ball.y).toBeGreaterThanOrEqual(t.top + r - 1e-9);
    expect(Math.hypot(g.ball.vx, g.ball.vy)).toBeCloseTo(speed, 6);
  });
});

describe('Ping Pong boosts', () => {
  it('shield: the first point the player loses is not counted, later ones are', () => {
    const shielded = fresh(1, ['shield']);
    score(shielded.game, 'computer');
    expect(peek(shielded.game).rivalPts).toBe(0);
    expect(peek(shielded.game).shieldUsed).toBe(true);
    score(shielded.game, 'computer');
    expect(peek(shielded.game).rivalPts).toBe(1);

    const plain = fresh(1);
    score(plain.game, 'computer');
    expect(peek(plain.game).rivalPts).toBe(1);
  });

  it('head start: the player begins two points up and needs nine more to win', () => {
    const boosted = fresh(1, ['head-start']);
    const b = peek(boosted.game);
    expect(b.playerPts).toBe(2);
    expect(boosted.game.getResult().score).toBe(0);
    for (let i = 0; i < 8; i++) score(boosted.game, 'player');
    expect(b.isEnding).toBe(false);
    score(boosted.game, 'player');
    expect(b.isEnding).toBe(true);
    expect(boosted.game.getResult().stats.wins).toBe(1);

    const plain = fresh(1);
    const p = peek(plain.game);
    for (let i = 0; i < 9; i++) score(plain.game, 'player');
    expect(p.playerPts).toBe(9);
    expect(p.isEnding).toBe(false);
  });
});

describe('Ping Pong controls', () => {
  it('moves the player paddle with the keys', () => {
    const { game, input } = fresh();
    const g = peek(game);
    const start = g.playerY;
    input.setVirtual('down', true, 'test');
    step(game, input, 30);
    input.setVirtual('down', false, 'test');
    const u = g.H / DESIGN_H;
    expect(g.playerY - start).toBeGreaterThan(200 * u);
  });

  it('follows a press and drag on the stage to the pointer height', () => {
    const { game, input } = fresh();
    const g = peek(game);
    const t = g.table();
    const target = t.top + (t.bottom - t.top) * 0.25;
    input.pointer.down = true;
    input.pointer.y = target;
    step(game, input, 90);
    expect(g.playerY).toBeCloseTo(target, 1);
    input.pointer.down = false;
  });

  it('keeps the paddles inside the table', () => {
    const { game, input } = fresh();
    const g = peek(game);
    const t = g.table();
    const half = paddleHalf(t);
    input.setVirtual('up', true, 'test');
    step(game, input, 300);
    expect(g.playerY).toBeCloseTo(t.top + half, 6);
    input.setVirtual('up', false, 'test');
    input.setVirtual('down', true, 'test');
    step(game, input, 300);
    expect(g.playerY).toBeCloseTo(t.bottom - half, 6);
    input.setVirtual('down', false, 'test');
  });
});

describe('Ping Pong computer', () => {
  it('replays the same match for the same seed and the same inputs', () => {
    const trace = (seed: number) => {
      const { game, input } = fresh(seed);
      const g = peek(game);
      const history: number[] = [];
      const out: number[] = [];
      for (let i = 0; i < 60 * 120; i++) {
        trackerStep(game, input, history, 12);
        step(game, input);
        out.push(g.ball.x, g.ball.y, g.playerPts, g.rivalPts);
      }
      return { out, result: game.getResult() };
    };
    const a = trace(11);
    const b = trace(11);
    expect(b.out).toEqual(a.out);
    expect(b.result).toEqual(a.result);
    expect(trace(12).out).not.toEqual(a.out);
  });

  it('moves no faster than its top speed, which is below the player keyboard speed', () => {
    const { game, input } = fresh(3);
    const g = peek(game);
    const u = g.H / DESIGN_H;
    const history: number[] = [];
    let fastest = 0;
    let last = g.rival.y;
    for (let i = 0; i < 60 * 60; i++) {
      trackerStep(game, input, history, 12);
      step(game, input);
      fastest = Math.max(fastest, Math.abs(g.rival.y - last) / DT);
      last = g.rival.y;
    }
    expect(fastest).toBeLessThanOrEqual(470 * u + 1e-6);
  });

  it('loses a meaningful share of points to a player who tracks the ball', () => {
    let playerPts = 0;
    let rivalPts = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const m = trackedMatch(seed, 0.2);
      expect(m.over, `seed ${seed} finishes`).toBe(true);
      playerPts += m.playerPts;
      rivalPts += m.rivalPts;
    }
    const share = playerPts / (playerPts + rivalPts);
    expect(share).toBeGreaterThanOrEqual(0.4);
    expect(share).toBeLessThanOrEqual(0.85);
  });

  it('ends the match when the player stops playing', () => {
    const { game, input } = fresh(5);
    for (let i = 0; i < 60 * 900 && !game.isOver(); i++) step(game, input);
    expect(game.isOver()).toBe(true);
  });
});

describe('Ping Pong rendering and layout', () => {
  const corners = cornerSizes(pongGame);
  const touchInsets = { top: 0, right: 0, bottom: 110, left: 0 };

  const sizes: [string, number, number][] = [
    ['design', pongGame.width, pongGame.height],
    ...corners.map((c): [string, number, number] => [`${c.width}x${c.height}`, c.width, c.height]),
  ];
  it.each(sizes)('renders at %s without throwing, with boosts and touch insets', (_label, width, height) => {
    const { game, input } = fresh(9, ['shield', 'head-start'], width, height, touchInsets);
    const g = peek(game);
    for (let i = 0; i < 60 * 20; i++) {
      if (i % 90 === 0) input.setVirtual('up', i % 180 === 0, 'test');
      game.update(DT);
      input.postUpdate();
      game.render();
    }
    expect(Number.isFinite(g.ball.x)).toBe(true);
    expect(Number.isFinite(g.playerY)).toBe(true);
  });

  it('keeps the score band above the table, so the centre line never reaches it', () => {
    for (const [W, H] of [
      [800, 480],
      [960, 600],
      [1200, 640],
    ] as const) {
      const t = tableFor(W, H, NO_INSETS);
      expect(t.top).toBeGreaterThanOrEqual(headHeight(H));
      expect(t.left).toBe(0);
      expect(t.right).toBe(W);
    }
  });

  const LANDSCAPE_PHONES: [string, number, number][] = [
    ['L1', 740, 360],
    ['L2', 844, 390],
    ['L3', 932, 430],
  ];

  it('fills the landscape phone stages', () => {
    for (const [name, w, h] of LANDSCAPE_PHONES) {
      const size = chooseLogicalSize(pongGame, w, h);
      const fill = fittedArea(size, w, h) / (w * h);
      expect(fill, name).toBeGreaterThanOrEqual(0.85);
    }
  });

  it('keeps every paddle at least 44 CSS px tall on L2, above the touch buttons', () => {
    const w = 844;
    const h = 390;
    const size = chooseLogicalSize(pongGame, w, h);
    const scale = Math.min(w / size.width, h / size.height);
    // Touch buttons sit 8 px above the bottom edge, are 62 px tall and keep a 6 px margin.
    const bottom = Math.ceil(76 * (size.height / h));
    const t = tableFor(size.width, size.height, { top: 0, right: 0, bottom, left: 0 });
    expect(paddleHalf(t) * 2 * scale).toBeGreaterThanOrEqual(44);
  });
});
