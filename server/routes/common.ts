import type { Request } from 'express';
import type { AccountResponse, PublicUser } from '../../shared/api';
import type { Config } from '../config';
import type { Repository, StoredProfile, StoredUser } from '../db/repository';
import { resolveSession } from '../auth/session';
import { unauthorized } from '../http/errors';
import type { RateLimiter } from '../http/rate-limit';

/** What the routes need from the process: configuration, storage, the clock and the limiter. */
export interface RouteContext {
  config: Pick<Config, 'appOrigin' | 'cookieSecure' | 'trustProxy' | 'dataStore'>;
  repo: Repository;
  now: () => number;
  limiter: RateLimiter;
}

/** Never includes the password hash. */
export function toPublicUser(user: StoredUser): PublicUser {
  return { id: user.id, username: user.username, createdAt: user.createdAt };
}

export function accountResponse(user: StoredUser, stored: StoredProfile): AccountResponse {
  return { user: toPublicUser(user), profile: stored.profile, version: stored.version };
}

/** Loads the user behind the session, or fails with 401. */
export async function requireUser(ctx: RouteContext, req: Request): Promise<StoredUser> {
  const user = await resolveSession(ctx.repo, req, ctx.now());
  if (!user) throw unauthorized();
  return user;
}

/** Every user gets a profile when they register, so a missing one means the data is damaged. */
export async function loadProfile(ctx: RouteContext, user: StoredUser): Promise<StoredProfile> {
  const stored = await ctx.repo.getProfile(user.id);
  if (!stored) throw new Error(`Profile missing for user ${user.id}.`);
  return stored;
}
