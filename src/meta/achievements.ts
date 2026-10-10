import { GAME_IDS, type GameId } from '../games/types';
import { isFree, SKINS } from './catalog';
import { levelInfo } from './progression';
import type { Profile } from './profile';

export type Tier = 'bronze' | 'silver' | 'gold' | 'platinum';

export type Goal =
  | { type: 'total'; key: string; target: number }
  | { type: 'best'; key: string; target: number }
  | { type: 'plays'; gameId?: GameId; target: number }
  | { type: 'distinct-games'; target: number }
  | { type: 'level'; target: number }
  | { type: 'streak'; target: number }
  | { type: 'skins'; target: number };

export interface AchievementDef {
  id: string;
  name: string;
  description: string;
  gameId: GameId | null;
  tier: Tier;
  reward: { coins: number; gems: number };
  goal: Goal;
}

export const ACHIEVEMENTS: readonly AchievementDef[] = [
  // Arcade-wide
  {
    id: 'first-run',
    name: 'First Steps',
    description: 'Finish your first game.',
    gameId: null,
    tier: 'bronze',
    reward: { coins: 50, gems: 0 },
    goal: { type: 'plays', target: 1 },
  },
  {
    id: 'explorer',
    name: 'Arcade Explorer',
    description: 'Play all five games.',
    gameId: null,
    tier: 'silver',
    reward: { coins: 200, gems: 2 },
    goal: { type: 'distinct-games', target: 5 },
  },
  {
    id: 'regular',
    name: 'Regular',
    description: 'Play 25 games.',
    gameId: null,
    tier: 'silver',
    reward: { coins: 300, gems: 0 },
    goal: { type: 'plays', target: 25 },
  },
  {
    id: 'legend',
    name: 'Arcade Legend',
    description: 'Play 100 games.',
    gameId: null,
    tier: 'platinum',
    reward: { coins: 1000, gems: 10 },
    goal: { type: 'plays', target: 100 },
  },
  {
    id: 'level-5',
    name: 'Rising Star',
    description: 'Reach player level 5.',
    gameId: null,
    tier: 'bronze',
    reward: { coins: 200, gems: 0 },
    goal: { type: 'level', target: 5 },
  },
  {
    id: 'level-15',
    name: 'Veteran',
    description: 'Reach player level 15.',
    gameId: null,
    tier: 'gold',
    reward: { coins: 600, gems: 5 },
    goal: { type: 'level', target: 15 },
  },
  {
    id: 'level-30',
    name: 'Grandmaster',
    description: 'Reach player level 30.',
    gameId: null,
    tier: 'platinum',
    reward: { coins: 2000, gems: 15 },
    goal: { type: 'level', target: 30 },
  },
  {
    id: 'streak-3',
    name: 'Committed',
    description: 'Claim daily rewards 3 days in a row.',
    gameId: null,
    tier: 'bronze',
    reward: { coins: 150, gems: 0 },
    goal: { type: 'streak', target: 3 },
  },
  {
    id: 'streak-7',
    name: 'Devoted',
    description: 'Claim daily rewards 7 days in a row.',
    gameId: null,
    tier: 'gold',
    reward: { coins: 500, gems: 5 },
    goal: { type: 'streak', target: 7 },
  },
  {
    id: 'coins-1k',
    name: 'Pocket Change',
    description: 'Earn 1,000 coins in total.',
    gameId: null,
    tier: 'bronze',
    reward: { coins: 100, gems: 0 },
    goal: { type: 'total', key: 'all.coinsEarned', target: 1000 },
  },
  {
    id: 'coins-10k',
    name: 'Treasure Hunter',
    description: 'Earn 10,000 coins in total.',
    gameId: null,
    tier: 'gold',
    reward: { coins: 500, gems: 3 },
    goal: { type: 'total', key: 'all.coinsEarned', target: 10000 },
  },
  {
    id: 'collector',
    name: 'Collector',
    description: 'Unlock 3 premium skins.',
    gameId: null,
    tier: 'silver',
    reward: { coins: 300, gems: 3 },
    goal: { type: 'skins', target: 3 },
  },
  // Metro Dash
  {
    id: 'runner-1k',
    name: 'Marathoner',
    description: 'Run 1,000 m in one Metro Dash run.',
    gameId: 'runner',
    tier: 'bronze',
    reward: { coins: 200, gems: 0 },
    goal: { type: 'best', key: 'runner.distance', target: 1000 },
  },
  {
    id: 'runner-3k',
    name: 'Ultra Runner',
    description: 'Run 3,000 m in one Metro Dash run.',
    gameId: 'runner',
    tier: 'gold',
    reward: { coins: 600, gems: 5 },
    goal: { type: 'best', key: 'runner.distance', target: 3000 },
  },
  {
    id: 'runner-roofs',
    name: 'Rooftop Rider',
    description: 'Land on 25 train roofs.',
    gameId: 'runner',
    tier: 'silver',
    reward: { coins: 250, gems: 0 },
    goal: { type: 'total', key: 'runner.trainsRidden', target: 25 },
  },
  // Pixel Quest
  {
    id: 'plat-clear',
    name: 'Flag Bearer',
    description: 'Clear your first Pixel Quest course.',
    gameId: 'platformer',
    tier: 'bronze',
    reward: { coins: 150, gems: 0 },
    goal: { type: 'total', key: 'platformer.levels', target: 1 },
  },
  {
    id: 'plat-world',
    name: 'World Traveller',
    description: 'Clear 4 courses in a single run.',
    gameId: 'platformer',
    tier: 'gold',
    reward: { coins: 500, gems: 3 },
    goal: { type: 'best', key: 'platformer.levels', target: 4 },
  },
  {
    id: 'plat-stomp',
    name: 'Stomp Master',
    description: 'Stomp 100 enemies.',
    gameId: 'platformer',
    tier: 'silver',
    reward: { coins: 300, gems: 0 },
    goal: { type: 'total', key: 'platformer.stomps', target: 100 },
  },
  // Duck Season
  {
    id: 'duck-100',
    name: 'Sharpshooter',
    description: 'Hit 100 ducks.',
    gameId: 'duck',
    tier: 'silver',
    reward: { coins: 250, gems: 0 },
    goal: { type: 'total', key: 'duck.ducks', target: 100 },
  },
  {
    id: 'duck-perfect',
    name: 'Flawless',
    description: 'Hit all 10 ducks in a round.',
    gameId: 'duck',
    tier: 'gold',
    reward: { coins: 400, gems: 3 },
    goal: { type: 'total', key: 'duck.perfectRounds', target: 1 },
  },
  {
    id: 'duck-gold',
    name: 'Golden Hunter',
    description: 'Hit 5 golden ducks.',
    gameId: 'duck',
    tier: 'silver',
    reward: { coins: 300, gems: 0 },
    goal: { type: 'total', key: 'duck.goldenDucks', target: 5 },
  },
  // Hill Rider
  {
    id: 'hill-1k',
    name: 'Long Hauler',
    description: 'Drive 1,000 m in one Hill Rider run.',
    gameId: 'hill',
    tier: 'bronze',
    reward: { coins: 250, gems: 0 },
    goal: { type: 'best', key: 'hill.distance', target: 1000 },
  },
  {
    id: 'hill-moon',
    name: 'Moonwalker',
    description: 'Reach the Lunar Base (2,400 m).',
    gameId: 'hill',
    tier: 'platinum',
    reward: { coins: 800, gems: 5 },
    goal: { type: 'best', key: 'hill.distance', target: 2400 },
  },
  {
    id: 'hill-flips',
    name: 'Daredevil',
    description: 'Land 25 flips.',
    gameId: 'hill',
    tier: 'silver',
    reward: { coins: 300, gems: 0 },
    goal: { type: 'total', key: 'hill.flips', target: 25 },
  },
  // Galaxy War
  {
    id: 'galaxy-500',
    name: 'Ace Pilot',
    description: 'Destroy 500 enemy ships.',
    gameId: 'galaxy',
    tier: 'silver',
    reward: { coins: 300, gems: 0 },
    goal: { type: 'total', key: 'galaxy.enemies', target: 500 },
  },
  {
    id: 'galaxy-boss',
    name: 'Giant Slayer',
    description: 'Destroy a Mothership.',
    gameId: 'galaxy',
    tier: 'gold',
    reward: { coins: 400, gems: 3 },
    goal: { type: 'total', key: 'galaxy.bosses', target: 1 },
  },
  {
    id: 'galaxy-wave15',
    name: 'Last Line',
    description: 'Reach wave 15.',
    gameId: 'galaxy',
    tier: 'platinum',
    reward: { coins: 800, gems: 5 },
    goal: { type: 'best', key: 'galaxy.wave', target: 15 },
  },
  // Snake Classic
  {
    id: 'snake-50',
    name: 'Hungry Serpent',
    description: 'Eat 50 apples in total.',
    gameId: 'snake',
    tier: 'silver',
    reward: { coins: 250, gems: 0 },
    goal: { type: 'total', key: 'snake.food', target: 50 },
  },
  {
    id: 'snake-golden5',
    name: 'Golden Bite',
    description: 'Eat 5 golden apples in total.',
    gameId: 'snake',
    tier: 'silver',
    reward: { coins: 300, gems: 0 },
    goal: { type: 'total', key: 'snake.golden', target: 5 },
  },
  {
    id: 'snake-length20',
    name: 'Long Coil',
    description: 'Grow to a length of 20 in one run.',
    gameId: 'snake',
    tier: 'gold',
    reward: { coins: 500, gems: 3 },
    goal: { type: 'best', key: 'snake.length', target: 20 },
  },
  {
    id: 'snake-level5',
    name: 'Level Five',
    description: 'Reach level 5 in one run.',
    gameId: 'snake',
    tier: 'gold',
    reward: { coins: 400, gems: 2 },
    goal: { type: 'best', key: 'snake.level', target: 5 },
  },
  // Bomb Squad
  {
    id: 'bomb-kills100',
    name: 'Demolition Pro',
    description: 'Defeat 100 bots in total.',
    gameId: 'bombsquad',
    tier: 'silver',
    reward: { coins: 300, gems: 0 },
    goal: { type: 'total', key: 'bombsquad.kills', target: 100 },
  },
  {
    id: 'bomb-blocks200',
    name: 'Wrecking Crew',
    description: 'Blow up 200 crates in total.',
    gameId: 'bombsquad',
    tier: 'silver',
    reward: { coins: 250, gems: 0 },
    goal: { type: 'total', key: 'bombsquad.blocks', target: 200 },
  },
  {
    id: 'bomb-wave5',
    name: 'Squad Leader',
    description: 'Reach wave 5 in one run.',
    gameId: 'bombsquad',
    tier: 'gold',
    reward: { coins: 500, gems: 3 },
    goal: { type: 'best', key: 'bombsquad.wave', target: 5 },
  },
  {
    id: 'bomb-multikill3',
    name: 'Chain Reaction',
    description: 'Defeat 3 bots with a single blast.',
    gameId: 'bombsquad',
    tier: 'gold',
    reward: { coins: 400, gems: 2 },
    goal: { type: 'best', key: 'bombsquad.multikill', target: 3 },
  },
  // Block Drop
  {
    id: 'tetris-lines100',
    name: 'Line Sweeper',
    description: 'Clear 100 lines in total.',
    gameId: 'tetris',
    tier: 'silver',
    reward: { coins: 250, gems: 0 },
    goal: { type: 'total', key: 'tetris.lines', target: 100 },
  },
  {
    id: 'tetris-tetris5',
    name: 'Four in a Row',
    description: 'Make 5 four-line clears in total.',
    gameId: 'tetris',
    tier: 'gold',
    reward: { coins: 400, gems: 2 },
    goal: { type: 'total', key: 'tetris.tetrises', target: 5 },
  },
  {
    id: 'tetris-level8',
    name: 'Speed Stacker',
    description: 'Reach level 8 in one run.',
    gameId: 'tetris',
    tier: 'gold',
    reward: { coins: 500, gems: 3 },
    goal: { type: 'best', key: 'tetris.level', target: 8 },
  },
];

