import { hashString } from '../core/rng';
import type { GameId } from '../games/types';

/**
 * Daily Challenge: once a day, each game offers a run on a seed everyone shares, so the same layout, the same pieces
 * and the same enemies come up for every player that day. The first run that scores pays a one-off bonus.
 */
export interface ChallengeRecord {
  /** The day (YYYY-MM-DD) these figures are for; older figures count as nothing. */
  day: string;
  /** Best score of the day's attempts. */
  best: number;
  /** Attempts finished that day. */
  plays: number;
  /** Whether the day's bonus has been paid. */
  claimed: boolean;
}

export const CHALLENGE_COINS = 50;
export const CHALLENGE_XP = 50;

export function emptyChallenge(): ChallengeRecord {
  return { day: '', best: 0, plays: 0, claimed: false };
}

/** The seed every player gets for `gameId` on `day`. */
export function challengeSeed(day: string, gameId: GameId): number {
  return hashString(`challenge:${day}:${gameId}`);
}

/** The record as it stands on `day`: yesterday's attempts are gone. */
export function challengeOn(rec: ChallengeRecord, day: string): ChallengeRecord {
  return rec.day === day ? rec : { ...emptyChallenge(), day };
}

/** What a finished challenge run did, for the results screen. */
export interface ChallengeOutcome {
  day: string;
  /** Which attempt of the day this was. */
  attempt: number;
  /** Best score of the day, this run included. */
  bestToday: number;
  /** Whether this run beat an earlier attempt of the day. */
  beatBest: boolean;
  /** Bonus paid by this run (0 when the day's bonus was already taken, or the run scored nothing). */
  bonusCoins: number;
  bonusXp: number;
}
