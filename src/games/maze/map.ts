/**
 * The maze, 15 x 17. '#' wall, '.' dot, 'o' power pellet, ' ' open floor, '-' the ghost-house door (ghosts only),
 * 'G' inside the ghost house, 'P' the player's start. The row with open ends is a tunnel that wraps round.
 */
export const MAP: readonly string[] = [
  '###############',
  '#......#......#',
  '#o##.#.#.#.##o#',
  '#.............#',
  '#.##.##.##.##.#',
  '#.............#',
  '####.##-##.####',
  '####.##-##.####',
  '    .#GGG#.    ',
  '####.#####.####',
  '#......#......#',
  '#.##.#.#.#.##.#',
  '#o.#.......#.o#',
  '##.#.##.##.#.##',
  '#....#.P.#....#',
  '#.............#',
  '###############',
];

export const COLS = 15;
export const ROWS = 17;

export type Dir = 'up' | 'down' | 'left' | 'right';
export const DIRS: readonly Dir[] = ['up', 'left', 'down', 'right'];
export const STEP: Readonly<Record<Dir, readonly [number, number]>> = {
  up: [0, -1],
  down: [0, 1],
  left: [-1, 0],
  right: [1, 0],
};
export const OPPOSITE: Readonly<Record<Dir, Dir>> = { up: 'down', down: 'up', left: 'right', right: 'left' };

export function cellAt(c: number, r: number): string {
  return MAP[r]?.[((c % COLS) + COLS) % COLS] ?? '#';
}

/** Whether the player (or, with `ghost`, a ghost) can stand on cell (c, r). Columns wrap for the tunnel. */
export function open(c: number, r: number, ghost = false): boolean {
  const k = cellAt(c, r);
  if (k === '#') return false;
  if (k === '-' || k === 'G') return ghost;
  return true;
}

export function find(ch: string): [number, number] {
  for (let r = 0; r < ROWS; r++) {
    const c = (MAP[r] ?? '').indexOf(ch);
    if (c >= 0) return [c, r];
  }
  return [0, 0];
}
