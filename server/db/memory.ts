import type { GameId } from '../../src/games/types';
import type { Profile } from '../../src/meta/profile';
import type { LedgerEntry } from '../ledger';
import {
  DuplicateUsernameError,
  normalizeUsername,
  type Repository,
  type SaveProfileInput,
  type SaveProfileResult,
  type StoredProfile,
  type StoredRun,
  type StoredSession,
  type StoredUser,
} from './repository';

/**
 * In-process repository with the same rules as MongoRepository: unique usernames ignoring case, one run
 * per (userId, clientRunId), conditional profile saves and expiring sessions. Data lives only as long as
 * the process, so use it for tests and local development.
 */
export class MemoryRepository implements Repository {
  private readonly users = new Map<string, StoredUser>();
  private readonly userIdByName = new Map<string, string>();
  private readonly sessions = new Map<string, StoredSession>();
  private readonly profiles = new Map<string, StoredProfile>();
  private readonly ledger: LedgerEntry[] = [];
  private readonly runs: StoredRun[] = [];

  async ensureIndexes(): Promise<void> {}

  async ping(): Promise<boolean> {
    return true;
  }

  async close(): Promise<void> {}

  async findUserByUsername(username: string): Promise<StoredUser | null> {
    const id = this.userIdByName.get(normalizeUsername(username));
    return id === undefined ? null : copy(this.users.get(id));
  }

  async findUserById(id: string): Promise<StoredUser | null> {
    return copy(this.users.get(id));
  }

  async createUserWithProfile(user: StoredUser, profile: Profile): Promise<void> {
    const key = normalizeUsername(user.username);
    if (this.userIdByName.has(key)) throw new DuplicateUsernameError();
    this.users.set(user.id, { ...user });
    this.userIdByName.set(key, user.id);
    this.profiles.set(user.id, { profile: structuredClone(profile), version: 0 });
  }

  async createSession(session: StoredSession): Promise<void> {
    this.sessions.set(session.tokenHash, { ...session });
  }

  async findSessionUser(tokenHash: string, now: number): Promise<StoredUser | null> {
    const session = this.sessions.get(tokenHash);
    if (!session) return null;
    if (session.expiresAt <= now) {
      this.sessions.delete(tokenHash);
      return null;
    }
    return copy(this.users.get(session.userId));
  }

  async deleteSession(tokenHash: string): Promise<void> {
    this.sessions.delete(tokenHash);
  }

  async getProfile(userId: string): Promise<StoredProfile | null> {
    const stored = this.profiles.get(userId);
    return stored ? { profile: structuredClone(stored.profile), version: stored.version } : null;
  }

  async saveProfile(input: SaveProfileInput): Promise<SaveProfileResult> {
    const stored = this.profiles.get(input.userId);
    if (!stored) throw new Error('Profile not found for user.');
    if (stored.version !== input.baseVersion) return { saved: false, version: stored.version };
    const version = stored.version + 1;
    this.profiles.set(input.userId, { profile: structuredClone(input.profile), version });
    this.ledger.push(...input.ledger.map((entry) => structuredClone(entry)));
    return { saved: true, version };
  }

  async insertRun(run: StoredRun): Promise<{ run: StoredRun; created: boolean }> {
    const existing = this.runs.find((r) => r.userId === run.userId && r.clientRunId === run.clientRunId);
    if (existing) return { run: structuredClone(existing), created: false };
    this.runs.push(structuredClone(run));
    return { run: structuredClone(run), created: true };
  }

  async listRuns(userId: string, limit: number): Promise<StoredRun[]> {
    // Insertion order breaks ties, so the newest of two runs with the same timestamp comes first.
    return this.runs
      .map((run, seq) => ({ run, seq }))
      .filter(({ run }) => run.userId === userId)
      .sort((a, b) => b.run.createdAt - a.run.createdAt || b.seq - a.seq)
      .slice(0, limit)
      .map(({ run }) => structuredClone(run));
  }

  async topRuns(gameId: GameId, limit: number): Promise<StoredRun[]> {
    return this.runs
      .map((run, seq) => ({ run, seq }))
      .filter(({ run }) => run.gameId === gameId)
      .sort((a, b) => b.run.score - a.run.score || a.run.createdAt - b.run.createdAt || a.seq - b.seq)
      .slice(0, limit)
      .map(({ run }) => structuredClone(run));
  }

  /** Ledger rows written so far, for tests. Not part of the Repository contract. */
  ledgerEntries(): LedgerEntry[] {
    return this.ledger.map((entry) => structuredClone(entry));
  }
}

function copy(user: StoredUser | undefined): StoredUser | null {
  return user ? { ...user } : null;
}
