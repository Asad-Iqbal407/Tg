import { describe, expect, it, vi } from 'vitest';
import { authenticate } from '../../server/auth/credentials';
import { dummyHash, hashPassword, verifyPassword } from '../../server/auth/password';
import { MemoryRepository } from '../../server/db/memory';
import { defaultProfile } from '../../src/meta/profile';

describe('password hashing', () => {
  it('round-trips a password and rejects a wrong one', async () => {
    const hash = await hashPassword('correct-horse-battery');
    expect(hash.startsWith('scrypt$16384$8$1$')).toBe(true);
    expect(await verifyPassword('correct-horse-battery', hash)).toBe(true);
    expect(await verifyPassword('correct-horse-batter', hash)).toBe(false);
  });

  it('salts each hash, so equal passwords store different values', async () => {
    const a = await hashPassword('same-password-here');
    const b = await hashPassword('same-password-here');
    expect(a).not.toBe(b);
    expect(await verifyPassword('same-password-here', b)).toBe(true);
  });

  it('rejects stored values it cannot parse', async () => {
    expect(await verifyPassword('anything-at-all', 'not-a-hash')).toBe(false);
    expect(await verifyPassword('anything-at-all', 'scrypt$16384$8$1$$')).toBe(false);
    expect(await verifyPassword('anything-at-all', 'scrypt$0$8$1$c2FsdA$a2V5')).toBe(false);
    expect(await verifyPassword('anything-at-all', 'bcrypt$16384$8$1$c2FsdA$a2V5')).toBe(false);
  });

  it('verifies against the dummy hash and never matches it', async () => {
    const dummy = await dummyHash();
    expect(dummy.startsWith('scrypt$16384$8$1$')).toBe(true);
    expect(await verifyPassword('anything-at-all', dummy)).toBe(false);
  });
});

describe('authenticate', () => {
  async function repoWithAlice(): Promise<MemoryRepository> {
    const repo = new MemoryRepository();
    await repo.createUserWithProfile(
      {
        id: 'user-1',
        username: 'Alice_01',
        passwordHash: await hashPassword('correct-horse-battery'),
        createdAt: 1,
      },
      defaultProfile(1),
    );
    return repo;
  }

  it('returns the user for the right password, ignoring username case', async () => {
    const repo = await repoWithAlice();
    expect((await authenticate(repo, 'alice_01', 'correct-horse-battery'))?.id).toBe('user-1');
  });

  it('returns null for a wrong password', async () => {
    const repo = await repoWithAlice();
    expect(await authenticate(repo, 'Alice_01', 'wrong-horse-battery')).toBeNull();
  });

  it('checks an unknown username against the dummy hash, so the work matches a real check', async () => {
    const repo = await repoWithAlice();
    const verify = vi.fn(async (_password: string, _stored: string) => false);
    expect(await authenticate(repo, 'nobody_here', 'some-password-value', verify)).toBeNull();
    expect(verify).toHaveBeenCalledTimes(1);
    expect(verify.mock.calls[0]?.[1]).toBe(await dummyHash());
  });

  it('checks a known username against its own hash', async () => {
    const repo = await repoWithAlice();
    const verify = vi.fn(async (_password: string, _stored: string) => true);
    expect((await authenticate(repo, 'Alice_01', 'correct-horse-battery', verify))?.id).toBe('user-1');
    expect(verify.mock.calls[0]?.[1]).not.toBe(await dummyHash());
  });
});
