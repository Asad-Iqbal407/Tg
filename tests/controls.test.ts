import { describe, expect, it } from 'vitest';
import { PressBuffer } from '../src/games/drag';
import { dinoGame } from '../src/games/dino';
import { hopperGame } from '../src/games/hopper';
import { knifeGame } from '../src/games/knife';
import { createGame } from './helpers';

const DT = 1 / 60;

describe('PressBuffer', () => {
  it('hands a fresh press back once, and lets an old one lapse', () => {
    const b = new PressBuffer(0.1);
    expect(b.take()).toBeNull();
    b.press();
    b.tick(0.05);
    expect(b.take()).toBe(true);
    expect(b.take()).toBeNull();
    b.press();
    b.tick(0.11);
    expect(b.take()).toBeNull();
  });

  it('keeps only the latest value', () => {
    const b = new PressBuffer<string>(0.2);
    b.press('left');
    b.press('right');
    expect(b.take()).toBe('right');
  });
});

/** A short tap on `action`: down on one step, up on the next. */
function tap(
  game: { update(dt: number): void },
  input: {
    setVirtual(a: 'primary' | 'up' | 'left' | 'right' | 'down', d: boolean): void;
    postUpdate(): void;
  },
  a: 'primary' | 'up' | 'left' | 'right' | 'down',
) {
  input.setVirtual(a, true);
  game.update(DT);
  input.postUpdate();
  input.setVirtual(a, false);
  game.update(DT);
  input.postUpdate();
}

function idle(game: { update(dt: number): void }, input: { postUpdate(): void }, steps: number) {
  for (let i = 0; i < steps; i++) {
    game.update(DT);
    input.postUpdate();
  }
}

describe('early presses are not lost', () => {
  it('Dino: a jump pressed just before landing fires on touchdown', () => {
    const { game, input } = createGame(dinoGame, { seed: 2 });
    const g = game as unknown as { y: number; stats: Record<string, number> };
    tap(game, input, 'primary'); // starts the run and jumps
    // Climb, then wait until the dino is almost back down.
    let steps = 0;
    while (g.y > 0 || steps < 3) {
      game.update(DT);
      input.postUpdate();
      steps++;
      if (g.y > 0 && g.y < 60 && steps > 10) break;
      if (steps > 300) throw new Error('never came down');
    }
    const jumpsBefore = game.getResult().stats['jumps'] ?? 0;
    tap(game, input, 'primary'); // pressed in the air, a few steps from the ground
    idle(game, input, 20);
    expect(game.getResult().stats['jumps'] ?? 0).toBe(jumpsBefore + 1);
  });

  it('Dino: a press made long before landing is forgotten', () => {
    const { game, input } = createGame(dinoGame, { seed: 2 });
    tap(game, input, 'primary');
    idle(game, input, 3);
    const before = game.getResult().stats['jumps'] ?? 0;
    tap(game, input, 'primary'); // right after take-off, far from landing
    idle(game, input, 12);
    // The press expired; the dino lands on its own and does not jump again at once.
    expect(game.getResult().stats['jumps'] ?? 0).toBe(before);
  });

  it('Road Hopper: a hop asked for mid-hop goes as soon as the hen lands', () => {
    const { game, input } = createGame(hopperGame, { seed: 4 });
    const g = game as unknown as { row: number };
    tap(game, input, 'up');
    const afterFirst = g.row;
    expect(afterFirst).toBe(1);
    tap(game, input, 'up'); // still mid-hop
    idle(game, input, 12);
    expect(g.row).toBe(2);
  });

  it('Knife Hit: a tap while a knife is flying throws the next one', () => {
    const { game, input } = createGame(knifeGame, { seed: 3 });
    const g = game as unknown as { flying: unknown; left: number };
    const start = g.left;
    tap(game, input, 'primary');
    expect(g.flying).not.toBeNull();
    tap(game, input, 'primary');
    idle(game, input, 60);
    // Two knives went out (or the log was hit); either way the second tap was not dropped.
    expect(start - g.left + (game.isOver() ? 1 : 0)).toBeGreaterThanOrEqual(2);
  });
});
