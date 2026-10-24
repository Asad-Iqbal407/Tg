import { randomUUID } from 'node:crypto';
import { type RequestHandler, Router } from 'express';
import { cleanName, defaultProfile } from '../../src/meta/profile';
import { authenticate, INVALID_CREDENTIALS_MESSAGE, loginSchema, registerSchema } from '../auth/credentials';
import { hashPassword } from '../auth/password';
import { clearSessionCookie, endSession, resolveSession, startSession } from '../auth/session';
import { DuplicateUsernameError, normalizeUsername, type StoredUser } from '../db/repository';
import { HttpError, parseWith } from '../http/errors';
import { type RouteContext, accountResponse, loadProfile, toPublicUser } from './common';

/**
 * Register and login are the brute-force targets, so each attempt counts against two limits: the
 * client address and the username. Both are checked before the password is verified.
 */
function limitAttempts(ctx: RouteContext): RequestHandler {
  return (req, res, next) => {
    const now = ctx.now();
    const keys = [`ip:${req.ip ?? 'unknown'}`];
    const username: unknown = req.body?.username;
    if (typeof username === 'string') keys.push(`user:${normalizeUsername(username.slice(0, 64))}`);
    for (const key of keys) {
      const decision = ctx.limiter.hit(key, now);
      if (!decision.allowed) {
        res.setHeader('Retry-After', String(decision.retryAfterSec));
        throw new HttpError(429, 'rate_limited', 'Too many attempts. Try again later.');
      }
    }
    next();
  };
}

export function authRoutes(ctx: RouteContext): Router {
  const router = Router();
  const limit = limitAttempts(ctx);

  router.get('/session', async (req, res) => {
    const user = await resolveSession(ctx.repo, req, ctx.now());
    res.json({ user: user ? toPublicUser(user) : null });
  });

  router.post('/register', limit, async (req, res) => {
    const credentials = parseWith(registerSchema, req.body);
    const now = ctx.now();
    const user: StoredUser = {
      id: randomUUID(),
      username: credentials.username,
      passwordHash: await hashPassword(credentials.password),
      createdAt: now,
    };
    const profile = { ...defaultProfile(now), name: cleanName(credentials.username) };
    try {
      await ctx.repo.createUserWithProfile(user, profile);
    } catch (error) {
      if (error instanceof DuplicateUsernameError) {
        throw new HttpError(409, 'username_taken', 'That username is already taken.');
      }
      throw error;
    }
    await startSession(ctx.repo, res, { cookieSecure: ctx.config.cookieSecure, now }, user.id);
    res.status(201).json(accountResponse(user, { profile, version: 0 }));
  });

  router.post('/login', limit, async (req, res) => {
    const credentials = parseWith(loginSchema, req.body);
    const user = await authenticate(ctx.repo, credentials.username, credentials.password);
    if (!user) throw new HttpError(401, 'invalid_credentials', INVALID_CREDENTIALS_MESSAGE);
    // A fresh session replaces whichever one this browser carried, so a stolen cookie stops working.
    await endSession(ctx.repo, req);
    await startSession(ctx.repo, res, { cookieSecure: ctx.config.cookieSecure, now: ctx.now() }, user.id);
    res.json(accountResponse(user, await loadProfile(ctx, user)));
  });

  router.post('/logout', async (req, res) => {
    await endSession(ctx.repo, req);
    clearSessionCookie(res, ctx.config.cookieSecure);
    res.json({ ok: true });
  });

  return router;
}
