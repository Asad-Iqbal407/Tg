import type { RequestHandler } from 'express';
import { HttpError } from './errors';

const STATE_CHANGING = new Set(['POST', 'PUT', 'DELETE']);

/** Every /api response is private and never sniffed into another type. */
export const apiHeaders: RequestHandler = (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  next();
};

/**
 * Cross-site defence for state-changing requests. Browsers send an Origin header on these, and it must
 * be the app's own origin. Requests without one (tools, server-to-server) pass this check.
 */
export function originGuard(appOrigin: string): RequestHandler {
  return (req, _res, next) => {
    if (!STATE_CHANGING.has(req.method)) return next();
    const origin = req.headers.origin;
    if (origin !== undefined && origin !== appOrigin) {
      throw new HttpError(403, 'forbidden_origin', 'This request came from an origin that is not allowed.');
    }
    next();
  };
}

/** Requires JSON for state-changing requests. A form post cannot send application/json without a preflight. */
export const jsonGuard: RequestHandler = (req, _res, next) => {
  if (!STATE_CHANGING.has(req.method)) return next();
  if (!req.is('application/json')) {
    throw new HttpError(415, 'unsupported_media_type', 'Send the request body as application/json.');
  }
  next();
};
