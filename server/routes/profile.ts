import { Router } from 'express';
import { z } from 'zod';
import { sanitizeProfile } from '../../src/meta/profile';
import type { SaveProfileResponse, VersionConflict } from '../../shared/api';
import { diffProfiles, MAX_LEDGER_ENTRIES } from '../ledger';
import { HttpError, parseWith } from '../http/errors';
import { type RouteContext, accountResponse, loadProfile, requireUser } from './common';

const saveSchema = z.object(
  {
    baseVersion: z
      .number({ error: 'baseVersion must be a whole number.' })
      .int({ error: 'baseVersion must be a whole number.' })
      .min(0, { error: 'baseVersion must be a whole number.' }),
    profile: z.record(z.string(), z.unknown(), { error: 'profile must be an object.' }),
  },
  { error: 'Send a JSON object with baseVersion and profile.' },
);

function versionConflict(version: number): HttpError {
  const body: Omit<VersionConflict, 'error' | 'message'> = { version };
  return new HttpError(
    409,
    'version_conflict',
    'This profile was saved from another session. Reload it and try again.',
    body,
  );
}

export function profileRoutes(ctx: RouteContext): Router {
  const router = Router();

  router.get('/profile', async (req, res) => {
    const user = await requireUser(ctx, req);
    res.json(accountResponse(user, await loadProfile(ctx, user)));
  });

  router.put('/profile', async (req, res) => {
    const user = await requireUser(ctx, req);
    const body = parseWith(saveSchema, req.body);
    const stored = await loadProfile(ctx, user);
    if (body.baseVersion !== stored.version) throw versionConflict(stored.version);

    // Only the canonical shape is stored. Balances and unlocks still come from the client, so they are
    // recorded as reported and cannot be verified here.
    const profile = sanitizeProfile(body.profile);
    const now = ctx.now();
    const ledger = diffProfiles(stored.profile, profile, user.id, now);
    if (ledger.length > MAX_LEDGER_ENTRIES) {
      throw new HttpError(413, 'payload_too_large', 'This save changes too many items at once.');
    }

    const result = await ctx.repo.saveProfile({
      userId: user.id,
      baseVersion: body.baseVersion,
      profile,
      ledger,
      savedAt: now,
    });
    if (!result.saved) throw versionConflict(result.version);

    const response: SaveProfileResponse = { version: result.version, savedAt: now };
    res.json(response);
  });

  return router;
}
