import { createHash, randomBytes } from 'node:crypto';
import type { CookieOptions, Request, Response } from 'express';
import { SESSION_COOKIE, SESSION_MAX_AGE_DAYS } from '../../shared/api';
import type { Repository, StoredUser } from '../db/repository';

export const SESSION_MAX_AGE_MS = SESSION_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;

/** 32 random bytes in base64url is 43 characters. Anything else cannot be one of our tokens. */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function newSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

/** The database keys sessions by this hash, so a leaked table cannot be replayed as cookies. */
export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Reads the session cookie, or null when it is absent or malformed. */
export function readSessionToken(req: Request): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0 || part.slice(0, eq).trim() !== SESSION_COOKIE) continue;
    const value = part.slice(eq + 1).trim();
    return TOKEN_PATTERN.test(value) ? value : null;
  }
  return null;
}

export function sessionCookieOptions(secure: boolean): CookieOptions {
  return { httpOnly: true, sameSite: 'lax', secure, path: '/', maxAge: SESSION_MAX_AGE_MS };
}

/** Creates a session for the user, stores its hash and sets the cookie. */
export async function startSession(
  repo: Repository,
  res: Response,
  options: { cookieSecure: boolean; now: number },
  userId: string,
): Promise<void> {
  const token = newSessionToken();
  await repo.createSession({
    tokenHash: hashSessionToken(token),
    userId,
    createdAt: options.now,
    expiresAt: options.now + SESSION_MAX_AGE_MS,
  });
  res.cookie(SESSION_COOKIE, token, sessionCookieOptions(options.cookieSecure));
}

/** Deletes the session the request carries, if any. */
export async function endSession(repo: Repository, req: Request): Promise<void> {
  const token = readSessionToken(req);
  if (token) await repo.deleteSession(hashSessionToken(token));
}

export function clearSessionCookie(res: Response, cookieSecure: boolean): void {
  res.clearCookie(SESSION_COOKIE, sessionCookieOptions(cookieSecure));
}

/** The user behind the request's session, or null when there is no valid session. */
export async function resolveSession(
  repo: Repository,
  req: Request,
  now: number,
): Promise<StoredUser | null> {
  const token = readSessionToken(req);
  if (!token) return null;
  return repo.findSessionUser(hashSessionToken(token), now);
}
