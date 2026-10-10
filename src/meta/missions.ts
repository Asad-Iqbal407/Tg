import { hashString, Rng } from '../core/rng';
import type { GameId } from '../games/types';
import type { MissionKind, MissionState } from './profile';

export interface MissionTemplate {
  id: string;
  gameId: GameId | null;
  kind: MissionKind;
  stat: string;
  targets: readonly [number, number, number];
  label: (n: number) => string;
}

const fmt = (n: number) => n.toLocaleString('en-US');

export const MISSION_TEMPLATES: readonly MissionTemplate[] = [
  {
    id: 'play-any',
    gameId: null,
    kind: 'plays',
    stat: '',
    targets: [2, 4, 6],
    label: (n) => `Play ${n} games`,
  },
  {
    id: 'coins-any',
    gameId: null,
    kind: 'total',
    stat: 'coins',
    targets: [40, 120, 250],
    label: (n) => `Collect ${fmt(n)} coins in any game`,
  },
  {
    id: 'runner-distance',
    gameId: 'runner',
    kind: 'total',
    stat: 'distance',
    targets: [800, 2000, 4000],
    label: (n) => `Run ${fmt(n)} m in Metro Dash`,
  },
  {
    id: 'runner-best',
    gameId: 'runner',
    kind: 'best',
    stat: 'distance',
    targets: [400, 900, 1600],
    label: (n) => `Run ${fmt(n)} m in one Metro Dash run`,
  },
  {
    id: 'runner-jumps',
    gameId: 'runner',
    kind: 'total',
    stat: 'jumps',
    targets: [20, 50, 100],
    label: (n) => `Jump ${n} times in Metro Dash`,
  },
  {
    id: 'plat-stomps',
    gameId: 'platformer',
    kind: 'total',
    stat: 'stomps',
    targets: [5, 15, 30],
    label: (n) => `Stomp ${n} enemies in Pixel Quest`,
  },
  {
    id: 'plat-levels',
    gameId: 'platformer',
    kind: 'total',
    stat: 'levels',
    targets: [1, 2, 4],
    label: (n) => `Clear ${n} Pixel Quest course${n > 1 ? 's' : ''}`,
  },
  {
    id: 'plat-coins',
    gameId: 'platformer',
    kind: 'total',
    stat: 'coins',
    targets: [15, 40, 80],
    label: (n) => `Grab ${n} coins in Pixel Quest`,
  },
  {
    id: 'duck-ducks',
    gameId: 'duck',
    kind: 'total',
    stat: 'ducks',
    targets: [10, 25, 50],
    label: (n) => `Hit ${n} ducks in Duck Season`,
  },
  {
    id: 'duck-round',
    gameId: 'duck',
    kind: 'best',
    stat: 'bestRound',
    targets: [2, 4, 6],
    label: (n) => `Clear round ${n} in Duck Season`,
  },
  {
    id: 'hill-distance',
    gameId: 'hill',
    kind: 'total',
    stat: 'distance',
    targets: [500, 1200, 2500],
    label: (n) => `Drive ${fmt(n)} m in Hill Rider`,
  },
  {
    id: 'hill-flips',
    gameId: 'hill',
    kind: 'total',
    stat: 'flips',
    targets: [2, 5, 12],
    label: (n) => `Land ${n} flips in Hill Rider`,
  },
  {
    id: 'galaxy-enemies',
    gameId: 'galaxy',
    kind: 'total',
    stat: 'enemies',
    targets: [40, 100, 200],
    label: (n) => `Destroy ${n} ships in Galaxy War`,
  },
  {
    id: 'galaxy-wave',
    gameId: 'galaxy',
    kind: 'best',
    stat: 'wave',
    targets: [3, 5, 8],
    label: (n) => `Reach wave ${n} in Galaxy War`,
  },
  {
    id: 'snake-food',
    gameId: 'snake',
    kind: 'total',
    stat: 'food',
    targets: [10, 30, 60],
    label: (n) => `Eat ${n} apples in Snake Classic`,
  },
  {
    id: 'snake-length',
    gameId: 'snake',
    kind: 'best',
    stat: 'length',
    targets: [8, 14, 20],
    label: (n) => `Grow to length ${n} in Snake Classic`,
  },
  {
    id: 'bomb-kills',
    gameId: 'bombsquad',
    kind: 'total',
    stat: 'kills',
    targets: [5, 15, 30],
    label: (n) => `Defeat ${n} bots in Bomb Squad`,
  },
  {
    id: 'bomb-wave',
    gameId: 'bombsquad',
    kind: 'best',
    stat: 'wave',
    targets: [2, 3, 5],
    label: (n) => `Reach wave ${n} in Bomb Squad`,
  },
];

const TIER_REWARDS = [
  { coins: 100, xp: 50, gems: 0 },
  { coins: 200, xp: 100, gems: 0 },
  { coins: 350, xp: 175, gems: 1 },
] as const;

export const MISSIONS_PER_DAY = 3;

/** Deterministic daily missions: everyone with the same date gets the same set. */
export function generateMissions(day: string): MissionState[] {
  const rng = new Rng(hashString(`missions:${day}`));
  const pool = rng.shuffle([...MISSION_TEMPLATES]);
  const chosen: MissionTemplate[] = [];
  const usedGames = new Set<string>();
  for (const t of pool) {
    if (chosen.length >= MISSIONS_PER_DAY) break;
    const g = t.gameId ?? 'any';
    if (usedGames.has(g)) continue;
    usedGames.add(g);
    chosen.push(t);
  }
  return chosen.map((t, tier) => {
    const target = t.targets[tier] as number;
    const reward = TIER_REWARDS[tier] ?? TIER_REWARDS[0];
    return {
      id: `${day}:${t.id}`,
      templateId: t.id,
      tier,
      gameId: t.gameId,
      kind: t.kind,
      stat: t.stat,
      target,
      progress: 0,
      claimed: false,
      label: t.label(target),
      reward: { ...reward },
    };
  });
}

/** Apply a finished run to mission progress. Returns missions that became complete. */
export function applyRunToMissions(
  list: MissionState[],
  gameId: GameId,
  stats: Readonly<Record<string, number>>,
): MissionState[] {
  const completed: MissionState[] = [];
  for (const m of list) {
    if (m.claimed || m.progress >= m.target) continue;
    if (m.gameId !== null && m.gameId !== gameId) continue;
    const before = m.progress;
    if (m.kind === 'plays') m.progress += 1;
    else if (m.kind === 'total') m.progress += Math.max(0, stats[m.stat] ?? 0);
    else m.progress = Math.max(m.progress, stats[m.stat] ?? 0);
    m.progress = Math.min(m.target, m.progress);
    if (before < m.target && m.progress >= m.target) completed.push(m);
  }
  return completed;
}
