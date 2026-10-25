/** Brick layouts, ten columns wide. '.' is empty, '1' to '3' are bricks with that many hits, '#' is steel. */
export const COLS = 10;

export const LAYOUTS: readonly (readonly string[])[] = [
  ['..........', '1111111111', '1111111111', '2222222222', '1111111111', '1111111111'],
  ['....22....', '...2112...', '..211112..', '.21111112.', '2111111112', '3333333333'],
  ['3.3.3.3.3.', '.2.2.2.2.2', '1111111111', '#..####..#', '2222222222', '1111111111'],
  ['....33....', '...2222...', '..111111..', '.22222222.', '..111111..', '...2222...', '....33....'],
  ['2222222222', '#1111111#.', '3333333333', '.#1111111#', '2222222222', '1111111111', '3..3..3..3'],
];

export interface Brick {
  col: number;
  row: number;
  hp: number;
  maxHp: number;
  steel: boolean;
}

/**
 * The bricks for a level (1-based). Levels cycle through the layouts, and every full cycle adds one hit to each
 * brick (up to three), so later loops take longer to clear.
 */
export function buildLevel(level: number): Brick[] {
  const idx = (level - 1) % LAYOUTS.length;
  const loop = Math.floor((level - 1) / LAYOUTS.length);
  const layout = LAYOUTS[idx] ?? LAYOUTS[0] ?? [];
  const bricks: Brick[] = [];
  layout.forEach((line, row) => {
    for (let col = 0; col < COLS; col++) {
      const ch = line[col] ?? '.';
      if (ch === '.') continue;
      if (ch === '#') {
        bricks.push({ col, row, hp: 1, maxHp: 1, steel: true });
        continue;
      }
      const hp = Math.min(3, Number(ch) + loop);
      bricks.push({ col, row, hp, maxHp: hp, steel: false });
    }
  });
  return bricks;
}

/** True when every brick that can break is gone (steel bricks never count). */
export function isCleared(bricks: readonly Brick[]): boolean {
  return bricks.every((b) => b.steel);
}

/**
 * Bounce direction for a ball of radius r at (x, y) moving (vx, vy) that overlaps the rectangle. Returns which
 * velocity component to flip: the axis of the shallower overlap, so a ball hitting a side bounces sideways.
 */
export function bounceAxis(
  x: number,
  y: number,
  r: number,
  rx: number,
  ry: number,
  rw: number,
  rh: number,
): 'x' | 'y' {
  const overlapX = Math.min(x + r - rx, rx + rw - (x - r));
  const overlapY = Math.min(y + r - ry, ry + rh - (y - r));
  return overlapX < overlapY ? 'x' : 'y';
}

/** True when a circle overlaps an axis-aligned rectangle. */
export function circleHitsRect(
  x: number,
  y: number,
  r: number,
  rx: number,
  ry: number,
  rw: number,
  rh: number,
): boolean {
  const cx = Math.max(rx, Math.min(x, rx + rw));
  const cy = Math.max(ry, Math.min(y, ry + rh));
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy < r * r;
}
