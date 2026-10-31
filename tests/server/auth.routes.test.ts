import { afterEach, describe, expect, it } from 'vitest';
import { SESSION_MAX_AGE_DAYS } from '../../shared/api';
import { type TestServer, PASSWORD, register, send, sessionCookie, startServer } from './helpers';

const DAY_MS = 24 * 60 * 60 * 1000;
let server: TestServer | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
});

async function boot(config: Parameters<typeof startServer>[0] = {}): Promise<TestServer> {
  server = await startServer(config);
  return server;
}

describe('POST /api/register', () => {
  it('creates the user and profile, starts a session and returns the account', async () => {
    const app = await boot();
    const { cookie, reply } = await register(app, 'Alice_01');

    expect(reply.status).toBe(201);
    expect(reply.body.user).toEqual({
      id: expect.any(String),
      username: 'Alice_01',
      createdAt: expect.any(Number),
    });
    expect(reply.body.version).toBe(0);
    expect(reply.body.profile.name).toBe('Alice_01');
    expect(reply.body.profile.coins).toBe(250);
    expect(reply.text).not.toContain('passwordHash');
    expect(reply.text).not.toContain(PASSWORD);
    expect(cookie).toMatch(/^na_session=[A-Za-z0-9_-]{43}$/);
  });

  it('stores a salted scrypt hash and never the password', async () => {
    const app = await boot();
    await register(app, 'Hash_Check');
    const stored = await app.repo.findUserByUsername('hash_check');
    expect(stored?.passwordHash.startsWith('scrypt$16384$8$1$')).toBe(true);
    expect(stored?.passwordHash).not.toContain(PASSWORD);
  });

  it('sets the session cookie with the required attributes', async () => {
    const app = await boot();
    const { reply } = await register(app);
    const line = reply.headers.getSetCookie().find((c) => c.startsWith('na_session='));
    expect(line).toBeDefined();
    expect(line).toContain('HttpOnly');
    expect(line).toContain('SameSite=Lax');
    expect(line).toContain('Path=/');
    expect(line).toContain(`Max-Age=${SESSION_MAX_AGE_DAYS * 24 * 60 * 60}`);
    expect(line).not.toContain('Secure');
  });

  it('adds the Secure flag when COOKIE_SECURE is on', async () => {
    const app = await boot({ config: { cookieSecure: true } });
    const { reply } = await register(app);
    const line = reply.headers.getSetCookie().find((c) => c.startsWith('na_session='));
    expect(line).toContain('Secure');
  });

  it('refuses a username that is already taken, ignoring case', async () => {
    const app = await boot();
    await register(app, 'Taken_Name');
    const again = await send(app, 'POST', '/api/register', {
      body: { username: 'taken_name', password: PASSWORD },
    });
    expect(again.status).toBe(409);
    expect(again.body).toEqual({ error: 'username_taken', message: 'That username is already taken.' });
  });

  it('answers invalid input with 400 invalid_request and a readable message', async () => {
    const app = await boot();
    const short = await send(app, 'POST', '/api/register', { body: { username: 'ab', password: PASSWORD } });
    expect(short.status).toBe(400);
    expect(short.body).toEqual({
      error: 'invalid_request',
      message: 'Username must be 3 to 20 letters, digits or underscores.',
    });

    const weak = await send(app, 'POST', '/api/register', {
      body: { username: 'good_name', password: 'short' },
    });
    expect(weak.body.error).toBe('invalid_request');
    expect(weak.body.message).toBe('Password must be 10 to 128 characters.');
  });

  it('answers a body that is not JSON with 400 invalid_request', async () => {
    const app = await boot();
    const reply = await send(app, 'POST', '/api/register', { raw: '{"username":' });
    expect(reply.status).toBe(400);
    expect(reply.body).toEqual({ error: 'invalid_request', message: 'Request body must be valid JSON.' });
  });
});

