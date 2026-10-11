import type { GameId } from '../../src/games/types';
import type { Profile } from '../../src/meta/profile';
import type { LedgerEntry } from '../ledger';

/**
 * Storage contract. MongoRepository talks to Atlas; MemoryRepository mirrors its semantics for tests
 * and for DATA_STORE=memory. Timestamps are epoch milliseconds in both.
 */

export interface StoredUser {
  id: string;
  username: string;
  passwordHash: string;
  createdAt: number;
}

export interface StoredSession {
  /** SHA-256 of the cookie token. The token itself is never stored. */
  tokenHash: string;
  userId: string;
  createdAt: number;
  expiresAt: number;
}

export interface StoredProfile {
  profile: Profile;
  version: number;
}

export interface StoredRun {
  id: string;
  userId: string;
  /** Copied from the user at write time, so the leaderboard needs no join. */
  username: string;
  clientRunId: string;
  gameId: GameId;
  score: number;
  coins: number;
  xp: number;
  durationSec: number;
  stats: Record<string, number>;
  startedAt: number;
  createdAt: number;
}

export interface SaveProfileInput {
  userId: string;
  baseVersion: number;
  profile: Profile;
  ledger: LedgerEntry[];
  savedAt: number;
}

/** `saved: false` means the stored version no longer matches baseVersion; `version` is the current one. */
export type SaveProfileResult = { saved: true; version: number } | { saved: false; version: number };

export interface Repository {
  /** Creates indexes. Safe to call on every start. */
  ensureIndexes(): Promise<void>;
  /** True when the database answers within a short timeout. Never throws. */
  ping(): Promise<boolean>;
  close(): Promise<void>;

  /** Case-insensitive lookup. */
  findUserByUsername(username: string): Promise<StoredUser | null>;
  findUserById(id: string): Promise<StoredUser | null>;
  /** Creates the user and their profile (version 0) together. Throws DuplicateUsernameError when taken. */
  createUserWithProfile(user: StoredUser, profile: Profile): Promise<void>;

  createSession(session: StoredSession): Promise<void>;
  /** Returns the session's user, or null when the session is unknown or expired at `now`. */
  findSessionUser(tokenHash: string, now: number): Promise<StoredUser | null>;
  deleteSession(tokenHash: string): Promise<void>;

  getProfile(userId: string): Promise<StoredProfile | null>;
  /** Stores the profile and its ledger rows together, only if the stored version is still baseVersion. */
  saveProfile(input: SaveProfileInput): Promise<SaveProfileResult>;

  /** Idempotent on (userId, clientRunId). `created` is false when the run already existed. */
  insertRun(run: StoredRun): Promise<{ run: StoredRun; created: boolean }>;
  /** The player's runs, newest first. */
  listRuns(userId: string, limit: number): Promise<StoredRun[]>;
  /** The best runs for one game: score descending, then earliest first. */
  topRuns(gameId: GameId, limit: number): Promise<StoredRun[]>;
}

export class DuplicateUsernameError extends Error {
  constructor() {
    super('Username is already taken.');
    this.name = 'DuplicateUsernameError';
  }
}

/** Usernames are unique ignoring case, so every lookup and index uses this form. */
export function normalizeUsername(username: string): string {
  return username.toLowerCase();
}
