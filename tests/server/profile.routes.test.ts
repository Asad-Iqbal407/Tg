import { afterEach, describe, expect, it } from 'vitest';
import { type Json, type TestServer, register, send, startServer } from './helpers';

let server: TestServer | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
});

async function boot(): Promise<TestServer> {
  server = await startServer();
  return server;
}

async function currentProfile(app: TestServer, cookie: string): Promise<Json> {
  const reply = await send(app, 'GET', '/api/profile', { cookie });
  return reply.body.profile;
}

describe('GET /api/profile', () => {
  it('returns the profile and its version for the signed-in player', async () => {
    const app = await boot();
    const { cookie } = await register(app, 'Profile_Reader');
    const reply = await send(app, 'GET', '/api/profile', { cookie });
    expect(reply.status).toBe(200);
    expect(reply.body.version).toBe(0);
    expect(reply.body.user.username).toBe('Profile_Reader');
    expect(reply.body.profile.name).toBe('Profile_Reader');
    expect(reply.body.profile.games.snake).toEqual({
      plays: 0,
      best: 0,
      totalScore: 0,
      totalTime: 0,
      lastPlayed: 0,
    });
  });
});

describe('PUT /api/profile', () => {
  it('saves a changed profile, bumps the version and returns the save time', async () => {
    const app = await boot();
    const { cookie } = await register(app, 'Saver_One');
    const profile = await currentProfile(app, cookie);

    const saved = await send(app, 'PUT', '/api/profile', {
      body: { baseVersion: 0, profile: { ...profile, coins: 300 } },
      cookie,
    });
    expect(saved.status).toBe(200);
    expect(saved.body).toEqual({ version: 1, savedAt: expect.any(Number) });

    const reread = await send(app, 'GET', '/api/profile', { cookie });
    expect(reread.body.version).toBe(1);
    expect(reread.body.profile.coins).toBe(300);
  });

  it('stores only canonical data: names are cleaned, unknown items dropped, bad values reset', async () => {
    const app = await boot();
    const { cookie } = await register(app, 'Clean_Me');
    const profile = await currentProfile(app, cookie);

    const hostile = {
      ...profile,
      name: '  <b>Mal\u0001ory</b>  ',
      coins: 'lots',
      owned: ['not-a-real-skin', 'runner-ninja'],
      equipped: { ...profile.equipped, snake: 'runner-ninja' },
      settings: { ...profile.settings, touchControls: 'sideways', masterVolume: 9 },
      daily: { lastClaim: 'yesterday', streak: -4, best: 2 },
      __proto__poison: true,
    };
    const saved = await send(app, 'PUT', '/api/profile', {
      body: { baseVersion: 0, profile: hostile },
      cookie,
    });
    expect(saved.status).toBe(200);

    const stored = await currentProfile(app, cookie);
    expect(stored.name).not.toMatch(/[<>]/);
    expect([...stored.name].some((c) => c.charCodeAt(0) < 32)).toBe(false);
    expect(stored.name.length).toBeLessThanOrEqual(16);
    expect(stored.coins).toBe(250);
    expect(stored.owned).toContain('runner-ninja');
    expect(stored.owned).not.toContain('not-a-real-skin');
    expect(stored.equipped.snake).not.toBe('runner-ninja');
    expect(stored.settings.touchControls).toBe('auto');
    expect(stored.settings.masterVolume).toBe(1);
    expect(stored.daily).toEqual({ lastClaim: null, streak: 0, best: 2 });
    expect(stored.__proto__poison).toBeUndefined();
  });

  it('refuses a stale baseVersion with 409 version_conflict and the current version', async () => {
    const app = await boot();
    const { cookie } = await register(app, 'Racer_Two');
    const profile = await currentProfile(app, cookie);

    const first = await send(app, 'PUT', '/api/profile', { body: { baseVersion: 0, profile }, cookie });
    expect(first.status).toBe(200);

    const stale = await send(app, 'PUT', '/api/profile', {
      body: { baseVersion: 0, profile: { ...profile, coins: 999 } },
      cookie,
    });
    expect(stale.status).toBe(409);
    expect(stale.body).toEqual({
      error: 'version_conflict',
      message: expect.any(String),
      version: 1,
    });
    expect((await currentProfile(app, cookie)).coins).toBe(250);
  });

  it('answers malformed requests with 400 invalid_request', async () => {
    const app = await boot();
    const { cookie } = await register(app, 'Strict_Shape');
    const profile = await currentProfile(app, cookie);

    for (const body of [
      { baseVersion: -1, profile },
      { baseVersion: 1.5, profile },
      { baseVersion: 'zero', profile },
      { baseVersion: 0, profile: [] },
      { baseVersion: 0 },
    ]) {
      const reply = await send(app, 'PUT', '/api/profile', { body, cookie });
      expect(reply.status).toBe(400);
      expect(reply.body.error).toBe('invalid_request');
    }
  });

  it('requires a session', async () => {
    const app = await boot();
    await register(app, 'Anonymous_Save');
    const reply = await send(app, 'PUT', '/api/profile', { body: { baseVersion: 0, profile: {} } });
    expect(reply.status).toBe(401);
    expect(reply.body.error).toBe('unauthorized');
  });

  it('writes ledger rows for balance changes, unlocks, purchases and daily claims', async () => {
    const app = await boot();
    const { cookie, reply: registered } = await register(app, 'Ledger_Keeper');
    const userId = registered.body.user.id as string;
    const profile = await currentProfile(app, cookie);

    const next = {
      ...profile,
      coins: profile.coins + 100,
      xp: profile.xp + 20,
      owned: [...profile.owned, 'runner-ninja'],
      achievements: { 'first-run': 1_700_000_000_000 },
      daily: { lastClaim: '2026-01-15', streak: 1, best: 1 },
    };
    const saved = await send(app, 'PUT', '/api/profile', { body: { baseVersion: 0, profile: next }, cookie });
    expect(saved.status).toBe(200);

    const rows = app.repo.ledgerEntries();
    expect(rows.every((row) => row.userId === userId)).toBe(true);
    expect(rows.every((row) => typeof row.createdAt === 'number')).toBe(true);
    expect(rows).toContainEqual(expect.objectContaining({ kind: 'coins', amount: 100, ref: null }));
    expect(rows).toContainEqual(expect.objectContaining({ kind: 'xp', amount: 20, ref: null }));
    expect(rows).toContainEqual(expect.objectContaining({ kind: 'achievement', ref: 'first-run' }));
    expect(rows).toContainEqual(expect.objectContaining({ kind: 'purchase', ref: 'runner-ninja' }));
    expect(rows).toContainEqual(expect.objectContaining({ kind: 'daily', ref: '2026-01-15', streak: 1 }));
  });

  it('records spending as a negative balance change', async () => {
    const app = await boot();
    const { cookie } = await register(app, 'Spender_Bee');
    const profile = await currentProfile(app, cookie);
    await send(app, 'PUT', '/api/profile', {
      body: { baseVersion: 0, profile: { ...profile, coins: profile.coins - 50 } },
      cookie,
    });
    expect(app.repo.ledgerEntries()).toContainEqual(expect.objectContaining({ kind: 'coins', amount: -50 }));
  });

  it('refuses a save that would add more than 500 ledger rows, and saves nothing', async () => {
    const app = await boot();
    const { cookie } = await register(app, 'Flood_Source');
    const profile = await currentProfile(app, cookie);
    const achievements = Object.fromEntries(Array.from({ length: 501 }, (_, i) => [`ach-${i}`, 1]));

    const reply = await send(app, 'PUT', '/api/profile', {
      body: { baseVersion: 0, profile: { ...profile, achievements } },
      cookie,
    });
    expect(reply.status).toBe(413);
    expect(reply.body.error).toBe('payload_too_large');
    expect((await send(app, 'GET', '/api/profile', { cookie })).body.version).toBe(0);
    expect(app.repo.ledgerEntries()).toEqual([]);
  });
});
