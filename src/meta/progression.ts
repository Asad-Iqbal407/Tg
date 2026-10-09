export const MAX_LEVEL = 99;

/** XP required to advance from `level` to `level + 1`. */
export function xpForNext(level: number): number {
  const l = Math.max(1, level) - 1;
  return Math.round((100 + 40 * l + 6 * l * l) / 10) * 10;
}

export interface LevelInfo {
  level: number;
  /** XP earned inside the current level. */
  into: number;
  /** XP needed to complete the current level (0 at max level). */
  needed: number;
  progress: number;
}

export function levelInfo(totalXp: number): LevelInfo {
  let level = 1;
  let rest = Math.max(0, Math.floor(totalXp));
  while (level < MAX_LEVEL && rest >= xpForNext(level)) {
    rest -= xpForNext(level);
    level++;
  }
  if (level >= MAX_LEVEL) return { level: MAX_LEVEL, into: 0, needed: 0, progress: 1 };
  const needed = xpForNext(level);
  return { level, into: rest, needed, progress: rest / needed };
}

export interface LevelReward {
  level: number;
  coins: number;
  gems: number;
}

export function levelUpReward(level: number): LevelReward {
  return { level, coins: 50 + level * 25, gems: level % 5 === 0 ? 5 : 1 };
}
