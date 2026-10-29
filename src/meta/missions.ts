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
  {
    id: 'tetris-lines',
    gameId: 'tetris',
    kind: 'total',
    stat: 'lines',
    targets: [10, 30, 60],
    label: (n) => `Clear ${n} lines in Block Drop`,
  },
  {
    id: 'tetris-level',
    gameId: 'tetris',
    kind: 'best',
    stat: 'level',
    targets: [3, 5, 8],
    label: (n) => `Reach level ${n} in Block Drop`,
  },
  {
    id: 'bubble-pops',
    gameId: 'bubble',
    kind: 'total',
    stat: 'pops',
    targets: [20, 50, 100],
    label: (n) => `Pop ${n} bubbles in Bubble Shooter`,
  },
  {
    id: 'bubble-combo',
    gameId: 'bubble',
    kind: 'best',
    stat: 'combo',
    targets: [2, 3, 4],
    label: (n) => `Reach a x${n} combo in Bubble Shooter`,
  },
  {
    id: 'pong-rally',
    gameId: 'pong',
    kind: 'best',
    stat: 'longestRally',
    targets: [6, 10, 15],
    label: (n) => `Keep a rally going for ${n} shots in Ping Pong`,
  },
  {
    id: 'pong-wins',
    gameId: 'pong',
    kind: 'total',
    stat: 'wins',
    targets: [1, 2, 3],
    label: (n) => `Win ${n} Ping Pong match${n > 1 ? 'es' : ''}`,
  },
  {
    id: 'breakout-bricks',
    gameId: 'breakout',
    kind: 'total',
    stat: 'bricks',
    targets: [30, 80, 150],
    label: (n) => `Break ${n} bricks in Brick Breaker`,
  },
  {
    id: 'breakout-levels',
    gameId: 'breakout',
    kind: 'best',
    stat: 'levels',
    targets: [1, 2, 3],
    label: (n) => `Clear ${n} level${n > 1 ? 's' : ''} in one Brick Breaker run`,
  },
  {
    id: 'merge-merges',
    gameId: 'merge',
    kind: 'total',
    stat: 'merges',
    targets: [40, 100, 200],
    label: (n) => `Merge ${n} tiles in 2048`,
  },
  {
    id: 'merge-tile',
    gameId: 'merge',
    kind: 'best',
    stat: 'bestTile',
    targets: [128, 256, 512],
    label: (n) => `Make a ${n} tile in 2048`,
  },
  {
    id: 'flappy-gates',
    gameId: 'flappy',
    kind: 'total',
    stat: 'gates',
    targets: [10, 25, 50],
    label: (n) => `Pass ${n} gates in Sky Hopper`,
  },
  {
    id: 'flappy-best',
    gameId: 'flappy',
    kind: 'best',
    stat: 'gates',
    targets: [5, 10, 20],
    label: (n) => `Pass ${n} gates in one Sky Hopper flight`,
  },
  {
    id: 'stack-floors',
    gameId: 'stack',
    kind: 'total',
    stat: 'floors',
    targets: [20, 50, 100],
    label: (n) => `Stack ${n} floors in Stack Tower`,
  },
  {
    id: 'stack-best',
    gameId: 'stack',
    kind: 'best',
    stat: 'floors',
    targets: [10, 20, 35],
    label: (n) => `Build a ${n}-floor tower in Stack Tower`,
  },
  {
    id: 'memory-pairs',
    gameId: 'memory',
    kind: 'total',
    stat: 'pairs',
    targets: [15, 40, 80],
    label: (n) => `Find ${n} pairs in Memory Match`,
  },
  {
    id: 'memory-levels',
    gameId: 'memory',
    kind: 'best',
    stat: 'levels',
    targets: [1, 2, 3],
    label: (n) => `Clear ${n} board${n > 1 ? 's' : ''} in one Memory Match run`,
  },
  {
    id: 'mole-whacks',
    gameId: 'mole',
    kind: 'total',
    stat: 'whacks',
    targets: [40, 100, 200],
    label: (n) => `Whack ${n} moles in Whack-a-Mole`,
  },
  {
    id: 'mole-best',
    gameId: 'mole',
    kind: 'best',
    stat: 'whacks',
    targets: [25, 40, 55],
    label: (n) => `Whack ${n} moles in one Whack-a-Mole round`,
  },
  {
    id: 'mines-cells',
    gameId: 'mines',
    kind: 'total',
    stat: 'cells',
    targets: [100, 250, 500],
    label: (n) => `Clear ${n} squares in Minesweeper`,
  },
  {
    id: 'mines-boards',
    gameId: 'mines',
    kind: 'best',
    stat: 'boards',
    targets: [1, 2, 3],
    label: (n) => `Clear ${n} field${n > 1 ? 's' : ''} in one Minesweeper run`,
  },
  {
    id: 'slice-fruits',
    gameId: 'slice',
    kind: 'total',
    stat: 'fruits',
    targets: [40, 100, 200],
    label: (n) => `Slice ${n} fruit in Fruit Slice`,
  },
  {
    id: 'slice-best',
    gameId: 'slice',
    kind: 'best',
    stat: 'fruits',
    targets: [25, 50, 80],
    label: (n) => `Slice ${n} fruit in one Fruit Slice run`,
  },
  {
    id: 'jumper-height',
    gameId: 'jumper',
    kind: 'best',
    stat: 'height',
    targets: [150, 400, 800],
    label: (n) => `Climb ${n} m in one Sky Jumper run`,
  },
  {
    id: 'jumper-springs',
    gameId: 'jumper',
    kind: 'total',
    stat: 'springs',
    targets: [3, 8, 15],
    label: (n) => `Use ${n} springs in Sky Jumper`,
  },
  {
    id: 'hopper-rows',
    gameId: 'hopper',
    kind: 'best',
    stat: 'rows',
    targets: [20, 40, 70],
    label: (n) => `Hop ${n} rows in one Road Hopper run`,
  },
  {
    id: 'hopper-hops',
    gameId: 'hopper',
    kind: 'total',
    stat: 'hops',
    targets: [60, 150, 300],
    label: (n) => `Make ${n} hops in Road Hopper`,
  },
  {
    id: 'sort-levels',
    gameId: 'sort',
    kind: 'total',
    stat: 'levels',
    targets: [1, 3, 5],
    label: (n) => `Solve ${n} Color Sort puzzle${n > 1 ? 's' : ''}`,
  },
  {
    id: 'sort-best',
    gameId: 'sort',
    kind: 'best',
    stat: 'levels',
    targets: [1, 2, 4],
    label: (n) => `Solve ${n} puzzle${n > 1 ? 's' : ''} in one Color Sort run`,
  },
  {
    id: 'four-wins',
    gameId: 'four',
    kind: 'total',
    stat: 'wins',
    targets: [1, 2, 4],
    label: (n) => `Win ${n} Connect Four game${n > 1 ? 's' : ''}`,
  },
  {
    id: 'four-best',
    gameId: 'four',
    kind: 'best',
    stat: 'wins',
    targets: [1, 2, 3],
    label: (n) => `Win ${n} Connect Four game${n > 1 ? 's' : ''} in one run`,
  },
  {
    id: 'knife-knives',
    gameId: 'knife',
    kind: 'total',
    stat: 'knives',
    targets: [30, 80, 150],
    label: (n) => `Land ${n} knives in Knife Hit`,
  },
  {
    id: 'knife-stages',
    gameId: 'knife',
    kind: 'best',
    stat: 'stages',
    targets: [2, 4, 6],
    label: (n) => `Clear ${n} stages in one Knife Hit run`,
  },
  {
    id: 'sudoku-cells',
    gameId: 'sudoku',
    kind: 'total',
    stat: 'cells',
    targets: [30, 60, 120],
    label: (n) => `Fill ${n} squares in Sudoku`,
  },
  {
    id: 'sudoku-puzzles',
    gameId: 'sudoku',
    kind: 'total',
    stat: 'puzzles',
    targets: [1, 2, 3],
    label: (n) => `Solve ${n} Sudoku${n > 1 ? 's' : ''}`,
  },
  {
    id: 'simon-rounds',
    gameId: 'simon',
    kind: 'best',
    stat: 'rounds',
    targets: [5, 8, 12],
    label: (n) => `Repeat a sequence of ${n} in Simon Says`,
  },
  {
    id: 'simon-taps',
    gameId: 'simon',
    kind: 'total',
    stat: 'taps',
    targets: [40, 100, 200],
    label: (n) => `Play ${n} pads in Simon Says`,
  },
  {
    id: 'maze-dots',
    gameId: 'maze',
    kind: 'total',
    stat: 'dots',
    targets: [100, 250, 500],
    label: (n) => `Eat ${n} dots in Maze Chase`,
  },
  {
    id: 'maze-ghosts',
    gameId: 'maze',
    kind: 'total',
    stat: 'ghosts',
    targets: [2, 5, 10],
    label: (n) => `Eat ${n} ghosts in Maze Chase`,
  },
  {
    id: 'golf-holes',
    gameId: 'golf',
    kind: 'total',
    stat: 'holes',
    targets: [5, 9, 18],
    label: (n) => `Play ${n} holes of Mini Golf`,
  },
  {
    id: 'golf-under',
    gameId: 'golf',
    kind: 'total',
    stat: 'under',
    targets: [1, 3, 6],
    label: (n) => `Finish ${n} Mini Golf hole${n > 1 ? 's' : ''} under par`,
  },
  {
    id: 'hoops-baskets',
    gameId: 'hoops',
    kind: 'total',
    stat: 'baskets',
    targets: [15, 40, 80],
    label: (n) => `Sink ${n} baskets in Hoops`,
  },
  {
    id: 'hoops-best',
    gameId: 'hoops',
    kind: 'best',
    stat: 'baskets',
    targets: [8, 15, 25],
    label: (n) => `Sink ${n} baskets in one game of Hoops`,
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
