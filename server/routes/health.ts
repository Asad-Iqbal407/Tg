import { Router } from 'express';
import type { HealthResponse } from '../../shared/api';
import type { RouteContext } from './common';

/** 200 when the database answers its ping, 503 when it does not. Memory mode has no database to check. */
export function healthRoutes(ctx: RouteContext): Router {
  const router = Router();

  router.get('/health', async (_req, res) => {
    if (ctx.config.dataStore === 'memory') {
      const body: HealthResponse = { ok: true, database: 'not-configured' };
      res.json(body);
      return;
    }
    const up = await ctx.repo.ping();
    const body: HealthResponse = { ok: up, database: up ? 'up' : 'down' };
    res.status(up ? 200 : 503).json(body);
  });

  return router;
}
