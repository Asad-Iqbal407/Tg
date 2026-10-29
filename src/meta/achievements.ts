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
    description: 'Play five different games.',
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
  // Bubble Shooter
  {
    id: 'bubble-pops300',
    name: 'Popper',
    description: 'Pop 300 bubbles in total.',
    gameId: 'bubble',
    tier: 'silver',
    reward: { coins: 250, gems: 0 },
    goal: { type: 'total', key: 'bubble.pops', target: 300 },
  },
  {
    id: 'bubble-combo3',
    name: 'Combo Crafter',
    description: 'Get a x3 combo with one shot.',
    gameId: 'bubble',
    tier: 'gold',
    reward: { coins: 400, gems: 2 },
    goal: { type: 'best', key: 'bubble.combo', target: 3 },
  },
  {
    id: 'bubble-levels3',
    name: 'Ceiling Breaker',
    description: 'Clear 3 levels in one run.',
    gameId: 'bubble',
    tier: 'silver',
    reward: { coins: 250, gems: 0 },
    goal: { type: 'best', key: 'bubble.levels', target: 3 },
  },
  // Ping Pong
  {
    id: 'pong-win',
    name: 'Match Winner',
    description: 'Win a match against the computer.',
    gameId: 'pong',
    tier: 'silver',
    reward: { coins: 300, gems: 0 },
    goal: { type: 'total', key: 'pong.wins', target: 1 },
  },
  {
    id: 'pong-rally15',
    name: 'Marathon Rally',
    description: 'Keep one rally going for 15 shots.',
    gameId: 'pong',
    tier: 'gold',
    reward: { coins: 500, gems: 3 },
    goal: { type: 'best', key: 'pong.longestRally', target: 15 },
  },
  {
    id: 'pong-aces10',
    name: 'Ace Server',
    description: 'Score 10 aces, points won straight off your serve.',
    gameId: 'pong',
    tier: 'silver',
    reward: { coins: 300, gems: 0 },
    goal: { type: 'total', key: 'pong.aces', target: 10 },
  },
  // Brick Breaker
  {
    id: 'breakout-bricks500',
    name: 'Wrecking Ball',
    description: 'Break 500 bricks in total.',
    gameId: 'breakout',
    tier: 'silver',
    reward: { coins: 300, gems: 0 },
    goal: { type: 'total', key: 'breakout.bricks', target: 500 },
  },
  {
    id: 'breakout-levels5',
    name: 'Wall Crusher',
    description: 'Clear 5 levels in one run.',
    gameId: 'breakout',
    tier: 'gold',
    reward: { coins: 500, gems: 3 },
    goal: { type: 'best', key: 'breakout.levels', target: 5 },
  },
  {
    id: 'breakout-combo10',
    name: 'Chain Breaker',
    description: 'Break 10 bricks without the ball touching the paddle.',
    gameId: 'breakout',
    tier: 'silver',
    reward: { coins: 300, gems: 0 },
    goal: { type: 'best', key: 'breakout.combo', target: 10 },
  },
  // 2048
  {
    id: 'merge-512',
    name: 'Half Way There',
    description: 'Make a 512 tile.',
    gameId: 'merge',
    tier: 'silver',
    reward: { coins: 300, gems: 0 },
    goal: { type: 'best', key: 'merge.bestTile', target: 512 },
  },
  {
    id: 'merge-2048',
    name: 'The Big One',
    description: 'Make the 2048 tile.',
    gameId: 'merge',
    tier: 'platinum',
    reward: { coins: 1000, gems: 10 },
    goal: { type: 'best', key: 'merge.bestTile', target: 2048 },
  },
  {
    id: 'merge-merges1000',
    name: 'Merge Master',
    description: 'Merge 1,000 tiles in total.',
    gameId: 'merge',
    tier: 'gold',
    reward: { coins: 500, gems: 3 },
    goal: { type: 'total', key: 'merge.merges', target: 1000 },
  },
  // Sky Hopper
  {
    id: 'flappy-gates10',
    name: 'Taking Flight',
    description: 'Pass 10 gates in one flight.',
    gameId: 'flappy',
    tier: 'bronze',
    reward: { coins: 150, gems: 0 },
    goal: { type: 'best', key: 'flappy.gates', target: 10 },
  },
  {
    id: 'flappy-gates50',
    name: 'High Flier',
    description: 'Pass 50 gates in one flight.',
    gameId: 'flappy',
    tier: 'gold',
    reward: { coins: 500, gems: 3 },
    goal: { type: 'best', key: 'flappy.gates', target: 50 },
  },
  {
    id: 'flappy-gates500',
    name: 'Frequent Flier',
    description: 'Pass 500 gates in total.',
    gameId: 'flappy',
    tier: 'silver',
    reward: { coins: 300, gems: 0 },
    goal: { type: 'total', key: 'flappy.gates', target: 500 },
  },
  // Stack Tower
  {
    id: 'stack-floors25',
    name: 'Skyline',
    description: 'Stack 25 floors in one tower.',
    gameId: 'stack',
    tier: 'silver',
    reward: { coins: 300, gems: 0 },
    goal: { type: 'best', key: 'stack.floors', target: 25 },
  },
  {
    id: 'stack-floors60',
    name: 'Skyscraper',
    description: 'Stack 60 floors in one tower.',
    gameId: 'stack',
    tier: 'gold',
    reward: { coins: 500, gems: 3 },
    goal: { type: 'best', key: 'stack.floors', target: 60 },
  },
  {
    id: 'stack-combo8',
    name: 'Laser Level',
    description: 'Make 8 perfect drops in a row.',
    gameId: 'stack',
    tier: 'gold',
    reward: { coins: 500, gems: 3 },
    goal: { type: 'best', key: 'stack.combo', target: 8 },
  },
  // Memory Match
  {
    id: 'memory-pairs200',
    name: 'Card Shark',
    description: 'Find 200 pairs in total.',
    gameId: 'memory',
    tier: 'silver',
    reward: { coins: 300, gems: 0 },
    goal: { type: 'total', key: 'memory.pairs', target: 200 },
  },
  {
    id: 'memory-levels4',
    name: 'Photographic',
    description: 'Clear 4 boards in one run.',
    gameId: 'memory',
    tier: 'gold',
    reward: { coins: 500, gems: 3 },
    goal: { type: 'best', key: 'memory.levels', target: 4 },
  },
  {
    id: 'memory-streak6',
    name: 'Total Recall',
    description: 'Find 6 pairs in a row without a miss.',
    gameId: 'memory',
    tier: 'gold',
    reward: { coins: 500, gems: 3 },
    goal: { type: 'best', key: 'memory.streak', target: 6 },
  },
  // Whack-a-Mole
  {
    id: 'mole-whacks60',
    name: 'Mole Patrol',
    description: 'Whack 60 moles in one round.',
    gameId: 'mole',
    tier: 'silver',
    reward: { coins: 300, gems: 0 },
    goal: { type: 'best', key: 'mole.whacks', target: 60 },
  },
  {
    id: 'mole-golden50',
    name: 'Gold Rush',
    description: 'Whack 50 golden moles in total.',
    gameId: 'mole',
    tier: 'gold',
    reward: { coins: 500, gems: 3 },
    goal: { type: 'total', key: 'mole.golden', target: 50 },
  },
  {
    id: 'mole-combo25',
    name: 'Hammer Time',
    description: 'Whack 25 moles in a row.',
    gameId: 'mole',
    tier: 'gold',
    reward: { coins: 500, gems: 3 },
    goal: { type: 'best', key: 'mole.combo', target: 25 },
  },
  // Minesweeper
  {
    id: 'mines-boards1',
    name: 'Clean Sweep',
    description: 'Clear a minefield.',
    gameId: 'mines',
    tier: 'silver',
    reward: { coins: 300, gems: 0 },
    goal: { type: 'total', key: 'mines.boards', target: 1 },
  },
  {
    id: 'mines-boards3',
    name: 'Bomb Disposal',
    description: 'Clear 3 fields in one run.',
    gameId: 'mines',
    tier: 'gold',
    reward: { coins: 500, gems: 3 },
    goal: { type: 'best', key: 'mines.boards', target: 3 },
  },
  {
    id: 'mines-flags100',
    name: 'Flag Bearer',
    description: 'Flag 100 mines in total.',
    gameId: 'mines',
    tier: 'silver',
    reward: { coins: 300, gems: 0 },
    goal: { type: 'total', key: 'mines.flags', target: 100 },
  },
  // Fruit Slice
  {
    id: 'slice-fruits100',
    name: 'Fruit Salad',
    description: 'Slice 100 fruit in one run.',
    gameId: 'slice',
    tier: 'silver',
    reward: { coins: 300, gems: 0 },
    goal: { type: 'best', key: 'slice.fruits', target: 100 },
  },
  {
    id: 'slice-combo5',
    name: 'Five Way Split',
    description: 'Slice 5 fruit with one swipe.',
    gameId: 'slice',
    tier: 'gold',
    reward: { coins: 500, gems: 3 },
    goal: { type: 'best', key: 'slice.combo', target: 5 },
  },
  {
    id: 'slice-golden20',
    name: 'Golden Touch',
    description: 'Slice 20 golden fruit in total.',
    gameId: 'slice',
    tier: 'gold',
    reward: { coins: 500, gems: 3 },
    goal: { type: 'total', key: 'slice.golden', target: 20 },
  },
  // Sky Jumper
  {
    id: 'jumper-500',
    name: 'Cloud Hopper',
    description: 'Climb 500 m in one jump.',
    gameId: 'jumper',
    tier: 'silver',
    reward: { coins: 300, gems: 0 },
    goal: { type: 'best', key: 'jumper.height', target: 500 },
  },
  {
    id: 'jumper-2000',
    name: 'Stratosphere',
    description: 'Climb 2,000 m in one jump.',
    gameId: 'jumper',
    tier: 'gold',
    reward: { coins: 500, gems: 3 },
    goal: { type: 'best', key: 'jumper.height', target: 2000 },
  },
  {
    id: 'jumper-springs50',
    name: 'Spring Loaded',
    description: 'Use 50 springs in total.',
    gameId: 'jumper',
    tier: 'silver',
    reward: { coins: 300, gems: 0 },
    goal: { type: 'total', key: 'jumper.springs', target: 50 },
  },
  // Road Hopper
  {
    id: 'hopper-50',
    name: 'Road Warrior',
    description: 'Hop 50 rows in one run.',
    gameId: 'hopper',
    tier: 'silver',
    reward: { coins: 300, gems: 0 },
    goal: { type: 'best', key: 'hopper.rows', target: 50 },
  },
  {
    id: 'hopper-150',
    name: 'Long Haul',
    description: 'Hop 150 rows in one run.',
    gameId: 'hopper',
    tier: 'gold',
    reward: { coins: 500, gems: 3 },
    goal: { type: 'best', key: 'hopper.rows', target: 150 },
  },
  {
    id: 'hopper-hops1000',
    name: 'Frequent Hopper',
    description: 'Make 1,000 hops in total.',
    gameId: 'hopper',
    tier: 'silver',
    reward: { coins: 300, gems: 0 },
    goal: { type: 'total', key: 'hopper.hops', target: 1000 },
  },
  // Color Sort
  {
    id: 'sort-levels3',
    name: 'Neat Freak',
    description: 'Solve 3 puzzles in one run.',
    gameId: 'sort',
    tier: 'silver',
    reward: { coins: 300, gems: 0 },
    goal: { type: 'best', key: 'sort.levels', target: 3 },
  },
  {
    id: 'sort-levels6',
    name: 'Perfectly Sorted',
    description: 'Solve 6 puzzles in one run.',
    gameId: 'sort',
    tier: 'gold',
    reward: { coins: 500, gems: 3 },
    goal: { type: 'best', key: 'sort.levels', target: 6 },
  },
  {
    id: 'sort-total25',
    name: 'Sort It Out',
    description: 'Solve 25 puzzles in total.',
    gameId: 'sort',
    tier: 'gold',
    reward: { coins: 500, gems: 3 },
    goal: { type: 'total', key: 'sort.levels', target: 25 },
  },
  // Connect Four
  {
    id: 'four-win1',
    name: 'Four Up',
    description: 'Beat the computer.',
    gameId: 'four',
    tier: 'bronze',
    reward: { coins: 150, gems: 0 },
    goal: { type: 'total', key: 'four.wins', target: 1 },
  },
  {
    id: 'four-wins4',
    name: 'Grandmaster',
    description: 'Win 4 games in one run.',
    gameId: 'four',
    tier: 'gold',
    reward: { coins: 500, gems: 3 },
    goal: { type: 'best', key: 'four.wins', target: 4 },
  },
  {
    id: 'four-wins25',
    name: 'Line Leader',
    description: 'Win 25 games in total.',
    gameId: 'four',
    tier: 'gold',
    reward: { coins: 500, gems: 3 },
    goal: { type: 'total', key: 'four.wins', target: 25 },
  },
  // Knife Hit
  {
    id: 'knife-stage5',
    name: 'Boss Breaker',
    description: 'Clear stage 5, the first boss log.',
    gameId: 'knife',
    tier: 'silver',
    reward: { coins: 300, gems: 0 },
    goal: { type: 'best', key: 'knife.stages', target: 5 },
  },
  {
    id: 'knife-stage15',
    name: 'Blade Master',
    description: 'Clear 15 stages in one run.',
    gameId: 'knife',
    tier: 'gold',
    reward: { coins: 500, gems: 3 },
    goal: { type: 'best', key: 'knife.stages', target: 15 },
  },
  {
    id: 'knife-apples50',
    name: 'Orchard',
    description: 'Hit 50 apples in total.',
    gameId: 'knife',
    tier: 'silver',
    reward: { coins: 300, gems: 0 },
    goal: { type: 'total', key: 'knife.apples', target: 50 },
  },
  // Sudoku
  {
    id: 'sudoku-1',
    name: 'First Grid',
    description: 'Solve a Sudoku.',
    gameId: 'sudoku',
    tier: 'silver',
    reward: { coins: 300, gems: 0 },
    goal: { type: 'total', key: 'sudoku.puzzles', target: 1 },
  },
  {
    id: 'sudoku-run3',
    name: 'Number Cruncher',
    description: 'Solve 3 Sudokus in one run.',
    gameId: 'sudoku',
    tier: 'gold',
    reward: { coins: 500, gems: 3 },
    goal: { type: 'best', key: 'sudoku.puzzles', target: 3 },
  },
  {
    id: 'sudoku-10',
    name: 'Sudoku Sensei',
    description: 'Solve 10 Sudokus in total.',
    gameId: 'sudoku',
    tier: 'gold',
    reward: { coins: 500, gems: 3 },
    goal: { type: 'total', key: 'sudoku.puzzles', target: 10 },
  },
  // Simon Says
  {
    id: 'simon-10',
    name: 'Good Listener',
    description: 'Repeat a sequence of 10.',
    gameId: 'simon',
    tier: 'silver',
    reward: { coins: 300, gems: 0 },
    goal: { type: 'best', key: 'simon.rounds', target: 10 },
  },
  {
    id: 'simon-20',
    name: 'Perfect Recall',
    description: 'Repeat a sequence of 20.',
    gameId: 'simon',
    tier: 'gold',
    reward: { coins: 500, gems: 3 },
    goal: { type: 'best', key: 'simon.rounds', target: 20 },
  },
  {
    id: 'simon-taps500',
    name: 'Pad Pusher',
    description: 'Play 500 pads in total.',
    gameId: 'simon',
    tier: 'silver',
    reward: { coins: 300, gems: 0 },
    goal: { type: 'total', key: 'simon.taps', target: 500 },
  },
  // Maze Chase
  {
    id: 'maze-clear',
    name: 'Clean Plate',
    description: 'Clear a maze.',
    gameId: 'maze',
    tier: 'silver',
    reward: { coins: 300, gems: 0 },
    goal: { type: 'total', key: 'maze.levels', target: 1 },
  },
  {
    id: 'maze-levels3',
    name: 'Maze Runner',
    description: 'Clear 3 mazes in one run.',
    gameId: 'maze',
    tier: 'gold',
    reward: { coins: 500, gems: 3 },
    goal: { type: 'best', key: 'maze.levels', target: 3 },
  },
  {
    id: 'maze-ghosts50',
    name: 'Ghost Buster',
    description: 'Eat 50 ghosts in total.',
    gameId: 'maze',
    tier: 'gold',
    reward: { coins: 500, gems: 3 },
    goal: { type: 'total', key: 'maze.ghosts', target: 50 },
  },
  // Mini Golf
  {
    id: 'golf-ace',
    name: 'Hole in One',
    description: 'Sink a hole in one.',
    gameId: 'golf',
    tier: 'gold',
    reward: { coins: 500, gems: 3 },
    goal: { type: 'total', key: 'golf.aces', target: 1 },
  },
  {
    id: 'golf-round',
    name: 'Full Round',
    description: 'Play all nine holes.',
    gameId: 'golf',
    tier: 'silver',
    reward: { coins: 300, gems: 0 },
    goal: { type: 'best', key: 'golf.holes', target: 9 },
  },
  {
    id: 'golf-under20',
    name: 'Birdie Hunter',
    description: 'Finish 20 holes under par in total.',
    gameId: 'golf',
    tier: 'gold',
    reward: { coins: 500, gems: 3 },
    goal: { type: 'total', key: 'golf.under', target: 20 },
  },
  // Hoops
  {
    id: 'hoops-20',
    name: 'Hot Hand',
    description: 'Sink 20 baskets in one game.',
    gameId: 'hoops',
    tier: 'silver',
    reward: { coins: 300, gems: 0 },
    goal: { type: 'best', key: 'hoops.baskets', target: 20 },
  },
  {
    id: 'hoops-streak10',
    name: 'On Fire',
    description: 'Sink 10 baskets in a row.',
    gameId: 'hoops',
    tier: 'gold',
    reward: { coins: 500, gems: 3 },
    goal: { type: 'best', key: 'hoops.streak', target: 10 },
  },
  {
    id: 'hoops-swish100',
    name: 'Nothing but Net',
    description: 'Swish 100 baskets in total.',
    gameId: 'hoops',
    tier: 'gold',
    reward: { coins: 500, gems: 3 },
    goal: { type: 'total', key: 'hoops.swishes', target: 100 },
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

/**
 * Achievements whose goal is met but which are not yet recorded as unlocked. Any recorded unlock time
 * counts, 0 included (an imported save or a clock at the epoch), so a reward is never paid twice.
 */
export function newlyCompleted(p: Profile): AchievementDef[] {
  return ACHIEVEMENTS.filter(
    (a) => p.achievements[a.id] === undefined && achievementProgress(a, p).current >= a.goal.target,
  );
}

/** How many of the arcade's achievements are unlocked (ids a save may carry from elsewhere don't count). */
export function unlockedCount(p: Profile): number {
  return ACHIEVEMENTS.filter((a) => p.achievements[a.id] !== undefined).length;
}

export function getAchievement(id: string): AchievementDef | undefined {
  return ACHIEVEMENTS.find((a) => a.id === id);
}
