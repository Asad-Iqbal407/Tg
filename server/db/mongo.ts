import { type ClientSession, type Collection, type Db, MongoClient, type WithId } from 'mongodb';
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

/** Fail fast: a request should not wait long for a database that is down. */
const SERVER_SELECTION_TIMEOUT_MS = 5000;
const PING_TIMEOUT_MS = 2000;
const POOL_SIZE = 5;

interface UserDoc {
  _id: string;
  username: string;
  usernameLower: string;
  passwordHash: string;
  createdAt: number;
}

interface SessionDoc {
  _id: string;
  userId: string;
  createdAt: number;
  /** A Date, because the TTL index only works on Date values. */
  expiresAt: Date;
}

interface ProfileDoc {
  _id: string;
  version: number;
  profile: Profile;
  updatedAt: number;
}

/** A run stores its id as `_id`. */
type RunDoc = Omit<StoredRun, 'id'> & { _id: string };

/**
 * MongoDB Atlas storage. Writes that touch two collections (user with profile, profile with ledger)
 * run in a transaction, which Atlas supports on its replica set.
 */
export class MongoRepository implements Repository {
  private readonly users: Collection<UserDoc>;
  private readonly sessions: Collection<SessionDoc>;
  private readonly profiles: Collection<ProfileDoc>;
  private readonly ledger: Collection<LedgerEntry>;
  private readonly runs: Collection<RunDoc>;

  private constructor(
    private readonly client: MongoClient,
    db: Db,
  ) {
    this.users = db.collection<UserDoc>('users');
    this.sessions = db.collection<SessionDoc>('sessions');
    this.profiles = db.collection<ProfileDoc>('profiles');
    this.ledger = db.collection<LedgerEntry>('ledger');
    this.runs = db.collection<RunDoc>('runs');
  }

  /** Opens the client. The first real operation (ensureIndexes) reports connection problems. */
  static async connect(uri: string, dbName: string): Promise<MongoRepository> {
    const client = new MongoClient(uri, {
      serverSelectionTimeoutMS: SERVER_SELECTION_TIMEOUT_MS,
      connectTimeoutMS: SERVER_SELECTION_TIMEOUT_MS,
      maxPoolSize: POOL_SIZE,
      appName: 'neon-arcade-api',
    });
    await client.connect();
    return new MongoRepository(client, client.db(dbName));
  }

