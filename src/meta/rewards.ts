import type { GameResult } from '../games/types';

export interface RewardOptions {
  scorePerCoin: number;
  scorePerXp: number;
  coinUpgradeLevel: number;
  xpUpgradeLevel: number;
  coinDoubler: boolean;
  xpBooster: boolean;
}

export interface RewardBreakdown {
  collected: number;
  scoreBonus: number;
  upgradeBonus: number;
  doublerBonus: number;
  coins: number;
  xpBase: number;
  xpBonus: number;
  xp: number;
}

/** Runs shorter than this earn no participation XP (prevents restart farming). */
export const MIN_RUN_SECONDS = 5;
export const PARTICIPATION_XP = 10;
/** Hard caps keep a single (possibly buggy or tampered) run from breaking the economy. */
export const MAX_RUN_COINS = 50_000;
export const MAX_RUN_XP = 50_000;

const finite = (n: number) => (Number.isFinite(n) ? n : 0);

export function computeRewards(result: GameResult, o: RewardOptions): RewardBreakdown {
  const score = Math.max(0, finite(result.score));
  const collected = Math.max(0, Math.floor(finite(result.coins)));
  const scoreBonus = Math.floor(score / Math.max(1, o.scorePerCoin));
  const base = collected + scoreBonus;
  const upgradeBonus = Math.floor(base * 0.1 * Math.max(0, o.coinUpgradeLevel));
  const subtotal = base + upgradeBonus;
  const doublerBonus = o.coinDoubler ? subtotal : 0;
  const coins = Math.min(MAX_RUN_COINS, subtotal + doublerBonus);

  const participation = finite(result.durationSec) >= MIN_RUN_SECONDS ? PARTICIPATION_XP : 0;
  const xpBase = participation + Math.floor(score / Math.max(1, o.scorePerXp));
  const withUpgrade = xpBase + Math.floor(xpBase * 0.1 * Math.max(0, o.xpUpgradeLevel));
  const xp = Math.min(MAX_RUN_XP, o.xpBooster ? withUpgrade * 2 : withUpgrade);
  return { collected, scoreBonus, upgradeBonus, doublerBonus, coins, xpBase, xpBonus: xp - xpBase, xp };
}
