import type { BoostId } from '../games/types';

export interface DailyReward {
  coins: number;
  gems?: number;
  boost?: BoostId;
}

/** A 7-day cycle; the streak keeps counting beyond 7 and the cycle repeats. */
export const DAILY_REWARDS: readonly DailyReward[] = [
  { coins: 100 },
  { coins: 150 },
  { coins: 200, boost: 'coin-doubler' },
  { coins: 250 },
  { coins: 300, gems: 2 },
  { coins: 400, boost: 'shield' },
  { coins: 600, gems: 5, boost: 'head-start' },
];

/** Local calendar date as YYYY-MM-DD. */
export function dayKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function shiftDay(key: string, delta: number): string {
  const [y, m, d] = key.split('-').map(Number) as [number, number, number];
  // Noon avoids DST edge cases when stepping whole days.
  const date = new Date(y, m - 1, d, 12);
  date.setDate(date.getDate() + delta);
  return dayKey(date);
}

export interface DailyStatus {
  canClaim: boolean;
  /** Streak value after claiming today (or current streak if already claimed). */
  streak: number;
  /** Index into DAILY_REWARDS for today's claim. */
  index: number;
}

export function dailyStatus(daily: { lastClaim: string | null; streak: number }, today: string): DailyStatus {
  if (daily.lastClaim === today) {
    return {
      canClaim: false,
      streak: daily.streak,
      index: (Math.max(1, daily.streak) - 1) % DAILY_REWARDS.length,
    };
  }
  const continues = daily.lastClaim !== null && daily.lastClaim === shiftDay(today, -1);
  const streak = continues ? daily.streak + 1 : 1;
  return { canClaim: true, streak, index: (streak - 1) % DAILY_REWARDS.length };
}
