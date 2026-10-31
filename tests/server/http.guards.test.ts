import { afterEach, describe, expect, it } from 'vitest';
import { MemoryRepository } from '../../server/db/memory';
import { PASSWORD, type TestServer, register, send, startServer } from './helpers';

let server: TestServer | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
});

async function boot(options: Parameters<typeof startServer>[0] = {}): Promise<TestServer> {
  server = await startServer(options);
  return server;
}

describe('state-changing requests', () => {
  it('refuses a body that is not application/json with 415', async () => {
    const app = await boot();
    const form = await send(app, 'POST', '/api/register', {
      raw: `username=alice&password=${PASSWORD}`,
      contentType: 'application/x-www-form-urlencoded',
    });
    expect(form.status).toBe(415);
    expect(form.body).toEqual({
      error: 'unsupported_media_type',
      message: 'Send the request body as application/json.',
    });

    const none = await send(app, 'POST', '/api/logout', { contentType: null });
    expect(none.status).toBe(415);
  });

  it('accepts application/json with a charset parameter', async () => {
    const app = await boot();
    const reply = await send(app, 'POST', '/api/logout', { contentType: 'application/json; charset=utf-8' });
    expect(reply.status).toBe(200);
  });

  it('refuses a foreign Origin with 403 forbidden_origin, before anything else runs', async () => {
    const app = await boot();
    const reply = await send(app, 'POST', '/api/register', {
      body: { username: 'cross_site', password: PASSWORD },
      origin: 'https://evil.example',
    });
    expect(reply.status).toBe(403);
    expect(reply.body.error).toBe('forbidden_origin');
    expect(await app.repo.findUserByUsername('cross_site')).toBeNull();
  });

  it('refuses an Origin of "null" and a near-miss of the app origin', async () => {
    const app = await boot();
    expect((await send(app, 'POST', '/api/logout', { origin: 'null' })).status).toBe(403);
    expect((await send(app, 'POST', '/api/logout', { origin: 'http://localhost:5174' })).status).toBe(403);
    expect((await send(app, 'POST', '/api/logout', { origin: 'http://localhost:5173/' })).status).toBe(403);
  });

  it('accepts the exact app origin, and requests that carry no Origin at all', async () => {
    const app = await boot();
    expect((await send(app, 'POST', '/api/logout', { origin: 'http://localhost:5173' })).status).toBe(200);
    expect((await send(app, 'POST', '/api/logout', { origin: null })).status).toBe(200);
  });

  it('applies the same checks to PUT and DELETE', async () => {
    const app = await boot();
    const { cookie } = await register(app);
    const put = await send(app, 'PUT', '/api/profile', {
      body: { baseVersion: 0, profile: {} },
      origin: 'https://evil.example',
      cookie,
    });
    expect(put.status).toBe(403);
    const del = await send(app, 'DELETE', '/api/session', { contentType: 'text/plain', raw: '', cookie });
    expect(del.status).toBe(415);
  });

  it('leaves safe methods alone, so reads never need an Origin or JSON type', async () => {
    const app = await boot();
    const reply = await send(app, 'GET', '/api/leaderboard/snake', { origin: 'https://evil.example' });
    expect(reply.status).toBe(200);
  });
});

describe('response headers and errors', () => {
  it('sets no-store and nosniff on every /api response and hides X-Powered-By', async () => {
    const app = await boot();
    for (const [method, path] of [
      ['GET', '/api/health'],
      ['GET', '/api/session'],
      ['GET', '/api/leaderboard/nope'],
    ] as const) {
      const reply = await send(app, method, path);
      expect(reply.headers.get('cache-control')).toBe('no-store');
      expect(reply.headers.get('x-content-type-options')).toBe('nosniff');
      expect(reply.headers.get('x-powered-by')).toBeNull();
    }
  });

  it('answers an unknown route with the ApiError shape', async () => {
    const app = await boot();
    const reply = await send(app, 'GET', '/api/nothing-here');
    expect(reply.status).toBe(404);
    expect(reply.body).toEqual({ error: 'not_found', message: 'Not found.' });
    expect(reply.headers.get('cache-control')).toBe('no-store');
  });

  it('rejects a JSON body above 256 KB with 413 payload_too_large', async () => {
    const app = await boot();
    const huge = JSON.stringify({ username: 'x', password: 'p'.repeat(300 * 1024) });
    const reply = await send(app, 'POST', '/api/login', { raw: huge });
    expect(reply.status).toBe(413);
    expect(reply.body).toEqual({ error: 'payload_too_large', message: 'Request body is too large.' });
  });

  it('never leaks a stack trace or internal message on an unexpected failure', async () => {
    class BrokenRepository extends MemoryRepository {
      override async findSessionUser(): Promise<null> {
        throw new Error('connection to db-internal.example failed');
      }
    }
    const app = await boot({ repo: new BrokenRepository() });
    const reply = await send(app, 'GET', '/api/session', { cookie: 'na_session=' + 'a'.repeat(43) });
    expect(reply.status).toBe(500);
    expect(reply.body).toEqual({ error: 'server_error', message: 'Something went wrong. Please try again.' });
    expect(reply.text).not.toContain('db-internal');
    expect(reply.text).not.toContain('at ');
  });
});

describe('request log', () => {
  it('writes one JSON line per request with method, path, status and duration', async () => {
    const app = await boot();
    await send(app, 'GET', '/api/health');
    // The log line is written on the response's finish event, which can land just after the client reads it.
    await new Promise((resolve) => setTimeout(resolve, 20));
    const line = app.logs
      .map((l) => JSON.parse(l) as Record<string, unknown>)
      .find((l) => l.path === '/api/health');
    expect(line).toMatchObject({ method: 'GET', path: '/api/health', status: 200 });
    expect(typeof line?.durationMs).toBe('number');
    expect(typeof line?.time).toBe('string');
  });

  it('never logs passwords, cookies or bodies', async () => {
    const app = await boot();
    const { cookie } = await register(app, 'Quiet_Log');
    await send(app, 'POST', '/api/login', {
      body: { username: 'Quiet_Log', password: 'wrong-password-value' },
    });
    await send(app, 'GET', '/api/session', { cookie });
    const everything = app.logs.join('\n');
    expect(everything).not.toContain(PASSWORD);
    expect(everything).not.toContain('wrong-password-value');
    expect(everything).not.toContain(cookie.split('=')[1] ?? '');
    expect(everything).not.toContain('na_session');
    expect(everything).not.toContain('Quiet_Log');
  });
});
