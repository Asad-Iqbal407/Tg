import { afterEach, describe, expect, it } from 'vitest';
import { createRateLimiter } from '../../server/http/rate-limit';
import { type TestServer, PASSWORD, register, send, startServer } from './helpers';

const FIFTEEN_MINUTES = 15 * 60 * 1000;
let server: TestServer | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
});

async function boot(config: Parameters<typeof startServer>[0] = {}): Promise<TestServer> {
  server = await startServer(config);
  return server;
}

describe('createRateLimiter', () => {
  it('allows the limit per window and refuses the next attempt with the time to wait', () => {
    const limiter = createRateLimiter({ limit: 2, windowMs: 10_000 });
    expect(limiter.hit('k', 0)).toEqual({ allowed: true });
    expect(limiter.hit('k', 1_000)).toEqual({ allowed: true });
    expect(limiter.hit('k', 2_000)).toEqual({ allowed: false, retryAfterSec: 8 });
    expect(limiter.hit('other', 2_000)).toEqual({ allowed: true });
  });

  it('starts a new window once the old one has ended', () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 10_000 });
    expect(limiter.hit('k', 0).allowed).toBe(true);
    expect(limiter.hit('k', 5_000).allowed).toBe(false);
    expect(limiter.hit('k', 10_000)).toEqual({ allowed: true });
  });
});

describe('auth rate limiting', () => {
  it('allows ten login attempts per client, then answers 429 with Retry-After', async () => {
    const app = await boot();
    for (let i = 0; i < 10; i++) {
      const attempt = await send(app, 'POST', '/api/login', {
        body: { username: 'Target_One', password: 'wrong-password-value' },
      });
      expect(attempt.status).toBe(401);
    }

    const blocked = await send(app, 'POST', '/api/login', {
      body: { username: 'Target_One', password: PASSWORD },
    });
    expect(blocked.status).toBe(429);
    expect(blocked.body).toEqual({ error: 'rate_limited', message: 'Too many attempts. Try again later.' });
    expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(Number(blocked.headers.get('retry-after'))).toBeLessThanOrEqual(15 * 60);
  });

  it('counts register attempts against the same client limit', async () => {
    const app = await boot({ rateLimit: { limit: 2, windowMs: FIFTEEN_MINUTES } });
    expect((await register(app, 'Reg_One')).reply.status).toBe(201);
    expect((await register(app, 'Reg_Two')).reply.status).toBe(201);
    const third = await send(app, 'POST', '/api/register', {
      body: { username: 'Reg_Three', password: PASSWORD },
    });
    expect(third.status).toBe(429);
  });

  it('limits a username across client addresses, so rotating addresses does not unlock it', async () => {
    const app = await boot({ config: { trustProxy: true } });
    for (let i = 0; i < 10; i++) {
      await send(app, 'POST', '/api/login', {
        body: { username: 'Shared_Target', password: 'wrong-password-value' },
        headers: { 'X-Forwarded-For': `10.0.0.${i + 1}` },
      });
    }
    const fromNewAddress = await send(app, 'POST', '/api/login', {
      body: { username: 'shared_target', password: PASSWORD },
      headers: { 'X-Forwarded-For': '10.9.9.9' },
    });
    expect(fromNewAddress.status).toBe(429);

    const otherUser = await send(app, 'POST', '/api/login', {
      body: { username: 'Someone_Else', password: 'wrong-password-value' },
      headers: { 'X-Forwarded-For': '10.9.9.9' },
    });
    expect(otherUser.status).toBe(401);
  });

  it('reopens after the fifteen-minute window passes', async () => {
    const app = await boot({ rateLimit: { limit: 1, windowMs: FIFTEEN_MINUTES } });
    await send(app, 'POST', '/api/login', {
      body: { username: 'Window_Test', password: 'wrong-password-value' },
    });
    const blocked = await send(app, 'POST', '/api/login', {
      body: { username: 'Window_Test', password: 'wrong-password-value' },
    });
    expect(blocked.status).toBe(429);

    app.clock.now += FIFTEEN_MINUTES + 1_000;
    const reopened = await send(app, 'POST', '/api/login', {
      body: { username: 'Window_Test', password: 'wrong-password-value' },
    });
    expect(reopened.status).toBe(401);
  });

  it('does not limit reads', async () => {
    const app = await boot({ rateLimit: { limit: 1, windowMs: FIFTEEN_MINUTES } });
    for (let i = 0; i < 5; i++) {
      expect((await send(app, 'GET', '/api/session')).status).toBe(200);
    }
  });
});