export function achievementProgress(def: AchievementDef, p: Profile): { current: number; target: number } {
  const g = def.goal;
  let current = 0;
  switch (g.type) {
    case 'total':
      current = p.totals[g.key] ?? 0;
      break;
    case 'best':
      current = p.bests[g.key] ?? 0;
      break;
    case 'plays':
      current = g.gameId ? p.games[g.gameId].plays : GAME_IDS.reduce((s, id) => s + p.games[id].plays, 0);
      break;
    case 'distinct-games':
      current = GAME_IDS.filter((id) => p.games[id].plays > 0).length;
      break;
    case 'level':
      current = levelInfo(p.xp).level;
      break;
    case 'streak':
      current = Math.max(p.daily.streak, p.daily.best);
      break;
    case 'skins':
      current = p.owned.filter((id) => {
        const s = SKINS.find((k) => k.id === id);
        return !!s && !isFree(s);
      }).length;
      break;
  }
  return { current: Math.min(current, g.target), target: g.target };
}

/** Achievements whose goal is met but which are not yet recorded as unlocked. */
export function newlyCompleted(p: Profile): AchievementDef[] {
  return ACHIEVEMENTS.filter(
    (a) => !p.achievements[a.id] && achievementProgress(a, p).current >= a.goal.target,
  );
}

export function getAchievement(id: string): AchievementDef | undefined {
  return ACHIEVEMENTS.find((a) => a.id === id);
}
