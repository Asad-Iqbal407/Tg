import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RunRequest, SaveProfileRequest } from '../shared/api';
import { ApiError } from '../src/meta/cloud/api';
import { RUN_QUEUE_KEY, RunQueue } from '../src/meta/cloud/queue';
import { CLOUD_PREFS_KEY, readPrefs } from '../src/meta/cloud/storage';
import { callsTo, FakeCloud, finishRun, harness, profileWith, type RecordedCall } from './cloud-harness';

const PASSWORD = 'correct-horse-battery';

const puts = (cloud: FakeCloud) => callsTo(cloud, 'PUT', 'profile');
const bodyOf = (c: RecordedCall | undefined) => c?.body as SaveProfileRequest;
const runOf = (c: RecordedCall | undefined) => c?.body as RunRequest;

/** Lets pending promise continuations run, with fake timers still stopped. */
async function settle(): Promise<void> {
  for (let i = 0; i < 10; i++) await vi.advanceTimersByTimeAsync(0);
}

describe('CloudSync', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('coalesces a burst of edits into one save after 1.5 s of quiet', async () => {
    const cloud = new FakeCloud();
    cloud.addAccount('alice', PASSWORD, profileWith({ coins: 300 }));
    cloud.cookieFor('alice');
    const h = harness({ cloud });
    h.sync.start();
    await h.sync.ready;

    for (let i = 0; i < 5; i++) {
      h.store.update((p) => {
        p.coins += 1;
      });
      await vi.advanceTimersByTimeAsync(200);
    }
    await vi.advanceTimersByTimeAsync(800); // 1 s after the last edit: still waiting
    expect(puts(cloud)).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(500);
    expect(puts(cloud)).toHaveLength(1);
    expect(bodyOf(puts(cloud)[0]).profile.coins).toBe(305);
    expect(cloud.account('alice').version).toBe(2);
  });

  it('does not treat the account copy it applied as a local change (no echo)', async () => {
    const cloud = new FakeCloud();
    cloud.addAccount('alice', PASSWORD, profileWith({ coins: 900, plays: 4 }), 3);
    cloud.cookieFor('alice');
    const h = harness({ cloud });
    h.sync.start();
    await h.sync.ready;

    expect(h.store.get().coins).toBe(900);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(puts(cloud)).toHaveLength(0);
    expect(h.asked).toHaveLength(0);
    expect(readPrefs(h.backend).binding).toEqual({
      userId: cloud.account('alice').id,
      version: 3,
      pending: false,
    });
    expect(h.sync.current).toMatchObject({ kind: 'account', phase: 'saved' });
  });

  it('a change that is reverted before the save goes out sends nothing', async () => {
    const cloud = new FakeCloud();
    cloud.addAccount('alice', PASSWORD, profileWith({ coins: 300 }));
    cloud.cookieFor('alice');
    const h = harness({ cloud });
    h.sync.start();
    await h.sync.ready;

    h.store.update((p) => {
      p.coins += 1;
    });
    h.store.update((p) => {
      p.coins -= 1;
    });
    await vi.advanceTimersByTimeAsync(5000);
    expect(puts(cloud)).toHaveLength(0);
    expect(h.sync.current).toMatchObject({ phase: 'saved' });
  });

  it('on a version conflict takes the server copy, drops the stale edit and says so', async () => {
    const cloud = new FakeCloud();
    cloud.addAccount('alice', PASSWORD, profileWith({ coins: 300 }), 1);
    cloud.cookieFor('alice');
    const h = harness({ cloud });
    h.sync.start();
    await h.sync.ready;

    cloud.remoteSave('alice', profileWith({ coins: 1000 })); // another device saved version 2
    h.store.update((p) => {
      p.coins += 5; // based on version 1
    });
    await vi.advanceTimersByTimeAsync(1500);
    await settle();

    expect(puts(cloud)).toHaveLength(1);
    expect(bodyOf(puts(cloud)[0]).baseVersion).toBe(1);
    expect(h.store.get().coins).toBe(1000);
    expect(h.notices).toEqual([{ kind: 'refreshed' }]);
    expect(h.sync.current).toMatchObject({ kind: 'account', phase: 'saved' });

    await vi.advanceTimersByTimeAsync(60_000);
    expect(puts(cloud)).toHaveLength(1); // the refreshed copy is not sent back
  });

  it('retries transient failures on a 2, 4, 8 ... 60 second schedule', async () => {
    const cloud = new FakeCloud();
    cloud.addAccount('alice', PASSWORD, profileWith({ coins: 300 }));
    cloud.cookieFor('alice');
    const h = harness({ cloud });
    h.sync.start();
    await h.sync.ready;

    cloud.inject(
      'PUT',
      'profile',
      100,
      () => new Response(JSON.stringify({ error: 'server_error', message: 'down' }), { status: 503 }),
    );
    const changedAt = Date.now();
    h.store.update((p) => {
      p.coins += 1;
    });
    await vi.advanceTimersByTimeAsync(130_000);

    const attempts = puts(cloud).map((c) => c.at - changedAt);
    // First try after the debounce, then waits of 2, 4, 8, 16, 32 and 60 seconds.
    expect(attempts).toEqual([1500, 3500, 7500, 15500, 31500, 63500, 123500]);
    expect(h.sync.current).toMatchObject({ kind: 'account', phase: 'retry' });
  });

  it('retries straight away when the browser reports it is back online', async () => {
    let online = false;
    const cloud = new FakeCloud();
    cloud.addAccount('alice', PASSWORD, profileWith({ coins: 300 }));
    cloud.cookieFor('alice');
    const h = harness({ cloud, online: () => online });
    h.sync.start();
    await h.sync.ready;

    cloud.networkDown = true;
    const changedAt = Date.now();
    h.store.update((p) => {
      p.coins += 1;
    });
    await vi.advanceTimersByTimeAsync(1500);
    expect(h.sync.current).toMatchObject({ kind: 'account', phase: 'offline' });

    cloud.networkDown = false;
    online = true;
    h.env.win?.dispatchEvent(new Event('online'));
    await settle();
    expect(Date.now() - changedAt).toBe(1500); // no waiting for the backoff timer
    expect(cloud.account('alice').version).toBe(2);
    expect(h.sync.current).toMatchObject({ kind: 'account', phase: 'saved' });
  });

  it('sends pending changes with keepalive when the page is hidden', async () => {
    const cloud = new FakeCloud();
    cloud.addAccount('alice', PASSWORD, profileWith({ coins: 300 }));
    cloud.cookieFor('alice');
    const h = harness({ cloud });
    h.sync.start();
    await h.sync.ready;

    h.store.update((p) => {
      p.coins += 2;
    });
    h.env.win?.dispatchEvent(new Event('pagehide'));
    await settle();
    expect(puts(cloud)).toHaveLength(1);
    expect(puts(cloud)[0]?.keepalive).toBe(true);
    expect(cloud.account('alice').version).toBe(2);
  });

  it('guest mode makes no network calls, even when runs finish and progress changes', async () => {
    const cloud = new FakeCloud();
    const h = harness({ cloud });
    h.sync.start();
    await h.sync.ready;
    expect(h.sync.current).toEqual({ kind: 'guest' });

    finishRun(h.arcade);
    h.store.update((p) => {
      p.coins += 3;
    });
    await vi.advanceTimersByTimeAsync(120_000);

    expect(cloud.calls.map((c) => `${c.method} ${c.path}`)).toEqual(['GET session']);
    expect(h.backend.getItem(CLOUD_PREFS_KEY)).toBeNull();
    expect(h.backend.getItem(RUN_QUEUE_KEY)).toBeNull();
  });

  it('reports unavailable when the server cannot be reached, then recovers', async () => {
    const cloud = new FakeCloud();
    cloud.networkDown = true;
    const h = harness({ cloud });
    h.sync.start();
    await h.sync.ready;
    expect(h.sync.current).toEqual({ kind: 'unavailable' });

    cloud.networkDown = false;
    await vi.advanceTimersByTimeAsync(2000);
    await settle();
    expect(h.sync.current).toEqual({ kind: 'guest' });
  });

  it('reports a wrong password to the caller and leaves guest mode unchanged', async () => {
    const cloud = new FakeCloud();
    cloud.addAccount('alice', PASSWORD, profileWith({}));
    const h = harness({ cloud });
    h.sync.start();
    await h.sync.ready;

    await expect(h.sync.signIn({ username: 'alice', password: 'not-the-password' })).rejects.toBeInstanceOf(
      ApiError,
    );
    expect(h.sync.current).toEqual({ kind: 'guest' });
  });

  it('asks once when signing in finds progress that differs, and keeps the device copy if told to', async () => {
    const cloud = new FakeCloud();
    cloud.addAccount('alice', PASSWORD, profileWith({ coins: 900, plays: 4 }), 3);
    const h = harness({ cloud, ask: async () => 'device' });
    h.store.update((p) => {
      p.coins = 400;
      p.games.runner.plays = 2;
    });
    h.sync.start();
    await h.sync.ready;

    await h.sync.signIn({ username: 'alice', password: PASSWORD });
    await settle();
    expect(h.asked).toEqual([
      { username: 'alice', device: { games: 2, coins: 400 }, account: { games: 4, coins: 900 } },
    ]);
    expect(bodyOf(puts(cloud)[0]).baseVersion).toBe(3);
    expect(bodyOf(puts(cloud)[0]).profile.coins).toBe(400);
    expect(cloud.account('alice').profile.coins).toBe(400);
  });

  it('takes the account copy when asked to keep it, and sends nothing back', async () => {
    const cloud = new FakeCloud();
    cloud.addAccount('alice', PASSWORD, profileWith({ coins: 900, plays: 4 }), 3);
    const h = harness({ cloud, ask: async () => 'account' });
    h.store.update((p) => {
      p.coins = 400;
      p.games.runner.plays = 2;
    });
    h.sync.start();
    await h.sync.ready;

    await h.sync.signIn({ username: 'alice', password: PASSWORD });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.store.get().coins).toBe(900);
    expect(puts(cloud)).toHaveLength(0);
  });

  it('uploads guest progress into a new account without asking', async () => {
    const cloud = new FakeCloud();
    const h = harness({ cloud });
    h.store.update((p) => {
      p.coins = 640;
      p.games.runner.plays = 3;
    });
    h.sync.start();
    await h.sync.ready;

    await h.sync.register({ username: 'bob_99', password: PASSWORD });
    await settle();
    expect(h.asked).toHaveLength(0);
    expect(bodyOf(puts(cloud)[0]).baseVersion).toBe(1);
    expect(cloud.account('bob_99').profile.coins).toBe(640);
    expect(h.sync.current).toMatchObject({ kind: 'account', phase: 'saved' });
  });

  it('posts a finished run once, with a client id, even when the reply is lost', async () => {
    const cloud = new FakeCloud();
    cloud.addAccount('alice', PASSWORD, profileWith({}));
    cloud.cookieFor('alice');
    const h = harness({ cloud });
    h.sync.start();
    await h.sync.ready;

    // The server stores the run but the reply never arrives.
    cloud.inject('POST', 'runs', 1, (call) => {
      cloud.recordRun('alice', runOf(call));
      return 'network';
    });
    finishRun(h.arcade, 800, 12);
    await settle();
    expect(new RunQueue(h.backend).size).toBe(1);

    await vi.advanceTimersByTimeAsync(2000);
    await settle();
    const posts = callsTo(cloud, 'POST', 'runs');
    expect(posts).toHaveLength(2);
    expect(runOf(posts[0]).clientRunId).toBe(runOf(posts[1]).clientRunId);
    expect(cloud.account('alice').runs).toHaveLength(1);
    expect(new RunQueue(h.backend).size).toBe(0);
    expect(h.sync.current).toMatchObject({ kind: 'account', pendingRuns: 0 });
  });

  it('a run queued before the page closed is posted on the next visit for the same account', async () => {
    const cloud = new FakeCloud();
    cloud.addAccount('alice', PASSWORD, profileWith({}));
    cloud.cookieFor('alice');
    const first = harness({ cloud });
    first.sync.start();
    await first.sync.ready;

    cloud.networkDown = true;
    finishRun(first.arcade, 600, 5);
    await settle();
    cloud.networkDown = false;

    const next = harness({ cloud, backend: first.backend });
    next.sync.start();
    await next.sync.ready;
    await settle();
    expect(callsTo(cloud, 'POST', 'runs').length).toBeGreaterThanOrEqual(2);
    expect(cloud.account('alice').runs).toHaveLength(1);
    expect(new RunQueue(first.backend).size).toBe(0);
  });

  it("does not post another account's queued runs", async () => {
    const cloud = new FakeCloud();
    cloud.addAccount('alice', PASSWORD, profileWith({}));
    cloud.addAccount('bob', PASSWORD, profileWith({}));
    cloud.cookieFor('alice');
    const first = harness({ cloud });
    first.sync.start();
    await first.sync.ready;

    cloud.networkDown = true;
    finishRun(first.arcade, 600, 5);
    await settle();
    cloud.networkDown = false;
    cloud.calls.length = 0;

    // Bob is the signed-in player on this device now. Alice's queued run must not be credited to him.
    cloud.cookieFor('bob');
    const next = harness({ cloud, backend: first.backend });
    next.sync.start();
    await next.sync.ready;
    await settle();
    expect(callsTo(cloud, 'POST', 'runs')).toHaveLength(0);
    expect(cloud.account('bob').runs).toHaveLength(0);
    expect(cloud.account('alice').runs).toHaveLength(0);
    expect(new RunQueue(first.backend).size).toBe(1); // kept for Alice's next visit
  });

  it("signing out stops syncing, drops this account's queued runs and keeps the local profile", async () => {
    const cloud = new FakeCloud();
    cloud.addAccount('alice', PASSWORD, profileWith({ coins: 300 }));
    cloud.cookieFor('alice');
    const h = harness({ cloud });
    h.sync.start();
    await h.sync.ready;

    cloud.networkDown = true;
    finishRun(h.arcade, 700, 9);
    await settle();
    expect(h.sync.current).toMatchObject({ kind: 'account', pendingRuns: 1 });
    const before = JSON.stringify(h.store.get());

    h.sync.signOut();
    expect(h.sync.current).toEqual({ kind: 'guest' });
    expect(new RunQueue(h.backend).size).toBe(0);
    expect(JSON.stringify(h.store.get())).toBe(before);

    const callsAfterSignOut = cloud.calls.length;
    cloud.networkDown = false;
    h.store.update((p) => {
      p.coins += 1;
    });
    await vi.advanceTimersByTimeAsync(120_000);
    expect(cloud.calls.length).toBe(callsAfterSignOut);
    expect(cloud.account('alice').runs).toHaveLength(0);

    // The session cookie outlives sign-out, so the next visit must still start as a guest.
    const again = harness({ cloud, backend: h.backend, ask: async () => 'account' });
    again.sync.start();
    await again.sync.ready;
    expect(again.sync.current).toEqual({ kind: 'guest' });
    expect(callsTo(cloud, 'GET', 'profile')).toHaveLength(1); // only the first sign-in's visit

    // Signing back in asks again, because the device no longer knows what the account holds.
    await again.sync.signIn({ username: 'alice', password: PASSWORD });
    expect(again.asked).toHaveLength(1);
  });
});
