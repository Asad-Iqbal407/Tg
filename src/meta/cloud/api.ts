/**
 * Typed client for the routes in shared/api.ts. Requests go to `./api/...` on the page's own origin,
 * carry the httpOnly session cookie, and give up after REQUEST_TIMEOUT_MS.
 *
 * Failures come in two kinds. An ApiError is a JSON error body from the server. A NetworkError means
 * no usable answer arrived: the browser is offline, the request timed out, the connection failed, or
 * the reply was not the JSON the contract promises (a static host's 404 page, for example).
 */
import type {
  AccountResponse,
  ApiErrorCode,
  Credentials,
  LeaderboardEntry,
  LeaderboardResponse,
  PublicUser,
  RunRequest,
  RunResponse,
  SaveProfileRequest,
  SaveProfileResponse,
  SessionResponse,
} from '../../../shared/api';
import type { GameId } from '../../games/types';
import { asRecord, isFiniteNumber } from './guards';

/** Mirrors API_PATH in shared/api.ts. Runtime code imports only types from the contract. */
export const API_ROOT = './api/';
export const REQUEST_TIMEOUT_MS = 8000;

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiErrorCode,
    message: string,
    /** Set on a 409 version_conflict: the version the server holds now. */
    readonly version?: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export type NetworkReason = 'offline' | 'timeout' | 'unreachable';

export class NetworkError extends Error {
  constructor(readonly reason: NetworkReason) {
    super(`The arcade server could not be reached (${reason}).`);
    this.name = 'NetworkError';
  }
}

/** `keepalive` lets a request outlive the page, which is how changes are sent on pagehide. */
export interface RequestOptions {
  keepalive?: boolean;
}

export interface CloudApi {
  session(): Promise<SessionResponse>;
  register(credentials: Credentials): Promise<AccountResponse>;
  login(credentials: Credentials): Promise<AccountResponse>;
  getProfile(): Promise<AccountResponse>;
  saveProfile(request: SaveProfileRequest, opts?: RequestOptions): Promise<SaveProfileResponse>;
  postRun(run: RunRequest, opts?: RequestOptions): Promise<RunResponse>;
  leaderboard(gameId: GameId): Promise<LeaderboardResponse>;
}

type Method = 'GET' | 'POST' | 'PUT';

async function request(
  method: Method,
  path: string,
  body?: unknown,
  opts: RequestOptions = {},
): Promise<unknown> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new NetworkError('offline');
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, REQUEST_TIMEOUT_MS);
  const unreachable = () => new NetworkError(timedOut ? 'timeout' : 'unreachable');
  try {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    let res: Response;
    let text: string;
    try {
      res = await fetch(`${API_ROOT}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        credentials: 'same-origin',
        cache: 'no-store',
        keepalive: opts.keepalive === true,
        signal: controller.signal,
      });
      text = await res.text();
    } catch {
      throw unreachable();
    }
    const data = parseJson(text);
    if (!res.ok) {
      const err = errorBody(data);
      if (err) throw new ApiError(res.status, err.code, err.message, err.version);
      throw new NetworkError('unreachable');
    }
    if (data === undefined) throw new NetworkError('unreachable');
    return data;
  } finally {
    clearTimeout(timer);
  }
}

function parseJson(text: string): unknown {
  if (text.length === 0) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function errorBody(data: unknown): { code: ApiErrorCode; message: string; version?: number } | null {
  const o = asRecord(data);
  if (o === null || typeof o.error !== 'string' || typeof o.message !== 'string') return null;
  return {
    code: o.error as ApiErrorCode,
    message: o.message,
    version: isFiniteNumber(o.version) ? o.version : undefined,
  };
}

// ---------------------------------------------------------------- reply checks

const invalid = (): never => {
  throw new NetworkError('unreachable');
};

function isPublicUser(v: unknown): v is PublicUser {
  const o = asRecord(v);
  return (
    o !== null && typeof o.id === 'string' && typeof o.username === 'string' && isFiniteNumber(o.createdAt)
  );
}

function isLeaderboardEntry(v: unknown): v is LeaderboardEntry {
  const o = asRecord(v);
  return (
    o !== null && typeof o.username === 'string' && isFiniteNumber(o.score) && isFiniteNumber(o.createdAt)
  );
}

function parseSession(data: unknown): SessionResponse {
  const o = asRecord(data);
  if (o === null || !('user' in o)) return invalid();
  if (o.user === null) return { user: null };
  return isPublicUser(o.user) ? { user: o.user } : invalid();
}

function parseAccount(data: unknown): AccountResponse {
  const o = asRecord(data);
  if (o === null || !isPublicUser(o.user) || asRecord(o.profile) === null || !isFiniteNumber(o.version)) {
    return invalid();
  }
  return { user: o.user, profile: o.profile as AccountResponse['profile'], version: o.version };
}

function parseSave(data: unknown): SaveProfileResponse {
  const o = asRecord(data);
  if (o === null || !isFiniteNumber(o.version) || !isFiniteNumber(o.savedAt)) return invalid();
  return { version: o.version, savedAt: o.savedAt };
}

function parseRun(data: unknown): RunResponse {
  const o = asRecord(data);
  if (
    o === null ||
    typeof o.id !== 'string' ||
    typeof o.duplicate !== 'boolean' ||
    !isFiniteNumber(o.createdAt)
  ) {
    return invalid();
  }
  return { id: o.id, duplicate: o.duplicate, createdAt: o.createdAt };
}

function parseLeaderboard(data: unknown, gameId: GameId): LeaderboardResponse {
  const o = asRecord(data);
  if (o === null || !Array.isArray(o.entries)) return invalid();
  return { gameId, entries: o.entries.filter(isLeaderboardEntry) };
}

/** Credentials are sent as exactly these two fields. */
function credentialsBody(c: Credentials): Credentials {
  return { username: c.username, password: c.password };
}

/** The real network implementation of CloudApi. */
export const liveApi: CloudApi = {
  session: async () => parseSession(await request('GET', 'session')),
  register: async (c) => parseAccount(await request('POST', 'register', credentialsBody(c))),
  login: async (c) => parseAccount(await request('POST', 'login', credentialsBody(c))),
  getProfile: async () => parseAccount(await request('GET', 'profile')),
  saveProfile: async (req, opts) => parseSave(await request('PUT', 'profile', req, opts)),
  postRun: async (run, opts) => parseRun(await request('POST', 'runs', run, opts)),
  leaderboard: async (gameId) =>
    parseLeaderboard(await request('GET', `leaderboard/${encodeURIComponent(gameId)}`), gameId),
};
