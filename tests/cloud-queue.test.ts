import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RunRequest } from '../shared/api';
import { type KVBackend, MemoryBackend } from '../src/core/storage';
import type { RunSummary } from '../src/meta/arcade';
import { newRunId, RUN_QUEUE_CAP, RUN_QUEUE_KEY, RunQueue, toRunRequest } from '../src/meta/cloud/queue';
import { Backoff } from '../src/meta/cloud/sync';

const run = (id: string): RunRequest => ({
  clientRunId: id,
  gameId: 'runner',
  score: 10,
  coins: 1,
  xp: 5,
  durationSec: 20,
  stats: {},
  startedAt: 1,
});

const ids = (q: RunQueue, userId = 'u1') => q.forUser(userId).map((x) => x.run.clientRunId);

describe('Backoff', () => {
  it('doubles from 2 s and stops growing at 60 s, and reset starts over', () => {
    const b = new Backoff();
    expect(Array.from({ length: 8 }, () => b.next())).toEqual([
      2000, 4000, 8000, 16000, 32000, 60000, 60000, 60000,
    ]);
    b.reset();
    expect(b.next()).toBe(2000);
  });
});

describe('RunQueue', () => {
  it(`keeps at most ${RUN_QUEUE_CAP} runs in storage and drops the oldest first`, () => {
    const backend = new MemoryBackend();
    const queue = new RunQueue(backend);
    for (let i = 1; i <= RUN_QUEUE_CAP + 5; i++) queue.add('u1', run(`run-${i}`), i);
    expect(queue.size).toBe(RUN_QUEUE_CAP);
    expect(ids(queue)[0]).toBe('run-6');
    expect(ids(queue).at(-1)).toBe(`run-${RUN_QUEUE_CAP + 5}`);
    expect(new RunQueue(backend).size).toBe(RUN_QUEUE_CAP);
  });

  it('keeps its runs across a reload, in order', () => {
    const backend = new MemoryBackend();
    const first = new RunQueue(backend);
    first.add('u1', run('a'), 1);
    first.add('u1', run('b'), 2);
    expect(ids(new RunQueue(backend))).toEqual(['a', 'b']);
  });

  it('removes posted runs and clears the key once empty', () => {
    const backend = new MemoryBackend();
    const queue = new RunQueue(backend);
    queue.add('u1', run('a'), 1);
    queue.remove('a');
    expect(queue.size).toBe(0);
    expect(backend.getItem(RUN_QUEUE_KEY)).toBeNull();
  });

  it('removes one account’s runs without touching another’s', () => {
    const queue = new RunQueue(new MemoryBackend());
    queue.add('u1', run('a'), 1);
    queue.add('u2', run('b'), 2);
    queue.removeForUser('u1');
    expect(queue.count('u1')).toBe(0);
    expect(ids(queue, 'u2')).toEqual(['b']);
  });

  it('reads as empty from corrupted storage and drops entries that do not match the contract', () => {
    const corrupted = new MemoryBackend();
    corrupted.setItem(RUN_QUEUE_KEY, '{not json');
    expect(new RunQueue(corrupted).size).toBe(0);

    const mixed = new MemoryBackend();
    const good = { userId: 'u1', queuedAt: 1, run: run('good') };
    const badGame = { userId: 'u1', queuedAt: 1, run: { ...run('bad'), gameId: 'nope' } };
    mixed.setItem(RUN_QUEUE_KEY, JSON.stringify([good, badGame, 'junk', { userId: 'u1' }]));
    expect(ids(new RunQueue(mixed))).toEqual(['good']);
  });

  it('keeps working in memory when storage throws', () => {
    const broken: KVBackend = {
      getItem: () => {
        throw new Error('storage disabled');
      },
      setItem: () => {
        throw new Error('quota exceeded');
      },
      removeItem: () => {
        throw new Error('storage disabled');
      },
    };
    const queue = new RunQueue(broken);
    expect(queue.size).toBe(0);
    expect(() => queue.add('u1', run('a'), 1)).not.toThrow();
    expect(queue.size).toBe(1);
    expect(() => queue.remove('a')).not.toThrow();
    expect(queue.size).toBe(0);
  });
});

describe('toRunRequest', () => {
  it('clamps numbers like ArcadeService does and keeps only finite stats', () => {
    const summary = {
      gameId: 'hill',
      result: { score: -4.7, coins: 3, stats: { jumps: 2, bad: Number.NaN, neg: -1 }, durationSec: -2 },
      rewards: { coins: 17.9, xp: 30 },
    } as unknown as RunSummary;
    expect(toRunRequest(summary, 1234.6, 'id-1', 999)).toEqual({
      clientRunId: 'id-1',
      gameId: 'hill',
      score: 0,
      coins: 17,
      xp: 30,
      durationSec: 0,
      stats: { jumps: 2 },
      startedAt: 1234,
    });
  });
});

describe('newRunId', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('makes RFC 4122 version 4 ids, with or without crypto.randomUUID', () => {
    const v4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
    expect(newRunId()).toMatch(v4);
    vi.stubGlobal('crypto', {
      getRandomValues: (b: Uint8Array) => {
        b.fill(0xab);
        return b;
      },
    });
    expect(newRunId()).toMatch(v4);
  });
});