describe('POST /api/login', () => {
  it('signs in with the right password and returns the account with a fresh session', async () => {
    const app = await boot();
    await register(app, 'Login_User');
    const reply = await send(app, 'POST', '/api/login', {
      body: { username: 'login_user', password: PASSWORD },
    });
    expect(reply.status).toBe(200);
    expect(reply.body.user.username).toBe('Login_User');
    expect(reply.body.version).toBe(0);
    expect(sessionCookie(reply)).toMatch(/^na_session=/);
  });

  it('answers a wrong password and an unknown user with the same 401 body', async () => {
    const app = await boot();
    await register(app, 'Known_User');
    const wrongPassword = await send(app, 'POST', '/api/login', {
      body: { username: 'Known_User', password: 'not-the-password' },
    });
    const unknownUser = await send(app, 'POST', '/api/login', {
      body: { username: 'Nobody_Here', password: PASSWORD },
    });

    expect(wrongPassword.status).toBe(401);
    expect(unknownUser.status).toBe(401);
    expect(wrongPassword.body).toEqual({
      error: 'invalid_credentials',
      message: 'Incorrect username or password.',
    });
    expect(unknownUser.body).toEqual(wrongPassword.body);
    expect(sessionCookie(wrongPassword)).toBeUndefined();
  });

  it('replaces the session the browser already carried, so the old cookie stops working', async () => {
    const app = await boot();
    const { cookie: first } = await register(app, 'Rotate_Me');
    const login = await send(app, 'POST', '/api/login', {
      body: { username: 'Rotate_Me', password: PASSWORD },
      cookie: first,
    });
    expect(login.status).toBe(200);
    const second = sessionCookie(login);

    expect((await send(app, 'GET', '/api/session', { cookie: first })).body).toEqual({ user: null });
    expect((await send(app, 'GET', '/api/session', { cookie: second })).body.user.username).toBe('Rotate_Me');
  });
});

describe('GET /api/session and POST /api/logout', () => {
  it('returns the user for a valid session and null otherwise', async () => {
    const app = await boot();
    const { cookie } = await register(app, 'Session_Me');
    const signedIn = await send(app, 'GET', '/api/session', { cookie });
    expect(signedIn.status).toBe(200);
    expect(signedIn.body.user.username).toBe('Session_Me');

    expect((await send(app, 'GET', '/api/session')).body).toEqual({ user: null });
    expect((await send(app, 'GET', '/api/session', { cookie: 'na_session=garbage' })).body).toEqual({
      user: null,
    });
  });

  it('deletes the session on logout and clears the cookie', async () => {
    const app = await boot();
    const { cookie } = await register(app, 'Leaving_Now');
    const reply = await send(app, 'POST', '/api/logout', { cookie });

    expect(reply.status).toBe(200);
    expect(reply.body).toEqual({ ok: true });
    const cleared = reply.headers.getSetCookie().find((c) => c.startsWith('na_session='));
    expect(cleared).toContain('na_session=;');
    expect(cleared).toContain('Expires=Thu, 01 Jan 1970');

    expect((await send(app, 'GET', '/api/session', { cookie })).body).toEqual({ user: null });
    expect((await send(app, 'GET', '/api/profile', { cookie })).status).toBe(401);
  });

  it('succeeds without a session, since logging out is always safe', async () => {
    const app = await boot();
    const reply = await send(app, 'POST', '/api/logout');
    expect(reply.status).toBe(200);
    expect(reply.body).toEqual({ ok: true });
  });
});

describe('session lifetime', () => {
  it('expires a session after SESSION_MAX_AGE_DAYS', async () => {
    const app = await boot();
    const { cookie } = await register(app, 'Patient_One');
    app.clock.now += (SESSION_MAX_AGE_DAYS - 1) * DAY_MS;
    expect((await send(app, 'GET', '/api/session', { cookie })).body.user?.username).toBe('Patient_One');

    app.clock.now += 2 * DAY_MS;
    expect((await send(app, 'GET', '/api/session', { cookie })).body).toEqual({ user: null });
    expect((await send(app, 'GET', '/api/profile', { cookie })).status).toBe(401);
  });

  it('answers GET /api/profile with 401 unauthorized when signed out', async () => {
    const app = await boot();
    const reply = await send(app, 'GET', '/api/profile');
    expect(reply.status).toBe(401);
    expect(reply.body.error).toBe('unauthorized');
  });
});