  async ensureIndexes(): Promise<void> {
    await Promise.all([
      this.users.createIndex({ usernameLower: 1 }, { unique: true, name: 'usernameLower_unique' }),
      this.sessions.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0, name: 'expiresAt_ttl' }),
      this.ledger.createIndex({ userId: 1, createdAt: 1 }, { name: 'userId_createdAt' }),
      this.runs.createIndex(
        { userId: 1, clientRunId: 1 },
        { unique: true, name: 'userId_clientRunId_unique' },
      ),
      this.runs.createIndex({ userId: 1, createdAt: -1 }, { name: 'userId_createdAt' }),
      this.runs.createIndex({ gameId: 1, score: -1, createdAt: 1 }, { name: 'gameId_score_createdAt' }),
    ]);
  }

  async ping(): Promise<boolean> {
    try {
      await withTimeout(this.client.db('admin').command({ ping: 1 }), PING_TIMEOUT_MS);
      return true;
    } catch {
      return false;
    }
  }

  async close(): Promise<void> {
    await this.client.close();
  }

  async findUserByUsername(username: string): Promise<StoredUser | null> {
    const doc = await this.users.findOne({ usernameLower: normalizeUsername(username) });
    return doc ? toUser(doc) : null;
  }

  async findUserById(id: string): Promise<StoredUser | null> {
    const doc = await this.users.findOne({ _id: id });
    return doc ? toUser(doc) : null;
  }

  async createUserWithProfile(user: StoredUser, profile: Profile): Promise<void> {
    await this.inTransaction(async (session) => {
      await this.users.insertOne(
        {
          _id: user.id,
          username: user.username,
          usernameLower: normalizeUsername(user.username),
          passwordHash: user.passwordHash,
          createdAt: user.createdAt,
        },
        { session },
      );
      await this.profiles.insertOne(
        { _id: user.id, version: 0, profile, updatedAt: user.createdAt },
        { session },
      );
    }).catch((error: unknown) => {
      if (isDuplicateKey(error)) throw new DuplicateUsernameError();
      throw error;
    });
  }

  async createSession(session: StoredSession): Promise<void> {
    await this.sessions.insertOne({
      _id: session.tokenHash,
      userId: session.userId,
      createdAt: session.createdAt,
      expiresAt: new Date(session.expiresAt),
    });
  }

  async findSessionUser(tokenHash: string, now: number): Promise<StoredUser | null> {
    // The TTL monitor removes expired sessions about once a minute, so the expiry check is repeated here.
    const session = await this.sessions.findOne({ _id: tokenHash, expiresAt: { $gt: new Date(now) } });
    return session ? this.findUserById(session.userId) : null;
  }

  async deleteSession(tokenHash: string): Promise<void> {
    await this.sessions.deleteOne({ _id: tokenHash });
  }

  async getProfile(userId: string): Promise<StoredProfile | null> {
    const doc = await this.profiles.findOne({ _id: userId });
    return doc ? { profile: doc.profile, version: doc.version } : null;
  }

  async saveProfile(input: SaveProfileInput): Promise<SaveProfileResult> {
    let result: SaveProfileResult | undefined;
    await this.inTransaction(async (session) => {
      const update = await this.profiles.updateOne(
        { _id: input.userId, version: input.baseVersion },
        {
          $set: {
            profile: input.profile,
            version: input.baseVersion + 1,
            updatedAt: input.savedAt,
          },
        },
        { session },
      );
      if (update.matchedCount === 0) {
        const current = await this.profiles.findOne(
          { _id: input.userId },
          { session, projection: { version: 1 } },
        );
        if (!current) throw new Error('Profile not found for user.');
        result = { saved: false, version: current.version };
        return;
      }
      if (input.ledger.length > 0) await this.ledger.insertMany(input.ledger, { session });
      result = { saved: true, version: input.baseVersion + 1 };
    });
    if (!result) throw new Error('Profile save did not complete.');
    return result;
  }

  async insertRun(run: StoredRun): Promise<{ run: StoredRun; created: boolean }> {
    const { id, ...fields } = run;
    try {
      await this.runs.insertOne({ _id: id, ...fields });
      return { run, created: true };
    } catch (error) {
      if (!isDuplicateKey(error)) throw error;
      const existing = await this.runs.findOne({ userId: run.userId, clientRunId: run.clientRunId });
      if (!existing) throw error;
      return { run: toRun(existing), created: false };
    }
  }

  async listRuns(userId: string, limit: number): Promise<StoredRun[]> {
    const docs = await this.runs.find({ userId }).sort({ createdAt: -1, _id: -1 }).limit(limit).toArray();
    return docs.map(toRun);
  }

  async topRuns(gameId: GameId, limit: number): Promise<StoredRun[]> {
    const docs = await this.runs
      .find({ gameId })
      .sort({ score: -1, createdAt: 1, _id: 1 })
      .limit(limit)
      .toArray();
    return docs.map(toRun);
  }

  private async inTransaction(work: (session: ClientSession) => Promise<void>): Promise<void> {
    const session = this.client.startSession();
    try {
      await session.withTransaction(() => work(session));
    } finally {
      await session.endSession();
    }
  }
}

function toUser(doc: WithId<UserDoc>): StoredUser {
  return { id: doc._id, username: doc.username, passwordHash: doc.passwordHash, createdAt: doc.createdAt };
}

function toRun(doc: WithId<RunDoc>): StoredRun {
  const { _id, ...fields } = doc;
  return { id: _id, ...fields };
}

function isDuplicateKey(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 11000;
}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('Timed out.')), ms);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}
