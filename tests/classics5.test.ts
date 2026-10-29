import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { knifeGame } from '../src/games/knife';
import { hitsKnife, KNIFE_GAP, knivesFor, spinFor } from '../src/games/knife/knife';
import { simonGame } from '../src/games/simon';
import { flashFor, padAt } from '../src/games/simon/simon';
import { sudokuGame } from '../src/games/sudoku';
import {
  allowed,
  countSolutions,
  givensFor,
  type Grid,
  makePuzzle,
  sees,
  solvedGrid,
} from '../src/games/sudoku/puzzle';
import type { GameInstance } from '../src/games/types';
import { createGame } from './helpers';

const DT = 1 / 60;

function run(game: GameInstance, seconds: number): void {
  for (let i = 0; i < seconds * 60 && !game.isOver(); i++) game.update(DT);
}

describe('Knife Hit', () => {
  it('collides only with a knife closer than the gap', () => {
    expect(hitsKnife([0], KNIFE_GAP * 0.5)).toBe(true);
    expect(hitsKnife([0], KNIFE_GAP * 1.5)).toBe(false);
    // Angles wrap round the log.
    expect(hitsKnife([Math.PI - 0.05], -Math.PI + 0.05)).toBe(true);
  });

  it('asks for more knives and more spin on later stages, most on a boss', () => {
    expect(knivesFor(4)).toBeGreaterThan(knivesFor(1));
    expect(knivesFor(5)).toBeGreaterThan(knivesFor(4));
    expect(spinFor(8)).toBeGreaterThan(spinFor(1));
  });

  interface Peek {
    stuck: number[];
    apples: number[];
    left: number;
    stage: number;
    rot: number;
    flying: { y: number } | null;
    impactAngle(): number;
  }

  /** Throws one knife and lets it land. */
  function throwKnife(game: GameInstance): void {
    const g = game as unknown as Peek & { restY(): number };
    g.flying = { y: g.restY() };
    for (let i = 0; i < 30 && g.flying; i++) game.update(DT);
  }

  it('sticks knives, clears the stage when they are all thrown, and pays for apples', () => {
    const { game } = createGame(knifeGame, { seed: 2 });
    const g = game as unknown as Peek;
    g.stuck = [];
    g.apples = [];
    const total = g.left;
    for (let i = 0; i < total; i++) {
      // Clear the log before each throw so every knife lands; put an apple where the first one lands.
      g.stuck = [];
      if (i === 0) g.apples = [g.impactAngle()];
      throwKnife(game);
    }
    run(game, 2);
    const r = game.getResult();
    expect(r.stats.knives).toBe(total);
    expect(r.stats.stages).toBe(1);
    expect(r.stats.apples).toBe(1);
    expect(g.stage).toBe(2);
  });

  it('a knife that hits another ends the run, unless the shield gives it back', () => {
    for (const shield of [false, true]) {
      const { game } = createGame(knifeGame, { seed: 3, boosts: shield ? ['shield'] : [] });
      const g = game as unknown as Peek;
      // A knife already sits where the next one will land, whatever the spin does in the meantime.
      g.stuck = Array.from({ length: 40 }, (_, i) => (i / 40) * Math.PI * 2);
      const before = g.left;
      throwKnife(game);
      run(game, 2);
      expect(game.isOver()).toBe(!shield);
      if (shield) expect(g.left).toBe(before);
    }
  });
});

describe('Sudoku puzzles', () => {
  function valid(g: Grid): boolean {
    return g.every((d, i) => d >= 1 && d <= 9 && g.every((e, j) => !sees(i, j) || e !== d));
  }

  it('builds complete, valid grids', () => {
    for (const seed of [1, 2, 3]) expect(valid(solvedGrid(new Rng(seed)))).toBe(true);
  });

  it('makes puzzles with one solution that match their solution', () => {
    for (const seed of [4, 5]) {
      const { puzzle, solution } = makePuzzle(new Rng(seed), 30);
      expect(countSolutions([...puzzle], 2)).toBe(1);
      puzzle.forEach((d, i) => {
        if (d) expect(d).toBe(solution[i]);
      });
      expect(puzzle.filter(Boolean).length).toBeLessThanOrEqual(40);
    }
  });

  it('knows where a digit is allowed', () => {
    const g = Array<number>(81).fill(0);
    g[0] = 5;
    expect(allowed(g, 8, 5)).toBe(false); // same row
    expect(allowed(g, 72, 5)).toBe(false); // same column
    expect(allowed(g, 20, 5)).toBe(false); // same box
    expect(allowed(g, 40, 5)).toBe(true);
  });

  it('gives fewer numbers on later puzzles', () => {
    expect(givensFor(3)).toBeLessThan(givensFor(1));
    expect(givensFor(50)).toBe(26);
  });
});

