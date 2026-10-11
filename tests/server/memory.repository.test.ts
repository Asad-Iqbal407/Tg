import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { defaultProfile } from '../../src/meta/profile';
import { MemoryRepository } from '../../server/db/memory';
import { repositoryContract } from './repository.contract';

repositoryContract('MemoryRepository', async () => new MemoryRepository());

describe('MemoryRepository specifics', () => {
  it('copies stored values so callers cannot change the store by mutating results', async () => {
    const repo = new MemoryRepository();
    const profile = defaultProfile(1);
    const id = randomUUID();
    await repo.createUserWithProfile({ id, username: 'copy_test', passwordHash: 'h', createdAt: 1 }, profile);

    profile.coins = 1;
    const stored = await repo.getProfile(id);
    expect(stored?.profile.coins).toBe(250);
    if (stored) stored.profile.coins = 2;
    expect((await repo.getProfile(id))?.profile.coins).toBe(250);
  });

  it('writes ledger rows only when the save succeeds', async () => {
    const repo = new MemoryRepository();
    const id = randomUUID();
    await repo.createUserWithProfile(
      { id, username: 'ledger_test', passwordHash: 'h', createdAt: 1 },
      defaultProfile(1),
    );
    const row = { userId: id, kind: 'coins' as const, amount: 5, ref: null, createdAt: 2 };

    await repo.saveProfile({
      userId: id,
      baseVersion: 3,
      profile: defaultProfile(1),
      ledger: [row],
      savedAt: 2,
    });
    expect(repo.ledgerEntries()).toEqual([]);

    await repo.saveProfile({
      userId: id,
      baseVersion: 0,
      profile: defaultProfile(1),
      ledger: [row],
      savedAt: 2,
    });
    expect(repo.ledgerEntries()).toEqual([row]);
  });
});
