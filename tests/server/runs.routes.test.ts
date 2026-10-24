import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { type TestServer, register, send, startServer } from './helpers';

const FIVE_MINUTES = 5 * 60 * 1000;
let server: TestServer | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
});

async function boot(): Promise<TestServer> {
  server = await startServer();
  return server;
}

function runBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    clientRunId: randomUUID(),
    gameId: 'snake',
    score: 120,
    coins: 10,
    xp: 30,
    durationSec: 42.5,
    stats: { food: 7, golden: 1 },
    startedAt: Date.UTC(2026, 0, 15, 11, 59),
    ...overrides,
  };
}

describe('POST /api/runs', () => {
  it('requires a session', async () => {
    const app = await boot();
    const reply = await send(app, 'POST', '/api/runs', { body: runBody() });
    expect(reply.status).toBe(401);
  });

  it('stores a new run with 201 and returns the same run for a duplicate clientRunId with 200', async () => {
    const app = await boot();
    const { cookie } = await register(app, 'Run_Logger');
    const body = runBody();

    const created = await send(app, 'POST', '/api/runs', { body, cookie });
    expect(created.status).toBe(201);
    expect(created.body).toEqual({ id: expect.any(String), duplicate: false, createdAt: app.clock.now });

    app.clock.now += 5_000;
    const again = await send(app, 'POST', '/api/runs', { body: { ...body, score: 999 }, cookie });
    expect(again.status).toBe(200);
    expect(again.body).toEqual({ id: created.body.id, duplicate: true, createdAt: created.body.createdAt });

    const list = await send(app, 'GET', '/api/runs', { cookie });
    expect(list.body.runs).toHaveLength(1);
    expect(list.body.runs[0].score).toBe(120);
  });

  it('treats the same clientRunId from another player as a separate run', async () => {
    const app = await boot();
    const first = await register(app, 'Player_One');
    const second = await register(app, 'Player_Two');
    const body = runBody();

    expect((await send(app, 'POST', '/api/runs', { body, cookie: first.cookie })).status).toBe(201);
    expect((await send(app, 'POST', '/api/runs', { body, cookie: second.cookie })).status).toBe(201);
  });

  it('accepts the boundary values of every field', async () => {
    const app = await boot();
    const { cookie } = await register(app, 'Edge_Values');
    const edges = [
      runBody({ score: 0, coins: 0, xp: 0, durationSec: 0, stats: {}, startedAt: 0 }),
      runBody({
        score: 10_000_000,
        coins: 1_000_000,
        xp: 1_000_000,
        durationSec: 86_400,
        stats: Object.fromEntries(Array.from({ length: 64 }, (_, i) => [`s${i}`, 1_000_000_000])),
        startedAt: app.clock.now + FIVE_MINUTES,
      }),
    ];
    for (const body of edges) {
      expect((await send(app, 'POST', '/api/runs', { body, cookie })).status).toBe(201);
    }
  });

  it('rejects each out-of-range or malformed field with a readable message', async () => {
    const app = await boot();
    const { cookie } = await register(app, 'Strict_Runs');
    const cases: [Record<string, unknown>, string][] = [
      [{ clientRunId: 'not-a-uuid' }, 'clientRunId must be a UUID.'],
      [{ gameId: 'chess' }, 'gameId must be one of the games in the arcade.'],
      [{ score: -1 }, 'score must be a whole number from 0 to 10000000.'],
      [{ score: 10_000_001 }, 'score must be a whole number from 0 to 10000000.'],
      [{ score: 1.5 }, 'score must be a whole number from 0 to 10000000.'],
      [{ score: '120' }, 'score must be a whole number from 0 to 10000000.'],
      [{ coins: 1_000_001 }, 'coins must be a whole number from 0 to 1000000.'],
      [{ xp: -5 }, 'xp must be a whole number from 0 to 1000000.'],
      [{ durationSec: 86_401 }, 'durationSec must be a number from 0 to 86400.'],
      [{ durationSec: -0.5 }, 'durationSec must be a number from 0 to 86400.'],
      [
        { stats: Object.fromEntries(Array.from({ length: 65 }, (_, i) => [`k${i}`, 1])) },
        'A run can report at most 64 stats.',
      ],
      [
        { stats: { 'bad.key': 1 } },
        'Stat names must start with a letter and use only letters, digits and underscores.',
      ],
      [
        { stats: { '9lives': 1 } },
        'Stat names must start with a letter and use only letters, digits and underscores.',
      ],
      [{ stats: { food: -1 } }, 'Stat values must be from 0 to 1000000000.'],
      [{ stats: { food: 1_000_000_001 } }, 'Stat values must be from 0 to 1000000000.'],
      [{ startedAt: -1 }, 'startedAt must be a whole number from 0 to 9007199254740991.'],
      [{ startedAt: 1.5 }, 'startedAt must be a whole number from 0 to 9007199254740991.'],
      [
        { startedAt: Number.MAX_SAFE_INTEGER - 1 },
        'startedAt cannot be more than five minutes in the future.',
      ],
    ];
    for (const [overrides, message] of cases) {
      const reply = await send(app, 'POST', '/api/runs', { body: runBody(overrides), cookie });
      expect(reply.status, JSON.stringify(overrides)).toBe(400);
      expect(reply.body.message, JSON.stringify(overrides)).toBe(message);
    }
  });

  it('refuses a start time more than five minutes ahead of the server clock', async () => {
    const app = await boot();
    const { cookie } = await register(app, 'Clock_Check');
    const late = await send(app, 'POST', '/api/runs', {
      body: runBody({ startedAt: app.clock.now + FIVE_MINUTES + 1 }),
      cookie,
    });
    expect(late.status).toBe(400);
    expect(late.body.message).toBe('startedAt cannot be more than five minutes in the future.');
  });

  it('refuses a stat named __proto__ and a body that is not an object', async () => {
    const app = await boot();
    const { cookie } = await register(app, 'Proto_Probe');
    const poisoned = JSON.stringify(runBody()).replace('"stats":{', '"stats":{"__proto__":1,');
    expect((await send(app, 'POST', '/api/runs', { raw: poisoned, cookie })).status).toBe(400);
    expect((await send(app, 'POST', '/api/runs', { body: [1, 2], cookie })).status).toBe(400);
  });
});