describe('Sudoku game', () => {
  interface Peek {
    cells: Grid;
    solution: Grid;
    given: boolean[];
    selected: number;
    notes: number[];
    notesMode: boolean;
    mistakes: number;
    puzzleNum: number;
    enter(d: number): void;
  }

  const empty = (g: Peek) => g.cells.findIndex((v) => v === 0);

  it('writes a right number, counts a wrong one as a mistake, and ends after three', () => {
    const { game } = createGame(sudokuGame, { seed: 1 });
    const g = game as unknown as Peek;
    g.selected = empty(g);
    g.enter(g.solution[g.selected] as number);
    expect(g.cells[g.selected]).not.toBe(0);
    g.selected = empty(g);
    const wrong = ((g.solution[g.selected] as number) % 9) + 1;
    for (let k = 0; k < 3; k++) g.enter(wrong);
    expect(g.cells[g.selected]).toBe(0);
    expect(g.mistakes).toBe(3);
    run(game, 2);
    expect(game.isOver()).toBe(true);
  });

  it('pencils notes, and clears them where a placed number rules them out', () => {
    const { game } = createGame(sudokuGame, { seed: 2 });
    const g = game as unknown as Peek;
    const a = empty(g);
    const d = g.solution[a] as number;
    const b = g.cells.findIndex((v, i) => v === 0 && i !== a && sees(i, a));
    g.notesMode = true;
    g.selected = b;
    g.enter(d);
    expect(g.notes[b]! & (1 << d)).toBeTruthy();
    g.notesMode = false;
    g.selected = a;
    g.enter(d);
    expect(g.notes[b]! & (1 << d)).toBeFalsy();
  });

  it('solving the grid deals the next puzzle', () => {
    const { game } = createGame(sudokuGame, { seed: 3 });
    const g = game as unknown as Peek;
    for (let i = 0; i < 81; i++) {
      if (g.cells[i]) continue;
      g.selected = i;
      g.enter(g.solution[i] as number);
    }
    run(game, 2.5);
    expect(g.puzzleNum).toBe(2);
    expect(game.getResult().stats.puzzles).toBe(1);
    expect(game.getResult().coins).toBe(2);
  });

  it('allows one more mistake with the shield', () => {
    const g = createGame(sudokuGame, { seed: 1, boosts: ['shield'] }).game as unknown as {
      allowedMistakes: number;
    };
    expect(g.allowedMistakes).toBe(4);
  });
});

describe('Simon Says', () => {
  it('finds the pad under a point', () => {
    expect(padAt(0, -100, 30, 150)).toBe(0);
    expect(padAt(100, 0, 30, 150)).toBe(1);
    expect(padAt(0, 100, 30, 150)).toBe(2);
    expect(padAt(-100, 0, 30, 150)).toBe(3);
    expect(padAt(0, -10, 30, 150)).toBeNull();
    expect(padAt(0, -200, 30, 150)).toBeNull();
  });

  it('plays faster as the sequence grows', () => {
    expect(flashFor(12)).toBeLessThan(flashFor(1));
    expect(flashFor(100)).toBe(0.22);
  });

  interface Peek {
    seq: number[];
    phase: string;
    step: number;
    press(pad: number): void;
  }

  function untilInput(game: GameInstance): void {
    const g = game as unknown as Peek;
    for (let i = 0; i < 60 * 20 && g.phase !== 'input' && !game.isOver(); i++) game.update(DT);
  }

  it('grows the sequence after a correct repeat', () => {
    const { game } = createGame(simonGame, { seed: 1 });
    const g = game as unknown as Peek;
    for (let round = 1; round <= 3; round++) {
      untilInput(game);
      for (const pad of [...g.seq]) g.press(pad);
      expect(g.seq).toHaveLength(round + 1);
    }
    expect(game.getResult().stats.rounds).toBe(3);
  });

  it('a wrong pad ends the run, unless the shield replays the sequence', () => {
    for (const shield of [false, true]) {
      const { game } = createGame(simonGame, { seed: 2, boosts: shield ? ['shield'] : [] });
      const g = game as unknown as Peek;
      untilInput(game);
      g.press(((g.seq[0] as number) + 1) % 4);
      run(game, 2);
      expect(game.isOver()).toBe(!shield);
    }
  });

  it('waiting too long counts as a miss', () => {
    const { game } = createGame(simonGame, { seed: 3 });
    untilInput(game);
    run(game, 8);
    expect(game.isOver()).toBe(true);
  });
});
