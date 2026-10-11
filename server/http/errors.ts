import type { ErrorRequestHandler } from 'express';
import type { z } from 'zod';
import type { ApiErrorCode } from '../../shared/api';

/** An error with a known status and code. Its message is safe to show to the client. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiErrorCode,
    message: string,
    /** Extra fields for the body, such as `version` on a 409. */
    readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export function invalidRequest(message: string): HttpError {
  return new HttpError(400, 'invalid_request', message);
}

export function unauthorized(): HttpError {
  return new HttpError(401, 'unauthorized', 'Sign in to continue.');
}

/** Parses a request body or query value. The first failing rule becomes the readable message. */
export function parseWith<S extends z.ZodType>(schema: S, value: unknown): z.output<S> {
  const result = schema.safeParse(value);
  if (!result.success) throw invalidRequest(result.error.issues[0]?.message ?? 'Invalid request.');
  return result.data;
}

/** Turns anything thrown during a request into the ApiError shape, without stack traces. */
export function errorHandler(log: (line: string) => void): ErrorRequestHandler {
  return (error, req, res, next) => {
    if (res.headersSent) {
      next(error);
      return;
    }
    const known = error instanceof HttpError ? error : fromBodyParser(error);
    if (known) {
      res.status(known.status).json({ error: known.code, message: known.message, ...known.extra });
      return;
    }
    log(
      JSON.stringify({
        level: 'error',
        method: req.method,
        path: req.path,
        name: error instanceof Error ? error.name : 'UnknownError',
        message: error instanceof Error ? error.message : undefined,
      }),
    );
    res.status(500).json({ error: 'server_error', message: 'Something went wrong. Please try again.' });
  };
}

/** express.json() reports bad bodies with a `type`. Map those to the same error codes as the rest of the API. */
function fromBodyParser(error: unknown): HttpError | null {
  if (typeof error !== 'object' || error === null || !('type' in error)) return null;
  const type = String(error.type);
  if (type === 'entity.too.large')
    return new HttpError(413, 'payload_too_large', 'Request body is too large.');
  if (type === 'charset.unsupported' || type === 'encoding.unsupported') {
    return new HttpError(415, 'unsupported_media_type', 'Unsupported request encoding.');
  }
  if (type.startsWith('entity.')) return invalidRequest('Request body must be valid JSON.');
  // The client went away mid-request, so nothing is sent back; a 400 keeps it out of the error log.
  if (type === 'request.aborted') return invalidRequest('The request was cut off before it finished.');
  return null;
}
