import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { GAME_IDS, type GameId } from '../../src/games/types';
import { LEADERBOARD_SIZE } from '../../src/meta/profile';
import type {
  LeaderboardResponse,
  RunListResponse,
  RunRecord,
  RunRequest,
  RunResponse,
} from '../../shared/api';
import type { StoredRun } from '../db/repository';
import { HttpError, invalidRequest, parseWith } from '../http/errors';
import { type RouteContext, requireUser } from './common';

/** A run may claim a start time at most this far ahead of the server clock. */
const FUTURE_SKEW_MS = 5 * 60 * 1000;
const MAX_STATS = 64;
/** Stat names are short words such as `coins` or `bestRound`, which matches the mission stat limit. */
const STAT_KEY = /^[A-Za-z][A-Za-z0-9_]{0,31}$/;
const DEFAULT_RUN_LIMIT = 20;
const MAX_RUN_LIMIT = 50;

export function isGameId(value: string): value is GameId {
  return (GAME_IDS as readonly string[]).includes(value);
}

function integer(name: string, min: number, max: number) {
  const message = `${name} must be a whole number from ${min} to ${max}.`;
  return z
    .number({ error: message })
    .int({ error: message })
    .min(min, { error: message })
    .max(max, { error: message });
}

const STAT_NAME_MESSAGE = 'Stat names must start with a letter and use only letters, digits and underscores.';
const STAT_VALUE_MESSAGE = 'Stat values must be from 0 to 1000000000.';

/**
 * Checks the stats object as received. zod's record schema would drop a `__proto__` key without
 * complaint, so the keys are read straight off the parsed JSON and rejected when they do not match.
 */
function statsProblem(raw: Record<string, unknown>): string | null {
  const keys = Object.keys(raw);
  if (keys.length > MAX_STATS) return `A run can report at most ${MAX_STATS} stats.`;
  for (const key of keys) {
    if (!STAT_KEY.test(key)) return STAT_NAME_MESSAGE;
    const value = raw[key];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1e9) {
      return STAT_VALUE_MESSAGE;
    }
  }
  return null;
}

const statsSchema = z
  .custom<Record<string, unknown>>(
    (value) => typeof value === 'object' && value !== null && !Array.isArray(value),
    { error: 'stats must be an object of numbers.' },
  )
  .superRefine((raw, ctx) => {
    const problem = statsProblem(raw);
    if (problem) ctx.addIssue({ code: 'custom', message: problem, input: raw });
  })
  .transform((raw) => Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, v as number])));

/** The run schema depends on the clock, because startedAt may not be far in the future. */
export function runRequestSchema(now: number) {
  return z.object(
    {
      clientRunId: z.uuid({ error: 'clientRunId must be a UUID.' }),
      gameId: z.enum(GAME_IDS, { error: 'gameId must be one of the games in the arcade.' }),
      score: integer('score', 0, 10_000_000),
      coins: integer('coins', 0, 1_000_000),
      xp: integer('xp', 0, 1_000_000),
      durationSec: z
        .number({ error: 'durationSec must be a number from 0 to 86400.' })
        .min(0, { error: 'durationSec must be a number from 0 to 86400.' })
        .max(86_400, { error: 'durationSec must be a number from 0 to 86400.' }),
      stats: statsSchema,
      startedAt: integer('startedAt', 0, Number.MAX_SAFE_INTEGER).refine(
        (startedAt) => startedAt <= now + FUTURE_SKEW_MS,
        { error: 'startedAt cannot be more than five minutes in the future.' },
      ),
    },
    { error: 'Send a JSON object describing the run.' },
  );
}

function parseLimit(raw: unknown): number {
  const message = `limit must be a whole number from 1 to ${MAX_RUN_LIMIT}.`;
  if (raw === undefined) return DEFAULT_RUN_LIMIT;
  if (typeof raw !== 'string' || !/^\d{1,3}$/.test(raw)) throw invalidRequest(message);
  const limit = Number(raw);
  if (limit < 1 || limit > MAX_RUN_LIMIT) throw invalidRequest(message);
  return limit;
}

function toRunRecord(run: StoredRun): RunRecord {
  return {
    id: run.id,
    gameId: run.gameId,
    score: run.score,
    coins: run.coins,
    durationSec: run.durationSec,
    createdAt: run.createdAt,
  };
}

export function runRoutes(ctx: RouteContext): Router {
  const router = Router();

  router.post('/runs', async (req, res) => {
    const user = await requireUser(ctx, req);
    const now = ctx.now();
    const body: RunRequest = parseWith(runRequestSchema(now), req.body);
    const run: StoredRun = {
      id: randomUUID(),
      userId: user.id,
      username: user.username,
      clientRunId: body.clientRunId,
      gameId: body.gameId,
      score: body.score,
      coins: body.coins,
      xp: body.xp,
      durationSec: body.durationSec,
      stats: body.stats,
      startedAt: body.startedAt,
      createdAt: now,
    };
    const { run: stored, created } = await ctx.repo.insertRun(run);
    const response: RunResponse = { id: stored.id, duplicate: !created, createdAt: stored.createdAt };
    res.status(created ? 201 : 200).json(response);
  });

  router.get('/runs', async (req, res) => {
    const user = await requireUser(ctx, req);
    const runs = await ctx.repo.listRuns(user.id, parseLimit(req.query.limit));
    const response: RunListResponse = { runs: runs.map(toRunRecord) };
    res.json(response);
  });

  router.get('/leaderboard/:gameId', async (req, res) => {
    const gameId = req.params.gameId;
    if (!isGameId(gameId)) throw new HttpError(404, 'not_found', 'Unknown game.');
    const runs = await ctx.repo.topRuns(gameId, LEADERBOARD_SIZE);
    const response: LeaderboardResponse = {
      gameId,
      entries: runs.map((run) => ({ username: run.username, score: run.score, createdAt: run.createdAt })),
    };
    res.json(response);
  });

  return router;
}