describe('GET /api/runs', () => {
  it('lists only the signed-in player runs, newest first, with a default limit of 20', async () => {
    const app = await boot();
    const mine = await register(app, 'List_Mine');
    const theirs = await register(app, 'List_Theirs');
    for (let i = 0; i < 25; i++) {
      app.clock.now += 1_000;
      await send(app, 'POST', '/api/runs', { body: runBody({ score: i }), cookie: mine.cookie });
    }
    await send(app, 'POST', '/api/runs', { body: runBody({ score: 9999 }), cookie: theirs.cookie });

    const reply = await send(app, 'GET', '/api/runs', { cookie: mine.cookie });
    expect(reply.status).toBe(200);
    expect(reply.body.runs).toHaveLength(20);
    const scores = reply.body.runs.map((r: { score: number }) => r.score);
    expect(scores[0]).toBe(24);
    expect(scores).not.toContain(9999);
    expect(Object.keys(reply.body.runs[0]).sort()).toEqual(
      ['coins', 'createdAt', 'durationSec', 'gameId', 'id', 'score'].sort(),
    );
  });

  it('honours limits from 1 to 50 and refuses anything else', async () => {
    const app = await boot();
    const { cookie } = await register(app, 'Limit_Test');
    for (let i = 0; i < 3; i++) await send(app, 'POST', '/api/runs', { body: runBody(), cookie });

    expect((await send(app, 'GET', '/api/runs?limit=1', { cookie })).body.runs).toHaveLength(1);
    expect((await send(app, 'GET', '/api/runs?limit=50', { cookie })).body.runs).toHaveLength(3);
    for (const query of ['limit=0', 'limit=51', 'limit=abc', 'limit=-1', 'limit=1&limit=2', 'limit=']) {
      const reply = await send(app, 'GET', `/api/runs?${query}`, { cookie });
      expect(reply.status, query).toBe(400);
      expect(reply.body.error).toBe('invalid_request');
    }
  });

  it('requires a session', async () => {
    const app = await boot();
    expect((await send(app, 'GET', '/api/runs')).status).toBe(401);
  });
});

describe('GET /api/leaderboard/:gameId', () => {
  it('returns the top 10 scores across players, highest first, ties by earliest', async () => {
    const app = await boot();
    const a = await register(app, 'Board_A');
    const b = await register(app, 'Board_B');
    const scores: [string, number][] = [
      ['a', 50],
      ['b', 300],
      ['a', 300],
      ['b', 10],
      ['a', 90],
      ['b', 70],
      ['a', 20],
      ['b', 40],
      ['a', 60],
      ['b', 80],
      ['a', 5],
      ['b', 1],
    ];
    for (const [who, score] of scores) {
      app.clock.now += 1_000;
      await send(app, 'POST', '/api/runs', {
        body: runBody({ score, gameId: 'hill' }),
        cookie: who === 'a' ? a.cookie : b.cookie,
      });
    }

    const reply = await send(app, 'GET', '/api/leaderboard/hill');
    expect(reply.status).toBe(200);
    expect(reply.body.gameId).toBe('hill');
    expect(reply.body.entries).toHaveLength(10);
    expect(reply.body.entries.map((e: { score: number }) => e.score)).toEqual([
      300, 300, 90, 80, 70, 60, 50, 40, 20, 10,
    ]);
    const [first, second] = reply.body.entries;
    expect(first.username).toBe('Board_B');
    expect(second.username).toBe('Board_A');
    expect(first.createdAt).toBeLessThan(second.createdAt);
    expect(Object.keys(first).sort()).toEqual(['createdAt', 'score', 'username']);
  });

  it('is public and only lists the requested game', async () => {
    const app = await boot();
    const { cookie } = await register(app, 'Only_Snake');
    await send(app, 'POST', '/api/runs', { body: runBody({ gameId: 'snake', score: 77 }), cookie });
    const reply = await send(app, 'GET', '/api/leaderboard/duck');
    expect(reply.status).toBe(200);
    expect(reply.body.entries).toEqual([]);
  });

  it('answers an unknown game with 404 not_found', async () => {
    const app = await boot();
    const reply = await send(app, 'GET', '/api/leaderboard/chess');
    expect(reply.status).toBe(404);
    expect(reply.body).toEqual({ error: 'not_found', message: 'Unknown game.' });
  });
});
