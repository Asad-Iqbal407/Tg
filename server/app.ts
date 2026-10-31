import express, { type Express } from 'express';
import { dummyHash } from './auth/password';
import type { Repository } from './db/repository';
import { HttpError, errorHandler } from './http/errors';
import { apiHeaders, jsonGuard, originGuard } from './http/guards';
import { requestLogger, writeLine } from './http/logging';
import { createRateLimiter, type RateLimitOptions } from './http/rate-limit';
import { type RouteContext } from './routes/common';
import { authRoutes } from './routes/auth';
import { healthRoutes } from './routes/health';
import { profileRoutes } from './routes/profile';
import { runRoutes } from './routes/runs';

/** Ten attempts per client address and per username, in fifteen minutes. */
export const AUTH_RATE_LIMIT: RateLimitOptions = { limit: 10, windowMs: 15 * 60 * 1000 };
const JSON_BODY_LIMIT = '256kb';

export interface AppOptions {
  config: RouteContext['config'];
  repo: Repository;
  /** Epoch milliseconds. Tests pass a controlled clock. */
  now?: () => number;
  /** Receives one JSON line per request and per unexpected error. */
  log?: (line: string) => void;
  rateLimit?: RateLimitOptions;
}

/** Builds the Express app. Every API route lives under /api; nothing else is served. */
export function createApp(options: AppOptions): Express {
  const { config, repo } = options;
  const now = options.now ?? Date.now;
  const log = options.log ?? writeLine;
  const ctx: RouteContext = {
    config,
    repo,
    now,
    limiter: createRateLimiter(options.rateLimit ?? AUTH_RATE_LIMIT),
  };

  const app = express();
  app.disable('x-powered-by');
  app.set('etag', false);
  // With TRUST_PROXY, one hop is trusted (nginx), so the client address comes from the header nginx appends.
  app.set('trust proxy', config.trustProxy ? 1 : false);

  app.use(requestLogger(log));
  app.use(
    '/api',
    apiHeaders,
    originGuard(config.appOrigin),
    jsonGuard,
    express.json({ limit: JSON_BODY_LIMIT }),
    healthRoutes(ctx),
    authRoutes(ctx),
    profileRoutes(ctx),
    runRoutes(ctx),
  );
  app.use((_req, _res, next) => next(new HttpError(404, 'not_found', 'Not found.')));
  app.use(errorHandler(log));

  // Start hashing the dummy password now, so the first unknown-username login is not slower than the rest.
  void dummyHash();
  return app;
}
