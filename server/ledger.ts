import type { Profile } from '../src/meta/profile';

/** A single save may add at most this many ledger rows. Larger saves are refused with 413. */
export const MAX_LEDGER_ENTRIES = 500;

export type LedgerKind = 'coins' | 'gems' | 'xp' | 'achievement' | 'mission' | 'purchase' | 'daily';

export interface LedgerEntry {
  userId: string;
  kind: LedgerKind;
  /**
   * Signed balance change for coins, gems and xp. Spending is negative. Other kinds carry no amount,
   * so summing the amounts of a user's rows gives their current balances.
   */
  amount?: number;
  /** Achievement id, mission id, item id or claim day. Null for balance rows. */
  ref: string | null;
  /** Mission rewards, recorded for reference. The balances they add appear in the coins, gems and xp rows. */
  reward?: { coins: number; xp: number; gems: number };
  /** Streak after a daily claim. */
  streak?: number;
  createdAt: number;
}

/**
 * The ledger rows a save produces, from comparing the stored profile with the new one. Both profiles
 * must already be sanitized, so the comparison only sees canonical values.
 */
export function diffProfiles(
  before: Profile,
  after: Profile,
  userId: string,
  createdAt: number,
): LedgerEntry[] {
  const entries: LedgerEntry[] = [];
  const base = { userId, createdAt };

  const balances = [
    ['coins', before.coins, after.coins],
    ['gems', before.gems, after.gems],
    ['xp', before.xp, after.xp],
  ] as const;
  for (const [kind, prev, next] of balances) {
    if (next !== prev) entries.push({ ...base, kind, amount: next - prev, ref: null });
  }

  for (const id of Object.keys(after.achievements)) {
    if (!Object.hasOwn(before.achievements, id)) entries.push({ ...base, kind: 'achievement', ref: id });
  }

  const owned = new Set(before.owned);
  for (const id of after.owned) {
    if (!owned.has(id)) entries.push({ ...base, kind: 'purchase', ref: id });
  }

  const claimed = new Set(before.missions.list.filter((m) => m.claimed).map((m) => m.id));
  for (const mission of after.missions.list) {
    if (mission.claimed && !claimed.has(mission.id)) {
      const reward = { ...mission.reward };
      entries.push({ ...base, kind: 'mission', ref: mission.id, reward });
    }
  }

  const claim = after.daily.lastClaim;
  if (claim !== null && claim !== before.daily.lastClaim) {
    entries.push({ ...base, kind: 'daily', ref: claim, streak: after.daily.streak });
  }

  return entries;
}
