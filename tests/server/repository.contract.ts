import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { defaultProfile } from '../../src/meta/profile';
import { DuplicateUsernameError, type Repository, type StoredRun } from '../../server/db/repository';

/**
 * Behaviour every Repository must share. MemoryRepository runs it on every test run. MongoRepository runs
 * it only when MONGODB_TEST_URI is set. Usernames and ids are unique per test, so one database can host
 * the whole suite.
 */
export function repositoryContract(name: string, create: () => Promise<Repository>): void {
  describe(`${name} repository contract`, () => {
    const suffix = () => randomUUID().replace(/-/g, '').slice(0, 10);

    function run(overrides: Partial<StoredRun>): StoredRun {
      return {
        id: randomUUID(),
        userId: randomUUID(),
        username: 'runner',
        clientRunId: randomUUID(),
        gameId: 'snake',
        score: 100,
        coins: 1,
        xp: 2,
        durationSec: 30,
        stats: { food: 3 },
        startedAt: 1,
        createdAt: 1,
        ...overrides,
      };
    }

    it('finds users ignoring case and rejects duplicate names', async () => {
      const repo = await create();
      const name = `Case_${suffix()}`;
      const id = randomUUID();
      await repo.createUserWithProfile(
        { id, username: name, passwordHash: 'hash', createdAt: 1 },
        defaultProfile(1),
      );

      expect((await repo.findUserByUsername(name.toUpperCase()))?.id).toBe(id);
      expect((await repo.findUserById(id))?.username).toBe(name);
      await expect(
        repo.createUserWithProfile(
          { id: randomUUID(), username: name.toLowerCase(), passwordHash: 'hash', createdAt: 2 },
          defaultProfile(2),
        ),
      ).rejects.toBeInstanceOf(DuplicateUsernameError);
    });

    it('creates the profile at version 0 and saves only against the current version', async () => {
      const repo = await create();
      const id = randomUUID();
      await repo.createUserWithProfile(
        { id, username: `Save_${suffix()}`, passwordHash: 'hash', createdAt: 1 },
        defaultProfile(1),
      );
      expect((await repo.getProfile(id))?.version).toBe(0);

      const next = { ...defaultProfile(1), coins: 999 };
      const saved = await repo.saveProfile({
        userId: id,
        baseVersion: 0,
        profile: next,
        ledger: [],
        savedAt: 5,
      });
      expect(saved).toEqual({ saved: true, version: 1 });

      const stale = await repo.saveProfile({
        userId: id,
        baseVersion: 0,
        profile: next,
        ledger: [],
        savedAt: 6,
      });
      expect(stale).toEqual({ saved: false, version: 1 });

      const stored = await repo.getProfile(id);
      expect(stored?.version).toBe(1);
      expect(stored?.profile.coins).toBe(999);
    });

    it('treats unknown and expired sessions as absent', async () => {
      const repo = await create();
      const userId = randomUUID();
      const username = `Sess_${suffix()}`;
      await repo.createUserWithProfile(
        { id: userId, username, passwordHash: 'hash', createdAt: 1 },
        defaultProfile(1),
      );
      expect(await repo.findSessionUser('no-such-token', 1_000)).toBeNull();

      await repo.createSession({ tokenHash: 'live', userId, createdAt: 1_000, expiresAt: 5_000 });
      await repo.createSession({ tokenHash: 'old', userId, createdAt: 1_000, expiresAt: 2_000 });
      expect((await repo.findSessionUser('live', 4_999))?.username).toBe(username);
      expect(await repo.findSessionUser('live', 5_000)).toBeNull();
      expect(await repo.findSessionUser('old', 2_500)).toBeNull();

      await repo.deleteSession('live');
      expect(await repo.findSessionUser('live', 1_500)).toBeNull();
    });

    it('stores a run once per (userId, clientRunId)', async () => {
      const repo = await create();
      const first = run({ createdAt: 10 });
      const again = run({ userId: first.userId, clientRunId: first.clientRunId, score: 1, createdAt: 20 });

      expect(await repo.insertRun(first)).toEqual({ run: first, created: true });
      const second = await repo.insertRun(again);
      expect(second.created).toBe(false);
      expect(second.run.id).toBe(first.id);
      expect(second.run.score).toBe(100);

      const other = await repo.insertRun(run({ clientRunId: first.clientRunId }));
      expect(other.created).toBe(true);
    });

    it('lists a player runs newest first and honours the limit', async () => {
      const repo = await create();
      const userId = randomUUID();
      for (const createdAt of [10, 30, 20]) await repo.insertRun(run({ userId, createdAt }));
      await repo.insertRun(run({ createdAt: 40 }));

      const runs = await repo.listRuns(userId, 2);
      expect(runs.map((r) => r.createdAt)).toEqual([30, 20]);
      expect(runs.every((r) => r.userId === userId)).toBe(true);
    });

    it('ranks runs per game by score, then earliest', async () => {
      const repo = await create();
      const game = 'hill' as const;
      const other = 'duck' as const;
      await repo.insertRun(run({ gameId: game, score: 50, createdAt: 3 }));
      await repo.insertRun(run({ gameId: game, score: 90, createdAt: 9 }));
      await repo.insertRun(run({ gameId: game, score: 90, createdAt: 2 }));
      await repo.insertRun(run({ gameId: other, score: 1_000, createdAt: 1 }));

      const top = await repo.topRuns(game, 3);
      expect(top.map((r) => [r.score, r.createdAt])).toEqual([
        [90, 2],
        [90, 9],
        [50, 3],
      ]);
      expect(top.every((r) => r.gameId === game)).toBe(true);
    });

    it('reports the database as reachable', async () => {
      const repo = await create();
      expect(await repo.ping()).toBe(true);
    });
  });
}
