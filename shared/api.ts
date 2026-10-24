/**
 * HTTP contract between the arcade client and its API server. Both sides import this file, so it
 * holds types and constants only. Keep it free of runtime code so the browser bundle stays small.
 *
 * Every route lives under the same origin as the app, at `./api/...` relative to the page.
 * Authentication is an httpOnly session cookie; the client never sees or stores the session token.
 */
import type { GameId } from '../src/games/types';
import type { Profile } from '../src/meta/profile';

export const API_PATH = 'api';

/** Accepted account names: letters, digits and underscores. */
export const USERNAME_PATTERN = /^[A-Za-z0-9_]{3,20}$/;
export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;

export const SESSION_COOKIE = 'na_session';
export const SESSION_MAX_AGE_DAYS = 30;

export type ApiErrorCode =
  | 'invalid_request'
  | 'invalid_credentials'
  | 'username_taken'
  | 'unauthorized'
  | 'version_conflict'
  | 'rate_limited'
  | 'payload_too_large'
  | 'unsupported_media_type'
  | 'forbidden_origin'
  | 'not_found'
  | 'server_error'
  | 'unavailable';

/** Every non-2xx JSON body has this shape. */
export interface ApiError {
  error: ApiErrorCode;
  message: string;
}

/** 409 body for PUT /profile when the client's base version is stale. */
export interface VersionConflict extends ApiError {
  error: 'version_conflict';
  /** The version currently stored; the client should fetch the profile at this version. */
  version: number;
}

export interface PublicUser {
  id: string;
  username: string;
  createdAt: number;
}

/** GET /session. `user` is null when the request has no valid session. */
export interface SessionResponse {
  user: PublicUser | null;
}

/** POST /register and POST /login. */
export interface Credentials {
  username: string;
  password: string;
}

/** Returned by POST /register, POST /login and GET /profile. */
export interface AccountResponse {
  user: PublicUser;
  profile: Profile;
  /** Monotonic save counter; pass it back as `baseVersion` when saving. */
  version: number;
}

/** PUT /profile. `baseVersion` is the version the client last loaded or saved. */
export interface SaveProfileRequest {
  baseVersion: number;
  profile: Profile;
}

export interface SaveProfileResponse {
  version: number;
  savedAt: number;
}

/**
 * POST /runs. `clientRunId` is a UUID generated once per run on the client. Re-sending the same
 * run (after a network error, say) returns the stored run with `duplicate: true` instead of
 * recording it twice.
 */
export interface RunRequest {
  clientRunId: string;
  gameId: GameId;
  score: number;
  coins: number;
  xp: number;
  durationSec: number;
  /** Per-run statistics, as reported by the game's GameResult.stats. */
  stats: Record<string, number>;
  /** Client wall-clock time when the run started, in milliseconds since the epoch. */
  startedAt: number;
}

export interface RunResponse {
  id: string;
  duplicate: boolean;
  createdAt: number;
}

export interface RunRecord {
  id: string;
  gameId: GameId;
  score: number;
  coins: number;
  durationSec: number;
  createdAt: number;
}

/** GET /runs?limit=N: the signed-in player's most recent runs, newest first. */
export interface RunListResponse {
  runs: RunRecord[];
}

export interface LeaderboardEntry {
  username: string;
  score: number;
  createdAt: number;
}

/** GET /leaderboard/:gameId: the best scores across all players, highest first. */
export interface LeaderboardResponse {
  gameId: GameId;
  entries: LeaderboardEntry[];
}

/** GET /health. Returns 503 when the database cannot be reached. */
export interface HealthResponse {
  ok: boolean;
  database: 'up' | 'down' | 'not-configured';
}
