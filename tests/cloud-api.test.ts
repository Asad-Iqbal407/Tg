import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { API_PATH, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, USERNAME_PATTERN } from '../shared/api';
import {
  type CloudApi,
  liveApi,
  ApiError,
  NetworkError,
  REQUEST_TIMEOUT_MS,
  API_ROOT,
} from '../src/meta/cloud/api';
import {
  CLIENT_PASSWORD_MAX,
  CLIENT_PASSWORD_MIN,
  CLIENT_USERNAME_PATTERN,
  checkCredentials,
  describeCloudError,
} from '../src/meta/cloud/credentials';
import { clearGlobalBoardCache, GLOBAL_BOARD_TTL_MS, loadGlobalBoard } from '../src/meta/cloud/leaderboard';
import { defaultProfile } from '../src/meta/profile';
import { fakeHtml, fakeResponse } from './cloud-harness';

describe('liveApi requests', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('calls relative ./api routes on the same origin, with JSON bodies for writes', async () => {
    const fetchMock = vi.fn(async () => fakeResponse(200, { user: null }));
    vi.stubGlobal('fetch', fetchMock);
    await liveApi.session();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('./api/session');
    expect(init.method).toBe('GET');
    expect(init.credentials).toBe('same-origin');
    expect(init.body).toBeUndefined();

    fetchMock.mockResolvedValueOnce(fakeResponse(200, { version: 3, savedAt: 1 }));
    await liveApi.saveProfile({ baseVersion: 2, profile: defaultProfile(1) }, { keepalive: true });
    const [putUrl, putInit] = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    expect(putUrl).toBe('./api/profile');
    expect(putInit.method).toBe('PUT');
    expect(putInit.keepalive).toBe(true);
    expect(JSON.parse(String(putInit.body))).toMatchObject({ baseVersion: 2 });
    expect((putInit.headers as Record<string, string>)['Content-Type']).toBe('application/json');
  });

  it('turns a JSON error body into an ApiError carrying the status and code', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => fakeResponse(401, { error: 'unauthorized', message: 'Sign in.' })),
    );
    const err = await liveApi.getProfile().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 401, code: 'unauthorized' });
  });

  it('exposes the server version on a 409 version_conflict', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => fakeResponse(409, { error: 'version_conflict', message: 'Stale.', version: 7 })),
    );
    const err = await liveApi
      .saveProfile({ baseVersion: 1, profile: defaultProfile(1) })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).version).toBe(7);
  });

  it('treats a non-JSON reply (such as a static host 404 page) as unreachable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => fakeHtml(404, '<html>Not found</html>')),
    );
    const err = await liveApi.session().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NetworkError);
    expect((err as NetworkError).reason).toBe('unreachable');
  });

  it('treats a successful reply that does not match the contract as unreachable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => fakeResponse(200, { hello: 'world' })),
    );
    await expect(liveApi.session()).rejects.toBeInstanceOf(NetworkError);
  });

  it('treats a failed connection as unreachable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    const err = await liveApi.session().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NetworkError);
    expect((err as NetworkError).reason).toBe('unreachable');
  });

  it('does not send anything while the browser is offline', async () => {
    const fetchMock = vi.fn(async () => fakeResponse(200, { user: null }));
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('navigator', { onLine: false });
    const err = await liveApi.session().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NetworkError);
    expect((err as NetworkError).reason).toBe('offline');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('gives up after REQUEST_TIMEOUT_MS with a timeout NetworkError', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
          }),
      ),
    );
    const outcome = liveApi.session().catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);
    const err = await outcome;
    expect(err).toBeInstanceOf(NetworkError);
    expect((err as NetworkError).reason).toBe('timeout');
  });

  it('never writes request or reply bodies to the console', async () => {
    const spies = [vi.spyOn(console, 'log'), vi.spyOn(console, 'warn'), vi.spyOn(console, 'error')];
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => fakeResponse(500, { error: 'server_error', message: 'boom' })),
    );
    await liveApi.login({ username: 'alice', password: 'secret-password-123' }).catch(() => undefined);
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    for (const spy of spies) spy.mockRestore();
  });

  it('keeps only well-formed entries from a leaderboard reply', async () => {
    const fetchMock = vi.fn(async () =>
      fakeResponse(200, {
        gameId: 'snake',
        entries: [
          { username: 'ann', score: 900, createdAt: 1 },
          { username: 'bad', score: 'lots', createdAt: 1 },
        ],
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const board = await liveApi.leaderboard('snake');
    expect(board).toEqual({ gameId: 'snake', entries: [{ username: 'ann', score: 900, createdAt: 1 }] });
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe('./api/leaderboard/snake');
  });
});

describe('global leaderboard loader', () => {
  beforeEach(() => clearGlobalBoardCache());

  it('resolves to null when the server cannot be reached', async () => {
    const api = {
      leaderboard: vi.fn(async () => {
        throw new NetworkError('unreachable');
      }),
    } as unknown as CloudApi;
    await expect(loadGlobalBoard('runner', api, 0)).resolves.toBeNull();
  });

  it('reuses a fresh reply and asks again after the TTL', async () => {
    const entries = [{ username: 'ann', score: 900, createdAt: 1 }];
    const leaderboard = vi.fn(async (gameId: string) => ({ gameId, entries }));
    const api = { leaderboard } as unknown as CloudApi;
    await loadGlobalBoard('snake', api, 0);
    await loadGlobalBoard('snake', api, GLOBAL_BOARD_TTL_MS - 1);
    expect(leaderboard).toHaveBeenCalledTimes(1);
    await loadGlobalBoard('snake', api, GLOBAL_BOARD_TTL_MS);
    expect(leaderboard).toHaveBeenCalledTimes(2);
  });
});

describe('client-side checks', () => {
  it('mirrors the contract constants', () => {
    expect(CLIENT_USERNAME_PATTERN.source).toBe(USERNAME_PATTERN.source);
    expect(CLIENT_PASSWORD_MIN).toBe(PASSWORD_MIN_LENGTH);
    expect(CLIENT_PASSWORD_MAX).toBe(PASSWORD_MAX_LENGTH);
    expect(API_ROOT).toBe(`./${API_PATH}/`);
  });

  it('checks usernames and passwords the way the server does', () => {
    expect(checkCredentials('ab', 'x'.repeat(12), 'register')?.field).toBe('username');
    expect(checkCredentials('a'.repeat(21), 'x'.repeat(12), 'register')?.field).toBe('username');
    expect(checkCredentials('has space', 'x'.repeat(12), 'signin')?.field).toBe('username');
    expect(checkCredentials('good_name', 'short', 'register')).toMatchObject({ field: 'password' });
    expect(checkCredentials('good_name', 'x'.repeat(10), 'register')).toBeNull();
    expect(checkCredentials('good_name', 'short', 'signin')).toBeNull();
    expect(checkCredentials('good_name', '', 'signin')).toMatchObject({ field: 'password' });
    expect(checkCredentials('good_name', 'x'.repeat(129), 'signin')).toMatchObject({ field: 'password' });
  });

  it('describes failures in plain language', () => {
    expect(describeCloudError(new ApiError(401, 'invalid_credentials', 'x'))).toBe(
      'That username and password do not match.',
    );
    expect(describeCloudError(new NetworkError('offline'))).toMatch(/offline/);
    expect(describeCloudError(new NetworkError('timeout'))).toMatch(/Can't reach the server/);
    expect(describeCloudError(new Error('boom'))).toBe('Something went wrong. Try again.');
  });
});
